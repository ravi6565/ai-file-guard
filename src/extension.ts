import * as vscode from 'vscode';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { LockManager } from './core/lockManager';
import { ManifestStore } from './core/manifestStore';
import { LocalManifestStore } from './core/localManifestStore';
import { initializePublisherPolicy } from './core/publisherPolicyMigration';
import { PathResolver } from './core/pathResolver';
import { ProtectionDecorations } from './ui/protectionDecorations';
import { ProtectedFilesTree } from './ui/protectedFilesTree';
import { GuardStatusBar } from './ui/statusBar';
import { AgentChangesPreview } from './ui/agentChangesPreview';
import { AuditLogger } from './audit/auditLogger';
import { IntegrityMonitor } from './integrity/integrityMonitor';
import { IsolationManager } from './isolation/isolationManager';
import { ChangeBroker } from './isolation/changeBroker';
import { IsolationSession } from './isolation/types';
import { detectEnforcementCapability, setEnforcementCapability } from './enforcement/platformEnforcement';
import { ManagedSandbox } from './enforcement/managedSandbox';
import { LEGACY_PERMISSION_KEY, PermissionEnforcer } from './enforcement/permissionEnforcer';
import { LEGACY_READONLY_KEY, ReadonlySettingsManager } from './enforcement/readonlySettings';
import { ClaudeAdapter, CodexAdapter, CopilotAdapter, GenericAdapter } from './agents/adapters';
import { InstructionCoordinator, InstructionSyncResult } from './agents/instructionCoordinator';
import { instructionRoots } from './instructions/workspaceRoots';

