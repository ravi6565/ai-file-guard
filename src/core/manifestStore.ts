import { LockEntry, LockManifest } from './types';
import path from 'node:path';

export interface KeyValueStore {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void>;
}

const KEY = 'aiFileGuard.lockManifest.v1';
const EMPTY: LockManifest = { version: 1, locks: [] };

export interface ManifestRepository {
  load(): LockManifest;
  refresh(): Promise<LockManifest>;
  transact(update: (current: LockManifest) => readonly LockEntry[] | Promise<readonly LockEntry[]>): Promise<LockManifest>;
}

export class ManifestStore implements ManifestRepository {
  private queue: Promise<unknown> = Promise.resolve();
  public constructor(private readonly storage: KeyValueStore) {}

  public load(): LockManifest {
    const value = this.storage.get<unknown>(KEY, EMPTY);
    return validateManifest(value);
  }

  public async save(manifest: LockManifest): Promise<void> {
    await this.storage.update(KEY, manifest);
  }

  public async refresh(): Promise<LockManifest> { return this.load(); }

  public transact(update: (current: LockManifest) => readonly LockEntry[] | Promise<readonly LockEntry[]>): Promise<LockManifest> {
    const result = this.queue.then(async () => {
      const next: LockManifest = { version: 1, locks: await update(this.load()) };
      await this.save(next);
      return next;
    });
    this.queue = result.catch(() => undefined);
    return result;
  }
}

export function validateManifest(value: unknown): LockManifest {
  if (!isManifest(value)) throw new Error('Lock policy is invalid. Protection cannot be evaluated until the local policy is repaired.');
  return { version: 1, locks: value.locks.map(lock => ({ ...lock })) };
}

function isManifest(value: unknown): value is LockManifest {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<LockManifest>;
  return candidate.version === 1 && Array.isArray(candidate.locks) && candidate.locks.every(lock =>
    typeof lock === 'object' && lock !== null &&
    typeof lock.canonicalPath === 'string' && typeof lock.displayPath === 'string' &&
    isAbsolute(lock.canonicalPath) && isAbsolute(lock.displayPath) &&
    (lock.kind === 'file' || lock.kind === 'directory') && typeof lock.lockedAt === 'string' &&
    (lock.fileId === undefined || typeof lock.fileId === 'string'));
}

function isAbsolute(value: string): boolean { return path.posix.isAbsolute(value) || path.win32.isAbsolute(value); }
