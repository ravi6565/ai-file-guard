#!/usr/bin/env node
'use strict';

// Run explicitly on the affected Windows host. All ACL changes and test writes
// are confined to a newly created diagnostic directory, never the user's project.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const HELP = `Usage: node scripts/diagnose-windows.cjs [options]

  --extension <directory>  Installed extension directory, or unpacked VSIX root.
                           Defaults to the extension containing this script.
  --control <directory>    Existing parent for a NEW private diagnostic directory.
                           Defaults to the Windows temporary directory.
  --timeout-ms <number>    Outer deadline per launcher run (10000-600000; 120000).
  --output <report.json>  Write the JSON report to this file; print a short result.
  --keep                  Keep the new diagnostic directory for inspection.
  --show-paths            Include full local paths in the JSON report.
  --help, -h              Show this help without executing diagnostics.

Requires native Windows and Node.js 22 or newer. No npm install is needed.
Tests use disposable files and a fresh copy of the extension's shipped runtime.
The existing verification result and cold/warm runtime stages are reported as JSON.
A failed verification or incomplete probe exits nonzero. Nothing is published.
`;

function parseArguments(argv) {
  const result = { extension: path.resolve(__dirname, '..'), timeoutMs: 120_000, keep: false, showPaths: false, help: false };
  const seen = new Set();
  for (let index = 0; index < argv.length; index++) {
    const option = argv[index];
    if (seen.has(option)) throw new Error(`Duplicate option: ${option}`);
    seen.add(option);
    if (option === '--help' || option === '-h') result.help = true;
    else if (option === '--keep') result.keep = true;
    else if (option === '--show-paths') result.showPaths = true;
    else if (['--extension', '--control', '--timeout-ms', '--output'].includes(option)) {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}.`);
      if (option === '--timeout-ms') {
        if (!/^\d+$/.test(value) || Number(value) < 10_000 || Number(value) > 600_000) throw new Error('--timeout-ms must be an integer from 10000 through 600000.');
        result.timeoutMs = Number(value);
      } else result[option.slice(2)] = path.resolve(value);
    } else throw new Error(`Unknown option: ${option}`);
  }
  return result;
}

// Waiting for close (rather than exit) captures the final pipe output. Killing
// the native launcher closes its non-inherited Job handle and ends its children.
// Bound pipe draining too: a descendant retaining stdio must not stall reporting.
function executeFile(executable, args, { cwd, env, timeoutMs, maxBuffer = 128 * 1024 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) return Promise.reject(new Error('A positive finite process deadline is required.'));
  const start = performance.now();
  return new Promise(resolve => {
    const child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = { stdout: [], stderr: [] };
    const sizes = { stdout: 0, stderr: 0 };
    let spawnError;
    let timedOut = false;
    let outputLimitExceeded = false;
    let forcedPipeClosure = false;
    let settled = false;
    let exitCode = null;
    let signal = null;
    let drainTimer;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(drainTimer);
      resolve({
        success: !spawnError && !timedOut && !outputLimitExceeded && !forcedPipeClosure && exitCode === 0,
        exitCode, signal, timedOut, outputLimitExceeded, forcedPipeClosure,
        error: spawnError ? { code: spawnError.code, message: spawnError.message } : undefined,
        durationMs: Math.round(performance.now() - start),
        stdout: Buffer.concat(chunks.stdout).toString('utf8'),
        stderr: Buffer.concat(chunks.stderr).toString('utf8'),
      });
    };
    const terminate = () => {
      child.kill('SIGKILL');
      if (!drainTimer) drainTimer = setTimeout(() => {
        forcedPipeClosure = true;
        for (const stream of [child.stdin, child.stdout, child.stderr]) stream.destroy();
        child.unref();
        finish();
      }, 1000);
    };
    const timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
    child.stdin.on('error', () => undefined);
    child.stdin.end();
    for (const stream of ['stdout', 'stderr']) child[stream].on('data', bytes => {
      const remaining = Math.max(0, maxBuffer - sizes[stream]);
      if (remaining) chunks[stream].push(bytes.subarray(0, remaining));
      sizes[stream] += bytes.length;
      if (sizes[stream] > maxBuffer && !outputLimitExceeded) { outputLimitExceeded = true; terminate(); }
    });
    child.on('error', error => { spawnError = error; });
    child.on('exit', (code, reason) => { exitCode = code; signal = reason; });
    child.on('close', (code, reason) => { exitCode = code; signal = reason; finish(); });
  });
}

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function contains(parent, child) {
  const relative = path.relative(parent, child);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}

