import { spawnSync } from 'node:child_process';
import path from 'node:path';

if (!['darwin', 'win32'].includes(process.platform)) {
  throw new Error('Native enforcement tests require a real Windows or macOS host.');
}
const result = spawnSync(process.execPath, [
  require.resolve('mocha/bin/mocha'), '--require', 'source-map-support/register',
  path.join(__dirname, process.platform === 'win32' ? 'windowsSandbox.test.js' : 'sandbox.test.js'),
], { stdio: 'inherit', env: { ...process.env, AI_FILE_GUARD_NATIVE_TESTS: '1' } });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
