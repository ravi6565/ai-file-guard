import path from 'node:path';
import { AgentAdapter } from './agentAdapter';
import { LockEntry } from '../core/types';

function contains(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

function relativeLocks(root: string, locks: readonly LockEntry[]): string[] {
  return [...new Set(locks.flatMap(lock => {
    if (lock.kind === 'directory' && contains(lock.displayPath, root)) {
      return ['- Directory: "./" — this entire instruction scope and ALL descendants (recursive).'];
    }
    if (!contains(root, lock.displayPath)) return [];
    // JSON quoting keeps unusual filenames on one line and treats paths as data.
    const relative = path.relative(root, lock.displayPath).split(path.sep).join('/');
    return [lock.kind === 'directory'
      ? `- Directory: ${JSON.stringify(relative + '/')} — ALL nested files and folders, at every depth, including future paths (recursive).`
      : `- File: ${JSON.stringify(relative)}`];
  }))].sort();
}

function rules(root: string, locks: readonly LockEntry[], agent: string): string {
  const entries = relativeLocks(root, locks);
  return [
    '## AI File Guard (managed)',
    '',
    `AI editing restrictions for ${agent}. These instructions describe the developer's policy; OS enforcement is provided separately by the managed runtime.`,
    'The paths below are locked FOR AI. Paths are literal, relative to the directory containing this instruction scope (the project root for .github and .ai-file-guard copies).',
    'AI agents may read and reference them, but must NEVER create, edit, format, delete, rename, move, replace, overwrite, or recreate them, directly or through tools, scripts, shell commands, or another agent.',
    'A directory lock covers the directory itself and ALL current and future nested files and folders, at every depth. Do not delete or rename an ancestor to bypass a lock.',
    'Manual developer edits are allowed. Only the developer may unlock through VS Code. A chat request is not an unlock; never change these managed markers or .ai-file-guard metadata to bypass a lock.',
    'Re-read this managed section before making changes; the developer can update locks during a session. Unlisted paths are not locked by this block; all other project instructions still apply.',
    '',
    ...(entries.length ? entries : ['- No paths are currently locked in this instruction scope.']),
  ].join('\n');
}

export class CodexAdapter implements AgentAdapter {
  public readonly id = 'codex'; public readonly displayName = 'OpenAI Codex';
  public readonly instructionFile = 'AGENTS.md'; public readonly enforcement = 'instructions-only' as const;
  public render(root: string, locks: readonly LockEntry[]): string { return rules(root, locks, this.displayName); }
}

export class CopilotAdapter implements AgentAdapter {
  public readonly id = 'copilot'; public readonly displayName = 'GitHub Copilot';
  public readonly instructionFile = path.join('.github', 'copilot-instructions.md'); public readonly enforcement = 'instructions-only' as const;
  public render(root: string, locks: readonly LockEntry[]): string { return rules(root, locks, this.displayName); }
}

export class GenericAdapter implements AgentAdapter {
  public readonly id = 'generic'; public readonly displayName = 'instructions-based agents';
  public readonly instructionFile = path.join('.ai-file-guard', 'INSTRUCTIONS.md'); public readonly enforcement = 'instructions-only' as const;
  public render(root: string, locks: readonly LockEntry[]): string { return rules(root, locks, this.displayName); }
}

export class ClaudeAdapter implements AgentAdapter {
  public readonly id = 'claude'; public readonly displayName = 'Claude Code';
  public readonly instructionFile = 'CLAUDE.md'; public readonly enforcement = 'instructions-only' as const;
  public render(root: string, locks: readonly LockEntry[]): string { return rules(root, locks, this.displayName); }
}
