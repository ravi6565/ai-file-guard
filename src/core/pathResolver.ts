import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface PathIdentity {
  readonly canonicalPath: string;
  readonly displayPath: string;
}

export class PathResolver {
  private readonly pathApi: typeof path.posix;

  public constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly realpath: (value: string) => Promise<string> = fs.realpath,
  ) { this.pathApi = platform === 'win32' ? path.win32 : path.posix; }

  public async resolve(input: string, allowMissing = false): Promise<PathIdentity> {
    const absolute = this.pathApi.resolve(input);
    let resolved: string;
    try {
      resolved = await this.realpath(absolute);
    } catch (error) {
      if (!allowMissing || !isMissing(error)) throw error;
      resolved = await this.resolveMissing(absolute);
    }
    const normalized = this.pathApi.normalize(resolved);
    return {
      displayPath: normalized,
      canonicalPath: this.platform === 'win32' ? normalized.toLocaleLowerCase('en-US') : normalized,
    };
  }

  public contains(parent: string, candidate: string): boolean {
    const relative = this.pathApi.relative(parent, candidate);
    return relative === '' || (!relative.startsWith(`..${this.pathApi.sep}`) && relative !== '..' && !this.pathApi.isAbsolute(relative));
  }

  private async resolveMissing(absolute: string): Promise<string> {
    const suffix: string[] = []; let cursor = absolute;
    while (true) {
      try { return this.pathApi.join(await this.realpath(cursor), ...suffix.reverse()); }
      catch (error) {
        if (!isMissing(error)) throw error;
        const parent = this.pathApi.dirname(cursor);
        if (parent === cursor) throw error;
        suffix.push(this.pathApi.basename(cursor)); cursor = parent;
      }
    }
  }
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