async function resolveExtension(input) {
  for (const candidate of [input, path.join(input, 'extension')]) {
    let bytes;
    try { bytes = await fs.readFile(path.join(candidate, 'package.json')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const manifest = JSON.parse(bytes.toString('utf8'));
    if (manifest.name !== 'ai-file-guard' || manifest.publisher !== 'ravikiranv') continue;
    const directory = await fs.realpath(candidate);
    await fs.access(path.join(directory, 'dist', 'enforcement', 'windowsSandbox.js'));
    return { directory, version: manifest.version, packageJsonSha256: hash(bytes) };
  }
  throw new Error('Expected the ravikiranv.ai-file-guard extension directory or unpacked Windows VSIX root.');
}

function validateConfiguration(config, root, runtimeDirectory, originalDirectory) {
  const inside = value => typeof value === 'string' && path.isAbsolute(value) && contains(root, value);
  if (!config || typeof config.ProfileName !== 'string' || !config.ProfileName.startsWith('AIFileGuard.') ||
      config.Executable !== path.join(runtimeDirectory, 'node.exe') ||
      !Array.isArray(config.Arguments) || !config.Arguments.every(value => typeof value === 'string') ||
      !inside(config.WorkingDirectory) || !Array.isArray(config.WritableRoots) || !config.WritableRoots.length ||
      !config.WritableRoots.every(value => inside(value) && !contains(value, originalDirectory) && !contains(originalDirectory, value)) ||
      !Array.isArray(config.ReadOnlyRoots) || config.ReadOnlyRoots.length !== 1 || config.ReadOnlyRoots[0] !== runtimeDirectory ||
      !config.Environment || typeof config.Environment !== 'object' || Object.values(config.Environment).some(value => typeof value !== 'string')) {
    throw new Error('Generated diagnostic configuration escaped its disposable test area or had an unexpected schema.');
  }
}

function runtimeProbeScript() {
  const child = `const fs=require('node:fs');process.stdout.write('CHILD_STARTED\\n');
    try{fs.writeFileSync(process.argv[1],'escaped');process.stderr.write('ORIGINAL_WRITE_SUCCEEDED');process.exit(91)}
    catch(error){if(!['EPERM','EACCES','ENOENT'].includes(error.code))throw error;process.stdout.write('CHILD_DENIED:'+error.code+'\\n')}`;
  return `process.stdout.write('RUNTIME_STARTED\\n');const cp=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
    const timer=setTimeout(()=>{process.stderr.write('RUNTIME_WATCHDOG');process.exit(92)},15000);timer.unref();
    const child=cp.spawnSync(process.execPath,['-e',${JSON.stringify(child)},process.argv[1]],{encoding:'utf8',timeout:10000});
    process.stdout.write('CHILD_RESULT:'+JSON.stringify({status:child.status,signal:child.signal,error:child.error&&child.error.code,stdout:child.stdout,stderr:child.stderr})+'\\n');
    if(child.status!==0||!/^CHILD_STARTED\\nCHILD_DENIED:(EPERM|EACCES|ENOENT)\\r?\\n$/.test(child.stdout||'')||child.stderr)process.exit(93);
    fs.writeFileSync(path.join(process.cwd(),'runtime-allowed.txt'),'yes');clearTimeout(timer);process.stdout.write('RUNTIME_VERIFIED\\n');`;
}

function redactReport(report, replacements) {
  const visit = value => {
    if (typeof value === 'string') {
      for (const [source, replacement] of replacements) {
        if (!source) continue;
        value = value.split(source).join(replacement);
        value = value.split(source.replaceAll('\\', '/')).join(replacement);
      }
      return value;
    }
    if (Array.isArray(value)) return value.map(visit);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, visit(item)]));
    return value;
  };
  return visit(report);
}

