import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { ManagedNetworkProxy } from './networkProxy';

const execFile = promisify(execFileCallback);
export interface SandboxCapability {
  readonly available: boolean;
  readonly backend: 'macos-seatbelt' | 'unsupported';
  readonly scope: 'managed-agents-only';
  readonly reason: string;
}
export interface SandboxLaunch {
  readonly executable: string;
  readonly arguments: string[];
  readonly cwd: string;
  readonly environment: Record<string, string>;
  readonly profilePath: string;
}

export class ManagedSandbox {
  private verification?: Promise<SandboxCapability>;
  private readonly proxy = new ManagedNetworkProxy();
  public constructor(private readonly controlRoot: string, private readonly platform: NodeJS.Platform = process.platform) {}

  public verify(retry = false): Promise<SandboxCapability> {
    if (retry) this.verification = undefined;
    return this.verification ??= this.probe();
  }
  public async dispose(): Promise<void> { await this.proxy.dispose(); }

  public async prepare(stagingRoot: string, originalRoot: string, protectedCopies: readonly string[] = []): Promise<SandboxLaunch> {
    const capability = await this.verify();
    if (!capability.available) throw new Error(capability.reason);
    const original = await fs.realpath(originalRoot);
    const staging = await fs.realpath(stagingRoot);
    if (contains(original, staging) || contains(staging, original)) throw new Error('Sandbox workspace and original project must be separate.');
    const sessionRoot = path.dirname(staging);
    const workspaceId = createHash('sha256').update(original).digest('hex').slice(0, 32);
    const home = path.join(this.controlRoot, 'agent-homes', workspaceId);
    const temporary = path.join(sessionRoot, 'agent-tmp');
    await fs.mkdir(home, { recursive: true, mode: 0o700 });
    await fs.mkdir(temporary, { recursive: true, mode: 0o700 });
    const writableRoots = [staging, await fs.realpath(home), await fs.realpath(temporary)];
    if (writableRoots.some(writable => contains(original, writable) || contains(writable, original))) {
      throw new Error('Original project overlaps sandbox writable storage. Refusing to launch.');
    }
    const profilePath = path.join(sessionRoot, `sandbox-${randomUUID()}.sb`);
    const proxyPort = await this.proxy.start();
    const environment = sandboxEnvironment(home, temporary, proxyPort);
    const profile = macProfile(writableRoots, protectedCopies, proxyPort);
    await fs.writeFile(profilePath, profile, { flag: 'wx', mode: 0o600 });
    await execFile('/usr/bin/sandbox-exec', ['-f', profilePath, '/usr/bin/true'], { timeout: 5_000, env: environment });
    return {
      executable: '/usr/bin/sandbox-exec',
      arguments: ['-f', profilePath, '/bin/zsh', '-f'],
      cwd: staging,
      environment,
      profilePath,
    };
  }

  private async probe(): Promise<SandboxCapability> {
    const base = { scope: 'managed-agents-only' as const };
    if (this.platform !== 'darwin') return { ...base, available: false, backend: 'unsupported', reason: 'This build requires the macOS sandbox runtime. No unconfined fallback will be launched.' };
    const probeRoot = path.join(this.controlRoot, 'probes', randomUUID());
    try {
      await fs.access('/usr/bin/sandbox-exec');
      await fs.mkdir(probeRoot, { recursive: true, mode: 0o700 });
      const canonical = await fs.realpath(probeRoot);
      const writable = path.join(canonical, 'writable');
      const protectedFile = path.join(canonical, 'original.txt');
      await fs.mkdir(writable); await fs.writeFile(protectedFile, 'original');
      // Only built-in OS executables are needed; no dependency on the host's
      // Node installation or Electron run-as-node flags for capability checks.
      const script = `set -eu
        if (printf bad > "$1") 2>/dev/null; then exit 41; fi
        if /bin/rm "$1" 2>/dev/null; then exit 42; fi
        if /bin/mv "$1" "$1.moved" 2>/dev/null; then exit 43; fi
        if /bin/mkdir "$1.folder" 2>/dev/null; then exit 44; fi
        printf yes > "$2/allowed"
        printf GUARD_VERIFIED`;
      const { stdout } = await execFile('/usr/bin/sandbox-exec', ['-p', macProfile([writable]), '/bin/sh', '-c', script, 'guard-probe', protectedFile, writable], {
        timeout: 15_000, maxBuffer: 64 * 1024,
        env: sandboxEnvironment(writable, writable),
      });
      if (!stdout.includes('GUARD_VERIFIED') || await fs.readFile(protectedFile, 'utf8') !== 'original') throw new Error('Sandbox did not enforce original-file protection.');
      return { ...base, available: true, backend: 'macos-seatbelt', reason: 'OS write denial verified for agents launched through the Protected AI Terminal. Ordinary external AI sessions are outside this boundary.' };
    } catch (error) {
      return { ...base, available: false, backend: 'macos-seatbelt', reason: `Sandbox verification failed; agents will not be launched without protection: ${messageOf(error)}` };
    } finally { await fs.rm(probeRoot, { recursive: true, force: true }).catch(() => undefined); }
  }
}

