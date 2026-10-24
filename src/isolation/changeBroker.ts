import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LockManager } from '../core/lockManager';
import { hashBytes, hashFile } from '../integrity/hash';
import { AuditLogger } from '../audit/auditLogger';
import { BrokerResult, IsolationSession, ProposedChange } from './types';
import { inventory } from './isolationManager';
import { PolicyEngine } from '../core/policyEngine';

export class ChangeBroker {
  public constructor(private readonly locks: LockManager, private readonly audit: AuditLogger) {}

  public async preview(session: IsolationSession): Promise<ProposedChange[]> {
    const before = new Map(session.baseline.map(file => [normalize(file.relativePath), file]));
    const after = new Map((await inventory(session.stagingRoot)).map(file => [normalize(file.relativePath), file]));
    const changes: ProposedChange[] = [];
    for (const [relativePath, item] of after) {
      const previous = before.get(relativePath);
      if (!previous) changes.push({ type: item.kind === 'directory' ? 'mkdir' : 'create', relativePath, stagedHash: item.hash });
      else if ((previous.kind ?? 'file') !== item.kind) throw new Error(`Changing file/directory kind is unsupported: ${relativePath}`);
      else if (previous.hash !== item.hash) changes.push({ type: 'write', relativePath, stagedHash: item.hash });
    }
    for (const [relativePath, item] of before) if (!after.has(relativePath)) changes.push({ type: item.kind === 'directory' ? 'rmdir' : 'delete', relativePath });
    const order = { mkdir: 0, create: 1, write: 1, delete: 2, rmdir: 3 };
    return changes.sort((a, b) => order[a.type] - order[b.type] ||
      ((a.type === 'mkdir' ? 1 : -1) * (a.relativePath.split('/').length - b.relativePath.split('/').length)) || a.relativePath.localeCompare(b.relativePath));
  }

  public async review(session: IsolationSession): Promise<{ change: ProposedChange; allowed: boolean; reason?: string }[]> {
    const baseline = new Map(session.baseline.map(file => [normalize(file.relativePath), file.hash]));
    const result = [];
    for (const change of await this.preview(session)) {
      try {
        const target = await containedPath(session.workspaceRoot, change.relativePath);
        await containedPath(session.stagingRoot, change.relativePath);
        const reason = await this.rejectionReason(change, target, baseline.get(normalize(change.relativePath)));
        result.push({ change, allowed: !reason, reason });
      } catch (error) { result.push({ change, allowed: false, reason: error instanceof Error ? error.message : String(error) }); }
    }
    return result;
  }

  public advanceBaseline(session: IsolationSession, result: BrokerResult): IsolationSession {
    const baseline = new Map(session.baseline.map(item => [normalize(item.relativePath), item]));
    for (const change of result.applied) {
      if (change.type === 'delete' || change.type === 'rmdir') baseline.delete(normalize(change.relativePath));
      else baseline.set(normalize(change.relativePath), {
        relativePath: change.relativePath,
        kind: change.type === 'mkdir' ? 'directory' : 'file',
        hash: change.type === 'mkdir' ? 'directory' : change.stagedHash!,
      });
    }
    return { ...session, baseline: [...baseline.values()] };
  }

