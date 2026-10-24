import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializePublisherPolicy } from '../core/publisherPolicyMigration';
import { LocalManifestStore } from '../core/localManifestStore';
import { LockEntry } from '../core/types';

describe('Marketplace publisher policy migration', () => {
  let temporary: string;
  let old: LocalManifestStore;
  let current: LocalManifestStore;
  const lock = (name: string): LockEntry => ({ canonicalPath: path.join(temporary, name), displayPath: path.join(temporary, name), kind: 'file', lockedAt: new Date().toISOString() });
  beforeEach(async () => {
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'guard-publisher-'));
    old = new LocalManifestStore(path.join(temporary, 'old', 'local-locks.json'));
    current = new LocalManifestStore(path.join(temporary, 'new', 'local-locks.json'));
  });
  afterEach(async () => { await fs.rm(temporary, { recursive: true, force: true }); });

  it('imports saved locks without changing the old policy', async () => {
    const entries = [lock('one.ts'), lock('two.ts')];
    await old.transact(() => entries);
    const before = await fs.readFile(old.location, 'utf8');
    assert.equal(await initializePublisherPolicy(current, old.location), 2);
    assert.deepEqual(current.load().locks, entries);
    assert.equal(await fs.readFile(old.location, 'utf8'), before);
  });

  it('does not reintroduce locks after an unlock or replace a new publisher policy', async () => {
    await old.transact(() => [lock('old.ts')]);
    await initializePublisherPolicy(current, old.location);
    await current.transact(() => []);
    assert.equal(await initializePublisherPolicy(new LocalManifestStore(current.location), old.location), 0);
    assert.deepEqual((await current.refresh()).locks, []);
    const newEntries = [lock('new.ts')];
    await current.transact(() => newEntries);
    await initializePublisherPolicy(new LocalManifestStore(current.location), old.location);
    assert.deepEqual((await current.refresh()).locks, newEntries);
  });

  it('handles simultaneous first activation and initializes fresh installations', async () => {
    const entries = [lock('one.ts')];
    await old.transact(() => entries);
    const imports = await Promise.all([
      initializePublisherPolicy(current, old.location),
      initializePublisherPolicy(new LocalManifestStore(current.location), old.location),
    ]);
    assert.equal(imports.reduce((sum, value) => sum + value), 1);
    assert.deepEqual((await current.refresh()).locks, entries);
    const fresh = new LocalManifestStore(path.join(temporary, 'fresh', 'local-locks.json'));
    assert.equal(await initializePublisherPolicy(fresh, path.join(temporary, 'absent.json')), 0);
    assert.deepEqual(JSON.parse(await fs.readFile(fresh.location, 'utf8')), { version: 1, locks: [] });
  });

  it('refuses a corrupt old policy instead of silently dropping its locks', async () => {
    await fs.mkdir(path.dirname(old.location), { recursive: true });
    await fs.writeFile(old.location, '{broken');
    await assert.rejects(initializePublisherPolicy(current, old.location));
    await assert.rejects(fs.stat(current.location), error => (error as NodeJS.ErrnoException).code === 'ENOENT');
  });
});
