import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, connect } from 'node:net';
import { WindowsSandbox, windowsEnvironment, windowsSystemExecutable, formatWindowsVerificationFailure, validateWindowsRuntimeCache, WindowsRuntimeBuild, WINDOWS_PROBE_LAUNCH_TIMEOUT } from '../enforcement/windowsSandbox';
import { ManagedSandbox, SandboxLaunch } from '../enforcement/managedSandbox';
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
    assert.equal(environment.NODE_OPTIONS, '--preserve-symlinks --preserve-symlinks-main');
    assert.equal(environment.SSH_AUTH_SOCK, undefined);
    assert.equal(environment.HTTP_PROXY, undefined);
    assert.equal(environment.PATH.includes('C:\\guard\\runtime'), true);
  });
});

describe('Windows verification diagnostics', () => {
  const diagnostic = (stage: Parameters<typeof formatWindowsVerificationFailure>[0], error: unknown) => JSON.parse(formatWindowsVerificationFailure(stage, error).split('no unconfined fallback: ')[1]);
  it('identifies ACL preparation timeouts without claiming runtime child I/O started', () => {
    const error = Object.assign(new Error('Command timed out'), { killed: true, signal: 'SIGTERM', stdout: '', stderr: 'AI File Guard native: stage=create-profile; elapsed_ms=1\nAI File Guard native: stage=grant-readonly-trees; elapsed_ms=119999' });
    const result = diagnostic('runtime-child-io', error);
    assert.equal(result.stage, 'runtime-child-io');
    assert.equal(result.nativeStage, 'grant-readonly-trees');
    assert.equal(result.runtimeStarted, false);
    assert.equal(result.timedOut, true);
    assert.equal(result.signal, 'SIGTERM');
    assert.ok(WINDOWS_PROBE_LAUNCH_TIMEOUT >= 120_000);
  });
  it('preserves native execution limits and actual runtime startup evidence', () => {
    const error = Object.assign(new Error('Command failed'), { code: 125, killed: false, stdout: '', stderr: 'RUNTIME_STARTING_CHILD_IO\nIsolated process exceeded its 10000 ms execution limit [stage=wait-child; elapsed_ms=12000]' });
    const result = diagnostic('runtime-child-io', error);
    assert.equal(result.nativeStage, 'wait-child');
    assert.equal(result.runtimeStarted, true);
    assert.equal(result.timedOut, true);
    assert.equal(result.code, 125);
    assert.equal(result.killed, false);
  });
  it('bounds failure output while retaining final diagnostics and preparation errors', () => {
    const result = diagnostic('runtime-preparation', Object.assign(new Error('missing runtime'), { stderr: 'x'.repeat(30_000) + '\nRUNTIME_CHILD_IO_FAILED:81', stdout: 'x'.repeat(30_000) + 'last-output' }));
    assert.equal(result.stage, 'runtime-preparation');
    assert.equal(result.message, 'missing runtime');
    assert.ok(result.stderr.length <= 6_144);
    assert.ok(result.stdout.length <= 4_096);
    assert.match(result.stderr, /RUNTIME_CHILD_IO_FAILED:81$/);
    assert.match(result.stdout, /last-output$/);
  });
  it('distinguishes output-limit termination from a timeout', () => {
    const result = diagnostic('native-denial', Object.assign(new Error('stdout maxBuffer length exceeded'), { killed: true, code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }));
    assert.equal(result.timedOut, false);
    assert.equal(result.code, 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
  });
});

describe('Windows runtime cache validation', () => {
  let cache: string;
  let build: WindowsRuntimeBuild;
  let files: Record<string, string>;
  beforeEach(async () => {
    cache = await fs.mkdtemp(path.join(os.tmpdir(), 'guard-runtime-validation-'));
    const node = Buffer.from('verified node fixture'), launcher = Buffer.from('verified launcher fixture');
    const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    build = { nodeSha256: hash(node), npmSha256: 'a'.repeat(64), npmCompatibilitySha256: 'b'.repeat(64), launcherSha256: { 'codex.cjs': hash(launcher) } };
    files = { 'node.exe': hash(node), 'guard-bin/codex.cjs': hash(launcher) };
    await fs.mkdir(path.join(cache, 'guard-bin'));
    await fs.writeFile(path.join(cache, 'node.exe'), node);
    await fs.writeFile(path.join(cache, 'guard-bin', 'codex.cjs'), launcher);
    await fs.writeFile(path.join(cache, 'runtime-build.json'), JSON.stringify(build));
  });
  afterEach(async () => { await fs.rm(cache, { recursive: true, force: true }); });
  it('accepts a complete cache matching the verified bundle', async () => {
    await validateWindowsRuntimeCache(cache, build, files);
  });
  it('rejects changed executable bytes without overwriting the cache', async () => {
    await fs.writeFile(path.join(cache, 'node.exe'), 'changed');
    await assert.rejects(validateWindowsRuntimeCache(cache, build, files), /refusing reuse.*cached file mismatch: node\.exe/);
    assert.equal(await fs.readFile(path.join(cache, 'node.exe'), 'utf8'), 'changed');
  });
  it('rejects an incomplete cache even when node.exe still exists', async () => {
    await fs.unlink(path.join(cache, 'runtime-build.json'));
    await assert.rejects(validateWindowsRuntimeCache(cache, build, files), /cache is incomplete or changed/);
    assert.equal(await fs.readFile(path.join(cache, 'node.exe'), 'utf8'), 'verified node fixture');
  });
  it('checks npm archive, compatibility and launcher provenance on reuse', async () => {
    for (const field of ['npmSha256', 'npmCompatibilitySha256'] as const) {
      await fs.writeFile(path.join(cache, 'runtime-build.json'), JSON.stringify({ ...build, [field]: 'f'.repeat(64) }));
      await assert.rejects(validateWindowsRuntimeCache(cache, build, files), new RegExp(`build manifest mismatch: ${field}`));
    }
    await fs.writeFile(path.join(cache, 'runtime-build.json'), JSON.stringify({ ...build, launcherSha256: { 'codex.cjs': 'f'.repeat(64) } }));
    await assert.rejects(validateWindowsRuntimeCache(cache, build, files), /build manifest mismatch: codex\.cjs/);
    await fs.writeFile(path.join(cache, 'runtime-build.json'), JSON.stringify(build));
    await fs.writeFile(path.join(cache, 'guard-bin', 'codex.cjs'), 'changed launcher');
    await assert.rejects(validateWindowsRuntimeCache(cache, build, files), /cached file mismatch: guard-bin\/codex\.cjs/);
  });
  it('rejects a changed installed npm compatibility helper', async () => {
    const directory = path.join(cache, 'node_modules', 'npm', 'node_modules', '@npmcli', 'arborist', 'lib');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'realpath.js'), 'unreviewed helper bytes');
    await assert.rejects(validateWindowsRuntimeCache(cache, build, files, Buffer.from('verified compatibility code')), /cached npm compatibility helper mismatch/);
  });
});

