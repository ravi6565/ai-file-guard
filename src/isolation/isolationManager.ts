import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { hashFile } from '../integrity/hash';
import { IsolationSession } from './types';
import { PathResolver } from '../core/pathResolver';

export class IsolationManager {
  public constructor(private readonly sessionsRoot: string) {}

  public async create(workspaceRoot: string): Promise<IsolationSession> {
    workspaceRoot = await fs.realpath(workspaceRoot);
    const storagePath = (await new PathResolver().resolve(this.sessionsRoot, true)).displayPath;
    const relativeStorage = path.relative(workspaceRoot, storagePath);
    if (!relativeStorage || (!path.isAbsolute(relativeStorage) && relativeStorage !== '..' && !relativeStorage.startsWith(`..${path.sep}`))) {
      throw new Error('The project contains extension session storage. Choose a project outside that storage to avoid recursive copying.');
    }
    const id = randomUUID(); const stagingRoot = path.join(storagePath, id, 'workspace');
    await fs.mkdir(stagingRoot, { recursive: true, mode: 0o700 });
    await copyTree(workspaceRoot, stagingRoot);
    // The baseline must describe what the agent actually received. Re-reading
    // originals after copying can mislabel a concurrent developer edit as baseline.
    const baseline = await inventory(stagingRoot);
    const session: IsolationSession = { id, workspaceRoot, stagingRoot, createdAt: new Date().toISOString(), baseline };
    await fs.writeFile(path.join(storagePath, id, 'session.json'), JSON.stringify(session, null, 2), { mode: 0o600 });
    return session;
  }
}

export async function inventory(root: string): Promise<{ relativePath: string; hash: string; kind: 'file' | 'directory' }[]> {
  const files = await listFiles(root); const result = [];
  for (const file of files) {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) throw new Error('Workspace entry changed into a symlink during inventory.');
    const kind = stat.isDirectory() ? 'directory' as const : 'file' as const;
    result.push({ relativePath: path.relative(root, file), hash: kind === 'directory' ? 'directory' : await hashFile(file), kind });
  }
  return result;
}

async function listFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await fs.readdir(root, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.ai-file-guard' || entry.isSymbolicLink()) continue;
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(child, ...await listFiles(child)); else if (entry.isFile()) result.push(child);
  }
  return result;
}

async function copyTree(source: string, destination: string): Promise<void> {
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.ai-file-guard' || entry.isSymbolicLink()) continue;
    const from = path.join(source, entry.name); const to = path.join(destination, entry.name);
    if (entry.isDirectory()) { await fs.mkdir(to, { recursive: true }); await copyTree(from, to); }
    else if (entry.isFile()) await fs.copyFile(from, to);
  }
}
