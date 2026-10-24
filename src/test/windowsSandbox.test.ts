import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, connect } from 'node:net';
import { WindowsSandbox, windowsEnvironment, windowsSystemExecutable } from '../enforcement/windowsSandbox';
import { ManagedSandbox } from '../enforcement/managedSandbox';
import { LockManager } from '../core/lockManager';
import { LocalManifestStore } from '../core/localManifestStore';
import { PathResolver } from '../core/pathResolver';
import { IsolationManager } from '../isolation/isolationManager';
import { ChangeBroker } from '../isolation/changeBroker';
import { AuditLogger } from '../audit/auditLogger';

const execFile = promisify(execFileCallback);
describe('Windows managed environment', () => {
  it('isolates credentials/home and excludes host control, injection, and proxy variables', () => {
    const environment = windowsEnvironment('C:\\guard\\home', 'C:\\guard\\tmp', 'C:\\guard\\runtime');
    assert.equal(environment.USERPROFILE, 'C:\\guard\\home');
    assert.equal(environment.CODEX_HOME, 'C:\\guard\\home\\.codex');
    assert.equal(environment.VSCODE_IPC_HOOK_CLI, undefined);
    assert.equal(environment.NODE_OPTIONS, undefined);
    assert.equal(environment.SSH_AUTH_SOCK, undefined);
    assert.equal(environment.HTTP_PROXY, undefined);
    assert.equal(environment.PATH.includes('C:\\guard\\runtime'), true);
  });
});

