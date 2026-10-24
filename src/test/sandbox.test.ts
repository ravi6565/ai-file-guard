import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { ManagedSandbox, macProfile, sandboxEnvironment } from '../enforcement/managedSandbox';
import { LocalManifestStore } from '../core/localManifestStore';
import { LockManager } from '../core/lockManager';
import { PathResolver } from '../core/pathResolver';
import { IsolationManager } from '../isolation/isolationManager';
import { ChangeBroker } from '../isolation/changeBroker';
import { AuditLogger } from '../audit/auditLogger';
import { createServer } from 'node:net';

const execFile = promisify(execFileCallback);
describe('Managed sandbox profile', () => {
  it('denies by default and never inherits editor IPC configuration', () => {
    const profile = macProfile(['/private/tmp/guard-workspace']);
    assert.match(profile, /\(deny default\)/);
    assert.throws(() => macProfile(['/']), /Unsafe/);
    assert.throws(() => macProfile(['/tmp/line\nbreak']), /Unsafe/);
    const env = sandboxEnvironment('/private/tmp/home', '/private/tmp/tmp');
    assert.equal(env.VSCODE_IPC_HOOK_CLI, undefined);
    assert.equal(env.NODE_OPTIONS, undefined);
    assert.equal(env.SSH_AUTH_SOCK, undefined);
  });
  it('refuses unsupported platforms without launching an agent', async () => {
    const result = await new ManagedSandbox('/unused', 'linux').verify();
    assert.equal(result.available, false);
  });
});

