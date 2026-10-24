export type ProtectionMode = 'review' | 'advisory' | 'hard-lock' | 'enforced';

export interface LockEntry {
  readonly canonicalPath: string;
  readonly displayPath: string;
  readonly kind: 'file' | 'directory';
  readonly lockedAt: string;
  readonly fileId?: string;
}

export interface LockManifest {
  readonly version: 1;
  readonly locks: readonly LockEntry[];
}

export type ProtectionStatus =
  | { readonly protected: false }
  | { readonly protected: true; readonly explicit: boolean; readonly lock: LockEntry };

export type FileOperation =
  | { readonly type: 'write' | 'create' | 'delete'; readonly path: string }
  | { readonly type: 'rename'; readonly source: string; readonly destination: string };

export interface PolicyDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly lock?: LockEntry;
}
