import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ManifestRepository, validateManifest } from './manifestStore';
import { LockEntry, LockManifest } from './types';

// Machine-local, outside repositories and Settings Sync. The on-disk transaction
// lock prevents two VS Code windows from overwriting each other's policies.
export class LocalManifestStore implements ManifestRepository {
  private current: LockManifest = { version: 1, locks: [] };
  private seenFile = false;
  public constructor(public readonly location: string) {}
  public load(): LockManifest { return this.current; }
  public async refresh(): Promise<LockManifest> {
    try {
      this.current = validateManifest(JSON.parse(await fs.readFile(this.location, 'utf8')));
      this.seenFile = true;
    }
    catch (error) {
      if (code(error) !== 'ENOENT') throw error;
      if (this.seenFile) throw new Error('The local lock policy disappeared. Restore it before evaluating or changing locks.');
      this.current = { version: 1, locks: [] };
    }
    return this.current;
  }

  public async transact(update: (current: LockManifest) => readonly LockEntry[] | Promise<readonly LockEntry[]>): Promise<LockManifest> {
    await fs.mkdir(path.dirname(this.location), { recursive: true, mode: 0o700 });
    const lockDirectory = `${this.location}.lock`;
    const deadline = Date.now() + 5_000;
    while (true) {
      try { await fs.mkdir(lockDirectory, { mode: 0o700 }); break; }
      catch (error) {
        if (code(error) !== 'EEXIST') throw error;
        if (Date.now() >= deadline) throw new Error(`Local policy is busy in another window. Retry the operation. Lock: ${lockDirectory}`);
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    const temporary = `${this.location}.${randomUUID()}.tmp`;
    try {
      const current = await this.refresh();
      const next = validateManifest({ version: 1, locks: await update(current) });
      if (this.seenFile && JSON.stringify(next) === JSON.stringify(current)) return next;
      await fs.writeFile(temporary, JSON.stringify(next, null, 2), { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, this.location);
      this.current = next;
      this.seenFile = true;
      return next;
    } finally {
      try { await fs.unlink(temporary); }
      catch (error) { if (code(error) !== 'ENOENT') throw error; }
      finally { await fs.rmdir(lockDirectory); }
    }
  }
}

function code(error: unknown): string | undefined { return (error as NodeJS.ErrnoException)?.code; }
