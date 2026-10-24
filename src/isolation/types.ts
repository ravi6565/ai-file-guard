export interface BaselineFile { readonly relativePath: string; readonly hash: string; readonly kind?: 'file' | 'directory'; }
export interface IsolationSession {
  readonly id: string;
  readonly workspaceRoot: string;
  readonly stagingRoot: string;
  readonly createdAt: string;
  readonly baseline: readonly BaselineFile[];
}
export interface ProposedChange { readonly type: 'create' | 'write' | 'delete' | 'mkdir' | 'rmdir'; readonly relativePath: string; readonly stagedHash?: string; }
export interface BrokerResult { readonly applied: readonly ProposedChange[]; readonly rejected: readonly { change: ProposedChange; reason: string }[]; }
