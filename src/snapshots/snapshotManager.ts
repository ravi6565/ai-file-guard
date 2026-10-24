import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { LockEntry } from '../core/types';
import { hashBytes, hashFile } from '../integrity/hash';

export interface SnapshotRecord { readonly source: string; readonly hash: string; readonly blob: string; readonly capturedAt: string; }

export class SnapshotManager {
  private readonly records = new Map<string, SnapshotRecord>();
  public constructor(private readonly root: string) {}

  public async initialize(): Promise<void> {
    await fs.mkdir(path.join(this.root, 'blobs'), { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(this.root, 'index.json'), 'utf8')) as SnapshotRecord[];
      parsed.forEach(record => this.records.set(record.source, record));
    } catch { /* first use or invalid index: snapshots remain unavailable */ }
  }

  public get(source: string): SnapshotRecord | undefined { return this.records.get(source); }

  public async readVerified(source: string): Promise<Buffer | undefined> {
    const record = this.records.get(source); if (!record) return undefined;
    const content = await fs.readFile(record.blob);
    if (hashBytes(content) !== record.hash) throw new Error('Snapshot integrity verification failed.');
    return content;
  }

  public async capture(lock: LockEntry): Promise<number> {
    const files = lock.kind === 'file' ? [lock.displayPath] : await walk(lock.displayPath);
    let captured = 0;
    for (const file of files) {
      const content = await fs.readFile(file);
      const hash = hashBytes(content);
      const blob = path.join(this.root, 'blobs', hash);
      try { await fs.writeFile(blob, content, { flag: 'wx', mode: 0o600 }); } catch (error) { if (!isExists(error)) throw error; }
      this.records.set(file, { source: file, hash, blob, capturedAt: new Date().toISOString() });
      captured++;
    }
    await this.persist();
    return captured;
  }

  public async verify(file: string): Promise<{ changed: boolean; expected?: string; actual?: string }> {
    const record = this.records.get(file);
    if (!record) {
      try { return { changed: true, actual: await hashFile(file) }; }
      catch (error) { if (isMissing(error)) return { changed: false }; throw error; }
    }
    try { const actual = await hashFile(file); return { changed: actual !== record.hash, expected: record.hash, actual }; }
    catch (error) { if (isMissing(error)) return { changed: true, expected: record.hash }; throw error; }
  }

  public async restore(file: string, observedHash?: string): Promise<void> {
    const record = this.records.get(file);
    let current: string | undefined;
    try { current = await hashFile(file); } catch (error) { if (!isMissing(error)) throw error; }
    if (current !== observedHash) throw new Error('The file changed again after detection; recovery was stopped to preserve developer work.');
    if (!record) {
      if (current === undefined) return;
      await fs.unlink(file);
      return;
    }
    const content = await fs.readFile(record.blob);
    if (hashBytes(content) !== record.hash) throw new Error('Snapshot integrity verification failed.');
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.ai-file-guard-recovery-${process.pid}`;
    await fs.writeFile(temporary, content, { flag: 'wx' });
    await fs.rename(temporary, file);
  }

  private async persist(): Promise<void> {
    const content = JSON.stringify([...this.records.values()], null, 2);
    const target = path.join(this.root, 'index.json'); const temporary = `${target}.tmp`;
    await fs.writeFile(temporary, content, { mode: 0o600 }); await fs.rename(temporary, target);
  }
}

async function walk(root: string): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.name === '.git' || entry.name === 'node_modules') continue;
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...await walk(child)); else if (entry.isFile()) output.push(child);
  }
  return output;
}
function isMissing(error: unknown): boolean { return code(error) === 'ENOENT'; }
function isExists(error: unknown): boolean { return code(error) === 'EEXIST'; }
function code(error: unknown): string | undefined { return typeof error === 'object' && error !== null && 'code' in error ? String((error as NodeJS.ErrnoException).code) : undefined; }
