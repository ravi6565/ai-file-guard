import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalManifestStore } from '../core/localManifestStore';
import { LockManager } from '../core/lockManager';
import { PathResolver } from '../core/pathResolver';
import { PolicyEngine } from '../core/policyEngine';
import { IsolationManager } from '../isolation/isolationManager';
import { ChangeBroker } from '../isolation/changeBroker';
import { AuditLogger } from '../audit/auditLogger';

describe('Local policy and broker regressions', () => {
  let temporary: string;
  let workspace: string;
  let policyFile: string;
  const connect = async () => {
    const store = new LocalManifestStore(policyFile);
    await store.refresh();
    return new LockManager(store, new PathResolver());
  };
  beforeEach(async () => {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-file-guard-policy-'));
    workspace = path.join(temporary, 'workspace');
    policyFile = path.join(temporary, 'machine-storage', 'locks.json');
    await fs.mkdir(workspace);
  });
  afterEach(async () => { await fs.rm(temporary, { recursive: true, force: true }); });

  it('keeps simultaneous locks from two windows and refreshes live unlocks', async () => {
    const first = path.join(workspace, 'first.txt'); const second = path.join(workspace, 'second.txt');
    await fs.writeFile(first, 'first'); await fs.writeFile(second, 'second');
    const one = await connect(); const two = await connect();
    await Promise.all([one.lock(first, 'file'), two.lock(second, 'file')]);
    assert.equal((await one.status(second)).protected, true);
    assert.equal((await two.status(first)).protected, true);
    assert.equal(one.all().length, 2);
    await two.unlock(first);
    assert.equal((await one.status(first)).protected, false);
    assert.equal((await one.status(second)).protected, true);
  });

  (process.platform === 'win32' ? it : it.skip)('retains policy and its lease while a Windows reader briefly blocks replacement', async () => {
    const first = path.join(workspace, 'first.txt'); const second = path.join(workspace, 'second.txt');
    await fs.writeFile(first, 'first'); await fs.writeFile(second, 'second');
    const locks = await connect(); await locks.lock(first, 'file');
    const rename = fs.rename;
    let blocked = false;
    fs.rename = async (from, to) => {
      if (String(to) === policyFile && !blocked) {
        blocked = true;
        assert.equal(JSON.parse(await fs.readFile(policyFile, 'utf8')).locks.length, 1, 'The existing policy must not be unlinked.');
        assert.equal((await fs.stat(policyFile + '.lock')).isDirectory(), true);
        throw Object.assign(new Error('Transient Windows sharing fixture'), { code: 'EPERM' });
      }
      return rename(from, to);
    };
    try { await locks.lock(second, 'file'); }
    finally { fs.rename = rename; }
    assert.equal(blocked, true);
    const reopened = await connect();
    assert.equal((await reopened.status(first)).protected, true);
    assert.equal((await reopened.status(second)).protected, true);
    await assert.rejects(fs.access(policyFile + '.lock'), { code: 'ENOENT' });
    assert.equal(await reopened.unlock(second), true);
  });

  it('retains locks after reopening from a different workspace context', async () => {
    const file = path.join(workspace, 'file.txt'); await fs.writeFile(file, 'manual');
    await (await connect()).lock(file, 'file');
    const reopened = await connect();
    assert.equal((await reopened.status(file)).protected, true);
    await fs.unlink(file);
    assert.equal((await reopened.status(file, true)).protected, true);
    assert.equal(await reopened.unlock(file), true);
  });

  it('stores policy outside the repository without changing permissions or tracked files', async () => {
    const file = path.join(workspace, 'file.txt'); await fs.writeFile(file, 'manual');
    const originalMode = (await fs.stat(file)).mode & 0o777;
    const locks = await connect(); await locks.lock(file, 'file');
    await fs.writeFile(file, 'developer changed it while locked');
    assert.equal((await fs.stat(file)).mode & 0o777, originalMode);
    assert.deepEqual(await fs.readdir(workspace), ['file.txt']);
    const content = JSON.parse(await fs.readFile(policyFile, 'utf8'));
    assert.equal(content.locks.length, 1);
    if (process.platform !== 'win32') assert.equal((await fs.stat(policyFile)).mode & 0o777, 0o600);
    const otherMachine = new LocalManifestStore(path.join(temporary, 'other-machine', 'locks.json'));
    await otherMachine.refresh();
    assert.equal(otherMachine.load().locks.length, 0);
  });

  it('fails on corrupted policy rather than silently allowing writes', async () => {
    const file = path.join(workspace, 'file.txt'); await fs.writeFile(file, 'original');
    const locks = await connect(); await locks.lock(file, 'file');
    const session = await new IsolationManager(path.join(temporary, 'sessions')).create(workspace);
    await fs.writeFile(path.join(session.stagingRoot, 'file.txt'), 'agent');
    await fs.writeFile(policyFile, '{invalid json');
    await assert.rejects(locks.status(file));
    await assert.rejects(new ChangeBroker(locks, new AuditLogger(path.join(temporary, 'audit'))).apply(session));
    assert.equal(await fs.readFile(file, 'utf8'), 'original');
  });

  it('rejects deleting or renaming a parent containing a locked descendant', async () => {
    const folder = path.join(workspace, 'src'); await fs.mkdir(folder);
    const file = path.join(folder, 'locked.txt'); await fs.writeFile(file, 'locked');
    const locks = await connect(); await locks.lock(file, 'file');
    const policy = new PolicyEngine(locks);
    assert.equal((await policy.evaluate({ type: 'delete', path: folder }, 'review')).allowed, false);
    assert.equal((await policy.evaluate({ type: 'rename', source: folder, destination: path.join(workspace, 'moved') }, 'review')).allowed, false);
    assert.equal((await policy.evaluate({ type: 'create', path: path.join(folder, 'free.txt') }, 'review')).allowed, true);
  });

  it('fails if an existing policy is accidentally removed', async () => {
    const file = path.join(workspace, 'file.txt'); await fs.writeFile(file, 'original');
    const locks = await connect(); await locks.lock(file, 'file');
    await fs.unlink(policyFile);
    await assert.rejects(locks.status(file), /disappeared/);
  });

  it('does not strand the transaction lock after an operation throws', async () => {
    const store = new LocalManifestStore(policyFile);
    await assert.rejects(store.transact(() => { throw new Error('simulated failure'); }), /simulated/);
    await store.transact(current => current.locks);
    assert.equal(store.load().locks.length, 0);
  });

  it('preserves executable permissions when applying a free file change', async () => {
    const file = path.join(workspace, 'run.sh'); await fs.writeFile(file, '#!/bin/sh\n');
    if (process.platform !== 'win32') await fs.chmod(file, 0o750);
    const locks = await connect();
    const session = await new IsolationManager(path.join(temporary, 'sessions')).create(workspace);
    await fs.writeFile(path.join(session.stagingRoot, 'run.sh'), '#!/bin/sh\nexit 0\n');
    const result = await new ChangeBroker(locks, new AuditLogger(path.join(temporary, 'audit'))).apply(session);
    assert.equal(result.applied.length, 1);
    if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o750);
  });

  it('checks current locks and unlocks instead of the policy at session creation', async () => {
    const file = path.join(workspace, 'file.txt'); await fs.writeFile(file, 'original');
    const locks = await connect();
    const session = await new IsolationManager(path.join(temporary, 'sessions')).create(workspace);
    await fs.writeFile(path.join(session.stagingRoot, 'file.txt'), 'agent');
    await locks.lock(file, 'file');
    const broker = new ChangeBroker(locks, new AuditLogger(path.join(temporary, 'audit')));
    const denied = await broker.apply(session);
    assert.equal(denied.applied.length, 0); assert.equal(denied.rejected.length, 1);
    await locks.unlock(file);
    const allowed = await broker.apply(session);
    assert.equal(allowed.applied.length, 1);
    assert.equal(await fs.readFile(file, 'utf8'), 'agent');
  });

  it('denies creates, writes and deletes at every depth of a locked folder', async () => {
    const folder = path.join(workspace, 'locked'); await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, 'write.txt'), 'write original');
    await fs.writeFile(path.join(folder, 'delete.txt'), 'delete original');
    const locks = await connect(); await locks.lock(folder, 'directory');
    const session = await new IsolationManager(path.join(temporary, 'sessions')).create(workspace);
    const staged = path.join(session.stagingRoot, 'locked');
    await fs.writeFile(path.join(staged, 'write.txt'), 'agent');
    await fs.unlink(path.join(staged, 'delete.txt'));
    await fs.mkdir(path.join(staged, 'deep'));
    await fs.writeFile(path.join(staged, 'deep', 'create.txt'), 'agent');
    const result = await new ChangeBroker(locks, new AuditLogger(path.join(temporary, 'audit'))).apply(session);
    assert.equal(result.applied.length, 0); assert.equal(result.rejected.length, 4);
    assert.equal(await fs.readFile(path.join(folder, 'write.txt'), 'utf8'), 'write original');
    assert.equal(await fs.readFile(path.join(folder, 'delete.txt'), 'utf8'), 'delete original');
    await assert.rejects(fs.stat(path.join(folder, 'deep')));
  });

  it('rejects a destination symlink outside the original workspace', async () => {
    const outside = path.join(temporary, 'outside'); await fs.mkdir(outside);
    const locks = await connect();
    const session = await new IsolationManager(path.join(temporary, 'sessions')).create(workspace);
    await fs.mkdir(path.join(session.stagingRoot, 'escape'));
    await fs.writeFile(path.join(session.stagingRoot, 'escape', 'created.txt'), 'agent');
    await fs.symlink(outside, path.join(workspace, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    const result = await new ChangeBroker(locks, new AuditLogger(path.join(temporary, 'audit'))).apply(session);
    assert.equal(result.applied.length, 0); assert.match(result.rejected[0].reason, /Symlink|junction/);
    assert.deepEqual(await fs.readdir(outside), []);
  });

  it('keeps a manually renamed locked folder and its future descendants protected', async () => {
    const before = path.join(workspace, 'before'); const after = path.join(workspace, 'after');
    await fs.mkdir(before);
    const locks = await connect(); await locks.lock(before, 'directory');
    await fs.rename(before, after);
    assert.equal((await locks.status(after)).protected, true);
    assert.equal((await locks.status(path.join(after, 'future.txt'), true)).protected, true);
    assert.equal(await locks.unlock(before), true);
    assert.equal((await locks.status(path.join(after, 'future.txt'), true)).protected, false);
  });

  it('rejects recursive review copies when session storage is inside the project', async () => {
    await assert.rejects(new IsolationManager(path.join(workspace, 'sessions')).create(workspace), /recursive copying/);
    assert.deepEqual(await fs.readdir(workspace), []);
  });

  it('rejects staged symlink substitution without deleting original content', async function () {
    if (process.platform === 'win32') this.skip();
    const file = path.join(workspace, 'file.txt'); await fs.writeFile(file, 'original');
    const outside = path.join(temporary, 'outside.txt'); await fs.writeFile(outside, 'outside secret');
    const locks = await connect();
    const session = await new IsolationManager(path.join(temporary, 'sessions')).create(workspace);
    await fs.unlink(path.join(session.stagingRoot, 'file.txt'));
    await fs.symlink(outside, path.join(session.stagingRoot, 'file.txt'));
    const result = await new ChangeBroker(locks, new AuditLogger(path.join(temporary, 'audit'))).apply(session);
    assert.equal(result.applied.length, 0); assert.match(result.rejected[0].reason, /Symlink/);
    assert.equal(await fs.readFile(file, 'utf8'), 'original');
  });

  it('rejects paths outside the workspace in a tampered session baseline', async () => {
    const outside = path.join(temporary, 'outside.txt'); await fs.writeFile(outside, 'outside');
    const locks = await connect();
    const session = await new IsolationManager(path.join(temporary, 'sessions')).create(workspace);
    const result = await new ChangeBroker(locks, new AuditLogger(path.join(temporary, 'audit'))).apply({
      ...session, baseline: [{ relativePath: '../outside.txt', hash: 'ignored' }],
    });
    assert.equal(result.applied.length, 0); assert.match(result.rejected[0].reason, /traversal/);
    assert.equal(await fs.readFile(outside, 'utf8'), 'outside');
  });

  it('recovers the audit queue after an individual write fails', async () => {
    const blocker = path.join(temporary, 'blocker'); await fs.writeFile(blocker, 'not a directory');
    const audit = new AuditLogger(path.join(blocker, 'events.jsonl'));
    await assert.rejects(audit.record({ action: 'first', outcome: 'failure' }));
    await fs.unlink(blocker);
    await audit.record({ action: 'second', outcome: 'success' });
    assert.match(await fs.readFile(audit.location(), 'utf8'), /second/);
  });

  it('supports repeated applications without accepting unsubmitted developer edits', async () => {
    const file = path.join(workspace, 'file.txt'); await fs.writeFile(file, 'original');
    const locks = await connect();
    const broker = new ChangeBroker(locks, new AuditLogger(path.join(temporary, 'audit')));
    let session = await new IsolationManager(path.join(temporary, 'sessions')).create(workspace);
    const staged = path.join(session.stagingRoot, 'file.txt');
    await fs.writeFile(staged, 'first agent update');
    const first = await broker.apply(session);
    assert.equal(first.applied.length, 1);
    session = broker.advanceBaseline(session, first);
    assert.equal((await broker.preview(session)).length, 0);
    await fs.writeFile(staged, 'second agent update');
    const second = await broker.apply(session);
    assert.equal(second.applied.length, 1);
    session = broker.advanceBaseline(session, second);
    await fs.writeFile(file, 'developer update');
    await fs.writeFile(staged, 'third agent update');
    const review = await broker.review(session);
    assert.equal(review[0].allowed, false);
    const third = await broker.apply(session);
    assert.equal(third.applied.length, 0);
    assert.equal(await fs.readFile(file, 'utf8'), 'developer update');
  });
});