// Run with npm run test:sandbox on a real, unrestricted macOS test host.
// Sandboxed coding-agent tool processes cannot always nest sandbox-exec.
const native = process.env.AI_FILE_GUARD_NATIVE_TESTS === '1' && process.platform === 'darwin' ? describe : describe.skip;
native('Native managed agent enforcement', function () {
  this.timeout(30_000);
  let root: string;
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-file-guard-native-')); root = await fs.realpath(root); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
  it('verifies real OS write denial while normal developer writes remain allowed', async () => {
    const result = await new ManagedSandbox(path.join(root, 'control')).verify();
    assert.equal(result.available, true, result.reason);
  });
  it('blocks write/create/delete/rename/atomic replacement and child-process bypasses', async () => {
    const original = path.join(root, 'original'); const staged = path.join(root, 'session', 'workspace');
    await fs.mkdir(original); await fs.mkdir(staged, { recursive: true });
    const file = path.join(original, 'locked.txt'); await fs.writeFile(file, 'original');
    const runtime = new ManagedSandbox(path.join(root, 'control'));
    const launch = await runtime.prepare(staged, original);
    const script = `const fs=require('node:fs'),p=require('node:path'),cp=require('node:child_process');
      const [original,stage]=process.argv.slice(1),file=p.join(original,'locked.txt');let checked=0;
      const denied=fn=>{try{fn()}catch(e){if(['EPERM','EACCES','EROFS'].includes(e.code)){checked++;return}throw e}throw Error('write escaped sandbox')};
      denied(()=>fs.writeFileSync(file,'bad'));denied(()=>fs.writeFileSync(p.join(original,'new.txt'),'bad'));
      denied(()=>fs.unlinkSync(file));denied(()=>fs.renameSync(file,file+'.moved'));
      denied(()=>fs.mkdirSync(p.join(original,'folder')));
      const temp=p.join(stage,'temp');fs.writeFileSync(temp,'bad');denied(()=>fs.renameSync(temp,file));
      const alias=p.join(stage,'alias');fs.symlinkSync(file,alias);denied(()=>fs.writeFileSync(alias,'bad'));
      denied(()=>fs.linkSync(file,p.join(stage,'hardlink')));
      const child=cp.spawnSync('/bin/sh',['-c','printf bad > "$1"','guard',file]);if(child.status===0)throw Error('child escaped');
      fs.writeFileSync(p.join(stage,'allowed.txt'),'agent change');process.stdout.write('CHECKED:'+checked);`;
    const result = await execFile(launch.executable, ['-f', launch.profilePath, process.execPath, '-e', script, original, staged], {
      cwd: staged, env: { ...launch.environment, ELECTRON_RUN_AS_NODE: '1' }, timeout: 15_000,
    });
    assert.match(result.stdout, /CHECKED:8/);
    assert.equal(await fs.readFile(file, 'utf8'), 'original');
    await fs.writeFile(file, 'developer edit');
    assert.equal(await fs.readFile(file, 'utf8'), 'developer edit');
    assert.equal(await fs.readFile(path.join(staged, 'allowed.txt'), 'utf8'), 'agent change');
  });

  it('enforces live locks on agent proposals, then applies file and directory changes after unlock', async () => {
    const original = path.join(root, 'original'); const docs = path.join(original, 'docs');
    await fs.mkdir(docs, { recursive: true });
    await fs.writeFile(path.join(docs, 'edit.txt'), 'original');
    await fs.writeFile(path.join(docs, 'delete.txt'), 'original');
    await fs.mkdir(path.join(docs, 'remove-empty'));
    const policyFile = path.join(root, 'control', 'policy.json');
    const store = new LocalManifestStore(policyFile); await store.refresh();
    const locks = new LockManager(store, new PathResolver());
    // Start before locking to prove application uses live policy.
    const session = await new IsolationManager(path.join(root, 'sessions')).create(original);
    const launch = await new ManagedSandbox(path.join(root, 'runtime')).prepare(session.stagingRoot, original);
    await locks.lock(docs, 'directory');
    const script = `const fs=require('node:fs'),p=require('node:path');const [stage,policy]=process.argv.slice(1);
      const docs=p.join(stage,'docs');fs.writeFileSync(p.join(docs,'edit.txt'),'agent');
      fs.unlinkSync(p.join(docs,'delete.txt'));fs.rmdirSync(p.join(docs,'remove-empty'));
      fs.mkdirSync(p.join(docs,'new-folder'));fs.writeFileSync(p.join(docs,'new-folder','created.txt'),'agent');
      try{fs.writeFileSync(policy,'{}');process.exit(49)}catch(e){if(!['EPERM','EACCES'].includes(e.code))throw e}
      process.stdout.write('PROPOSED');`;
    const result = await execFile(launch.executable, ['-f', launch.profilePath, process.execPath, '-e', script, session.stagingRoot, policyFile], {
      cwd: session.stagingRoot, env: { ...launch.environment, ELECTRON_RUN_AS_NODE: '1' }, timeout: 15_000,
    });
    assert.match(result.stdout, /PROPOSED/);
    const broker = new ChangeBroker(locks, new AuditLogger(path.join(root, 'audit')));
    const blocked = await broker.apply(session);
    assert.equal(blocked.applied.length, 0); assert.equal(blocked.rejected.length, 5);
    assert.equal(await fs.readFile(path.join(docs, 'edit.txt'), 'utf8'), 'original');
    assert.equal(await fs.readFile(path.join(docs, 'delete.txt'), 'utf8'), 'original');
    assert.ok((await fs.stat(path.join(docs, 'remove-empty'))).isDirectory());
    await assert.rejects(fs.stat(path.join(docs, 'new-folder')));
    await fs.writeFile(path.join(original, 'developer.txt'), 'manual edits allowed');
    await locks.unlock(docs);
    const allowed = await broker.apply(session);
    assert.equal(allowed.rejected.length, 0, JSON.stringify(allowed.rejected));
    assert.equal(allowed.applied.length, 5);
    assert.equal(await fs.readFile(path.join(docs, 'edit.txt'), 'utf8'), 'agent');
    assert.equal(await fs.readFile(path.join(docs, 'new-folder', 'created.txt'), 'utf8'), 'agent');
    await assert.rejects(fs.stat(path.join(docs, 'delete.txt')));
    await assert.rejects(fs.stat(path.join(docs, 'remove-empty')));
  });

  it('denies local TCP access to host control services', async () => {
    const server = createServer(socket => { socket.on('error', () => undefined); socket.end('host service'); });
    await new Promise<void>(resolve => server.listen(0, '::', resolve));
    try {
      const address = server.address(); assert.ok(address && typeof address !== 'string');
      const original = path.join(root, 'original'); const staged = path.join(root, 'session', 'workspace');
      await fs.mkdir(original); await fs.mkdir(staged, { recursive: true });
      const launch = await new ManagedSandbox(path.join(root, 'control')).prepare(staged, original);
      const script = `const net=require('node:net');const socket=net.createConnection({host:process.argv[2],port:Number(process.argv[1])});
        socket.on('connect',()=>{socket.destroy();process.exit(51)});socket.on('error',e=>{if(!['EPERM','EACCES'].includes(e.code))throw e;process.stdout.write('DENIED')});`;
      for (const host of ['127.0.0.1', '127.0.0.2', '::1', '::ffff:127.0.0.1']) {
        const result: { stdout: string; stderr: string } = await execFile(launch.executable, ['-f', launch.profilePath, process.execPath, '-e', script, String(address.port), host], {
          cwd: staged, env: { ...launch.environment, ELECTRON_RUN_AS_NODE: '1' }, timeout: 5_000,
        });
        assert.equal(result.stdout, 'DENIED', host);
      }
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });

  it('denies host UNIX control sockets', async () => {
    const socketPath = path.join(root, 'host.sock');
    const server = createServer(socket => socket.end('host service'));
    await new Promise<void>(resolve => server.listen(socketPath, resolve));
    try {
      const original = path.join(root, 'original'); const staged = path.join(root, 'session', 'workspace');
      await fs.mkdir(original); await fs.mkdir(staged, { recursive: true });
      const launch = await new ManagedSandbox(path.join(root, 'control')).prepare(staged, original);
      const script = `const socket=require('node:net').createConnection(process.argv[1]);socket.on('connect',()=>process.exit(52));
        socket.on('error',e=>{if(!['EPERM','EACCES'].includes(e.code))throw e;process.stdout.write('DENIED')});`;
      const result = await execFile(launch.executable, ['-f', launch.profilePath, process.execPath, '-e', script, socketPath], {
        cwd: staged, env: { ...launch.environment, ELECTRON_RUN_AS_NODE: '1' }, timeout: 5_000,
      });
      assert.equal(result.stdout, 'DENIED');
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });

  it('does not allow other loopback services on the trusted proxy port', async () => {
    const original = path.join(root, 'original'); const staged = path.join(root, 'session', 'workspace');
    await fs.mkdir(original); await fs.mkdir(staged, { recursive: true });
    const runtime = new ManagedSandbox(path.join(root, 'control'));
    const launch = await runtime.prepare(staged, original);
    const port = Number(new URL(launch.environment.HTTPS_PROXY).port);
    try {
      for (const host of ['127.0.0.2', '::1']) {
        const server = createServer(socket => { socket.on('error', () => undefined); socket.end('other host service'); });
        let listening = false;
        try {
          await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen({ host, port, ipv6Only: true }, resolve); });
          listening = true;
          const script = `const socket=require('node:net').createConnection({host:process.argv[1],port:Number(process.argv[2])});
            socket.on('connect',()=>{socket.destroy();process.exit(53)});socket.on('error',e=>{if(!['EPERM','EACCES'].includes(e.code))throw e;process.stdout.write('DENIED')});`;
          const result = await execFile(launch.executable, ['-f', launch.profilePath, process.execPath, '-e', script, host, String(port)], {
            cwd: staged, env: { ...launch.environment, ELECTRON_RUN_AS_NODE: '1' }, timeout: 5_000,
          });
          assert.equal(result.stdout, 'DENIED', host);
        } catch (error) {
          // Some OS versions reserve the v4/v6 port together; then a different
          // host service cannot occupy this address/port in the first place.
          if (!['EADDRINUSE', 'EADDRNOTAVAIL'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
        } finally { if (listening) await new Promise<void>(resolve => server.close(() => resolve())); }
      }
    } finally { await runtime.dispose(); }
  });
});
