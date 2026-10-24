import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ManagedSectionSynchronizer } from '../instructions/managedSection';
import { SnapshotManager } from '../snapshots/snapshotManager';
import { LockManager } from '../core/lockManager';
import { ManifestStore, KeyValueStore } from '../core/manifestStore';
import { PathResolver } from '../core/pathResolver';
import { IsolationManager } from '../isolation/isolationManager';
import { ChangeBroker } from '../isolation/changeBroker';
import { AuditLogger } from '../audit/auditLogger';
import { PermissionEnforcer } from '../enforcement/permissionEnforcer';

class MemoryStore implements KeyValueStore {
  private readonly values = new Map<string, unknown>();
  public get<T>(key: string, fallback: T): T { return (this.values.has(key) ? this.values.get(key) : fallback) as T; }
  public update(key: string, value: unknown): Thenable<void> { this.values.set(key, value); return Promise.resolve(); }
}

describe('Phases 3-6 services', () => {
  let temporary: string;
  beforeEach(async () => { temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-file-guard-test-')); });
  afterEach(async () => { await fs.rm(temporary, { recursive: true, force: true }); });

  it('updates only its bounded instruction section', () => {
    const sync = new ManagedSectionSynchronizer();
    const first = sync.merge('# User rules\n\nKeep this.\n', '## AI File Guard\n- `secret.ts`');
    const second = sync.merge(first, '## AI File Guard\n- `stable.ts`');
    assert.match(second, /# User rules/); assert.match(second, /Keep this/); assert.doesNotMatch(second, /secret\.ts/);
    assert.equal((second.match(/AI FILE GUARD:BEGIN/g) ?? []).length, 1);
  });

  it('verifies snapshots and refuses recovery after a concurrent change', async () => {
    const file = path.join(temporary, 'stable.ts'); await fs.writeFile(file, 'trusted');
    const snapshots = new SnapshotManager(path.join(temporary, 'snapshots')); await snapshots.initialize();
    await snapshots.capture({ canonicalPath: file, displayPath: file, kind: 'file', lockedAt: new Date().toISOString() });
    await fs.writeFile(file, 'agent change'); const detected = await snapshots.verify(file);
    assert.equal(detected.changed, true);
    await fs.writeFile(file, 'developer change');
    await assert.rejects(snapshots.restore(file, detected.actual), /changed again/);
    assert.equal(await fs.readFile(file, 'utf8'), 'developer change');
  });

  it('detects and safely removes a newly created protected file', async () => {
    const snapshots = new SnapshotManager(path.join(temporary, 'snapshots')); await snapshots.initialize();
    const created = path.join(temporary, 'created.ts'); await fs.writeFile(created, 'agent-created');
    const detected = await snapshots.verify(created); assert.equal(detected.changed, true);
    await snapshots.restore(created, detected.actual);
    await assert.rejects(fs.stat(created), error => (error as NodeJS.ErrnoException).code === 'ENOENT');
  });

  it('recognizes hard-link aliases to an explicitly locked file', async () => {
    const original = path.join(temporary, 'original.ts'); const alias = path.join(temporary, 'alias.ts');
    await fs.writeFile(original, 'stable'); await fs.link(original, alias);
    const locks = new LockManager(new ManifestStore(new MemoryStore()), new PathResolver());
    await locks.lock(original, 'file');
    const status = await locks.status(alias);
    assert.equal(status.protected, true); assert.equal(status.protected && status.explicit, false);
  });

  it('broker applies free changes and rejects protected changes', async () => {
    const workspace = path.join(temporary, 'workspace'); await fs.mkdir(workspace);
    const protectedFile = path.join(workspace, 'stable.ts'); const freeFile = path.join(workspace, 'free.ts');
    await fs.writeFile(protectedFile, 'stable'); await fs.writeFile(freeFile, 'before');
    const locks = new LockManager(new ManifestStore(new MemoryStore()), new PathResolver()); await locks.lock(protectedFile, 'file');
    const session = await new IsolationManager(path.join(temporary, 'sessions')).create(workspace);
    await fs.writeFile(path.join(session.stagingRoot, 'stable.ts'), 'forbidden');
    await fs.writeFile(path.join(session.stagingRoot, 'free.ts'), 'allowed');
    const result = await new ChangeBroker(locks, new AuditLogger(path.join(temporary, 'audit.jsonl'))).apply(session);
    assert.equal(result.applied.length, 1); assert.equal(result.rejected.length, 1);
    assert.equal(await fs.readFile(protectedFile, 'utf8'), 'stable');
    assert.equal(await fs.readFile(freeFile, 'utf8'), 'allowed');
  });

  it('broker rejects concurrent original modifications', async () => {
    const workspace = path.join(temporary, 'workspace'); await fs.mkdir(workspace);
    const file = path.join(workspace, 'free.ts'); await fs.writeFile(file, 'baseline');
    const locks = new LockManager(new ManifestStore(new MemoryStore()), new PathResolver());
    const session = await new IsolationManager(path.join(temporary, 'sessions')).create(workspace);
    await fs.writeFile(path.join(session.stagingRoot, 'free.ts'), 'agent'); await fs.writeFile(file, 'developer');
    const result = await new ChangeBroker(locks, new AuditLogger(path.join(temporary, 'audit.jsonl'))).apply(session);
    assert.equal(result.applied.length, 0); assert.match(result.rejected[0].reason, /concurrently/);
    assert.equal(await fs.readFile(file, 'utf8'), 'developer');
  });

  it('broker rejects managed policy changes', async () => {
    const workspace = path.join(temporary, 'workspace'); await fs.mkdir(path.join(workspace, '.github'), { recursive: true });
    const policy = path.join(workspace, '.github', 'copilot-instructions.md'); await fs.writeFile(policy, 'trusted');
    const locks = new LockManager(new ManifestStore(new MemoryStore()), new PathResolver());
    const session = await new IsolationManager(path.join(temporary, 'sessions')).create(workspace);
    await fs.writeFile(path.join(session.stagingRoot, '.github', 'copilot-instructions.md'), 'tampered');
    const result = await new ChangeBroker(locks, new AuditLogger(path.join(temporary, 'audit.jsonl'))).apply(session);
    assert.equal(result.applied.length, 0); assert.match(result.rejected[0].reason, /policy/);
  });

  it('hard locks and restores original filesystem write permissions', async () => {
    const root = path.join(temporary, 'locked'); await fs.mkdir(root);
    const file = path.join(root, 'stable.ts'); await fs.writeFile(file, 'stable'); await fs.chmod(file, 0o640); await fs.chmod(root, 0o750);
    const store = new MemoryStore(); const enforcer = new PermissionEnforcer(store);
    await enforcer.enforce([{ canonicalPath: root, displayPath: root, kind: 'directory', lockedAt: new Date().toISOString() }]);
    if (process.platform !== 'win32') {
      assert.equal((await fs.stat(file)).mode & 0o222, 0); assert.equal((await fs.stat(root)).mode & 0o222, 0);
    }
    if (process.platform === 'darwin') {
      await assert.rejects(fs.rename(file, path.join(root, 'renamed.ts')), error => ['EPERM', 'EACCES'].includes(String((error as NodeJS.ErrnoException).code)));
      await assert.rejects(fs.unlink(file), error => ['EPERM', 'EACCES'].includes(String((error as NodeJS.ErrnoException).code)));
    }
    await enforcer.suspend();
    if (process.platform !== 'win32') {
      assert.equal((await fs.stat(file)).mode & 0o777, 0o640); assert.equal((await fs.stat(root)).mode & 0o777, 0o750);
    }
  });
});
