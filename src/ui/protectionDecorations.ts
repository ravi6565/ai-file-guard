import * as vscode from 'vscode';
import { LockManager } from '../core/lockManager';
import { detectEnforcementCapability } from '../enforcement/platformEnforcement';

export class ProtectionDecorations implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<vscode.Uri[] | undefined>();
  private readonly subscription: { dispose(): void };
  public readonly onDidChangeFileDecorations = this.changed.event;

  public constructor(private readonly locks: LockManager, private readonly isEnforced: () => boolean = () => detectEnforcementCapability().available) {
    this.subscription = locks.onDidChange(() => this.changed.fire(undefined));
  }

  public async provideFileDecoration(uri: vscode.Uri): Promise<vscode.FileDecoration | undefined> {
    if (uri.scheme !== 'file') return undefined;
    try {
      const status = await this.locks.status(uri.fsPath);
      if (!status.protected) return undefined;
      const enforced = this.isEnforced();
      return {
        badge: enforced ? '🔒' : '!',
        tooltip: enforced ? `Locked against managed AI changes${status.explicit ? '' : ` by ${status.lock.displayPath}`}. Use the Protected AI Terminal; ordinary external AI sessions are not confined.` : 'Saved policy; managed sandbox unavailable. AI protection is NOT active.',
        color: new vscode.ThemeColor('charts.yellow'),
        propagate: status.explicit && status.lock.kind === 'directory',
      };
    } catch { return undefined; }
  }

  public dispose(): void { this.subscription.dispose(); this.changed.dispose(); }
}
