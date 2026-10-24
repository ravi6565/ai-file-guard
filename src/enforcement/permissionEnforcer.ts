import { promises as fs } from 'node:fs';
import path from 'node:path';
import { LockEntry } from '../core/types';
import { KeyValueStore } from '../core/manifestStore';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
interface PermissionRecord { readonly path: string; readonly mode: number; readonly hadUserImmutable?: boolean; }
interface PermissionState { readonly version: 1; readonly records: readonly PermissionRecord[]; }

export const LEGACY_PERMISSION_KEY = 'aiFileGuard.permissionState.v1';
const KEY = 'aiFileGuard.permissionState.v2';

export class PermissionEnforcer {
  private records = new Map<string, PermissionRecord>();

  public constructor(
    private readonly storage: KeyValueStore,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly storageKey = KEY,
  ) {
    const saved = storage.get<PermissionState | undefined>(storageKey, undefined);
    if (saved?.version === 1 && Array.isArray(saved.records)) saved.records.forEach(record => this.records.set(record.path, record));
  }

  public async suspend(): Promise<void> {
    const failures: string[] = [];
    // Parents first so child modes can be restored even when a directory was read-only.
    if (this.platform === 'darwin') {
      for (const record of this.records.values()) {
        const stat = await fs.lstat(record.path).catch(error => { if (isMissing(error)) return undefined; throw error; });
        if (!stat || stat.isSymbolicLink()) continue;
        if (!record.hadUserImmutable) try { await execFile('/usr/bin/chflags', ['nouchg', record.path]); } catch (error) { if (!isMissing(error)) failures.push(`${record.path}: ${messageOf(error)}`); }
      }
    }
    for (const [target, record] of [...this.records].sort(([a], [b]) => a.length - b.length)) {
      try {
        const stat = await fs.lstat(target);
        if (!stat.isSymbolicLink()) await fs.chmod(target, record.mode);
      } catch (error) { if (!isMissing(error)) failures.push(`${target}: ${messageOf(error)}`); }
    }
    if (failures.length) throw new Error(`Could not restore ${failures.length} permission(s): ${failures[0]}`);
  }

  public async enforce(locks: readonly LockEntry[]): Promise<number> {
    const targets = new Set<string>();
    for (const lock of locks) for (const target of await enumerate(lock.displayPath)) targets.add(target);

    for (const target of targets) {
      if (!this.records.has(target)) {
        const stat = await fs.lstat(target);
        if (!stat.isSymbolicLink()) this.records.set(target, {
          path: target,
          mode: stat.mode & 0o7777,
          hadUserImmutable: this.platform === 'darwin' ? await hasUserImmutable(target) : undefined,
        });
      }
    }
    await this.persist();

    const failures: string[] = [];
    // Children first; lock directories last to prevent entry creation/deletion.
    for (const target of [...targets].sort((a, b) => b.length - a.length)) {
      try {
        const stat = await fs.lstat(target); if (stat.isSymbolicLink()) continue;
        await fs.chmod(target, (stat.mode & 0o7777) & ~0o222);
        if (this.platform === 'darwin') await execFile('/usr/bin/chflags', ['uchg', target]);
      } catch (error) { failures.push(`${target}: ${messageOf(error)}`); }
    }
    if (failures.length) {
      await this.suspend();
      throw new Error(`Hard Lock failed for ${failures.length} path(s): ${failures[0]}`);
    }
    return targets.size;
  }

  public async clearUnused(activeLocks: readonly LockEntry[]): Promise<void> {
    const activeRoots = activeLocks.map(lock => lock.displayPath);
    for (const target of [...this.records.keys()]) {
      if (!activeRoots.some(root => target === root || target.startsWith(`${root}${path.sep}`))) this.records.delete(target);
    }
    await this.persist();
  }

  public limitation(): string {
    return this.platform === 'win32'
      ? 'Windows chmod semantics are weaker than NTFS deny ACLs; VS Code read-only rules provide the primary editor guard.'
      : 'Write bits are removed, but a process running as the same OS owner can restore them with chmod.';
  }

  public size(): number { return this.records.size; }

  private async persist(): Promise<void> {
    await this.storage.update(this.storageKey, { version: 1, records: [...this.records.values()] } satisfies PermissionState);
  }
}

async function enumerate(root: string): Promise<string[]> {
  const stat = await fs.lstat(root); if (stat.isSymbolicLink() || !stat.isDirectory()) return [root];
  const output: string[] = [root];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) output.push(...await enumerate(child)); else output.push(child);
  }
  return output;
}
function isMissing(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'; }
function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }
async function hasUserImmutable(target: string): Promise<boolean> {
  const { stdout } = await execFile('/usr/bin/stat', ['-f', '%Sf', target]);
  return stdout.trim().split(',').includes('uchg');
}
