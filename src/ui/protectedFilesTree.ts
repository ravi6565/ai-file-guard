import * as vscode from 'vscode';
import path from 'node:path';
import { LockManager } from '../core/lockManager';
import { LockEntry } from '../core/types';
import { detectEnforcementCapability } from '../enforcement/platformEnforcement';

export class ProtectedFilesTree implements vscode.TreeDataProvider<LockEntry>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<LockEntry | undefined>();
  private readonly subscription: { dispose(): void };
  public readonly onDidChangeTreeData = this.changed.event;

  public constructor(private readonly locks: LockManager, private readonly isEnforced: () => boolean = () => detectEnforcementCapability().available) {
    this.subscription = locks.onDidChange(() => this.changed.fire(undefined));
  }

  public getChildren(): LockEntry[] {
    return [...this.locks.all()].sort((a, b) => a.displayPath.localeCompare(b.displayPath));
  }

  public refresh(): void { this.changed.fire(undefined); }

  public getTreeItem(lock: LockEntry): vscode.TreeItem {
    const item = new vscode.TreeItem(path.basename(lock.displayPath), vscode.TreeItemCollapsibleState.None);
    item.resourceUri = vscode.Uri.file(lock.displayPath);
    const enforced = this.isEnforced();
    item.description = `${enforced ? 'Managed AI lock' : 'Sandbox unavailable'} • ${vscode.workspace.asRelativePath(lock.displayPath, false)}`;
    item.tooltip = `${lock.displayPath}\n${enforced ? 'Locked for agents in Protected AI Terminal. Manual edits allowed. Ordinary external AI sessions are not confined.' : 'Policy saved; managed protection is unavailable.'}`;
    item.iconPath = new vscode.ThemeIcon(enforced ? 'lock' : 'warning');
    item.contextValue = 'savedReviewPolicy';
    return item;
  }

  public dispose(): void { this.subscription.dispose(); this.changed.dispose(); }
}
