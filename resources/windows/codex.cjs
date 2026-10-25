// Managed Windows adapter: launch npm's native payload in its installed folder.
// Never invoke this adapter in the unrestricted extension host.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawn } = require('node:child_process');

try {
  if (process.platform !== 'win32' || process.arch !== 'x64' || process.env.AI_FILE_GUARD_MANAGED !== '1') throw new Error('Use this adapter inside the Windows x64 Protected AI Terminal.');
  const prefix = process.env.npm_config_prefix;
  if (!prefix || !path.isAbsolute(prefix)) throw new Error('Missing isolated npm prefix.');
  const packageRoot = path.join(prefix, 'node_modules', '@openai', 'codex');
  const metadata = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  if (metadata.name !== '@openai/codex') throw new Error('Unexpected CLI package.');
  const packageRequire = createRequire(path.join(packageRoot, 'package.json'));
  let vendor;
  try { vendor = path.join(path.dirname(packageRequire.resolve('@openai/codex-win32-x64/package.json')), 'vendor'); }
  catch { vendor = path.join(packageRoot, 'vendor'); }
  const executable = path.join(vendor, 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
  if (!fs.existsSync(executable)) throw new Error('Native Codex payload is missing. Run npm install -g @openai/codex in this terminal.');
  const environment = { ...process.env, CODEX_MANAGED_PACKAGE_ROOT: packageRoot };
  for (const name of ['CODEX_MANAGED_BY_NPM', 'CODEX_MANAGED_BY_BUN', 'CODEX_MANAGED_BY_PNPM', 'CODEX_MANAGED_BY_VITE_PLUS']) delete environment[name];
  environment.CODEX_MANAGED_BY_NPM = '1';
  const child = spawn(executable, process.argv.slice(2), { stdio: 'inherit', env: environment });
  child.once('error', error => { console.error(error.message); process.exitCode = 1; });
  child.once('exit', (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exitCode = code ?? 1; });
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { if (!child.killed) { try { child.kill(signal); } catch { /* Child already exited. */ } } });
} catch (error) {
  console.error(`AI File Guard Codex adapter: ${error.message}`);
  process.exitCode = 1;
}
