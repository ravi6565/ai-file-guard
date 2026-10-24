import * as vscode from 'vscode';

export class AgentChangesPreview implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly documents = new Map<string, string>();
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this.changed.event;
  public readonly registration = vscode.workspace.registerTextDocumentContentProvider('ai-file-guard-review', this);

  public provideTextDocumentContent(uri: vscode.Uri): string { return this.documents.get(uri.toString()) ?? 'No review available.'; }
  public async show(sessionId: string, content: string): Promise<void> {
    const uri = vscode.Uri.from({ scheme: 'ai-file-guard-review', authority: 'changes', path: `/${sessionId}/proposed-changes.md` });
    this.documents.set(uri.toString(), content);
    this.changed.fire(uri);
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, { preview: true });
  }
  public dispose(): void { this.registration.dispose(); this.changed.dispose(); this.documents.clear(); }
}
