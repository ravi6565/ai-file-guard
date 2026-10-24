import assert from 'node:assert/strict';
import * as vscode from 'vscode';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { ReadonlySettingsManager } from '../../enforcement/readonlySettings';
import { KeyValueStore } from '../../core/manifestStore';
import { LocalManifestStore } from '../../core/localManifestStore';
import { LockManager } from '../../core/lockManager';
import { PathResolver } from '../../core/pathResolver';
import { ProtectionDecorations } from '../../ui/protectionDecorations';
import { ProtectedFilesTree } from '../../ui/protectedFilesTree';

interface GuardAPI { scope: 'managed-agents-only'; capability(): { available: boolean; reason: string }; policyLocation: string; policyStatus(file: string): Promise<{ protected: boolean }>; }

suite('AI File Guard local policy', () => {
  let api: GuardAPI;
  let managedStaging: string | undefined;
  const root = () => {
    const workspace = process.env.AI_FILE_GUARD_TEST_WORKSPACE;
    assert.ok(workspace);
    return workspace;
  };
  const command = async (name: string, ...args: unknown[]) => {
    const result = await vscode.commands.executeCommand<{ ok: boolean; error?: string; instructionsSynced?: boolean }>(name, ...args);
    assert.equal(result?.ok, true, result?.error ?? 'Command should return its actual result.');
    if (result?.instructionsSynced !== undefined) assert.equal(result.instructionsSynced, true, 'Instructions must be synchronized before returning from the command.');
    return result;
  };

  test('activates and verifies the scoped managed sandbox', async () => {
    const extension = vscode.extensions.getExtension<GuardAPI>('ai-file-guard.ai-file-guard');
    assert.ok(extension);
    api = await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    for (const name of ['lock', 'addReviewPolicy', 'unlock', 'startManagedAgent', 'verifySandbox', 'previewAgentChanges', 'repairHardLocks', 'createReviewWorkspace', 'applyReviewWorkspace']) {
      assert.ok(commands.includes(`aiFileGuard.${name}`));
    }
    const result = await vscode.commands.executeCommand<{ capability: { available: boolean } }>('aiFileGuard.showStatus');
    assert.equal(result?.capability.available, process.platform === 'darwin', api.capability().reason);
    assert.equal(api.scope, 'managed-agents-only');
    assert.ok(!api.policyLocation.startsWith(root() + path.sep), 'Policy must live outside the repository.');
  });

  test('backfills previously saved locks into instructions on extension startup', async () => {
    const file = path.join(root(), 'preexisting-lock.txt');
    assert.equal((await api.policyStatus(file)).protected, true);
    for (const relative of ['AGENTS.md', '.github/copilot-instructions.md', 'CLAUDE.md', '.ai-file-guard/INSTRUCTIONS.md']) {
      assert.match(await fs.readFile(path.join(root(), relative), 'utf8'), /File: "preexisting-lock.txt"/);
    }
    await command('aiFileGuard.unlock', vscode.Uri.file(file));
  });

  test('explicit review policies preserve manual editor and filesystem access', async () => {
    const file = path.join(root(), 'protected.txt');
    const uri = vscode.Uri.file(file);
    const mode = (await fs.stat(file)).mode & 0o777;
    for (let cycle = 0; cycle < 2; cycle++) {
      await command(process.platform === 'darwin' ? 'aiFileGuard.lock' : 'aiFileGuard.addReviewPolicy', uri);
      assert.equal((await api.policyStatus(file)).protected, true);
      assert.equal((await fs.stat(file)).mode & 0o777, mode);
      const editor = await vscode.window.showTextDocument(uri);
      assert.equal(await editor.edit(edit => edit.insert(new vscode.Position(0, 0), 'manual edit\n')), true);
      assert.equal(await editor.document.save(), true);
      await fs.writeFile(file, 'manual filesystem edit');
      // Reload the externally saved bytes before the next editor edit so VS
      // Code's ordinary "modified since" check does not cause a false failure.
      await vscode.commands.executeCommand('workbench.action.files.revert');
      await command('aiFileGuard.unlock', uri);
      assert.equal((await api.policyStatus(file)).protected, false);
    }
  });

  test('review folder policy covers descendants without claiming AI prevention', async () => {
    const folder = path.join(root(), 'nested-repo', 'docs');
    await command(process.platform === 'darwin' ? 'aiFileGuard.lock' : 'aiFileGuard.addReviewPolicy', vscode.Uri.file(folder));
    assert.equal((await api.policyStatus(path.join(folder, 'future', 'child.txt'))).protected, true);
    const child = path.join(folder, 'manual.txt');
    await fs.writeFile(child, 'manual create');
    await fs.rename(child, path.join(folder, 'renamed.txt'));
    await fs.unlink(path.join(folder, 'renamed.txt'));
    await command('aiFileGuard.unlock', vscode.Uri.file(folder));
    assert.equal((await api.policyStatus(path.join(folder, 'future', 'child.txt'))).protected, false);
  });

  test('concurrent review policy commands retain both entries and remove multiple selections', async () => {
    const first = path.join(root(), 'first.txt');
    const second = path.join(root(), 'second.txt');
    await fs.writeFile(first, 'first'); await fs.writeFile(second, 'second');
    await Promise.all([command(process.platform === 'darwin' ? 'aiFileGuard.lock' : 'aiFileGuard.addReviewPolicy', vscode.Uri.file(first)), command(process.platform === 'darwin' ? 'aiFileGuard.lock' : 'aiFileGuard.addReviewPolicy', vscode.Uri.file(second))]);
    assert.equal((await api.policyStatus(first)).protected, true);
    assert.equal((await api.policyStatus(second)).protected, true);
    await command('aiFileGuard.unlock', vscode.Uri.file(first), [vscode.Uri.file(first), vscode.Uri.file(second)]);
    assert.equal((await api.policyStatus(first)).protected, false);
    assert.equal((await api.policyStatus(second)).protected, false);
  });

  test('review policy for a manually deleted resource can still be removed', async () => {
    const file = path.join(root(), 'deleted.txt');
    await fs.writeFile(file, 'manual delete allowed');
    await command(process.platform === 'darwin' ? 'aiFileGuard.lock' : 'aiFileGuard.addReviewPolicy', vscode.Uri.file(file));
    await fs.unlink(file);
    assert.equal((await api.policyStatus(file)).protected, true);
    await command('aiFileGuard.unlock', vscode.Uri.file(file));
    assert.equal((await api.policyStatus(file)).protected, false);
  });

  test('review policy supports local files outside the opened workspace', async () => {
    const file = path.join(path.dirname(root()), 'outside-project.txt');
    await fs.writeFile(file, 'outside');
    await command(process.platform === 'darwin' ? 'aiFileGuard.lock' : 'aiFileGuard.addReviewPolicy', vscode.Uri.file(file));
    assert.equal((await api.policyStatus(file)).protected, true);
    await command('aiFileGuard.unlock', vscode.Uri.file(file));
    await fs.unlink(file);
  });

  test('Lock for AI verifies enforcement and preserves manual access in every setting', async () => {
    const configuration = vscode.workspace.getConfiguration('aiFileGuard');
    const file = path.join(root(), 'strict-only.txt');
    await fs.writeFile(file, 'lock fixture');
    const mode = (await fs.stat(file)).mode;
    try {
      for (const setting of [undefined, 'review', 'enforced']) {
        await configuration.update('protectionMode', setting, vscode.ConfigurationTarget.Global);
        const result = await vscode.commands.executeCommand<{ ok: boolean; enforced: boolean; scope: string; error?: string }>('aiFileGuard.lock', vscode.Uri.file(file));
        assert.equal(result?.ok, process.platform === 'darwin', result?.error);
        assert.equal(result?.enforced, process.platform === 'darwin');
        assert.equal((await api.policyStatus(file)).protected, process.platform === 'darwin');
        if (process.platform === 'darwin') {
          assert.equal(result?.scope, 'managed-agents-only');
          await command('aiFileGuard.unlock', vscode.Uri.file(file));
        }
        assert.equal((await fs.stat(file)).mode, mode);
      }
    } finally { await configuration.update('protectionMode', undefined, vscode.ConfigurationTarget.Global); }
  });

  test('existing policies show a managed lock only after OS verification', async () => {
    const file = path.join(root(), 'protected.txt');
    await command('aiFileGuard.addReviewPolicy', vscode.Uri.file(file));
    try {
      const before = await fs.readFile(api.policyLocation, 'utf8');
      const status = await vscode.commands.executeCommand<{ enforced: boolean; scope: string; policyStatus: { protected: boolean } }>('aiFileGuard.showStatus', vscode.Uri.file(file));
      assert.equal(status?.enforced, process.platform === 'darwin');
      assert.equal(status?.scope, 'managed-agents-only');
      assert.equal(status?.policyStatus.protected, true);
      assert.equal(await fs.readFile(api.policyLocation, 'utf8'), before);
      const store = new LocalManifestStore(api.policyLocation);
      await store.refresh();
      const locks = new LockManager(store, new PathResolver());
      const decorations = new ProtectionDecorations(locks);
      const tree = new ProtectedFilesTree(locks);
      try {
        const decoration = await decorations.provideFileDecoration(vscode.Uri.file(file));
        assert.equal(decoration?.badge, process.platform === 'darwin' ? '🔒' : '!');
        assert.match(String(decoration?.tooltip), /managed|sandbox/);
        const entry = locks.all().find(item => item.displayPath.endsWith('protected.txt'));
        assert.ok(entry);
        const item = tree.getTreeItem(entry);
        assert.equal((item.iconPath as vscode.ThemeIcon).id, process.platform === 'darwin' ? 'lock' : 'warning');
      } finally { decorations.dispose(); tree.dispose(); }
    } finally { await command('aiFileGuard.unlock', vscode.Uri.file(file)); }
  });

  (process.platform === 'darwin' ? test : test.skip)('Protected AI Terminal actually denies original writes', async () => {
    const file = path.join(root(), 'managed-terminal.txt');
    await fs.writeFile(file, 'original');
    await command('aiFileGuard.lock', vscode.Uri.file(file));
    const result = await vscode.commands.executeCommand<{ ok: boolean; enforced: boolean; error?: string; session: { stagingRoot: string } }>('aiFileGuard.startManagedAgent', vscode.Uri.file(root()));
    assert.equal(result?.ok, true, result?.error);
    assert.equal(result?.enforced, true);
    managedStaging = result!.session.stagingRoot;
    const terminal = vscode.window.terminals.find(item => item.name === 'AI File Guard • Protected AI');
    assert.ok(terminal);
    const marker = path.join(result!.session.stagingRoot, 'sandbox-result.txt');
    const quoted = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
    try {
      await terminal.processId;
      terminal.sendText('if printf bad > ' + quoted(file) + '; then printf ESCAPED > ' + quoted(marker) + '; else printf DENIED > ' + quoted(marker) + '; fi', true);
      let observed = '';
      for (let attempt = 0; attempt < 150; attempt++) {
        observed = await fs.readFile(marker, 'utf8').catch(() => '');
        if (observed) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.equal(observed, 'DENIED', 'The actual VS Code terminal must run inside the OS sandbox.');
      assert.equal(await fs.readFile(file, 'utf8'), 'original');
      await fs.writeFile(file, 'developer edit still allowed');
      assert.equal(await fs.readFile(file, 'utf8'), 'developer edit still allowed');
    } finally {
      terminal.dispose();
      await command('aiFileGuard.unlock', vscode.Uri.file(file));
    }
  });

  (process.platform === 'darwin' ? test : test.skip)('preview is read-only and updates locked proposals after unlock', async () => {
    assert.ok(managedStaging);
    const file = path.join(root(), 'protected.txt');
    const original = await fs.readFile(file, 'utf8');
    await fs.writeFile(path.join(managedStaging, 'protected.txt'), 'proposed agent update');
    const uri = vscode.Uri.file(file);
    await command('aiFileGuard.lock', uri);
    try {
      const denied = await vscode.commands.executeCommand<{ change: { relativePath: string }; allowed: boolean }[]>('aiFileGuard.previewAgentChanges');
      assert.equal(denied?.find(item => item.change.relativePath === 'protected.txt')?.allowed, false);
      const document = vscode.window.activeTextEditor!.document;
      assert.equal(document.uri.scheme, 'ai-file-guard-review');
      assert.equal(document.isDirty, false);
      assert.match(document.getText(), /DENY/);
      assert.equal(await fs.readFile(file, 'utf8'), original);
      await command('aiFileGuard.unlock', uri);
      const allowed = await vscode.commands.executeCommand<{ change: { relativePath: string }; allowed: boolean }[]>('aiFileGuard.previewAgentChanges');
      assert.equal(allowed?.find(item => item.change.relativePath === 'protected.txt')?.allowed, true);
    } finally { await command('aiFileGuard.unlock', uri); }
  });

  test('legacy read-only cleanup preserves developer patterns and inherited user settings', async () => {
    const folder = vscode.workspace.workspaceFolders![0];
    const configuration = vscode.workspace.getConfiguration('files', folder.uri);
    const values = new Map<string, unknown>();
    const store: KeyValueStore = {
      get: <T>(key: string, fallback: T) => (values.get(key) ?? fallback) as T,
      update: async (key: string, value: unknown) => { values.set(key, value); },
    };
    values.set('aiFileGuard.readonlyPatterns.v2', { [folder.uri.toString()]: ['old-guard/**'] });
    try {
      await configuration.update('readonlyInclude', { 'user-only/**': true }, vscode.ConfigurationTarget.Global);
      await configuration.update('readonlyInclude', { 'old-guard/**': true, 'developer-only/**': true }, vscode.ConfigurationTarget.WorkspaceFolder);
      await new ReadonlySettingsManager(store).clearLegacyForOpenFolders();
      const inspected = configuration.inspect<Record<string, boolean>>('readonlyInclude');
      const local = inspected?.workspaceFolderValue ?? inspected?.workspaceValue ?? {};
      assert.equal(local['user-only/**'], undefined, 'Inherited settings must not be copied into the repository.');
      assert.deepEqual(local, { 'developer-only/**': true });
    } finally {
      await configuration.update('readonlyInclude', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
      await configuration.update('readonlyInclude', undefined, vscode.ConfigurationTarget.Global);
      // Remove only the settings fixture created by this test.
      await fs.unlink(path.join(root(), '.vscode', 'settings.json'));
      await fs.rmdir(path.join(root(), '.vscode'));
    }
  });

  test('multi-selection synchronizes individual files and recursive folders immediately, including final unlock', async () => {
    const one = path.join(root(), 'protected.txt');
    const folder = path.join(root(), 'nested-repo', 'docs');
    const instructionFiles = ['AGENTS.md', '.github/copilot-instructions.md', 'CLAUDE.md', '.ai-file-guard/INSTRUCTIONS.md'];
    await command(process.platform === 'darwin' ? 'aiFileGuard.lock' : 'aiFileGuard.addReviewPolicy', undefined, [vscode.Uri.file(one), vscode.Uri.file(folder)]);
    for (const relative of instructionFiles) {
      const text = await fs.readFile(path.join(root(), relative), 'utf8');
      assert.match(text, /File: "protected.txt"/);
      assert.match(text, /Directory: "nested-repo\/docs\/"/);
      assert.match(text, /including future paths/);
      assert.equal(text.split('<!-- AI FILE GUARD:BEGIN -->').length, 2);
    }
    assert.match(await fs.readFile(path.join(root(), 'nested-repo/AGENTS.md'), 'utf8'), /Directory: "docs\/"/);
    await command('aiFileGuard.unlock', vscode.Uri.file(one));
    assert.doesNotMatch(await fs.readFile(path.join(root(), 'AGENTS.md'), 'utf8'), /File: "protected.txt"/);
    assert.match(await fs.readFile(path.join(root(), 'AGENTS.md'), 'utf8'), /Directory: "nested-repo\/docs\/"/);
    await command('aiFileGuard.unlock', vscode.Uri.file(folder));
    for (const relative of [...instructionFiles, 'nested-repo/AGENTS.md']) assert.match(await fs.readFile(path.join(root(), relative), 'utf8'), /No paths are currently locked/);
    assert.ok((await fs.readFile(path.join(root(), 'AGENTS.md'), 'utf8')).startsWith('# Existing project instructions\n'));
    await assert.rejects(fs.stat(path.join(root(), '.vscode/settings.json')), error => (error as NodeJS.ErrnoException).code === 'ENOENT');
  });

  test('automatically synchronizes policy changes from another VS Code window', async () => {
    const file = path.join(root(), 'cross-window.txt'); await fs.writeFile(file, 'manual');
    const other = new LockManager(new LocalManifestStore(api.policyLocation), new PathResolver());
    await other.lock(file, 'file');
    const instructions = path.join(root(), '.github/copilot-instructions.md');
    const waitFor = async (check: (text: string) => boolean) => {
      for (let attempt = 0; attempt < 150; attempt++) {
        if (check(await fs.readFile(instructions, 'utf8'))) return;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.fail('Instruction files did not follow the shared local policy.');
    };
    try { await waitFor(text => text.includes('File: "cross-window.txt"')); }
    finally { await other.unlock(file); }
    await waitFor(text => !text.includes('File: "cross-window.txt"'));
  });

  test('unlocking a folder retains explicit child locks in all instruction scopes', async () => {
    const folder = path.join(root(), 'nested-repo', 'docs');
    const child = path.join(folder, 'child.txt');
    await command('aiFileGuard.addReviewPolicy', vscode.Uri.file(child));
    await command('aiFileGuard.addReviewPolicy', vscode.Uri.file(folder));
    await command('aiFileGuard.unlock', vscode.Uri.file(folder));
    try {
      assert.equal((await api.policyStatus(child)).protected, true);
      assert.match(await fs.readFile(path.join(root(), 'AGENTS.md'), 'utf8'), /File: "nested-repo\/docs\/child.txt"/);
      const nested = await fs.readFile(path.join(root(), 'nested-repo/AGENTS.md'), 'utf8');
      assert.match(nested, /File: "docs\/child.txt"/);
      assert.doesNotMatch(nested, /Directory: "docs\/"/);
    } finally { await command('aiFileGuard.unlock', vscode.Uri.file(child)); }
  });

  test('recreates deleted instruction files from the current policy', async () => {
    const file = path.join(root(), '.github/copilot-instructions.md');
    await command('aiFileGuard.addReviewPolicy', vscode.Uri.file(path.join(root(), 'protected.txt')));
    await fs.unlink(file);
    try {
      let text = '';
      for (let attempt = 0; attempt < 150; attempt++) {
        text = await fs.readFile(file, 'utf8').catch(() => '');
        if (text.includes('File: "protected.txt"')) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.match(text, /File: "protected.txt"/);
    } finally { await command('aiFileGuard.unlock', vscode.Uri.file(path.join(root(), 'protected.txt'))); }
  });

  test('dirty instruction edits are preserved and synchronization retries after save', async () => {
    const file = path.join(root(), 'AGENTS.md');
    const editor = await vscode.window.showTextDocument(vscode.Uri.file(file));
    await editor.edit(edit => edit.insert(new vscode.Position(0, 0), '# Unsaved developer guidance\n'));
    const resource = vscode.Uri.file(path.join(root(), 'protected.txt'));
    try {
      const result = await vscode.commands.executeCommand<{ ok: boolean; instructionsSynced: boolean }>('aiFileGuard.addReviewPolicy', resource);
      assert.equal(result?.ok, true); assert.equal(result.instructionsSynced, false);
      assert.equal(editor.document.isDirty, true);
      assert.ok(editor.document.getText().startsWith('# Unsaved developer guidance\n'));
      assert.doesNotMatch(await fs.readFile(file, 'utf8'), /File: "protected.txt"/);
      await editor.document.save();
      await command('aiFileGuard.syncInstructions');
      const text = await fs.readFile(file, 'utf8');
      assert.ok(text.startsWith('# Unsaved developer guidance\n'));
      assert.match(text, /File: "protected.txt"/);
    } finally { await command('aiFileGuard.unlock', resource); }
  });
});
