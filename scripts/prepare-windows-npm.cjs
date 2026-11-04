'use strict';

// Build-time only: replace checksum-pinned compatible dependencies in the
// private npm archive. Never execute package lifecycle scripts or system npm.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { gunzipSync } = require('node:zlib');
const run = promisify(execFile);
const hash = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');
const root = path.resolve(__dirname, '..');
const tar = process.platform === 'win32' ? path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : '/usr/bin/tar';

function validateTar(bytes) {
  const archive = gunzipSync(bytes, { maxOutputLength: 64 * 1024 * 1024 });
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const type = String.fromCharCode(header[156]);
    if (!['\0', '0', '5', 'x', 'g'].includes(type)) throw new Error('Package archive contains a link or unsupported object.');
    const size = Number.parseInt(header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim() || '0', 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > archive.length) throw new Error('Invalid package archive length.');
    offset += 512 + Math.ceil(size / 512) * 512;
  }
}

async function request(url, options = {}) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30_000), ...options });
  if (!response.ok) throw new Error(`Registry request failed (${response.status}): ${url}`);
  return response;
}

async function inventory(directory) {
  const result = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Links are not accepted in bundled npm dependencies.');
    if (entry.isDirectory()) result.push(...await inventory(file));
    else if (entry.name === 'package.json') {
      const metadata = JSON.parse(await fs.readFile(file, 'utf8'));
      if (typeof metadata.name === 'string' && typeof metadata.version === 'string') result.push({ directory, metadata });
    }
  }
  return result;
}