const native = process.platform === 'win32' && process.env.AI_FILE_GUARD_NATIVE_TESTS === '1' ? describe : describe.skip;
native('Native Windows LPAC enforcement', function () {
  // A verification can run two independently bounded setup/child probes.
  this.timeout(360_000);
  let root: string;
  let original: string;
  let staged: string;
  let runtime: WindowsSandbox;
  let nodeRuntime: string;
  const execute = (launch: SandboxLaunch) => execFile(launch.executable, launch.arguments, { cwd: launch.cwd, env: launch.environment, timeout: WINDOWS_PROBE_LAUNCH_TIMEOUT, maxBuffer: 1024 * 1024 }).catch(error => {
      throw new Error(`${error.message}\nNative diagnostic: ${JSON.stringify({ code: error.code, signal: error.signal, killed: error.killed, stdout: String(error.stdout).slice(-2048), stderr: String(error.stderr).slice(-2048) })}`);
    });
  const run = async (script: string, args: string[] = []) => {
    const launch = await runtime.prepareCommand(staged, original, path.join(nodeRuntime, 'node.exe'), ['-e', script, ...args], nodeRuntime);
    return execute(launch);
  };
  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'guard windows spaces & ')));
    original = path.join(root, 'original'); staged = path.join(root, 'session', 'workspace');
    await fs.mkdir(original); await fs.mkdir(staged, { recursive: true });
    runtime = new WindowsSandbox(path.join(root, 'control'));
    nodeRuntime = await runtime.prepareNodeRuntime();
  });
  // Windows image mappings/AV handles can briefly outlive process exit. Retry
  // only temporary-fixture removal; enforcement assertions are never retried.
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

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

  it('starts its execution deadline after setup and terminates the complete timed-out job', async () => {
    const launch = await runtime.prepareCommand(staged, original, path.join(nodeRuntime, 'node.exe'), ['-e', `const child=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('fs').writeFileSync('descendant.pid',String(child.pid));process.stdout.write('TIMEOUT_CHILD_STARTED');setInterval(()=>{},1000);`], nodeRuntime);
    const config = JSON.parse(await fs.readFile(launch.profilePath, 'utf8'));
    config.Diagnostics = true; config.TimeoutMilliseconds = 5_000;
    await fs.writeFile(launch.profilePath, JSON.stringify(config));
    await assert.rejects(execFile(launch.executable, launch.arguments, { cwd: launch.cwd, env: launch.environment, timeout: WINDOWS_PROBE_LAUNCH_TIMEOUT }), error => {
      const failure = error as Error & { code: number; killed: boolean; stdout: string; stderr: string };
      assert.equal(failure.code, 125, failure.message);
      assert.equal(failure.killed, false, 'The native child limit must run before the host setup deadline.');
      assert.match(failure.stdout, /TIMEOUT_CHILD_STARTED/);
      assert.match(failure.stderr, /execution limit/);
      assert.match(failure.stderr, /stage=wait-child/);
      return true;
    });
    const descendant = Number(await fs.readFile(path.join(staged, 'descendant.pid'), 'utf8'));
    assert.ok(Number.isInteger(descendant) && descendant > 0);
    // Job termination is asynchronous; allow it to complete without retrying the
    // execution-limit assertion or relaunching any process.
    for (let attempt = 0; attempt < 30; attempt++) {
      try { process.kill(descendant, 0); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return; throw error; }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail('A descendant survived the timed-out native job.');
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
    const result = await execute(launch);
    assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+$/);
    const network = await run(`require('https').get('https://registry.npmjs.org/-/ping',response=>{response.resume();if(response.statusCode!==200)process.exit(83);response.on('end',()=>process.stdout.write('HTTPS_OK'))}).on('error',error=>{console.error(error.message);process.exitCode=84}).setTimeout(10000,function(){this.destroy(Error('registry timeout'))});`);
    assert.equal(network.stdout, 'HTTPS_OK');
  });

  it('grants private npm trees beyond MAX_PATH without changing original permissions', async () => {
    const control = path.join(root, 'profile-'.repeat(10), 'globalStorage', 'runtime');
    const deepRuntime = new WindowsSandbox(control);
    const tools = await deepRuntime.prepareNodeRuntime(original);
    const longFile = path.join(tools, 'node_modules', 'npm', 'node_modules', '@npmcli', 'config', 'lib', 'index.js');
    assert.ok(longFile.length > 260, 'The fixture must exercise a real npm file beyond MAX_PATH.');
    const launch = await deepRuntime.prepareCommand(staged, original, path.join(tools, 'node.exe'), ['-e', "require('fs').readFileSync(process.argv[1]);process.stdout.write('LONG_PATH_OK')", longFile], tools);
    const result = await execute(launch);
    assert.equal(result.stdout, 'LONG_PATH_OK');
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
