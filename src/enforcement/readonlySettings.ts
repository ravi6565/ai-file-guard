import * as vscode from 'vscode';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { LockEntry } from '../core/types';
import { KeyValueStore } from '../core/manifestStore';

const KEY = 'aiFileGuard.readonlyPatterns.v2';
export const LEGACY_READONLY_KEY = 'aiFileGuard.readonlyPatterns.v1';

export class ReadonlySettingsManager {
  public constructor(private readonly storage: KeyValueStore, private readonly storageKey = KEY) {}
  public async clearLegacyForOpenFolders(): Promise<void> { await this.synchronizeInternal([], true); }
  public async synchronize(locks: readonly LockEntry[]): Promise<void> {
    await this.synchronizeInternal(locks, false);
  }
  private async synchronizeInternal(locks: readonly LockEntry[], preserveUnopened: boolean): Promise<void> {
    const saved = this.storage.get<Record<string, string[]>>(this.storageKey, {});
    const updated: Record<string, string[]> = preserveUnopened ? { ...saved } : {};
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      if (folder.uri.scheme !== 'file') continue;
      if (!locks.length && !(saved[folder.uri.toString()]?.length)) continue;
      const folderPath = await fs.realpath(folder.uri.fsPath).catch(() => folder.uri.fsPath);
      const configuration = vscode.workspace.getConfiguration('files', folder.uri);
      const inspected = configuration.inspect<Record<string, boolean>>('readonlyInclude');
      const current = inspected?.workspaceFolderValue ?? (!vscode.workspace.workspaceFile ? inspected?.workspaceValue : undefined) ?? {};
      const next = { ...current };
      (saved[folder.uri.toString()] ?? []).forEach(pattern => { if (next[pattern] === true) delete next[pattern]; });
      const owned: Record<string, boolean> = {};
      for (const lock of locks) {
        const relative = path.relative(folderPath, lock.displayPath);
        if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
        const pattern = escapeGlob(relative.split(path.sep).join('/'));
        owned[pattern] = true; next[pattern] = true;
        if (lock.kind === 'directory') { owned[`${pattern}/**`] = true; next[`${pattern}/**`] = true; }
      }
      if (JSON.stringify(next) !== JSON.stringify(current)) {
        await configuration.update('readonlyInclude', Object.keys(next).length ? next : undefined, vscode.ConfigurationTarget.WorkspaceFolder);
      }
      const ownedPatterns = Object.keys(owned);
      if (ownedPatterns.length) updated[folder.uri.toString()] = ownedPatterns;
      else delete updated[folder.uri.toString()];
    }
    await this.storage.update(this.storageKey, updated);
  }
}

function escapeGlob(value: string): string { return value.replace(/[?*\[\]{}]/g, character => `[${character}]`); }
