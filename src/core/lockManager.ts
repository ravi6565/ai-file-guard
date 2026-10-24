import { ManifestRepository } from './manifestStore';
import { PathResolver } from './pathResolver';
import { LockEntry, LockManifest, ProtectionStatus } from './types';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export class LockManager {
  private manifest: LockManifest;
  private readonly listeners = new Set<() => void>();

  public constructor(
    private readonly store: ManifestRepository,
    private readonly paths: PathResolver,
    private readonly fileIdentity: (file: string) => Promise<string> = async file => {
      const stat = await fs.stat(file); return `${stat.dev}:${stat.ino}`;
    },
  ) {
    this.manifest = store.load();
  }

  public all(): readonly LockEntry[] { return this.manifest.locks; }
  public async refresh(): Promise<void> { this.adopt(await this.store.refresh()); }
  public onDidChange(listener: () => void): { dispose(): void } {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  public async lock(input: string, kind: LockEntry['kind']): Promise<LockEntry> {
    const identity = await this.paths.resolve(input);
    const entry: LockEntry = { ...identity, kind, lockedAt: new Date().toISOString(), fileId: await this.fileIdentity(identity.displayPath) };
    this.adopt(await this.store.transact(current => current.locks.some(item => item.canonicalPath === identity.canonicalPath)
      ? current.locks : [...current.locks, entry]));
    return this.manifest.locks.find(item => item.canonicalPath === identity.canonicalPath)!;
  }

  public async unlock(input: string): Promise<boolean> {
    const identity = await this.paths.resolve(input, true);
    let removed = false;
    this.adopt(await this.store.transact(current => {
      const locks = current.locks.filter(item => item.canonicalPath !== identity.canonicalPath);
      removed = locks.length !== current.locks.length;
      return locks;
    }));
    return removed;
  }

  public async replace(locks: readonly LockEntry[]): Promise<void> {
    this.adopt(await this.store.transact(() => [...locks]));
  }

  public async withPolicy<T>(operation: () => Promise<T>): Promise<T> {
    let result!: T;
    this.adopt(await this.store.transact(async current => {
      this.adopt(current);
      result = await operation();
      return current.locks;
    }));
    return result;
  }

  public async status(input: string, allowMissing = false): Promise<ProtectionStatus> {
    await this.refresh();
    const identity = await this.paths.resolve(input, allowMissing);
    const explicit = this.manifest.locks.find(item => item.canonicalPath === identity.canonicalPath);
    if (explicit) return { protected: true, explicit: true, lock: explicit };
    try {
      const fileId = await this.fileIdentity(identity.displayPath);
      const alias = this.manifest.locks.find(item => item.fileId === fileId);
      if (alias) return { protected: true, explicit: false, lock: alias };
    } catch { /* missing targets are evaluated by their canonical parent path */ }
    const inherited = this.manifest.locks
      .filter(item => item.kind === 'directory' && this.paths.contains(item.canonicalPath, identity.canonicalPath))
      .sort((a, b) => b.canonicalPath.length - a.canonicalPath.length)[0];
    if (inherited) return { protected: true, explicit: false, lock: inherited };
    // A developer may rename a locked directory. Its stable identity still
    // covers descendants even while the original stored path no longer exists.
    const directoryIds = new Map(this.manifest.locks.filter(lock => lock.kind === 'directory' && lock.fileId).map(lock => [lock.fileId, lock]));
    let ancestor = path.dirname(identity.displayPath);
    while (directoryIds.size) {
      try {
        const covering = directoryIds.get(await this.fileIdentity(ancestor));
        if (covering) return { protected: true, explicit: false, lock: covering };
      } catch { /* missing ancestors may still have a protected existing parent */ }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
    return { protected: false };
  }

  private adopt(next: LockManifest): void {
    const changed = JSON.stringify(next) !== JSON.stringify(this.manifest);
    this.manifest = next;
    if (changed) this.listeners.forEach(listener => listener());
  }

  public async lockedDescendant(input: string): Promise<LockEntry | undefined> {
    await this.refresh();
    const identity = await this.paths.resolve(input, true);
    return this.manifest.locks.find(lock => this.paths.contains(identity.canonicalPath, lock.canonicalPath));
  }
}