async function diagnose(options, onStage = () => undefined) {
  const report = {
    schemaVersion: 1, startedAt: new Date().toISOString(), success: false,
    host: { platform: process.platform, release: os.release(), version: os.version(), architecture: os.arch(), nodeVersion: process.version },
    stages: [],
  };
  let root;
  let extension;
  const providerNames = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'GH_TOKEN'];
  const savedCredentials = new Map(providerNames.map(name => [name, process.env[name]]));
  const stage = async (name, action) => {
    onStage({ stage: name, status: 'started' });
    const start = performance.now();
    let result;
    try { result = await action(); }
    catch (error) { result = { success: false, error: { code: error.code, message: error.message } }; }
    report.stages.push({ name, durationMs: Math.round(performance.now() - start), ...result });
    onStage({ stage: name, status: result.success ? 'passed' : 'failed' });
    return result;
  };
  try {
    if (process.platform !== 'win32') throw new Error('Run diagnostics on the affected native Windows host. --help works on other platforms.');
    if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Node.js 22 or newer is required.');
    for (const name of providerNames) delete process.env[name];
    extension = await resolveExtension(options.extension);
    report.extension = extension;
    const parent = await fs.realpath(options.control ?? os.tmpdir());
    root = await fs.mkdtemp(path.join(parent, 'ai-file-guard-diag-'));
    report.testDirectory = root;
    const control = path.join(root, 'control');
    const original = path.join(root, 'original');
    const staging = path.join(root, 'session', 'workspace');
    await fs.mkdir(original); await fs.mkdir(staging, { recursive: true });
    const originalFile = path.join(original, 'locked.txt');
    await fs.writeFile(originalFile, 'original', { flag: 'wx' });
    const bundle = path.join(extension.directory, 'resources', 'windows', 'runtime');
    const manifestBytes = await fs.readFile(path.join(bundle, 'runtime.json'));
    const manifest = JSON.parse(manifestBytes.toString('utf8').replace(/^\uFEFF/, ''));
    report.runtime = { manifestSha256: hash(manifestBytes), launcherSourceSha256: hash(await fs.readFile(path.join(bundle, '..', 'GuardLauncher.cs'))) };
    for (const name of ['version', 'architecture', 'nodeSha256', 'npmSha256', 'sourceSha256', 'patchSha256']) report.runtime[name] = manifest[name];
    const { WindowsSandbox } = require(path.join(extension.directory, 'dist', 'enforcement', 'windowsSandbox.js'));
    const sandbox = new WindowsSandbox(control);
    await stage('extension-verification', async () => {
      const capability = await sandbox.verify();
      return { success: capability.available === true, capability };
    });
    const prepared = await stage('private-runtime-preparation', async () => {
      const directory = await sandbox.prepareNodeRuntime(original);
      if (!contains(control, directory)) throw new Error('Private runtime is outside the new diagnostic control directory.');
      const nodeSha256 = hash(await fs.readFile(path.join(directory, 'node.exe')));
      report.runtime.cachedNodeSha256 = nodeSha256;
      if (nodeSha256 !== manifest.nodeSha256) throw new Error('Cached private Node differs from the shipped runtime hash.');
      return { success: true, directory };
    });
    if (prepared.success) {
      const nativeTimeout = Math.min(30_000, Math.max(1000, options.timeoutMs - Math.min(10000, Math.floor(options.timeoutMs / 4))));
      for (const temperature of ['cold', 'warm']) await stage(`runtime-${temperature}`, async () => {
        await fs.rm(path.join(staging, 'runtime-allowed.txt'), { force: true });
        const launch = await sandbox.prepareCommand(staging, original, path.join(prepared.directory, 'node.exe'), ['-e', runtimeProbeScript(), originalFile], prepared.directory);
        if (!contains(root, launch.profilePath) || !contains(control, launch.executable)) throw new Error('Launcher/configuration is outside the disposable control directory.');
        const configuration = JSON.parse(await fs.readFile(launch.profilePath, 'utf8'));
        validateConfiguration(configuration, root, prepared.directory, original);
        configuration.TimeoutMilliseconds = nativeTimeout;
        configuration.Diagnostics = true;
        await fs.writeFile(launch.profilePath, JSON.stringify(configuration));
        const execution = await executeFile(launch.executable, launch.arguments, { cwd: launch.cwd, env: launch.environment, timeoutMs: options.timeoutMs });
        const originalPreserved = await fs.readFile(originalFile, 'utf8') === 'original';
        const writableVerified = await fs.readFile(path.join(staging, 'runtime-allowed.txt'), 'utf8').catch(() => '') === 'yes';
        const proofComplete = execution.stdout.startsWith('RUNTIME_STARTED\n') && execution.stdout.endsWith('RUNTIME_VERIFIED\n');
        return { ...execution, success: execution.success && originalPreserved && writableVerified && proofComplete, nativeTimeoutMs: nativeTimeout, originalPreserved, writableVerified, proofComplete };
      });
    }
    report.success = report.stages.length === 4 && report.stages.every(result => result.success);
  } catch (error) { report.error = { code: error.code, message: error.message }; }
  finally {
    for (const [name, value] of savedCredentials) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    if (root && !options.keep) {
      try { await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); report.cleanedUp = true; }
      catch (error) { report.success = false; report.cleanupError = { code: error.code, message: error.message }; }
    } else if (root) report.cleanedUp = false;
  }
  return options.showPaths ? report : redactReport(report, [[root, '<diagnostic-root>'], [extension?.directory, '<extension>'], [os.homedir(), '<user-home>']]);
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try { options = parseArguments(argv); }
  catch (error) { process.stderr.write(error.message + '\n' + HELP); return 2; }
  if (options.help) { process.stdout.write(HELP); return 0; }
  const report = await diagnose(options, event => process.stderr.write(JSON.stringify(event) + '\n'));
  if (options.output) {
    await fs.writeFile(options.output, JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(`Windows diagnostics ${report.success ? 'passed' : 'failed'}. Report: ${options.output}\n`);
  } else process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  return report.success ? 0 : 1;
}

if (require.main === module) main().then(code => { process.exitCode = code; }).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; });
else module.exports = { parseArguments, executeFile, resolveExtension, validateConfiguration, runtimeProbeScript, redactReport, diagnose, main };
