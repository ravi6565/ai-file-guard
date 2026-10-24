import * as vscode from 'vscode';
import { LockManager } from '../core/lockManager';
import { detectEnforcementCapability } from '../enforcement/platformEnforcement';

export class GuardStatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  private readonly disposables: vscode.Disposable[] = [];

  public constructor(private readonly locks: LockManager) {
    this.item.command = 'aiFileGuard.showStatus';
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => void this.refresh()),
      vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('aiFileGuard.protectionMode')) void this.refresh(); }),
      locks.onDidChange(() => void this.refresh()),
    );
    void this.refresh();
    this.item.show();
  }

  public async refresh(): Promise<void> {
    const active = vscode.window.activeTextEditor?.document.uri;
    let suffix = '';
    if (active?.scheme === 'file') {
      try { suffix = (await this.locks.status(active.fsPath, true)).protected ? ' • Locked' : ' • Unlocked'; }
      catch { suffix = ' • Policy error'; }
    }
    const capability = detectEnforcementCapability();
    this.item.text = `${capability.available ? '$(shield)' : '$(warning)'} AI Guard: ${capability.available ? 'Managed sandbox' : 'Sandbox unavailable'}${suffix}`;
    this.item.tooltip = `${capability.reason} Manual editing is allowed. Protection applies only to managed agents.`;
  }

  public dispose(): void { this.disposables.forEach(item => item.dispose()); this.item.dispose(); }
}