  public async apply(session: IsolationSession): Promise<BrokerResult> {
    const changes = await this.preview(session);
    // The shared policy transaction serializes lock changes and broker application
    // across local windows. It does not confine arbitrary external processes.
    return this.locks.withPolicy(async () => {
      const applied: ProposedChange[] = [];
      const rejected: { change: ProposedChange; reason: string }[] = [];
      const baseline = new Map(session.baseline.map(file => [normalize(file.relativePath), file.hash]));
      for (const change of changes) {
        let target: string | undefined;
        let temporary: string | undefined;
        try {
          target = await containedPath(session.workspaceRoot, change.relativePath);
          const staged = await containedPath(session.stagingRoot, change.relativePath);
          const reason = await this.rejectionReason(change, target, baseline.get(normalize(change.relativePath)));
          if (reason) throw new Error(reason);
          let content: Buffer | undefined;
          if (change.type === 'create' || change.type === 'write') {
            const handle = await fs.open(staged, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
            try {
              if (!(await handle.stat()).isFile()) throw new Error('Staged source is not a regular file.');
              content = await handle.readFile();
            } finally { await handle.close(); }
            if (hashBytes(content) !== change.stagedHash) throw new Error('Staged content changed during review; retry with a fresh preview.');
          }
          // Fail before a write if the attempted operation cannot be audited.
          await this.audit.record({ action: `broker-${change.type}`, path: target, outcome: 'validated' });
          if (change.type === 'delete') await fs.unlink(target);
          else if (change.type === 'mkdir') await fs.mkdir(target);
          else if (change.type === 'rmdir') await fs.rmdir(target);
          else {
            const mode = change.type === 'write' ? (await fs.stat(target)).mode & 0o777 : 0o644;
            await fs.mkdir(path.dirname(target), { recursive: true });
            await containedPath(session.workspaceRoot, change.relativePath);
            temporary = `${target}.ai-file-guard-${randomUUID()}.tmp`;
            await fs.writeFile(temporary, content!, { flag: 'wx', mode });
            if (change.type === 'write') await fs.chmod(temporary, mode);
            // Recheck concurrent developer changes after reading the staged bytes.
            const recheck = await this.rejectionReason(change, target, baseline.get(normalize(change.relativePath)));
            if (recheck) throw new Error(recheck);
            await fs.rename(temporary, target);
          }
          applied.push(change);
        } catch (error) {
          rejected.push({ change, reason: error instanceof Error ? error.message : String(error) });
        } finally {
          if (temporary) await fs.unlink(temporary).catch(error => { if (code(error) !== 'ENOENT') throw error; });
        }
        // Logging cannot turn an already completed write into a reported rejection.
        const rejection = rejected.find(item => item.change === change);
        await this.audit.record({
          action: `broker-${change.type}`, path: target,
          outcome: rejection ? 'rejected' : 'applied', detail: rejection?.reason,
        }).catch(() => undefined);
      }
      return { applied, rejected };
    });
  }

  private async rejectionReason(change: ProposedChange, target: string, baselineHash?: string): Promise<string | undefined> {
    // Protect managed metadata consistently on case-insensitive filesystems too.
    const policyPath = normalize(change.relativePath).toLowerCase();
    const parts = policyPath.split('/');
    if (parts.includes('.ai-file-guard') || parts.includes('.git') ||
        parts.some(part => ['agents.md', 'agents.override.md', 'claude.md'].includes(part)) ||
        policyPath.endsWith('.github/copilot-instructions.md')) {
      return 'Agent changes to authoritative policy files are forbidden.';
    }
    const operation = change.type === 'mkdir' ? 'create' : change.type === 'rmdir' ? 'delete' : change.type;
    const decision = await new PolicyEngine(this.locks).evaluate({ type: operation, path: target }, 'review');
    if (!decision.allowed) return decision.reason;
    if (change.type === 'rmdir') {
      try { if (!(await fs.lstat(target)).isDirectory()) return 'Original directory is missing or changed kind.'; }
      catch { return 'Original directory is missing or unreadable.'; }
    } else if (change.type !== 'create' && change.type !== 'mkdir') {
      try { if (await hashFile(target) !== baselineHash) return 'Original changed concurrently after the session began.'; }
      catch { return 'Original is missing or unreadable; concurrency check rejected the change.'; }
    } else {
      try { await fs.lstat(target); return 'Creation target now exists in the original workspace.'; }
      catch (error) { if (code(error) !== 'ENOENT') return 'Creation target could not be validated.'; }
    }
    return undefined;
  }
}

function normalize(value: string): string { return value.split(path.sep).join('/'); }

// Lexical containment alone permits an unprotected symlink to escape either
// root. Check every existing component and fail on any symlink/junction.
async function containedPath(root: string, relative: string): Promise<string> {
  if (!relative || path.isAbsolute(relative)) throw new Error('Path traversal rejected.');
  const canonicalRoot = await fs.realpath(root);
  const target = path.resolve(canonicalRoot, relative);
  const relation = path.relative(canonicalRoot, target);
  if (!relation || relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) throw new Error('Path traversal rejected.');
  let cursor = canonicalRoot;
  for (const part of relation.split(path.sep)) {
    cursor = path.join(cursor, part);
    try {
      const stat = await fs.lstat(cursor);
      if (stat.isSymbolicLink()) throw new Error('Symlink or junction paths are not accepted by the review broker.');
    } catch (error) { if (code(error) !== 'ENOENT') throw error; }
  }
  return target;
}
function code(error: unknown): string | undefined { return (error as NodeJS.ErrnoException)?.code; }
