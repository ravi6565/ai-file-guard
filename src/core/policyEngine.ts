import { LockManager } from './lockManager';
import { FileOperation, PolicyDecision, ProtectionMode } from './types';

export class PolicyEngine {
  public constructor(private readonly locks: LockManager) {}

  public async evaluate(operation: FileOperation, mode: ProtectionMode): Promise<PolicyDecision> {
    if (mode === 'advisory') return { allowed: true, reason: 'Advisory mode detects changes but does not block filesystem writes.' };
    const targets = operation.type === 'rename' ? [operation.source, operation.destination] : [operation.path];
    for (const target of targets) {
      const status = await this.locks.status(target, operation.type === 'create' || operation.type === 'rename');
      if (status.protected) {
        return { allowed: false, lock: status.lock, reason: `${operation.type} would affect protected resource ${status.lock.displayPath}.` };
      }
      if (operation.type === 'delete' || operation.type === 'rename') {
        const descendant = await this.locks.lockedDescendant(target);
        if (descendant) return { allowed: false, lock: descendant, reason: `${operation.type} would affect locked descendant ${descendant.displayPath}.` };
      }
    }
    return { allowed: true };
  }
}
