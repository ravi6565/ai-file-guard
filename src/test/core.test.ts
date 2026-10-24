import assert from 'node:assert/strict';
import path from 'node:path';
import { LockManager } from '../core/lockManager';
import { KeyValueStore, ManifestStore } from '../core/manifestStore';
import { PathResolver } from '../core/pathResolver';
import { PolicyEngine } from '../core/policyEngine';

class MemoryStore implements KeyValueStore {
  private readonly values = new Map<string, unknown>();
  public get<T>(key: string, fallback: T): T { return (this.values.has(key) ? this.values.get(key) : fallback) as T; }
  public update(key: string, value: unknown): Thenable<void> { this.values.set(key, value); return Promise.resolve(); }
}

function fixture(platform: NodeJS.Platform = 'linux') {
  const storage = new MemoryStore();
  const resolver = new PathResolver(platform, async value => path.normalize(value));
  const locks = new LockManager(new ManifestStore(storage), resolver, async value => value.toLowerCase());
  return { storage, resolver, locks };
}

describe('Phase 2 core', () => {
  it('persists explicit locks and restores them', async () => {
    const { storage, resolver, locks } = fixture();
    await locks.lock('/workspace/src/index.ts', 'file');
    const restored = new LockManager(new ManifestStore(storage), resolver, async value => value.toLowerCase());
    assert.equal(restored.all().length, 1);
    assert.equal((await restored.status('/workspace/src/index.ts')).protected, true);
  });

  it('protects directory descendants but not similarly prefixed paths', async () => {
    const { locks } = fixture();
    await locks.lock('/workspace/src', 'directory');
    const child = await locks.status('/workspace/src/deep/file.ts');
    assert.equal(child.protected && child.explicit, false);
    assert.equal((await locks.status('/workspace/src-other/file.ts')).protected, false);
  });

  it('normalizes Windows paths case-insensitively', async () => {
    const resolver = new PathResolver('win32', async () => 'C:\\Work\\Secret.ts');
    assert.equal((await resolver.resolve('ignored')).canonicalPath, 'c:\\work\\secret.ts');
  });

  it('only unlocks explicit locks', async () => {
    const { locks } = fixture();
    await locks.lock('/workspace/src', 'directory');
    assert.equal(await locks.unlock('/workspace/src/file.ts'), false);
    assert.equal(await locks.unlock('/workspace/src'), true);
  });

  it('blocks protected writes and both sides of renames in enforced policy', async () => {
    const { locks } = fixture();
    await locks.lock('/workspace/protected', 'directory');
    const policy = new PolicyEngine(locks);
    assert.equal((await policy.evaluate({ type: 'write', path: '/workspace/protected/a.ts' }, 'enforced')).allowed, false);
    assert.equal((await policy.evaluate({ type: 'rename', source: '/workspace/free.ts', destination: '/workspace/protected/free.ts' }, 'enforced')).allowed, false);
    assert.equal((await policy.evaluate({ type: 'delete', path: '/workspace/free.ts' }, 'enforced')).allowed, true);
  });

  it('allows operations in advisory mode while stating its limitation', async () => {
    const { locks } = fixture();
    await locks.lock('/workspace/a.ts', 'file');
    const decision = await new PolicyEngine(locks).evaluate({ type: 'delete', path: '/workspace/a.ts' }, 'advisory');
    assert.equal(decision.allowed, true);
    assert.match(decision.reason ?? '', /does not block/);
  });
});
