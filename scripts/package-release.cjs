const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { createVSIX } = require('@vscode/vsce');

async function main() {
  const root = path.resolve(__dirname, '..');
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  let target = `${process.platform}-${process.arch}`;
  let output;
  const args = process.argv.slice(2);
  while (args.length) {
    const option = args.shift();
    if (!['--target', '--out'].includes(option) || !args.length || args[0].startsWith('--')) throw new Error('Usage: npm run package:release -- [--target darwin-arm64|darwin-x64|win32-x64] [--out file.vsix]');
    if (option === '--target') target = args.shift(); else output = args.shift();
  }
  if (!['darwin-arm64', 'darwin-x64', 'win32-x64'].includes(target)) throw new Error(`No release backend for ${target}. Package on a supported host or specify a supported target.`);
  if (manifest.publisher !== 'ravikiranv' || manifest.name !== 'ai-file-guard' || manifest.preview !== false) throw new Error('Stable packaging requires the expected publisher, extension ID and preview: false.');
  const homepage = new URL(manifest.homepage);
  if (homepage.protocol !== 'https:' || homepage.hostname === 'marketplace.visualstudio.com') throw new Error('The homepage must be an owned HTTPS project/developer page, not a Marketplace listing.');
  // The source repository is private. Omitting bugs alone makes VSCE infer
  // its inaccessible issue tracker from repository, so omit both resources.
  if (manifest.bugs || manifest.repository) throw new Error('This private-source release uses README email support; omit optional bugs/repository resource metadata.');
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Marketplace requires a numeric extension version.');
  const hash = data => createHash('sha256').update(data).digest('hex');
  if (target === 'win32-x64') {
    const bundle = path.join(root, 'resources', 'windows', 'runtime');
    const runtime = JSON.parse(await fs.readFile(path.join(bundle, 'runtime.json'), 'utf8').catch(() => { throw new Error('Missing Windows runtime. Download the windows-lpac-runtime CI artifact into resources/windows/runtime before packaging.'); }));
    if (runtime.architecture !== 'x64' || runtime.version !== '24.22.1' || runtime.sourceSha256 !== '001773d9bd53fbd27a25efd42aa6a9693ebfe500998ca9bec635e9b6ee79bc91' || runtime.patchSha256 !== hash(await fs.readFile(path.join(root, 'resources', 'windows', 'libuv-appcontainer.patch')))) throw new Error('Windows runtime provenance does not match the pinned build.');
    for (const [file, expected] of [['node.exe', runtime.nodeSha256], ['npm.tar', runtime.npmSha256]]) if (hash(await fs.readFile(path.join(bundle, file))) !== expected) throw new Error(`Windows runtime checksum mismatch: ${file}`);
    for (const file of ['LICENSE', 'npm.cmd', 'npx.cmd']) await fs.access(path.join(bundle, file));
    await fs.access(path.join(bundle, '..', 'npm-private-roots.cjs'));
    for (const file of ['codex.cmd', 'codex.cjs']) await fs.access(path.join(bundle, '..', file));
  }
  const destination = path.resolve(root, output ?? `artifacts/ai-file-guard-${manifest.version}-${target}.vsix`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'guard-package-'));
  try {
    const ignoreFile = path.join(temporary, 'package.ignore');
    const ignores = await fs.readFile(path.join(root, '.vscodeignore'), 'utf8');
    await fs.writeFile(ignoreFile, `${ignores}\n${target.startsWith('darwin-') ? 'resources/windows/**\n' : ''}`);
    await createVSIX({ cwd: root, packagePath: destination, target, preRelease: false, allowMissingRepository: true, ignoreFile });
    const digest = hash(await fs.readFile(destination));
    await fs.writeFile(`${destination}.sha256`, `${digest}  ${path.basename(destination)}\n`);
    await fs.writeFile(`${destination}.json`, JSON.stringify({ extension: `${manifest.publisher}.${manifest.name}`, version: manifest.version, target, preRelease: false, sha256: digest, protectionScope: 'managed-agents-only', acceptanceRequired: true }, null, 2) + '\n');
    console.log(`Prepared ${destination}\nSHA256 ${digest}\nRun installed-VSIX acceptance on ${target} before uploading.`);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