export async function activate(context: vscode.ExtensionContext) {
  if (vscode.env.remoteName) throw new Error('AI File Guard currently supports local VS Code windows only.');
  const storageRoot = context.globalStorageUri.fsPath;
  const output = vscode.window.createOutputChannel('AI File Guard');
  context.subscriptions.push(output);
  const policy = new LocalManifestStore(path.join(storageRoot, 'local-locks.json'));
  await policy.refresh();
  if (context.extension.id === 'ravikiranv.ai-file-guard') {
    const imported = await initializePublisherPolicy(policy, path.join(path.dirname(storageRoot), 'ai-file-guard.ai-file-guard', 'local-locks.json'));
    if (imported) output.appendLine(`Imported ${imported} local lock(s) from the previous publisher. Disable the old extension and start new protected terminals; review sessions and agent credentials are not copied.`);
  }
  // Import this workspace once; never re-import locks that the user later removes.
  if (!context.workspaceState.get('aiFileGuard.localPolicyMigrated.v1', false)) {
    const previous = new ManifestStore(context.workspaceState).load();
    if (previous.locks.length) await policy.transact(current => {
      const merged = new Map(current.locks.map(lock => [lock.canonicalPath, lock]));
      previous.locks.forEach(lock => { if (!merged.has(lock.canonicalPath)) merged.set(lock.canonicalPath, lock); });
      return [...merged.values()];
    });
    await context.workspaceState.update('aiFileGuard.localPolicyMigrated.v1', true);
  }
  const locks = new LockManager(policy, new PathResolver());
  const audit = new AuditLogger(path.join(storageRoot, 'audit', 'events.jsonl'));
  const isolation = new IsolationManager(path.join(storageRoot, 'sessions'));
  const broker = new ChangeBroker(locks, audit);
  const sandbox = new ManagedSandbox(path.join(storageRoot, 'runtime'));
  context.subscriptions.push({ dispose: () => { void sandbox.dispose(); } });
  setEnforcementCapability(await sandbox.verify());
  const canonicalStorage = await fs.realpath(storageRoot).catch(() => path.resolve(storageRoot));
  const assertOriginalPath = async (file: string) => {
    const canonical = (await new PathResolver().resolve(file)).displayPath;
    const relative = path.relative(canonicalStorage, canonical);
    if (!relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))) {
      throw new Error('Select original project files, not AI File Guard copies, credentials, or extension storage.');
    }
  };
  const managedTerminals = new Set<vscode.Terminal>();
  context.subscriptions.push({ dispose: () => managedTerminals.forEach(terminal => terminal.dispose()) });
  let activeSession = context.workspaceState.get<IsolationSession | undefined>('aiFileGuard.reviewSession', undefined);
  let queue: Promise<unknown> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const pending = queue.then(operation);
    queue = pending.catch(() => undefined);
    return pending;
  };
  const report = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    output.appendLine(message);
    void vscode.window.showErrorMessage(`AI File Guard: ${message}`);
    return { ok: false as const, error: message };
  };
  const record = async (action: string, resource: string, outcome: string) => {
    try { await audit.record({ action, path: resource, outcome }); }
    catch (error) { output.appendLine(`Policy saved; audit write failed: ${String(error)}`); }
  };
  const restoreLegacy = async () => {
    for (const [storage, key] of [
      [context.globalState, LEGACY_PERMISSION_KEY],
      [context.workspaceState, 'aiFileGuard.permissionState.v2'],
    ] as const) {
      const enforcer = new PermissionEnforcer(storage, process.platform, key);
      if (enforcer.size()) { await enforcer.suspend(); await enforcer.clearUnused([]); }
    }
    await new ReadonlySettingsManager(context.globalState, LEGACY_READONLY_KEY).clearLegacyForOpenFolders();
    await new ReadonlySettingsManager(context.workspaceState).clearLegacyForOpenFolders();
  };
  // Keep commands registered even if a legacy permission cannot be restored.
  // The user can retry the repair command after resolving the reported OS error.
  try { await restoreLegacy(); } catch (error) { report(error); }
  // Pass the same live capability reader used by activation/commands. Module
  // paths can have distinct cache identities on case-insensitive hosts.
  const isEnforced = () => detectEnforcementCapability().available;
  const tree = new ProtectedFilesTree(locks, isEnforced);
  const decorations = new ProtectionDecorations(locks, isEnforced);
  const statusBar = new GuardStatusBar(locks);
  const previews = new AgentChangesPreview();
  const roots = () => vscode.workspace.workspaceFolders?.filter(folder => folder.uri.scheme === 'file') ?? [];
  const instructionRootsKey = 'aiFileGuard.instructionRoots.v1';
  let previousInstructionRoots = context.workspaceState.get<string[]>(instructionRootsKey, []);
  let lastInstructionSignature: string | undefined;
  let lastInstructionError: string | undefined;
  let instructionTargets = new Set<string>();
  const adapters = () => {
    const enabled = vscode.workspace.getConfiguration('aiFileGuard').get<string[]>('adapters', ['codex', 'copilot', 'claude', 'generic']);
    return [new CodexAdapter(), new CopilotAdapter(), new ClaudeAdapter(), new GenericAdapter()].filter(adapter => enabled.includes(adapter.id));
  };
  const instructionSignature = () => JSON.stringify([locks.all(), roots().map(root => root.uri.fsPath), previousInstructionRoots, adapters().map(adapter => adapter.id)]);
  const syncInstructions = async (force = false): Promise<InstructionSyncResult> => {
    if (!force && instructionSignature() === lastInstructionSignature) return { roots: previousInstructionRoots, updated: [], errors: [] };
    // Share the policy lease with other windows so an older synchronization
    // cannot overwrite instruction files after a newer unlock has completed.
    const result = await locks.withPolicy(async () => {
      const directories = await instructionRoots(roots().map(root => root.uri.fsPath), locks.all(), previousInstructionRoots);
      for (const directory of directories) await assertOriginalPath(directory);
      instructionTargets = new Set(directories.flatMap(directory => [...adapters().map(adapter => path.join(directory, adapter.instructionFile)), path.join(directory, 'AGENTS.override.md')]));
      const result = await new InstructionCoordinator(adapters()).sync(directories, locks.all(), async file => {
        for (const document of vscode.workspace.textDocuments) {
          if (document.uri.scheme === 'file' && document.isDirty && (await new PathResolver().resolve(document.uri.fsPath, true)).displayPath === file) {
            throw new Error('Unsaved instruction edits were preserved. Save this file to retry synchronization.');
          }
        }
      });
      // Keep scopes even after their last lock is removed, to clear stale rules.
      previousInstructionRoots = directories;
      await context.workspaceState.update(instructionRootsKey, directories);
      return result;
    });
    if (!result.errors.length) {
      lastInstructionSignature = instructionSignature();
      lastInstructionError = undefined;
    } else {
      lastInstructionSignature = undefined;
      const message = result.errors.map(error => `${error.file}: ${error.message}`).join('\n');
      if (message !== lastInstructionError) {
        lastInstructionError = message;
        output.appendLine(`Instruction synchronization incomplete:\n${message}`);
        void vscode.window.showErrorMessage('AI File Guard: local policy is saved, but some AI instruction files could not be updated. Save unsaved instructions or check the AI File Guard output, then run Sync AI Instructions.', 'Show Details').then(action => { if (action) output.show(); });
      }
    }
    return result;
  };
  const rememberResourceScope = async (file: string, directory: boolean) => {
    const canonical = (await new PathResolver().resolve(file, true)).displayPath;
    const existingRoots = await Promise.all(roots().map(root => fs.realpath(root.uri.fsPath)));
    const paths = new PathResolver();
    if (!existingRoots.some(root => paths.contains(root, canonical))) {
      // An Explorer selection normally has a workspace. Also support explicit
      // file URIs outside it without publishing absolute machine paths.
      const scope = directory ? canonical : path.dirname(canonical);
      previousInstructionRoots = [...new Set([...previousInstructionRoots, scope])];
      await context.workspaceState.update(instructionRootsKey, previousInstructionRoots);
    }
  };
  const refresh = async (forceInstructions = false) => {
    await locks.refresh(); tree.refresh(); await statusBar.refresh();
    return syncInstructions(forceInstructions);
  };
  let polling = false;
  const timer = setInterval(() => {
    if (polling) return;
    polling = true;
    void serialize(() => refresh()).catch(error => output.appendLine(String(error))).finally(() => { polling = false; });
  }, 2_000);
  const monitor = vscode.workspace.getConfiguration('aiFileGuard').get('monitoring.enabled', false)
    ? new IntegrityMonitor(locks, audit) : undefined;
  // Restore managed sections if an on-disk instruction file is edited/deleted.
  // Own writes cause one no-op pass, rather than a write/event loop.
  const instructionWatcher = vscode.workspace.createFileSystemWatcher('**/{AGENTS.md,AGENTS.override.md,CLAUDE.md,copilot-instructions.md,INSTRUCTIONS.md}');
  let instructionDebounce: ReturnType<typeof setTimeout> | undefined;
  const instructionChanged = (uri: vscode.Uri) => {
    void new PathResolver().resolve(uri.fsPath, true).then(identity => {
      if (!instructionTargets.has(identity.displayPath)) return;
      clearTimeout(instructionDebounce);
      instructionDebounce = setTimeout(() => { void serialize(() => refresh(true)).catch(report); }, 150);
    }).catch(error => output.appendLine(String(error)));
  };

  context.subscriptions.push(
    tree, decorations, statusBar, previews, ...(monitor ? [monitor] : []), { dispose: () => clearInterval(timer) },
    instructionWatcher, instructionWatcher.onDidCreate(instructionChanged), instructionWatcher.onDidChange(instructionChanged), instructionWatcher.onDidDelete(instructionChanged),
    { dispose: () => clearTimeout(instructionDebounce) },
    vscode.window.registerTreeDataProvider('aiFileGuard.protectedFiles', tree),
    vscode.window.registerFileDecorationProvider(decorations),
    vscode.commands.registerCommand('aiFileGuard.lock', (uri?: vscode.Uri, selected?: vscode.Uri[]) => serialize(async () => {
      const resources = selected?.length ? selected : uri ? [uri] : vscode.window.activeTextEditor ? [vscode.window.activeTextEditor.document.uri] : [];
      try {
        if (!resources.length) throw new Error('Select a local file or folder to lock.');
        const capability = await sandbox.verify();
        setEnforcementCapability(capability);
        if (!capability.available) throw new Error(capability.reason);
        let count = 0;
        for (const resource of resources) {
          if (resource.scheme !== 'file') throw new Error('Only local files and folders are supported.');
          await assertOriginalPath(resource.fsPath);
          const current = await locks.status(resource.fsPath, true);
          if (current.protected) { await rememberResourceScope(current.lock.displayPath, current.lock.kind === 'directory'); continue; }
          const stat = await fs.stat(resource.fsPath);
          if (!stat.isFile() && !stat.isDirectory()) throw new Error('Select a regular file or directory.');
          await rememberResourceScope(resource.fsPath, stat.isDirectory());
          const entry = await locks.lock(resource.fsPath, stat.isDirectory() ? 'directory' : 'file');
          count++; await record('lock', entry.displayPath, 'managed-agent-lock-active');
        }
        const instructions = await refresh(true);
        void vscode.window.showInformationMessage(
          `${count ? `Locked ${count} resource(s)` : 'Selected resources are already protected'}. ${instructions.errors.length ? 'AI instruction synchronization is incomplete; see the error details.' : 'AI instruction files updated. Restart existing AI chats to load the latest rules.'} Use the Protected AI Terminal for enforced protection. Manual edits stay allowed.`,
          'Open Protected AI Terminal',
        ).then(action => { if (action) void vscode.commands.executeCommand('aiFileGuard.startManagedAgent'); });
        return { ok: true as const, count, instructionsSynced: !instructions.errors.length, instructions, enforced: true as const, scope: 'managed-agents-only' as const };
      } catch (error) { return { ...report(error), enforced: false as const, code: 'MANAGED_SANDBOX_UNAVAILABLE' }; }
    })),
    vscode.commands.registerCommand('aiFileGuard.addReviewPolicy', (uri?: vscode.Uri, selected?: vscode.Uri[]) => serialize(async () => {
      const resources = selected?.length ? selected : uri ? [uri] : vscode.window.activeTextEditor ? [vscode.window.activeTextEditor.document.uri] : [];
      try {
        if (!resources.length) throw new Error('Select a local file or folder for the review policy.');
        let count = 0;
        for (const resource of resources) {
          if (resource.scheme !== 'file') throw new Error('Only local files and folders are supported.');
          const current = await locks.status(resource.fsPath, true);
          await assertOriginalPath(resource.fsPath);
          if (current.protected) { await rememberResourceScope(current.lock.displayPath, current.lock.kind === 'directory'); continue; }
          const stat = await fs.stat(resource.fsPath);
          if (!stat.isFile() && !stat.isDirectory()) throw new Error('Select a regular file or directory.');
          await rememberResourceScope(resource.fsPath, stat.isDirectory());
          const entry = await locks.lock(resource.fsPath, stat.isDirectory() ? 'directory' : 'file');
          count++;
          await record('policy-lock', entry.displayPath, 'locked-for-review-broker');
        }
        const instructions = await refresh(true);
        void vscode.window.showInformationMessage(`Saved ${count} review broker policy entry/entries. AI edits to original files are NOT blocked.`);
        return { ok: true as const, count, instructionsSynced: !instructions.errors.length, instructions, enforced: false as const };
      } catch (error) { return report(error); }
    })),
    vscode.commands.registerCommand('aiFileGuard.unlock', (value?: vscode.Uri | { displayPath: string }, selected?: vscode.Uri[]) => serialize(async () => {
      try {
        const values = selected?.length ? selected : value ? [value] : vscode.window.activeTextEditor ? [vscode.window.activeTextEditor.document.uri] : [];
        if (!values.length) throw new Error('Select an explicitly locked file or folder to unlock.');
        let count = 0;
        for (const value of values) {
          let target = value instanceof vscode.Uri ? value.fsPath : value.displayPath;
          if (value instanceof vscode.Uri && value.scheme !== 'file') throw new Error('Only local files and folders are supported.');
          const status = await locks.status(target, true);
          if (status.protected && !status.explicit) {
            const answer = await vscode.window.showWarningMessage(
              `This resource inherits protection from ${status.lock.displayPath}. Unlock that covering resource?`,
              { modal: true }, 'Unlock Covering Resource',
            );
            if (answer !== 'Unlock Covering Resource') continue;
            target = status.lock.displayPath;
          }
          if (await locks.unlock(target)) { count++; await record('policy-unlock', target, 'unlocked'); }
        }
        const instructions = await refresh(true);
        void vscode.window.showInformationMessage(`Unlocked ${count} resource(s). Managed AI changes to unlocked originals can now be applied. Other covering and descendant locks remain active.`);
        return { ok: true as const, count, instructionsSynced: !instructions.errors.length, instructions };
      } catch (error) { return report(error); }
    })),
    vscode.commands.registerCommand('aiFileGuard.refresh', () => serialize(() => refresh(true)).catch(report)),
    vscode.commands.registerCommand('aiFileGuard.syncInstructions', () => serialize(async () => {
      try {
        const instructions = await refresh(true);
        if (!instructions.errors.length) void vscode.window.showInformationMessage(`AI instruction files synchronized (${instructions.updated.length} updated). Restart existing AI chats to load the latest rules.`);
        return { ok: !instructions.errors.length, instructionsSynced: !instructions.errors.length, instructions };
      } catch (error) { return report(error); }
    })),
    vscode.commands.registerCommand('aiFileGuard.openLocalPolicy', () => vscode.commands.executeCommand('vscode.open', vscode.Uri.file(policy.location))),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { void serialize(() => refresh(true)).catch(report); }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('aiFileGuard.adapters')) void serialize(() => refresh(true)).catch(report);
    }),
    vscode.workspace.onDidSaveTextDocument(document => {
      if (['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md', 'copilot-instructions.md', 'INSTRUCTIONS.md'].includes(path.basename(document.uri.fsPath))) void serialize(() => refresh(true)).catch(report);
    }),
    vscode.commands.registerCommand('aiFileGuard.repairHardLocks', () => serialize(async () => {
      try {
        await restoreLegacy(); await refresh();
        void vscode.window.showInformationMessage('Legacy filesystem locks restored. Local AI policy is preserved and manual edits are allowed.');
        return { ok: true as const };
      } catch (error) { return report(error); }
    })),
    vscode.commands.registerCommand('aiFileGuard.openAuditLog', async () => {
      try { await audit.record({ action: 'audit-open', outcome: 'requested' }); await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(audit.location())); }
      catch (error) { report(error); }
    }),
    vscode.commands.registerCommand('aiFileGuard.startManagedAgent', (rootUri?: vscode.Uri) => serialize(async () => {
      try {
        if (!vscode.workspace.isTrusted) throw new Error('Trust the project before launching an agent.');
        if (rootUri && rootUri.scheme !== 'file') throw new Error('Only a local project can be isolated.');
        const folders = roots();
        const selected = rootUri ? { uri: rootUri } : folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Choose the project for the Protected AI Terminal' });
        if (!selected) return;
        await assertOriginalPath(selected.uri.fsPath);
        const capability = await sandbox.verify(true);
        setEnforcementCapability(capability);
        if (!capability.available) throw new Error(capability.reason);
        await refresh(true);
        const session = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Preparing protected AI workspace' }, () => isolation.create(selected.uri.fsPath),
        );
        const launch = await sandbox.prepare(session.stagingRoot, session.workspaceRoot);
        activeSession = session;
        await context.workspaceState.update('aiFileGuard.reviewSession', session);
        const terminal = vscode.window.createTerminal({
          name: 'AI File Guard • Protected AI', cwd: launch.cwd,
          shellPath: launch.executable, shellArgs: launch.arguments,
          strictEnv: true, env: launch.environment,
          iconPath: new vscode.ThemeIcon('shield'),
        });
        managedTerminals.add(terminal);
        terminal.show();
        // Initialize provider state inside the already confined child, never
        // through host writes into potentially agent-controlled home paths.
        terminal.sendText(process.platform === 'win32'
          ? 'if not exist "%CODEX_HOME%" mkdir "%CODEX_HOME%"'
          : 'mkdir -p "$CODEX_HOME"', true);
        terminal.sendText(process.platform === 'win32'
          ? 'echo AI File Guard: run your AI CLI here. Apply unlocked changes from the original VS Code window.'
          : 'printf "\\nAI File Guard: run your AI CLI here. Originals are OS read-only to this process. Apply unlocked changes from the original VS Code window.\\n"', true);
        await record('managed-session-start', session.stagingRoot, 'sandbox-verified');
        void vscode.window.showInformationMessage('Protected AI Terminal opened. Run your agent CLI there. Locked originals cannot be changed through the apply service. Ordinary Copilot/Codex/Claude extensions in this window are outside this runtime.');
        return { ok: true as const, enforced: true as const, scope: 'managed-agents-only' as const, session };
      } catch (error) { return { ...report(error), enforced: false as const }; }
    })),
    vscode.window.onDidCloseTerminal(terminal => { managedTerminals.delete(terminal); }),
    vscode.commands.registerCommand('aiFileGuard.verifySandbox', async () => {
      const capability = await sandbox.verify(true);
      setEnforcementCapability(capability); await refresh();
      if (capability.available) void vscode.window.showInformationMessage(capability.reason);
      else report(capability.reason);
      return capability;
    }),
    vscode.commands.registerCommand('aiFileGuard.createReviewWorkspace', () => serialize(async () => {
      try {
        if (!vscode.workspace.isTrusted) throw new Error('Trust the workspace before creating an agent review session.');
        const folders = roots();
        const folder = folders.length === 1 ? folders[0] : await vscode.window.showWorkspaceFolderPick({ placeHolder: 'Choose the project for this review session' });
        if (!folder) return;
        await refresh(true);
        activeSession = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Creating agent review workspace' }, () => isolation.create(folder.uri.fsPath),
        );
        await context.workspaceState.update('aiFileGuard.reviewSession', activeSession);
        await record('session-create', activeSession.stagingRoot, 'created');
        void vscode.window.showInformationMessage(`Review copy: ${activeSession.stagingRoot}. Only changes applied through the review broker are checked. This copy does not sandbox an agent.`);
        return activeSession;
      } catch (error) { return report(error); }
    })),
    vscode.commands.registerCommand('aiFileGuard.previewAgentChanges', () => serialize(async () => {
      try {
        if (!activeSession) throw new Error('Open a Protected AI Terminal first.');
        const review = await broker.review(activeSession);
        const content = ['# AI File Guard: proposed changes', '', `Original project: ${JSON.stringify(activeSession.workspaceRoot)}`, '',
          'Only allowed proposals may be applied. Policy is checked again when applying.', '',
          ...review.map(item => `- ${item.allowed ? 'ALLOW' : 'DENY'} ${item.change.type} ${JSON.stringify(item.change.relativePath)}${item.reason ? ` — ${item.reason}` : ''}`),
          ...(!review.length ? ['No proposed changes.'] : []),
        ].join('\n');
        await previews.show(activeSession.id, content);
        return review;
      } catch (error) { return report(error); }
    })),
    vscode.commands.registerCommand('aiFileGuard.applyReviewWorkspace', () => serialize(async () => {
      try {
        if (!vscode.workspace.isTrusted) throw new Error('Trust the workspace before applying changes.');
        if (!activeSession) throw new Error('Create an agent review workspace first.');
        const changes = await broker.preview(activeSession);
        if (!changes.length) return void vscode.window.showInformationMessage('No staged file changes found.');
        const confirm = await vscode.window.showWarningMessage(
          `Review and apply ${changes.length} staged file change(s)? Current locks and concurrent developer edits will be checked.`,
          { modal: true }, 'Apply Allowed Changes',
        );
        if (confirm !== 'Apply Allowed Changes') return;
        const result = await broker.apply(activeSession);
        activeSession = broker.advanceBaseline(activeSession, result);
        try { await context.workspaceState.update('aiFileGuard.reviewSession', activeSession); }
        catch (error) { output.appendLine(`Changes applied; persisting the session failed: ${String(error)}`); }
        void vscode.window.showInformationMessage(`Applied ${result.applied.length}; rejected ${result.rejected.length}. See the audit log for details.`);
        return result;
      } catch (error) { return report(error); }
    })),
    vscode.commands.registerCommand('aiFileGuard.showStatus', async (uri?: vscode.Uri) => {
      try {
        await locks.refresh();
        const active = uri ?? vscode.window.activeTextEditor?.document.uri;
        const status = active?.scheme === 'file' ? await locks.status(active.fsPath, true) : undefined;
        const capability = detectEnforcementCapability();
        void vscode.window.showInformationMessage(`${locks.all().length} local lock(s). Managed runtime: ${capability.available ? 'verified' : 'unavailable'}. ${managedTerminals.size} protected terminal(s). ${capability.reason}`);
        return { policyStatus: status, enforced: capability.available, scope: 'managed-agents-only' as const, managedTerminals: managedTerminals.size, capability, policyLocation: policy.location, count: locks.all().length };
      } catch (error) { return report(error); }
    }),
  );
  // Backfill saved locks on upgrade/reload without requiring a second lock click.
  try { await refresh(true); } catch (error) { report(error); }
  return { scope: 'managed-agents-only' as const, capability: () => detectEnforcementCapability(), policyLocation: policy.location, policyStatus: (file: string) => locks.status(file, true) };
}
export function deactivate(): void { /* VS Code disposes subscriptions. */ }
