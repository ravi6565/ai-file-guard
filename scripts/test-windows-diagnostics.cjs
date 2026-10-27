'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parseArguments, executeFile, resolveExtension, validateConfiguration, runtimeProbeScript, redactReport } = require('./diagnose-windows.cjs');

test('CLI rejects missing, unknown, duplicate and unbounded timeout arguments', () => {
  for (const argv of [['--extension'], ['--unknown'], ['--keep', '--keep'], ['--timeout-ms', 'Infinity'], ['--timeout-ms', '-1'], ['--timeout-ms', '600001'], ['--timeout-ms', '10000.5']]) assert.throws(() => parseArguments(argv));
  assert.equal(parseArguments(['--help']).help, true);
  assert.equal(parseArguments(['--timeout-ms', '30000']).timeoutMs, 30000);
  assert.equal(parseArguments(['--output', 'report.json']).output, path.resolve('report.json'));
});

test('help executes cross-platform without creating or loading a sandbox', async () => {
  const result = await executeFile(process.execPath, [path.join(__dirname, 'diagnose-windows.cjs'), '--help'], { timeoutMs: 5000 });
  assert.equal(result.success, true, result.stderr);
  assert.match(result.stdout, /unpacked VSIX/);
  assert.doesNotMatch(result.stderr, /"stage"/);
});