async function checkDependencies(directory, metadata, npmRoot, satisfies) {
  for (const [name, range] of Object.entries(metadata.dependencies || {})) {
    if (!/^(@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/.test(name)) throw new Error('Invalid dependency name.');
    let cursor = directory;
    let version;
    while (true) {
      try { version = JSON.parse(await fs.readFile(path.join(cursor, 'node_modules', name, 'package.json'), 'utf8')).version; break; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (cursor === npmRoot) break;
      cursor = path.dirname(cursor);
    }
    if (!version || !satisfies(version, range)) throw new Error(`Unsatisfied dependency after security update: ${metadata.name} needs ${name}@${range}, found ${version}.`);
  }
}

async function prepare({ runtime = path.join(root, 'resources', 'windows', 'runtime'), report = path.join(root, 'windows-npm-audit.json') } = {}) {
  runtime = path.resolve(runtime);
  const planBytes = await fs.readFile(path.join(root, 'resources', 'windows', 'npm-security-updates.json'));
  const plan = JSON.parse(planBytes);
  const manifestPath = path.join(runtime, 'runtime.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const archive = await fs.readFile(path.join(runtime, 'npm.tar'));
  if (hash(archive) !== manifest.npmSha256) throw new Error('Base npm archive checksum mismatch.');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'afg-npm-security-'));
  try {
    await run(tar, ['-xf', path.join(runtime, 'npm.tar'), '-C', temporary], { timeout: 30_000 });
    const npmRoot = path.join(temporary, 'npm');
    const npmMetadata = JSON.parse(await fs.readFile(path.join(npmRoot, 'package.json'), 'utf8'));
    if (plan.schemaVersion !== 1 || npmMetadata.name !== 'npm' || npmMetadata.version !== plan.npmVersion) throw new Error('Unexpected npm security-update base.');
    const satisfies = require(path.join(npmRoot, 'node_modules', 'semver')).satisfies;
    let packages = await inventory(path.join(npmRoot, 'node_modules'));
    for (const update of plan.updates) {
      if (!/^[a-z][a-z0-9-]*$/.test(update.name) || !/^\d+\.\d+\.\d+$/.test(update.version) ||
          update.tarball !== `https://registry.npmjs.org/${update.name}/-/${update.name}-${update.version}.tgz` ||
          !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(update.integrity)) throw new Error('Invalid pinned security-update entry.');
      const targets = packages.filter(item => item.metadata.name === update.name);
      if (!targets.length) throw new Error(`Expected bundled dependency is missing: ${update.name}`);
      for (const target of targets) if (![update.fromVersion, update.version].includes(target.metadata.version)) throw new Error(`Unreviewed base version: ${update.name}@${target.metadata.version}`);
      if (targets.every(target => target.metadata.version === update.version)) continue;
      const bytes = Buffer.from(await (await request(update.tarball)).arrayBuffer());
      if ('sha512-' + createHash('sha512').update(bytes).digest('base64') !== update.integrity) throw new Error(`Security-update integrity mismatch: ${update.name}`);
      validateTar(bytes);
      const downloaded = path.join(temporary, `${update.name}.tgz`);
      await fs.writeFile(downloaded, bytes, { flag: 'wx' });
      const listing = (await run(tar, ['-tzf', downloaded], { timeout: 15_000 })).stdout.trim().split(/\r?\n/);
      if (listing.some(name => !name.startsWith('package/') || name.split('/').includes('..') || name.includes('\\'))) throw new Error('Package archive path traversal rejected.');
      const unpacked = path.join(temporary, `unpack-${update.name}`);
      await fs.mkdir(unpacked);
      await run(tar, ['-xzf', downloaded, '-C', unpacked], { timeout: 30_000 });
      const replacement = path.join(unpacked, 'package');
      const metadata = JSON.parse(await fs.readFile(path.join(replacement, 'package.json'), 'utf8'));
      if (metadata.name !== update.name || metadata.version !== update.version) throw new Error('Downloaded package identity mismatch.');
      await inventory(replacement); // Reject links before copying any replacement.
      for (const target of targets) {
        await fs.rm(target.directory, { recursive: true, maxRetries: 10, retryDelay: 100 });
        await fs.cp(replacement, target.directory, { recursive: true, dereference: false });
        await checkDependencies(target.directory, metadata, npmRoot, satisfies);
      }
    }
    packages = await inventory(path.join(npmRoot, 'node_modules'));
    const payload = { [npmMetadata.name]: [npmMetadata.version] };
    for (const { metadata } of packages) payload[metadata.name] = [...new Set([...(payload[metadata.name] || []), metadata.version])];
    const advisories = await (await request('https://registry.npmjs.org/-/npm/v1/security/advisories/bulk', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    })).json();
    const findings = Object.entries(advisories).flatMap(([name, items]) => items.map(item => ({ name, versions: (payload[name] || []).filter(version => satisfies(version, item.vulnerable_versions)), severity: item.severity, title: item.title, url: item.url }))).filter(item => item.versions.length);
    const blocking = findings.filter(item => ['high', 'critical'].includes(item.severity));
    await fs.writeFile(report, JSON.stringify({ npmVersion: plan.npmVersion, packages: packages.length + 1, updates: plan.updates.map(({ name, version, integrity }) => ({ name, version, integrity })), findings, highCritical: blocking.length, checkedAt: new Date().toISOString() }, null, 2) + '\n');
    if (blocking.length) throw new Error(`Bundled npm has ${blocking.length} high/critical advisories; see ${report}.`);
    const patched = path.join(temporary, 'npm-secured.tar');
    await run(tar, ['-cf', patched, '-C', temporary, 'npm'], { timeout: 30_000 });
    const patchedBytes = await fs.readFile(patched);
    manifest.npmOriginalSha256 ??= manifest.npmSha256;
    manifest.npmSha256 = hash(patchedBytes);
    manifest.npmVersion = plan.npmVersion;
    manifest.npmSecurityUpdatesSha256 = hash(planBytes);
    await fs.copyFile(patched, path.join(runtime, 'npm.tar'));
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Private npm security updates applied; ${findings.length} moderate/low findings, no high/critical findings. Report: ${report}`);
  } finally { await fs.rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
}

if (require.main === module) prepare().catch(error => { console.error(error.message); process.exitCode = 1; });
else module.exports = { prepare, validateTar };
