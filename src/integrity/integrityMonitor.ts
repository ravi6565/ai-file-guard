import * as vscode from 'vscode';
import { LockManager } from '../core/lockManager';
import { AuditLogger } from '../audit/auditLogger';

// File events have no authenticated human/AI origin. This optional monitor only
// records changes; it never undoes or interrupts a developer edit.
export class IntegrityMonitor implements vscode.Disposable {
  private readonly watcher = vscode.workspace.createFileSystemWatcher('**/*');
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly disposables: vscode.Disposable[];
  public constructor(private readonly locks: LockManager, private readonly audit: AuditLogger) {
    const inspect = (uri: vscode.Uri) => {
      if (uri.scheme !== 'file') return;
      const previous = this.timers.get(uri.fsPath);
      if (previous) clearTimeout(previous);
      this.timers.set(uri.fsPath, setTimeout(() => {
        this.timers.delete(uri.fsPath);
        void this.inspect(uri.fsPath);
      }, 250));
    };
    this.disposables = [this.watcher, this.watcher.onDidChange(inspect), this.watcher.onDidCreate(inspect), this.watcher.onDidDelete(inspect)];
  }
  private async inspect(file: string): Promise<void> {
    try {
      const status = await this.locks.status(file, true);
      if (status.protected) await this.audit.record({
        action: 'protected-path-change', path: file, outcome: 'observed-origin-unknown',
        detail: 'This may be a developer edit. No attribution or automatic recovery was attempted.',
      });
    } catch (error) { console.error('AI File Guard monitoring failed', error); }
  }
  public dispose(): void { this.timers.forEach(clearTimeout); this.disposables.forEach(item => item.dispose()); }
}
