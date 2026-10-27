import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import type { SandboxCapability, SandboxLaunch } from './managedSandbox';

const execFile = promisify(execFileCallback);
export interface WindowsLaunchConfiguration {
  ProfileName: string;
  WritableRoots: string[];
  ReadOnlyRoots: string[];
  Executable: string;
  Arguments: string[];
  WorkingDirectory: string;
  Environment: Record<string, string>;
  Diagnostics?: boolean;
  TimeoutMilliseconds?: number;
}

// This deadline includes validating and granting thousands of private npm
// objects. The native execution limit starts only after the child is resumed.
export const WINDOWS_PROBE_LAUNCH_TIMEOUT = 120_000;
export type WindowsVerificationStage = 'setup' | 'native-denial' | 'runtime-preparation' | 'runtime-child-io';

export class WindowsSandbox {
  private launcher?: Promise<string>;
  public constructor(private readonly controlRoot: string) {}

  public async verify(): Promise<SandboxCapability> {
    const base = { scope: 'managed-agents-only' as const, backend: 'windows-lpac' as const };
    const probe = path.join(this.controlRoot, 'probes', randomUUID());
    let stage: WindowsVerificationStage = 'setup';
    try {
      if (process.platform !== 'win32') throw new Error('A native Windows host is required.');
      const launcher = await this.buildLauncher();
      await fs.mkdir(probe, { recursive: true });
      const root = await fs.realpath(probe);
      const writable = path.join(root, 'writable');
      const tools = path.join(root, 'tools');
      await fs.mkdir(writable); await fs.mkdir(tools);
      const original = path.join(root, 'original.txt');
      const policy = path.join(root, 'policy.json');
      await fs.writeFile(original, 'original'); await fs.writeFile(policy, 'policy');
      const child = path.join(tools, 'probe.exe');
      await fs.copyFile(launcher, child);
      const config = await this.writeConfiguration(root, {
        ProfileName: profileName(root), WritableRoots: [writable], ReadOnlyRoots: [tools],
        Executable: child, Arguments: ['--probe-child', original, writable, policy], WorkingDirectory: writable,
        Environment: windowsEnvironment(writable, writable), Diagnostics: true, TimeoutMilliseconds: 5_000,
      });
      stage = 'native-denial';
      const denialProbe = await execFile(launcher, ['--config', config], { timeout: WINDOWS_PROBE_LAUNCH_TIMEOUT, maxBuffer: 128 * 1024 });
      if (denialProbe.stdout !== 'GUARD_VERIFIED:5' || await fs.readFile(original, 'utf8') !== 'original' || await fs.readFile(policy, 'utf8') !== 'policy' || await fs.readFile(path.join(writable, 'allowed'), 'utf8') !== 'yes') {
        throw Object.assign(new Error('Native token/write-denial self-test did not pass.'), denialProbe);
      }
      for (const unexpected of [original + '.moved', original + '.folder']) {
        try { await fs.lstat(unexpected); throw new Error('A protected probe path was created or renamed.'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      stage = 'runtime-preparation';
      const runtime = await this.prepareNodeRuntime('runtime-verification');
      const runtimeConfig = await this.writeConfiguration(root, {
        ProfileName: profileName(this.controlRoot + ':runtime-verification'), WritableRoots: [writable], ReadOnlyRoots: [runtime],
        Executable: path.join(runtime, 'node.exe'), Arguments: ['-e', `const cp=require('child_process');process.stderr.write('RUNTIME_STARTING_CHILD_IO\\n');const child=cp.spawnSync(process.execPath,['-e',"process.stdout.write('PIPE_OK')"],{encoding:'utf8',timeout:5000});if(child.status!==0||child.error||child.stdout!=='PIPE_OK'){process.stderr.write('RUNTIME_CHILD_IO_FAILED:'+JSON.stringify({status:child.status,signal:child.signal,error:child.error&&{code:child.error.code,message:child.error.message},stdout:String(child.stdout).slice(-2048),stderr:String(child.stderr).slice(-2048)})+'\\n');process.exit(81)}process.stdout.write('RUNTIME_VERIFIED');`],
        WorkingDirectory: writable, Environment: windowsEnvironment(writable, writable, runtime), Diagnostics: true, TimeoutMilliseconds: 10_000,
      });
      stage = 'runtime-child-io';
      const runtimeProbe = await execFile(launcher, ['--config', runtimeConfig], { timeout: WINDOWS_PROBE_LAUNCH_TIMEOUT, maxBuffer: 128 * 1024 });
      if (runtimeProbe.stdout !== 'RUNTIME_VERIFIED') throw Object.assign(new Error('Private runtime child-process I/O verification failed.'), runtimeProbe);
      return { ...base, available: true, reason: 'Native Windows LPAC token, original-write denial and private runtime child I/O verified. Protected AI Terminal only; ordinary AI extensions are outside this boundary. No Docker or WSL required.' };
    } catch (error) {
      return { ...base, available: false, reason: formatWindowsVerificationFailure(stage, error) };
    } finally { await fs.rm(probe, { recursive: true, force: true }).catch(() => undefined); }
  }

  public async prepare(stagingRoot: string, originalRoot: string): Promise<SandboxLaunch> {
    const runtime = await this.prepareNodeRuntime(await fs.realpath(originalRoot));
    return this.prepareCommand(stagingRoot, originalRoot, windowsSystemExecutable('cmd.exe'), ['/d', '/q'], runtime);
  }

  /** Exposed for native acceptance tests; every command uses the same launcher. */
  public async prepareCommand(stagingRoot: string, originalRoot: string, executable: string, args: string[], readOnlyRuntime?: string): Promise<SandboxLaunch> {
    await fs.mkdir(this.controlRoot, { recursive: true });
    const original = await fs.realpath(originalRoot);
    const staging = await fs.realpath(stagingRoot);
    const control = await fs.realpath(this.controlRoot);
    if (contains(original, staging) || contains(staging, original) || contains(original, control) || contains(control, original)) throw new Error('Original project overlaps sandbox storage.');
    const home = path.join(control, 'agent-homes', digest(original));
    const temporary = path.join(path.dirname(staging), 'agent-tmp');
    await fs.mkdir(home, { recursive: true }); await fs.mkdir(temporary, { recursive: true });
    const canonicalHome = await fs.realpath(home);
    const canonicalTemporary = await fs.realpath(temporary);
    if (!contains(control, canonicalHome) || canonicalHome.toLowerCase() !== home.toLowerCase() || canonicalTemporary.toLowerCase() !== temporary.toLowerCase() || [staging, canonicalHome, canonicalTemporary].some(writable => contains(original, writable) || contains(writable, original))) {
      throw new Error('Unsafe sandbox writable path or reparse point.');
    }
    const environment = windowsEnvironment(canonicalHome, canonicalTemporary, readOnlyRuntime);
    environment.AI_FILE_GUARD_PRIVATE_ROOTS = JSON.stringify([staging, canonicalHome, canonicalTemporary, ...(readOnlyRuntime ? [readOnlyRuntime] : [])]);
    const config = await this.writeConfiguration(path.dirname(staging), {
      ProfileName: profileName(original), WritableRoots: [staging, canonicalHome, canonicalTemporary],
      ReadOnlyRoots: readOnlyRuntime ? [readOnlyRuntime] : [], Executable: executable, Arguments: args,
      WorkingDirectory: staging, Environment: environment,
    });
    // The host launcher must not hold the writable directory as its own cwd;
    // Windows opens cwd handles without delete sharing. Only the LPAC child
    // receives the staged working directory from the trusted configuration.
    return { executable: await this.buildLauncher(), arguments: ['--config', config], cwd: path.dirname(staging), environment, profilePath: config };
  }

  public async prepareNodeRuntime(workspaceIdentity = ''): Promise<string> {
    // Only the packaged, checksum-verified runtime is trusted. Stock Node has
    // an AppContainer child-pipe hang; never fall back to it silently.
    const bundle = path.resolve(__dirname, '..', '..', 'resources', 'windows', 'runtime');
    let manifest: { architecture: string; nodeSha256: string; npmSha256: string };
    try { manifest = JSON.parse(await fs.readFile(path.join(bundle, 'runtime.json'), 'utf8')); }
    catch { throw new Error('This Windows package is missing its compatible private runtime. Install a tested Windows x64 VSIX; Docker and WSL are not required.'); }
    if (manifest.architecture !== 'x64' || !/^[a-f0-9]{64}$/.test(manifest.nodeSha256) || !/^[a-f0-9]{64}$/.test(manifest.npmSha256)) throw new Error('Invalid private Windows runtime manifest.');
    const sourceBytes = await fs.readFile(path.join(bundle, 'node.exe'));
    const npmArchive = await fs.readFile(path.join(bundle, 'npm.tar'));
    const npmCompatibility = await fs.readFile(path.join(bundle, '..', 'npm-private-roots.cjs'));
    const launchers = await Promise.all(['codex.cmd', 'codex.cjs'].map(async name => ({ name, bytes: await fs.readFile(path.join(bundle, '..', name)) })));
    if (sha256(sourceBytes) !== manifest.nodeSha256 || sha256(npmArchive) !== manifest.npmSha256) throw new Error('Private Windows runtime checksum mismatch. Reinstall a tested package.');
    const build: WindowsRuntimeBuild = { nodeSha256: manifest.nodeSha256, npmSha256: manifest.npmSha256, npmCompatibilitySha256: sha256(npmCompatibility), launcherSha256: Object.fromEntries(launchers.map(launcher => [launcher.name, sha256(launcher.bytes)])) };
    const cachedFiles: Record<string, string> = { 'node.exe': manifest.nodeSha256 };
    for (const launcher of launchers) cachedFiles[`guard-bin/${launcher.name}`] = sha256(launcher.bytes);
    for (const name of ['npm.cmd', 'npx.cmd']) cachedFiles[name] = sha256(await fs.readFile(path.join(bundle, name)));
    // Keep executable paths below the Windows loader limit even for nested
    // VS Code profiles. A 128-bit cache key matches the profile identity size;
    // complete binary/archive SHA-256 verification above remains unchanged.
    const runtimeKey = createHash('sha256').update(sourceBytes).update(manifest.npmSha256).update(npmCompatibility).update(workspaceIdentity.toLowerCase());
    for (const launcher of launchers) runtimeKey.update(launcher.bytes);
    const runtime = path.join(this.controlRoot, 'node-runtimes', runtimeKey.digest('hex').slice(0, 32));
    let cached = true;
    try { await fs.lstat(runtime); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; cached = false; }
    if (cached) { await validateWindowsRuntimeCache(runtime, build, cachedFiles, npmCompatibility); return fs.realpath(runtime); }
    await fs.mkdir(path.dirname(runtime), { recursive: true });
    const temporary = `${runtime}.${randomUUID()}.tmp`;
    await fs.mkdir(temporary);
    try {
      await fs.writeFile(path.join(temporary, 'node.exe'), sourceBytes, { flag: 'wx' });
      const modules = path.join(temporary, 'node_modules');
      await fs.mkdir(modules);
      // Windows tar's chdir still truncates long -C paths. Extract the verified
      // archive to a short private host temporary path, then copy with Node's
      // long-path-aware filesystem APIs. This directory is never agent-writable.
      const extracted = await fs.mkdtemp(path.join(os.tmpdir(), 'afg-npm-'));
      try {
        await execFile(path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', path.join(bundle, 'npm.tar'), '-C', extracted], { timeout: 30_000 });
        await fs.cp(path.join(extracted, 'npm'), path.join(modules, 'npm'), { recursive: true, dereference: false, errorOnExist: true });
      } finally { await fs.rm(extracted, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
      const helper = path.join(modules, 'npm', 'node_modules', '@npmcli', 'arborist', 'lib', 'realpath.js');
      const originalHelper = await fs.readFile(helper);
      if (sha256(originalHelper) !== '54fb13b5b30d62115123b24e7b09b28d1ea6fa5363a81aae9ecd337de323662f') throw new Error('Unexpected npm Arborist helper; refusing an unreviewed compatibility modification.');
      await fs.writeFile(helper, Buffer.concat([originalHelper, Buffer.from('\n'), npmCompatibility]));
      await fs.mkdir(path.join(temporary, 'guard-bin'));
      for (const launcher of launchers) await fs.writeFile(path.join(temporary, 'guard-bin', launcher.name), launcher.bytes, { flag: 'wx' });
      await fs.writeFile(path.join(temporary, 'runtime-build.json'), JSON.stringify(build));
      for (const name of ['npm.cmd', 'npx.cmd', 'LICENSE']) await fs.copyFile(path.join(bundle, name), path.join(temporary, name));
      try { await fs.rename(temporary, runtime); }
      catch (error) { if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(String((error as NodeJS.ErrnoException).code))) throw error; await fs.access(path.join(runtime, 'node.exe')); }
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
    await validateWindowsRuntimeCache(runtime, build, cachedFiles, npmCompatibility);
    return fs.realpath(runtime);
  }

  private buildLauncher(): Promise<string> {
    return this.launcher ??= this.compileLauncher().catch(error => { this.launcher = undefined; throw error; });
  }

  private async compileLauncher(): Promise<string> {
    const source = path.resolve(__dirname, '..', '..', 'resources', 'windows', 'GuardLauncher.cs');
    // CLR also probes an adjacent .exe.config path before Main, so leave room
    // for that suffix in nested VS Code profiles (not just the executable).
    const hash = createHash('sha256').update(await fs.readFile(source)).digest('hex').slice(0, 32);
    const directory = path.join(this.controlRoot, 'launchers');
    await fs.mkdir(directory, { recursive: true });
    const launcher = path.join(directory, `guard-${hash}.exe`);
    try { await fs.access(launcher); return launcher; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const windows = process.env.SystemRoot ?? 'C:\\Windows';
    let compiler = path.join(windows, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
    try { await fs.access(compiler); } catch { compiler = path.join(windows, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'); }
    const temporary = path.join(directory, `guard-${randomUUID()}.exe`);
    try {
      await execFile(compiler, ['/nologo', '/target:exe', '/platform:anycpu', '/reference:System.Web.Extensions.dll', `/out:${temporary}`, source], { timeout: 60_000, maxBuffer: 512 * 1024 }).catch(error => {
        throw new Error(`Native Windows launcher compilation failed: ${String(error.stdout || error.stderr || error.message).slice(0, 8_000)}`);
      });
      try { await fs.rename(temporary, launcher); }
      catch (error) { if (!['EEXIST', 'EPERM'].includes(String((error as NodeJS.ErrnoException).code))) throw error; await fs.access(launcher); }
      return launcher;
    } finally { await fs.rm(temporary, { force: true }); }
  }

  private async writeConfiguration(directory: string, configuration: WindowsLaunchConfiguration): Promise<string> {
    const destination = path.join(directory, `sandbox-${randomUUID()}.json`);
    await fs.writeFile(destination, JSON.stringify(configuration), { flag: 'wx', mode: 0o600 });
    return destination;
  }
}

export function windowsSystemExecutable(name: 'cmd.exe' | 'where.exe'): string {
  return path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', name);
}

export function windowsEnvironment(home: string, temporary: string, runtime?: string): Record<string, string> {
  const windows = process.env.SystemRoot ?? 'C:\\Windows';
  const environment: Record<string, string> = {
    SystemRoot: windows, WINDIR: windows, COMSPEC: path.win32.join(windows, 'System32', 'cmd.exe'),
    PATH: [...(runtime ? [path.win32.join(runtime, 'guard-bin')] : []), path.win32.join(home, '.local'), ...(runtime ? [runtime] : []), path.win32.join(windows, 'System32'), windows].join(';'),
    USERPROFILE: home, HOME: home, HOMEDRIVE: path.win32.parse(home).root.slice(0, 2), HOMEPATH: home.slice(2),
    APPDATA: path.win32.join(home, 'AppData', 'Roaming'), LOCALAPPDATA: path.win32.join(home, 'AppData', 'Local'),
    TEMP: temporary, TMP: temporary, PATHEXT: '.COM;.EXE;.BAT;.CMD',
    CODEX_HOME: path.win32.join(home, '.codex'), CLAUDE_CONFIG_DIR: path.win32.join(home, '.claude'),
    npm_config_cache: path.win32.join(home, '.npm'), npm_config_prefix: path.win32.join(home, '.local'), AI_FILE_GUARD_MANAGED: '1',
    // CJS's JS realpath walks every ancestor and attempts lstat(C:\\), which
    // LPAC deliberately cannot read. Preserve module paths instead of granting
    // host ancestors. These fixed compatibility flags never inherit host input.
    NODE_OPTIONS: '--preserve-symlinks --preserve-symlinks-main',
  };
  for (const name of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'GH_TOKEN']) if (process.env[name]) environment[name] = process.env[name]!;
  return environment;
}
function contains(parent: string, child: string): boolean { const relative = path.relative(parent, child); return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`); }
function digest(input: string): string { return createHash('sha256').update(input.toLowerCase()).digest('hex').slice(0, 32); }
function profileName(input: string): string { return `AIFileGuard.${digest(input)}`; }

function sha256(input: Buffer): string { return createHash('sha256').update(input).digest('hex'); }

export function formatWindowsVerificationFailure(stage: WindowsVerificationStage, error: unknown): string {
  const detail = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const tail = (value: unknown, limit: number) => value === undefined ? '' : String(value).slice(-limit);
  const stdout = tail(detail.stdout, 4_096), stderr = tail(detail.stderr, 6_144);
  const nativeStages = [...stderr.matchAll(/\bstage=([a-z-]+)/g)];
  const nativeStage = nativeStages.at(-1)?.[1];
  const message = tail(error instanceof Error ? error.message : error, 1_024);
  return `Windows isolation verification failed; no unconfined fallback: ${JSON.stringify({
    stage, nativeStage, runtimeStarted: stderr.includes('RUNTIME_STARTING_CHILD_IO'),
    timedOut: (detail.killed === true && detail.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') || detail.code === 'ETIMEDOUT' || /execution limit/.test(stderr),
    code: detail.code, signal: detail.signal, killed: detail.killed, message, stdout, stderr,
  })}`;
}

export interface WindowsRuntimeBuild {
  nodeSha256: string;
  npmSha256: string;
  npmCompatibilitySha256: string;
  launcherSha256: Record<string, string>;
}

/** Reuse only complete caches matching the verified bundle. Never repair in place. */
export async function validateWindowsRuntimeCache(runtime: string, expected: WindowsRuntimeBuild, files: Readonly<Record<string, string>>, compatibility?: Buffer): Promise<void> {
  try {
    const directory = await fs.lstat(runtime);
    if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('runtime directory is a link or invalid object');
    const manifestPath = path.join(runtime, 'runtime-build.json');
    if (!(await fs.lstat(manifestPath)).isFile() || (await fs.lstat(manifestPath)).isSymbolicLink()) throw new Error('build manifest is not a regular file');
    const actual = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as WindowsRuntimeBuild;
    for (const field of ['nodeSha256', 'npmSha256', 'npmCompatibilitySha256'] as const) if (actual?.[field] !== expected[field]) throw new Error(`build manifest mismatch: ${field}`);
    for (const [name, hash] of Object.entries(expected.launcherSha256)) if (actual.launcherSha256?.[name] !== hash) throw new Error(`build manifest mismatch: ${name}`);
    for (const [name, hash] of Object.entries(files)) {
      const file = path.join(runtime, name);
      const stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || sha256(await fs.readFile(file)) !== hash) throw new Error(`cached file mismatch: ${name}`);
    }
    if (compatibility) {
      const helper = await fs.readFile(path.join(runtime, 'node_modules', 'npm', 'node_modules', '@npmcli', 'arborist', 'lib', 'realpath.js'));
      const suffix = Buffer.concat([Buffer.from('\n'), compatibility]);
      if (helper.length <= suffix.length || !helper.subarray(-suffix.length).equals(suffix) || sha256(helper.subarray(0, -suffix.length)) !== '54fb13b5b30d62115123b24e7b09b28d1ea6fa5363a81aae9ecd337de323662f') throw new Error('cached npm compatibility helper mismatch');
    }
  } catch (error) {
    throw new Error(`Private Windows runtime cache is incomplete or changed; refusing reuse. Close protected terminals and remove this cache manually before retrying: ${runtime}. ${error instanceof Error ? error.message : String(error)}`);
  }
}