export function macProfile(writableRoots: readonly string[], protectedCopies: readonly string[] = [], proxyPort?: number): string {
  if (!writableRoots.length) throw new Error('At least one sandbox writable root is required.');
  for (const root of [...writableRoots, ...protectedCopies]) if (!path.isAbsolute(root) || root === path.parse(root).root || /[\0\r\n]/.test(root)) throw new Error('Unsafe sandbox path.');
  const quoted = (value: string) => JSON.stringify(value);
  if (proxyPort !== undefined && (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535)) throw new Error('Invalid proxy port.');
  return [
    '(version 1)', '(deny default)',
    '(allow file-read*)', '(allow process-exec)', '(allow process-fork)', '(allow sysctl-read)',
    '(allow signal (target self))',
    // General TCP is not granted. Only the trusted HTTPS CONNECT proxy can be reached.
    ...(proxyPort ? [`(allow network-outbound (remote tcp4 "localhost:${proxyPort}"))`] : []),
    '(allow network-outbound (literal "/private/var/run/mDNSResponder"))',
    '(allow mach-lookup (global-name "com.apple.system.opendirectoryd.libinfo") (global-name "com.apple.system.notification_center") (global-name "com.apple.SystemConfiguration.DNSConfiguration"))',
    '(allow file-write-data (literal "/dev/null") (literal "/dev/tty") (literal "/dev/zero"))',
    `(allow file-write* ${writableRoots.map(root => `(subpath ${quoted(root)})`).join(' ')})`,
    ...protectedCopies.map(root => `(deny file-write* (subpath ${quoted(root)}))`),
    '',
  ].join('\n');
}

export function sandboxEnvironment(home: string, temporary: string, proxyPort?: number): Record<string, string> {
  const environment: Record<string, string> = {
    PATH: path.join(home, '.local', 'bin') + path.delimiter + (process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin'), HOME: home, TMPDIR: temporary + path.sep,
    LANG: process.env.LANG ?? 'en_US.UTF-8', TERM: 'xterm-256color',
    ZDOTDIR: home, XDG_CONFIG_HOME: path.join(home, '.config'), XDG_CACHE_HOME: path.join(home, '.cache'),
    CODEX_HOME: path.join(home, '.codex'), CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    npm_config_cache: path.join(home, '.npm'), npm_config_prefix: path.join(home, '.local'), AI_FILE_GUARD_MANAGED: '1',
  };
  for (const name of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'GH_TOKEN']) {
    if (process.env[name]) environment[name] = process.env[name]!;
  }
  if (proxyPort) {
    const proxy = `http://127.0.0.1:${proxyPort}`;
    Object.assign(environment, { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, http_proxy: proxy, https_proxy: proxy,
      npm_config_proxy: proxy, npm_config_https_proxy: proxy, NO_PROXY: '', no_proxy: '' });
  }
  return environment;
}

function contains(parent: string, child: string): boolean { const relative = path.relative(parent, child); return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)); }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }
