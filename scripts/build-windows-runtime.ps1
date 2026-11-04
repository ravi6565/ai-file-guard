#Requires -Version 7.0
param(
  [string]$Output = "$PSScriptRoot/../resources/windows/runtime",
  [switch]$KeepBuild
)
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'The private Windows runtime must be built on Windows.' }
$Output = [System.IO.Path]::GetFullPath($Output)

function Invoke-RuntimeSmoke {
  param([string]$Executable, [string[]]$Arguments, [int]$TimeoutMilliseconds = 15000)
  $start = [System.Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $Executable
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $start
  try {
    if (-not $process.Start()) { throw 'Could not start the private runtime smoke.' }
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit($TimeoutMilliseconds)) {
      $terminationDetail = ''
      try { $process.Kill($true) } catch { $terminationDetail = " Termination failed: $($_.Exception.Message)" }
      [void]$process.WaitForExit(2000)
      throw "Private runtime smoke exceeded ${TimeoutMilliseconds}ms.$terminationDetail"
    }
    # A descendant retaining an inherited pipe must not hang the build either.
    if (-not $stdout.Wait(2000) -or -not $stderr.Wait(2000)) { throw 'Private runtime smoke output did not close within its deadline.' }
    $result = [pscustomobject]@{ ExitCode = $process.ExitCode; Stdout = $stdout.GetAwaiter().GetResult(); Stderr = $stderr.GetAwaiter().GetResult() }
    if ($result.ExitCode -ne 0) { throw "Private runtime smoke exited $($result.ExitCode): $($result.Stderr)" }
    return $result
  } finally { $process.Dispose() }
}

$version = '24.22.1'
$sourceHash = '001773d9bd53fbd27a25efd42aa6a9693ebfe500998ca9bec635e9b6ee79bc91'
$patch = (Resolve-Path "$PSScriptRoot/../resources/windows/libuv-appcontainer.patch").Path
$patchHash = (Get-FileHash $patch -Algorithm SHA256).Hash.ToLowerInvariant()
$temporaryRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$work = Join-Path $temporaryRoot ("ai-file-guard-node-$version-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $work | Out-Null
try {
  $archive = Join-Path $work "node-v$version.tar.gz"
  Invoke-WebRequest "https://nodejs.org/dist/v$version/node-v$version.tar.gz" -OutFile $archive
  if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sourceHash) { throw 'Node source checksum mismatch.' }
  & tar.exe -xzf $archive -C $work
  if ($LASTEXITCODE -ne 0) { throw 'Node source extraction failed.' }
  $source = Join-Path $work "node-v$version"
  Push-Location $source
  try {
    & git apply --check --directory=deps/uv $patch
    if ($LASTEXITCODE -ne 0) { throw 'The reviewed libuv patch no longer applies to the pinned source.' }
    & git apply --directory=deps/uv $patch
    if ($LASTEXITCODE -ne 0) { throw 'Applying the reviewed libuv patch failed.' }
    # Do not pass "release": vcbuild's explicit release option enables expensive
    # LTCG. Its default configuration is already Release. Keep the full ICU data.
    & cmd.exe /d /c 'vcbuild.bat x64 no-cctest'
    if ($LASTEXITCODE -ne 0) { throw 'Building the private Windows runtime failed.' }
  } finally { Pop-Location }

  # Reject a broken host runtime before producing a cacheable manifest. LPAC
  # acceptance still runs separately against these exact packaged bytes.
  $node = Join-Path $source 'Release/node.exe'
  $runtimeVersion = Invoke-RuntimeSmoke -Executable $node -Arguments @('--version')
  if ($runtimeVersion.Stdout.Trim() -ne "v$version") { throw 'The private runtime version smoke failed.' }
  $pipeSmoke = 'const cp=require("node:child_process"),assert=require("node:assert/strict");assert.equal(process.arch,"x64");const r=cp.spawnSync(process.execPath,["-e","process.stdin.pipe(process.stdout);process.stderr.write(\"STDERR_OK\");"],{input:"PIPE_OK",encoding:"utf8",timeout:5000});assert.ifError(r.error);assert.equal(r.status,0);assert.equal(r.signal,null);assert.equal(r.stdout,"PIPE_OK");assert.equal(r.stderr,"STDERR_OK");process.stdout.write("HOST_PIPE_VERIFIED");'
  $pipeResult = Invoke-RuntimeSmoke -Executable $node -Arguments @('-e', $pipeSmoke)
  if ($pipeResult.Stdout -ne 'HOST_PIPE_VERIFIED') { throw 'The private runtime host child-pipe smoke failed.' }

  New-Item -ItemType Directory -Force -Path $Output | Out-Null
  Copy-Item $node "$Output/node.exe"
  Copy-Item "$source/LICENSE" "$Output/LICENSE"
  Copy-Item "$source/deps/npm/bin/npm.cmd", "$source/deps/npm/bin/npx.cmd" $Output
  & tar.exe -cf "$Output/npm.tar" -C "$source/deps" npm
  if ($LASTEXITCODE -ne 0) { throw 'Packaging npm failed.' }
  @{
    version = $version
    architecture = 'x64'
    sourceSha256 = $sourceHash
    patchSha256 = $patchHash
    nodeSha256 = (Get-FileHash "$Output/node.exe" -Algorithm SHA256).Hash.ToLowerInvariant()
    npmSha256 = (Get-FileHash "$Output/npm.tar" -Algorithm SHA256).Hash.ToLowerInvariant()
  } | ConvertTo-Json | Set-Content -Encoding utf8NoBOM "$Output/runtime.json"
} finally {
  if ($KeepBuild) { Write-Host "Private runtime build retained at $work" }
  else { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction Continue }
}
