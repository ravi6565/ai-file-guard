param([string]$Output = "$PSScriptRoot/../resources/windows/runtime")
$ErrorActionPreference = 'Stop'
$version = '24.22.1'
$sourceHash = '001773d9bd53fbd27a25efd42aa6a9693ebfe500998ca9bec635e9b6ee79bc91'
$patch = (Resolve-Path "$PSScriptRoot/../resources/windows/libuv-appcontainer.patch").Path
$patchHash = (Get-FileHash $patch -Algorithm SHA256).Hash.ToLowerInvariant()
$work = Join-Path $env:RUNNER_TEMP "ai-file-guard-node-$version"
New-Item -ItemType Directory -Force -Path $work | Out-Null
$archive = Join-Path $work "node-v$version.tar.gz"
Invoke-WebRequest "https://nodejs.org/dist/v$version/node-v$version.tar.gz" -OutFile $archive
if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sourceHash) { throw 'Node source checksum mismatch.' }
& tar.exe -xzf $archive -C $work
if ($LASTEXITCODE -ne 0) { throw 'Node source extraction failed.' }
$source = Join-Path $work "node-v$version"
Push-Location $source
try {
  & git apply --check --directory=deps/uv $patch
  if ($LASTEXITCODE -ne 0) { throw 'The pinned upstream libuv patch no longer applies.' }
  & git apply --directory=deps/uv $patch
  if ($LASTEXITCODE -ne 0) { throw 'Applying the upstream libuv patch failed.' }
  # Do not pass "release": vcbuild's explicit release option enables expensive
  # LTCG. Its default configuration is already Release. Keep the full ICU data.
  & cmd.exe /d /c 'vcbuild.bat x64 no-cctest'
  if ($LASTEXITCODE -ne 0) { throw 'Building the private Windows runtime failed.' }
} finally { Pop-Location }
New-Item -ItemType Directory -Force -Path $Output | Out-Null
Copy-Item "$source/Release/node.exe" "$Output/node.exe"
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
