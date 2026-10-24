import path from 'node:path';
import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath, runTests } from '@vscode/test-electron';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LocalManifestStore } from '../core/localManifestStore';
import { LockManager } from '../core/lockManager';
import { PathResolver } from '../core/pathResolver';

const execFileAsync = promisify(execFile);

async function main(): Promise<void> {
  let workspace: string | undefined;
  let testRoot: string | undefined;
  try {
    // Some IDE terminals set this for their own helpers; it turns the VS Code
    // Electron binary into plain Node and makes every workbench flag invalid.
    delete process.env.ELECTRON_RUN_AS_NODE;
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-file-guard-vscode-'));
    workspace = path.join(testRoot, 'workspace');
    await fs.mkdir(workspace);
    await fs.writeFile(path.join(workspace, 'AGENTS.md'), '# Existing project instructions\n');
    await fs.writeFile(path.join(workspace, 'protected.txt'), 'original');
    const previousLock = path.join(workspace, 'preexisting-lock.txt');
    await fs.writeFile(previousLock, 'saved before extension startup');
    await new LockManager(new LocalManifestStore(path.join(testRoot, 'profile', 'User', 'globalStorage', 'ai-file-guard.ai-file-guard', 'local-locks.json')), new PathResolver()).lock(previousLock, 'file');
    await fs.mkdir(path.join(workspace, 'nested-repo', '.git'), { recursive: true });
    await fs.mkdir(path.join(workspace, 'nested-repo', 'docs'), { recursive: true });
    await fs.writeFile(path.join(workspace, 'nested-repo', 'docs', 'child.txt'), 'original child');
    process.env.AI_FILE_GUARD_TEST_WORKSPACE = workspace;
    const vsixIndex = process.argv.indexOf('--vsix');
    let vscodeExecutablePath: string | undefined;
    let developmentPath = path.resolve(__dirname, '../..');
    if (vsixIndex >= 0) {
      const candidate = process.argv[vsixIndex + 1];
      if (!candidate) throw new Error('Pass the candidate VSIX path after --vsix.');
      const vsix = path.resolve(candidate);
      await fs.access(vsix);
      vscodeExecutablePath = await downloadAndUnzipVSCode();
      const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
      const installed = await execFileAsync(cli, [...cliArgs, '--install-extension', vsix, '--force', '--user-data-dir', path.join(testRoot, 'profile'), '--extensions-dir', path.join(testRoot, 'extensions')]);
      console.log(installed.stdout.trim());
      const installedDirectories = await fs.readdir(path.join(testRoot, 'extensions'), { withFileTypes: true });
      let installedPath: string | undefined;
      for (const directory of installedDirectories.filter(directory => directory.isDirectory())) {
        const candidatePath = path.join(testRoot, 'extensions', directory.name);
        const packageJson = await fs.readFile(path.join(candidatePath, 'package.json'), 'utf8').catch(() => '{}');
        const metadata = JSON.parse(packageJson) as { publisher?: string; name?: string };
        if (metadata.publisher === 'ravikiranv' && metadata.name === 'ai-file-guard') installedPath = candidatePath;
      }
      if (!installedPath) throw new Error('The installed preview extension could not be found in the isolated profile.');
      developmentPath = installedPath;
    }
    await runTests({
      vscodeExecutablePath,
      extensionDevelopmentPath: developmentPath,
      extensionTestsPath: path.resolve(__dirname, 'integration', 'index'),
      launchArgs: [workspace, ...(vsixIndex >= 0 ? [] : ['--disable-extensions']), '--user-data-dir', path.join(testRoot, 'profile'), '--extensions-dir', path.join(testRoot, 'extensions'), '--skip-welcome', '--skip-release-notes'],
    });
  } catch (error) {
    console.error('VS Code integration tests failed', error);
    process.exitCode = 1;
  } finally {
    if (workspace) {
      if (process.platform === 'darwin') await execFileAsync('/usr/bin/chflags', ['-R', 'nouchg', workspace]).catch(() => undefined);
      if (process.platform !== 'win32') await execFileAsync('/bin/chmod', ['-R', 'u+w', workspace]).catch(() => undefined);
      await fs.rm(workspace, { recursive: true, force: true }).catch(() => undefined);
    }
    if (testRoot) await fs.rm(testRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}
void main();