const native = process.platform === 'win32' && process.env.AI_FILE_GUARD_NATIVE_TESTS === '1' ? describe : describe.skip;
native('Native Windows LPAC enforcement', function () {
  this.timeout(120_000);
  let root: string;
  let original: string;
  let staged: string;
  let runtime: WindowsSandbox;
  let nodeRuntime: string;
  const run = async (script: string, args: string[] = []) => {
    const launch = await runtime.prepareCommand(staged, original, path.join(nodeRuntime, 'node.exe'), ['-e', script, ...args], nodeRuntime);
    return execFile(launch.executable, launch.arguments, { cwd: launch.cwd, env: launch.environment, timeout: 45_000, maxBuffer: 1024 * 1024 }).catch(error => {
      throw new Error(`${error.message}\nNative diagnostic: ${JSON.stringify({ code: error.code, signal: error.signal, killed: error.killed, stdout: String(error.stdout).slice(-2048), stderr: String(error.stderr).slice(-2048) })}`);
    });
  };
  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'guard windows spaces & ')));
    original = path.join(root, 'original'); staged = path.join(root, 'session', 'workspace');
    await fs.mkdir(original); await fs.mkdir(staged, { recursive: true });
    runtime = new WindowsSandbox(path.join(root, 'control'));
    nodeRuntime = await runtime.prepareNodeRuntime();
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it('requires a real LPAC token and denies original mutation while manual writes stay allowed', async () => {
    const capability = await new ManagedSandbox(path.join(root, 'control')).verify();
    assert.equal(capability.available, true, capability.reason);
    assert.equal(capability.backend, 'windows-lpac');
    const file = path.join(original, 'locked.txt'); await fs.writeFile(file, 'original');
    const result = await run(`const fs=require('fs'),p=require('path'),cp=require('child_process');const [file,stage]=process.argv.slice(1);let count=0;
      const denied=fn=>{try{fn()}catch(e){if(['EPERM','EACCES','ENOENT'].includes(e.code)){count++;return}throw e}throw Error('escaped')};
      denied(()=>fs.writeFileSync(file,'bad'));denied(()=>fs.writeFileSync(p.join(p.dirname(file),'new.txt'),'bad'));
      denied(()=>fs.unlinkSync(file));denied(()=>fs.renameSync(file,file+'.moved'));denied(()=>fs.mkdirSync(file+'.folder'));
      fs.writeFileSync(p.join(stage,'temp'),'bad');denied(()=>fs.renameSync(p.join(stage,'temp'),file));
      process.stdout.write('BEFORE_CHILD;');
      const child=cp.spawnSync(process.execPath,['-e',"try{require('fs').writeFileSync(process.argv[1],'bad');process.exit(51)}catch(e){if(!['EPERM','EACCES','ENOENT'].includes(e.code))throw e;process.stdout.write('CHILD_DENIED')}",file],{encoding:'utf8',timeout:10000});
      if(child.status!==0||child.stdout!=='CHILD_DENIED')throw Error('child denial not verified:'+JSON.stringify({status:child.status,error:child.error&&child.error.code,signal:child.signal,stdout:child.stdout,stderr:child.stderr}));
      fs.writeFileSync(p.join(stage,'allowed'),'yes');process.stdout.write('CHECKED:'+count);`, [file, staged]);
    assert.match(result.stdout, /CHECKED:6/);
    assert.equal(await fs.readFile(file, 'utf8'), 'original');
    await fs.writeFile(file, 'manual developer change');
    assert.equal(await fs.readFile(file, 'utf8'), 'manual developer change');
    assert.equal(await fs.readFile(path.join(staged, 'allowed'), 'utf8'), 'yes');
  });

  it('refuses staged junctions and hard-link aliases without modifying original access', async () => {
    const file = path.join(original, 'original.txt'); await fs.writeFile(file, 'original');
    const icacls = path.win32.join(path.win32.dirname(windowsSystemExecutable('cmd.exe')), 'icacls.exe');
    const beforeDirectory = (await execFile(icacls, [original])).stdout;
    const beforeFile = (await execFile(icacls, [file])).stdout;
    await fs.symlink(original, path.join(staged, 'junction'), 'junction');
    await assert.rejects(run(`process.stdout.write('escaped')`), /Reparse|reparse/i);
    await fs.unlink(path.join(staged, 'junction'));
    await fs.link(file, path.join(staged, 'alias.txt'));
    await assert.rejects(run(`process.stdout.write('escaped')`), /hard link/i);
    assert.equal((await execFile(icacls, [original])).stdout, beforeDirectory, 'Junction rejection must not grant access to the original directory.');
    assert.equal((await execFile(icacls, [file])).stdout, beforeFile, 'Hard-link rejection must not change the original file ACL or label.');
    assert.equal(await fs.readFile(file, 'utf8'), 'original');
    await fs.writeFile(file, 'manual still allowed');
  });

  it('runs the protected command shell, npm shim and public registry HTTPS', async () => {
    const launch = await runtime.prepareCommand(staged, original, windowsSystemExecutable('cmd.exe'), ['/d', '/q', '/c', 'npm --version'], nodeRuntime);
    const result = await execFile(launch.executable, launch.arguments, { cwd: launch.cwd, env: launch.environment, timeout: 30_000, maxBuffer: 128 * 1024 });
    assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
    const network = await run(`require('https').get('https://registry.npmjs.org/-/ping',response=>{response.resume();if(response.statusCode!==200)process.exit(83);response.on('end',()=>process.stdout.write('HTTPS_OK'))}).on('error',error=>{console.error(error.message);process.exitCode=84}).setTimeout(10000,function(){this.destroy(Error('registry timeout'))});`);
    assert.equal(network.stdout, 'HTTPS_OK');
  });

  it('denies host loopback control services without adding network exemptions', async () => {
    let connected = false;
    const server = createServer(socket => { socket.on('error', () => undefined); connected = true; socket.end('host control'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address(); assert.ok(address && typeof address !== 'string');
      const result = await run(`const socket=require('net').connect(Number(process.argv[1]),'127.0.0.1');
        socket.on('connect',()=>process.exit(71));socket.on('error',e=>{process.stdout.write('DENIED:'+e.code)});socket.setTimeout(5000,()=>process.exit(72));`, [String(address.port)]);
      assert.match(result.stdout, /^DENIED:/); assert.equal(connected, false);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });

  it('cannot connect to a host named-pipe control endpoint', async () => {
    const pipe = `\\\\.\\pipe\\guard-${randomUUID()}`;
    let connected = false;
    const server = createServer(socket => { socket.on('error', () => undefined); connected = true; socket.end('host control'); });
    await new Promise<void>(resolve => server.listen(pipe, resolve));
    try {
      await new Promise<void>((resolve, reject) => { const client = connect(pipe); client.resume(); client.on('end', () => { client.destroy(); resolve(); }); client.on('error', reject); });
      connected = false;
      const result = await run(`const socket=require('net').connect(process.argv[1]);socket.on('connect',()=>process.exit(73));
        socket.on('error',e=>process.stdout.write('DENIED:'+e.code));socket.setTimeout(5000,()=>process.exit(74));`, [pipe]);
      assert.match(result.stdout, /^DENIED:/); assert.equal(connected, false);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });

  it('applies live file/folder locks to proposals and permits them after explicit unlock', async () => {
    const docs = path.join(original, 'docs'); await fs.mkdir(docs);
    await fs.writeFile(path.join(docs, 'edit.txt'), 'original');
    await fs.writeFile(path.join(docs, 'delete.txt'), 'original');
    const locks = new LockManager(new LocalManifestStore(path.join(root, 'policy.json')), new PathResolver());
    const session = await new IsolationManager(path.join(root, 'sessions')).create(original);
    staged = session.stagingRoot;
    await locks.lock(docs, 'directory');
    await run(`const fs=require('fs'),p=require('path');const docs=p.join(process.cwd(),'docs');fs.writeFileSync(p.join(docs,'edit.txt'),'agent');
      fs.unlinkSync(p.join(docs,'delete.txt'));fs.mkdirSync(p.join(docs,'nested'));fs.writeFileSync(p.join(docs,'nested','new.txt'),'agent');process.stdout.write('PROPOSED');`);
    const broker = new ChangeBroker(locks, new AuditLogger(path.join(root, 'audit.jsonl')));
    const denied = await broker.apply(session); assert.equal(denied.applied.length, 0); assert.equal(denied.rejected.length, 4);
    assert.equal(await fs.readFile(path.join(docs, 'edit.txt'), 'utf8'), 'original');
    await locks.unlock(docs);
    const applied = await broker.apply(session); assert.equal(applied.rejected.length, 0); assert.equal(applied.applied.length, 4);
    assert.equal(await fs.readFile(path.join(docs, 'nested', 'new.txt'), 'utf8'), 'agent');
  });
});
