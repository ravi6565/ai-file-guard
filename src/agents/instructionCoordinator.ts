import path from 'node:path';
import { LockEntry } from '../core/types';
import { ManagedSectionSynchronizer } from '../instructions/managedSection';
import { AgentAdapter } from './agentAdapter';
import { promises as fs } from 'node:fs';

export interface InstructionSyncResult {
  roots: string[];
  updated: string[];
  errors: { file: string; message: string }[];
}

export class InstructionCoordinator {
  public constructor(private readonly adapters: readonly AgentAdapter[], private readonly sections = new ManagedSectionSynchronizer()) {}

  public async sync(workspaceRoots: readonly string[], locks: readonly LockEntry[], canWrite?: (file: string) => void | Promise<void>): Promise<InstructionSyncResult> {
    const result: InstructionSyncResult = { roots: [...workspaceRoots], updated: [], errors: [] };
    for (const root of workspaceRoots) {
      const contains = (parent: string, child: string) => {
        const relative = path.relative(parent, child);
        return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
      };
      const hasLocks = locks.some(lock => contains(root, lock.displayPath) || (lock.kind === 'directory' && contains(lock.displayPath, root)));
      for (const adapter of this.adapters) {
        const files = [path.join(root, adapter.instructionFile)];
        // Codex ignores AGENTS.md when this higher-precedence file exists.
        if (adapter.id === 'codex') {
          const override = path.join(root, 'AGENTS.override.md');
          try { await fs.lstat(override); files.push(override); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
        for (const file of files) {
          try {
            if (!hasLocks) {
              // Do not litter every opened project with empty instruction files.
              // Previously generated sections must still be cleared on unlock.
              let stat;
              try { stat = await fs.lstat(file); }
              catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
              if (stat.isFile()) {
                const existing = await fs.readFile(file, 'utf8');
                if (!existing.includes('<!-- AI FILE GUARD:BEGIN -->') && !existing.includes('<!-- AI FILE GUARD:END -->')) continue;
              }
            }
            if (await this.sections.sync(file, adapter.render(root, locks), canWrite, root)) result.updated.push(file);
          }
          catch (error) { result.errors.push({ file, message: error instanceof Error ? error.message : String(error) }); }
        }
      }
    }
    return result;
  }
}
