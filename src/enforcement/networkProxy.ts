import { createServer, Server } from 'node:http';
import { connect, isIP, Socket } from 'node:net';
import { lookup } from 'node:dns/promises';

// The child gets access to this CONNECT endpoint, not general host networking.
// This service never exposes filesystem/extension commands or model credentials.
export class ManagedNetworkProxy {
  private server?: Server;
  private readonly sockets = new Set<Socket>();
  private starting?: Promise<number>;

  public start(): Promise<number> { return this.starting ??= this.listen(); }
  public async dispose(): Promise<void> {
    this.sockets.forEach(socket => socket.destroy());
    const server = this.server;
    if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    this.server = undefined; this.starting = undefined;
  }
  private async listen(): Promise<number> {
    const server = createServer({ maxHeaderSize: 8192 }, (_request, response) => {
      response.writeHead(405, { Connection: 'close' }); response.end();
    });
    this.server = server;
    server.headersTimeout = 10_000;
    server.on('connection', socket => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
      socket.on('error', () => undefined);
      socket.setTimeout(300_000, () => socket.destroy());
      if (this.sockets.size > 128) socket.destroy();
    });
    server.on('clientError', (_error, socket) => { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
    server.on('connect', (request, client, head) => {
      void (async () => {
        const host = connectHost(request.url ?? '');
        const addresses = await lookup(host, { family: 4, all: true });
        if (!addresses.length || addresses.some(item => !isPublicIPv4(item.address))) throw new Error('Private destination denied.');
        if (client.destroyed) return;
        // Pin the validated address; never resolve the hostname again at connect.
        const upstream = connect({ host: addresses[0].address, port: 443, family: 4 });
        this.sockets.add(upstream);
        upstream.setTimeout(300_000, () => upstream.destroy());
        upstream.on('close', () => { this.sockets.delete(upstream); client.destroy(); });
        client.on('close', () => upstream.destroy());
        upstream.on('error', () => client.destroy());
        upstream.once('connect', () => {
          client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          if (head.length) upstream.write(head);
          client.pipe(upstream); upstream.pipe(client);
        });
      })().catch(() => { if (!client.destroyed) client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    });
    // The extension owns lifetime. A diagnostic process must not hang on an idle listener.
    server.unref();
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Cannot determine protected proxy port.');
    return address.port;
  }
}

export function connectHost(authority: string): string {
  const match = /^([a-zA-Z0-9.-]+):443$/.exec(authority);
  if (!match || match[1].length > 253) throw new Error('Only HTTPS CONNECT destinations on port 443 are supported.');
  const host = match[1].toLowerCase();
  if (isIP(host) || !host.includes('.') || host.endsWith('.') || host.split('.').some(part => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part)) ||
      ['localhost', 'local', 'internal', 'lan', 'home', 'test'].some(suffix => host === suffix || host.endsWith('.' + suffix))) {
    throw new Error('Non-public destination denied.');
  }
  return host;
}

export function isPublicIPv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const [a, b, c] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
}
