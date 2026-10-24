import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class ManagedSectionSynchronizer {
  public constructor(private readonly begin = '<!-- AI FILE GUARD:BEGIN -->', private readonly end = '<!-- AI FILE GUARD:END -->') {}

  public merge(existing: string, body: string): string {
    const block = `${this.begin}\n${body.trim()}\n${this.end}`;
    const start = existing.indexOf(this.begin);
    const finish = existing.indexOf(this.end);
    if ((start >= 0 || finish >= 0) && (start < 0 || finish < start || existing.indexOf(this.begin, start + this.begin.length) >= 0 || existing.indexOf(this.end, finish + this.end.length) >= 0)) {
      throw new Error('Malformed or duplicate AI File Guard markers. Repair the managed section before synchronizing.');
    }
    if (start >= 0 && finish >= start) {
      return `${existing.slice(0, start)}${block}${existing.slice(finish + this.end.length)}`;
    }
    return `${existing}${existing.length ? (existing.endsWith('\n') ? '\n' : '\n\n') : ''}${block}\n`;
  }

  public async sync(filePath: string, body: string, canWrite: (file: string) => void | Promise<void> = () => {}, root = path.dirname(filePath)): Promise<boolean> {
    const relative = path.relative(root, filePath);
    if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) throw new Error('Instruction path escapes its project.');
    // Refuse repository symlinks instead of writing through them to another project.
    let directory = root;
    for (const segment of ['', ...path.dirname(relative).split(path.sep).filter(segment => segment !== '.')]) {
      directory = path.join(directory, segment);
      try { await fs.mkdir(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      const stat = await fs.lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Instruction directory is not a regular directory: ${directory}`);
    }
    let mode = 0o600;
    try {
      const stat = await fs.lstat(filePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1) throw new Error(`Instruction file must be a regular, unlinked file: ${filePath}`);
      mode = stat.mode & 0o777;
    } catch (error) { if (!isMissing(error)) throw error; }
    let existing = '';
    try { existing = await fs.readFile(filePath, 'utf8'); } catch (error) { if (!isMissing(error)) throw error; }
    const content = this.merge(existing, body);
    if (content === existing) return false;
    await canWrite(filePath);
    const temporary = `${filePath}.ai-file-guard-${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, content, { encoding: 'utf8', mode, flag: 'wx' });
      await fs.chmod(temporary, mode);
      const current = await fs.readFile(filePath, 'utf8').catch(error => { if (!isMissing(error)) throw error; return ''; });
      if (current !== existing) throw new Error(`Instruction file changed during synchronization; retry: ${filePath}`);
      await canWrite(filePath);
      await fs.rename(temporary, filePath);
      return true;
    } finally { await fs.rm(temporary, { force: true }); }
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
