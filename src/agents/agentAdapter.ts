import { LockEntry } from '../core/types';

export interface AgentAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly instructionFile: string;
  readonly enforcement: 'instructions-only';
  render(workspaceRoot: string, locks: readonly LockEntry[]): string;
}
