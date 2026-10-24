import { promises as fs } from 'node:fs';
import path from 'node:path';
import { LockEntry } from '../core/types';

function contains(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

async function exists(file: string): Promise<boolean> {
  try { await fs.lstat(file); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}

/** Also remember nested scopes after their final lock is removed, so stale rules are cleared. */
export async function instructionRoots(workspaces: readonly string[], locks: readonly LockEntry[], previous: readonly string[] = []): Promise<string[]> {
  const roots = new Set<string>();
  const workspaceRoots: string[] = [];
  for (const candidate of workspaces) workspaceRoots.push(await fs.realpath(candidate));
  for (const candidate of [...workspaceRoots, ...previous]) {
    try { if ((await fs.stat(candidate)).isDirectory()) roots.add(await fs.realpath(candidate)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  for (const lock of locks) {
    const workspace = workspaceRoots.filter(root => contains(root, lock.displayPath)).sort((a, b) => b.length - a.length)[0];
    // Other projects' policies are synchronized by their own windows. An explicit
    // outside-workspace selection is supplied by the caller as an extra workspace.
    if (!workspace) continue;
    let directory = lock.kind === 'directory' ? lock.displayPath : path.dirname(lock.displayPath);
    while (contains(workspace, directory)) {
      if (await exists(directory)) {
        if (directory === workspace || await exists(path.join(directory, '.git')) || await exists(path.join(directory, 'AGENTS.md')) || await exists(path.join(directory, 'AGENTS.override.md')) || await exists(path.join(directory, 'CLAUDE.md'))) {
          roots.add(await fs.realpath(directory));
        }
      }
      if (directory === workspace) break;
      directory = path.dirname(directory);
    }
  }
  return [...roots].sort();
}
