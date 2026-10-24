import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { ManagedSandbox } from '../enforcement/managedSandbox';

async function main(): Promise<void> {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-file-guard-network-'));
  const sandbox = new ManagedSandbox(path.join(temporary, 'runtime'));
  try {
    const original = path.join(temporary, 'original'); const staging = path.join(temporary, 'session', 'workspace');
    await fs.mkdir(original); await fs.mkdir(staging, { recursive: true });
    const launch = await sandbox.prepare(staging, original);
    // Public package metadata only; no model request, account action, or key.
    const script = `const http=require('node:http'),https=require('node:https'),tls=require('node:tls');
      const proxy=new URL(process.env.HTTPS_PROXY);const request=http.request({host:proxy.hostname,port:proxy.port,method:'CONNECT',path:'registry.npmjs.org:443'});
      request.on('connect',(response,socket)=>{if(response.statusCode!==200)throw Error('Proxy '+response.statusCode);
        const secure=tls.connect({socket,servername:'registry.npmjs.org'});secure.on('error',e=>{console.error(e);process.exitCode=1});
        const agent=new https.Agent();agent.createConnection=()=>secure;
        https.get({host:'registry.npmjs.org',path:'/@openai%2fcodex/latest',agent},response=>{
          let body='';response.on('data',chunk=>body+=chunk);response.on('end',()=>{
            if(response.statusCode!==200)throw Error('HTTP '+response.statusCode);process.stdout.write('TLS_AND_DNS_OK '+JSON.parse(body).version);agent.destroy();
          });}).on('error',e=>{console.error(e);process.exitCode=1});
      });request.on('error',e=>{console.error(e);process.exitCode=1});request.end();`;
    const result = await promisify(execFileCallback)(launch.executable, ['-f', launch.profilePath, process.execPath, '-e', script], {
      cwd: launch.cwd, env: { ...launch.environment, ELECTRON_RUN_AS_NODE: '1' }, timeout: 20_000,
    });
    console.log(result.stdout);
    if (process.env.AI_FILE_GUARD_CLI_SMOKE === '1') {
      const version = result.stdout.trim().split(' ').at(-1)!;
      if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid CLI version in registry response.');
      const run = promisify(execFileCallback);
      await run(launch.executable, ['-f', launch.profilePath, 'npm', 'install', '--global', `@openai/codex@${version}`, '--no-audit', '--no-fund'], {
        cwd: launch.cwd, env: launch.environment, timeout: 180_000, maxBuffer: 512 * 1024,
      });
      const cli = await run(launch.executable, ['-f', launch.profilePath, path.join(launch.environment.HOME, '.local', 'bin', 'codex'), '--version'], {
        cwd: launch.cwd, env: launch.environment, timeout: 15_000,
      });
      console.log('SANDBOXED_CLI_OK ' + cli.stdout.trim());
    }
  } finally { await sandbox.dispose(); await fs.rm(temporary, { recursive: true, force: true }); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
