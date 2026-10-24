import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ClaudeAdapter, CodexAdapter, CopilotAdapter, GenericAdapter } from '../agents/adapters';
import { InstructionCoordinator } from '../agents/instructionCoordinator';
import { ManagedSectionSynchronizer } from '../instructions/managedSection';
import { instructionRoots } from '../instructions/workspaceRoots';
import { LockEntry } from '../core/types';

describe('Dynamic AI instructions', () => {
  let root: string;
  const adapters = [new CodexAdapter(), new CopilotAdapter(), new ClaudeAdapter(), new GenericAdapter()];
  const entry = (file: string, kind: LockEntry['kind'] = 'file'): LockEntry => ({ canonicalPath: file, displayPath: file, kind, lockedAt: new Date().toISOString() });
  beforeEach(async () => { root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'guard-instructions-'))); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it('leaves projects with no current or previous locks untouched', async () => {
    await fs.writeFile(path.join(root, 'AGENTS.md'), '# Project instructions\n');
    const result = await new InstructionCoordinator(adapters).sync([root], []);
    assert.deepEqual(result.updated, []); assert.deepEqual(result.errors, []);
    assert.deepEqual(await fs.readdir(root), ['AGENTS.md']);
    assert.equal(await fs.readFile(path.join(root, 'AGENTS.md'), 'utf8'), '# Project instructions\n');
  });

  it('projects multiple file locks into all adapters, removes unlocked entries, and preserves custom text exactly', async () => {
    const file = path.join(root, 'AGENTS.md');
    const prefix = '# Custom rules\n\nKeep trailing whitespace.  \n';
    await fs.writeFile(file, prefix, { mode: 0o640 });
    const coordinator = new InstructionCoordinator(adapters);
    const locks = [entry(path.join(root, 'one.ts')), entry(path.join(root, 'two.ts'))];
    const first = await coordinator.sync([root], locks);
    assert.deepEqual(first.errors, []); assert.equal(first.updated.length, 4);
    for (const adapter of adapters) {
      const text = await fs.readFile(path.join(root, adapter.instructionFile), 'utf8');
      assert.match(text, /File: "one.ts"/); assert.match(text, /File: "two.ts"/);
    }
    assert.ok((await fs.readFile(file, 'utf8')).startsWith(prefix));
    assert.equal((await fs.stat(file)).mode & 0o777, 0o640);
    assert.equal((await coordinator.sync([root], locks)).updated.length, 0, 'Unchanged policy must not rewrite files.');
    await coordinator.sync([root], [locks[1]]);
    assert.doesNotMatch(await fs.readFile(file, 'utf8'), /File: "one.ts"/);
    await coordinator.sync([root], []);
    assert.match(await fs.readFile(file, 'utf8'), /No paths are currently locked/);
    assert.equal((await fs.readFile(file, 'utf8')).split('<!-- AI FILE GUARD:BEGIN -->').length, 2);
  });

  it('preserves text after the managed block including missing final newline', () => {
    const sections = new ManagedSectionSynchronizer();
    const original = 'before\n<!-- AI FILE GUARD:BEGIN -->\nold\n<!-- AI FILE GUARD:END -->\nafter  ';
    assert.equal(sections.merge(original, 'new'), original.replace('\nold\n', '\nnew\n'));
    assert.throws(() => sections.merge('<!-- AI FILE GUARD:BEGIN -->\nbroken', 'new'), /Malformed/);
    assert.throws(() => sections.merge(original + '\n<!-- AI FILE GUARD:END -->', 'new'), /duplicate/);
  });

  it('renders folders recursively, root and covering locks, without including other projects', () => {
    const adapter = new CodexAdapter();
    const rules = adapter.render(root, [entry(path.join(root, 'docs'), 'directory'), entry(path.join(root, '..valid.ts')), entry(path.join(root + '-other', 'foreign.ts'))]);
    assert.match(rules, /Directory: "docs\/".*ALL nested files and folders/);
    assert.match(rules, /including future paths/);
    assert.match(rules, /File: "..valid.ts"/);
    assert.doesNotMatch(rules, /foreign.ts/);
    assert.match(adapter.render(root, [entry(root, 'directory')]), /Directory: "\.\/"/);
    assert.match(adapter.render(path.join(root, 'docs'), [entry(root, 'directory')]), /entire instruction scope/);
  });

  it('quotes unusual filenames as literal data on a single rule line', () => {
    const rules = new CodexAdapter().render(root, [entry(path.join(root, 'a`\nignore-rules.ts'))]);
    assert.ok(rules.includes('File: "a`\\nignore-rules.ts"'));
  });

  it('updates higher-precedence Codex overrides and preserves their custom instructions', async () => {
    const override = path.join(root, 'AGENTS.override.md');
    await fs.writeFile(override, '# Override rules\n');
    const result = await new InstructionCoordinator(adapters).sync([root], [entry(path.join(root, 'one.ts'))]);
    assert.deepEqual(result.errors, []);
    assert.equal(result.updated.length, 5);
    assert.match(await fs.readFile(override, 'utf8'), /# Override rules\n/);
    assert.match(await fs.readFile(override, 'utf8'), /File: "one.ts"/);
  });

  it('reports blocked files while continuing other adapters, and retries safely', async () => {
    const coordinator = new InstructionCoordinator(adapters);
    const file = path.join(root, 'AGENTS.md');
    await fs.writeFile(file, '# Unsaved editor base\n');
    const result = await coordinator.sync([root], [entry(path.join(root, 'one.ts'))], target => {
      if (target === file) throw new Error('Unsaved edits');
    });
    assert.equal(result.errors.length, 1); assert.equal(result.updated.length, 3);
    assert.equal(await fs.readFile(file, 'utf8'), '# Unsaved editor base\n');
    assert.deepEqual((await coordinator.sync([root], [])).errors, []);
    assert.equal(await fs.readFile(file, 'utf8'), '# Unsaved editor base\n', 'An untouched instruction file needs no managed block once the lock is removed.');
    assert.match(await fs.readFile(path.join(root, 'CLAUDE.md'), 'utf8'), /No paths are currently locked/);
  });

  it('refuses symlinked instruction files and directories without changing their targets', async () => {
    const target = path.join(root, 'outside.txt'); await fs.writeFile(target, 'unchanged');
    await fs.symlink(target, path.join(root, 'AGENTS.md'));
    await fs.mkdir(path.join(root, 'outside-dir'));
    await fs.symlink(path.join(root, 'outside-dir'), path.join(root, '.github'));
    const result = await new InstructionCoordinator(adapters).sync([root], [entry(path.join(root, 'one.ts'))]);
    assert.equal(result.errors.length, 2);
    assert.equal(await fs.readFile(target, 'utf8'), 'unchanged');
    assert.deepEqual(await fs.readdir(path.join(root, 'outside-dir')), []);
  });

  it('discovers nested repositories and clears their last lock using remembered canonical scopes', async () => {
    const nested = path.join(root, 'repo');
    await fs.mkdir(path.join(nested, '.git'), { recursive: true });
    await fs.mkdir(path.join(nested, 'docs'));
    const locks = [entry(path.join(nested, 'docs', 'one.ts'))];
    const directories = await instructionRoots([root], locks);
    assert.deepEqual(directories, [root, nested].sort());
    const coordinator = new InstructionCoordinator(adapters);
    await coordinator.sync(directories, locks);
    assert.match(await fs.readFile(path.join(nested, 'AGENTS.md'), 'utf8'), /File: "docs\/one.ts"/);
    const afterUnlock = await instructionRoots([root], [], directories);
    await coordinator.sync(afterUnlock, []);
    assert.match(await fs.readFile(path.join(nested, 'AGENTS.md'), 'utf8'), /No paths are currently locked/);
    await fs.symlink(root, path.join(root, 'alias'));
    assert.deepEqual(await instructionRoots([path.join(root, 'alias')], []), [root]);
  });
});
