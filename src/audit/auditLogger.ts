import { promises as fs } from 'node:fs';
import path from 'node:path';

export interface AuditEvent { readonly action: string; readonly path?: string; readonly outcome: string; readonly detail?: string; }

export class AuditLogger {
  private queue: Promise<void> = Promise.resolve();
  public constructor(private readonly logFile: string) {}
  public record(event: AuditEvent): Promise<void> {
    this.queue = this.queue.catch(() => undefined).then(async () => {
      await fs.mkdir(path.dirname(this.logFile), { recursive: true });
      await fs.appendFile(this.logFile, `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`, { encoding: 'utf8', mode: 0o600 });
    });
    return this.queue;
  }
  public location(): string { return this.logFile; }
}
