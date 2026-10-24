import { promises as fs } from 'node:fs';
import { LocalManifestStore } from './localManifestStore';

/** Initialize once under the destination lease. An existing empty policy is an
 * intentional state, so never re-import old locks after the user unlocks them. */
export async function initializePublisherPolicy(policy: LocalManifestStore, legacyLocation: string): Promise<number> {
  let imported = 0;
  await policy.transact(async current => {
    try { await fs.lstat(policy.location); return current.locks; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const previous = await new LocalManifestStore(legacyLocation).refresh();
    imported = previous.locks.length;
    return previous.locks;
  });
  return imported;
}