test('unsupported hosts write a failed report and return a nonzero CLI result', { skip: process.platform === 'win32' }, async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'afg-diag-report-'));
  try {
    const output = path.join(temporary, 'report.json');
    const result = await executeFile(process.execPath, [path.join(__dirname, 'diagnose-windows.cjs'), '--extension', temporary, '--output', output], { timeoutMs: 5000 });
    assert.equal(result.success, false);
    assert.equal(result.exitCode, 1);
    assert.match(result.stdout, /Windows diagnostics failed/);
    const report = JSON.parse(await fs.readFile(output, 'utf8'));
    assert.equal(report.success, false);
    assert.equal(report.host.release, os.release());
    assert.match(report.error.message, /native Windows host/);
    assert.deepEqual(report.stages, []);
    assert.deepEqual(await fs.readdir(temporary), ['report.json']);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test('a stalled subprocess fails within its deadline and retains startup output', async () => {
  const result = await executeFile(process.execPath, ['-e', 'process.stdout.write("STARTED");setInterval(()=>{},1000)'], { timeoutMs: 1000 });
  assert.equal(result.success, false);
  assert.equal(result.timedOut, true);
  assert.equal(result.stdout, 'STARTED');
  assert.ok(result.durationMs < 5000, `Deadline took ${result.durationMs}ms.`);
});

test('a descendant retaining inherited pipes cannot defeat the outer deadline', async () => {
  let descendant;
  try {
    const program = `const {spawn}=require('node:child_process');
      const child=spawn(process.execPath,['-e','setTimeout(()=>{},10000)'],{stdio:['ignore','inherit','inherit']});
      process.stdout.write('DESCENDANT:'+child.pid+'\\n');child.unref();process.exit(0);`;
    const result = await executeFile(process.execPath, ['-e', program], { timeoutMs: 1000 });
    descendant = Number(/DESCENDANT:(\d+)/.exec(result.stdout)?.[1]);
    assert.ok(descendant > 0, JSON.stringify(result));
    assert.equal(result.success, false);
    assert.equal(result.timedOut, true);
    assert.equal(result.forcedPipeClosure, true);
    assert.ok(result.durationMs < 5000, `Inherited pipes took ${result.durationMs}ms.`);
  } finally {
    if (descendant) {
      try { process.kill(descendant, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }
});

test('nonzero exit and output overflow cannot report success', async () => {
  const failed = await executeFile(process.execPath, ['-e', 'process.stderr.write("FAILED_STAGE");process.exit(93)'], { timeoutMs: 5000 });
  assert.equal(failed.success, false);
  assert.equal(failed.exitCode, 93);
  assert.equal(failed.stderr, 'FAILED_STAGE');
  const overflow = await executeFile(process.execPath, ['-e', 'process.stdout.write("x".repeat(100000));setInterval(()=>{},1000)'], { timeoutMs: 5000, maxBuffer: 1024 });
  assert.equal(overflow.success, false);
  assert.equal(overflow.outputLimitExceeded, true);
  assert.ok(overflow.stdout.length <= 1024);
});

test('an unpacked package must have the expected extension identity and compiled backend', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'afg-diag-schema-'));
  try {
    const extension = path.join(temporary, 'extension');
    await fs.mkdir(extension);
    await fs.writeFile(path.join(extension, 'package.json'), JSON.stringify({ name: 'other-extension', publisher: 'ravikiranv' }));
    await assert.rejects(resolveExtension(temporary), /Expected the ravikiranv/);
    await fs.writeFile(path.join(extension, 'package.json'), JSON.stringify({ name: 'ai-file-guard', publisher: 'ravikiranv', version: 'test' }));
    await assert.rejects(resolveExtension(temporary), { code: 'ENOENT' });
    await fs.mkdir(path.join(extension, 'dist', 'enforcement'), { recursive: true });
    await fs.writeFile(path.join(extension, 'dist', 'enforcement', 'windowsSandbox.js'), '');
    const resolved = await resolveExtension(temporary);
    assert.equal(resolved.directory, await fs.realpath(extension));
    assert.match(resolved.packageJsonSha256, /^[a-f0-9]{64}$/);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test('generated configuration cannot grant writes to an original or an outside directory', () => {
  const root = path.resolve(os.tmpdir(), 'diagnostic-fixture');
  const runtime = path.join(root, 'control', 'node-runtime');
  const original = path.join(root, 'original');
  const valid = {
    ProfileName: 'AIFileGuard.fixture', Executable: path.join(runtime, 'node.exe'),
    Arguments: ['-e', ''], WorkingDirectory: path.join(root, 'staging'),
    WritableRoots: [path.join(root, 'staging')], ReadOnlyRoots: [runtime], Environment: {},
  };
  assert.doesNotThrow(() => validateConfiguration(valid, root, runtime, original));
  for (const writable of [original, root, path.dirname(root), path.join(original, 'nested')]) assert.throws(() => validateConfiguration({ ...valid, WritableRoots: [writable] }, root, runtime, original));
  assert.throws(() => validateConfiguration({ ...valid, ReadOnlyRoots: [path.dirname(root)] }, root, runtime, original));
});

test('the runtime probe detects a writable original instead of accepting a pipe-only success', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'afg-diag-probe-'));
  try {
    const original = path.join(temporary, 'original.txt');
    await fs.writeFile(original, 'original');
    const result = await executeFile(process.execPath, ['-e', runtimeProbeScript(), original], { cwd: temporary, timeoutMs: 5000 });
    assert.equal(result.success, false);
    assert.equal(result.exitCode, 93);
    assert.match(result.stdout, /RUNTIME_STARTED/);
    assert.match(result.stdout, /ORIGINAL_WRITE_SUCCEEDED/);
    assert.doesNotMatch(result.stdout, /RUNTIME_VERIFIED/);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test('the generated probe completes captured child I/O when a disposable path is denied', async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'afg-diag-proof-'));
  try {
    // ENOENT is one of the intentional sandbox-denial results. This exercises
    // generated JS and its success protocol without pretending to test LPAC.
    const unavailable = path.join(temporary, 'missing-parent', 'original.txt');
    const result = await executeFile(process.execPath, ['-e', runtimeProbeScript(), unavailable], { cwd: temporary, timeoutMs: 5000 });
    assert.equal(result.success, true, JSON.stringify(result));
    assert.ok(result.stdout.startsWith('RUNTIME_STARTED\n'));
    assert.ok(result.stdout.endsWith('RUNTIME_VERIFIED\n'));
    assert.equal(result.stderr, '');
    const line = result.stdout.split('\n').find(value => value.startsWith('CHILD_RESULT:'));
    const child = JSON.parse(line.slice('CHILD_RESULT:'.length));
    assert.equal(child.stdout, 'CHILD_STARTED\nCHILD_DENIED:ENOENT\n');
    assert.equal(child.status, 0);
    assert.equal(await fs.readFile(path.join(temporary, 'runtime-allowed.txt'), 'utf8'), 'yes');
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test('report anonymization includes paths nested in captured launcher output', () => {
  const report = { stages: [{ stderr: 'Open C:\\Users\\Tester\\private\\file.txt' }] };
  assert.deepEqual(redactReport(report, [['C:\\Users\\Tester', '<user-home>']]), { stages: [{ stderr: 'Open <user-home>\\private\\file.txt' }] });
});
