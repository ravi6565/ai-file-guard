#Requires -Version 7.0
param([string]$Report = "$PSScriptRoot/../windows-standard-user.json")
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or $env:GITHUB_ACTIONS -ne 'true') { throw 'This account-creation test runs only on Windows GitHub Actions.' }
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'The CI fixture needs an administrator to create its disposable standard account.' }

$extension = (Resolve-Path "$PSScriptRoot/..").Path
$Report = [IO.Path]::GetFullPath($Report)
$fixture = Join-Path $env:PUBLIC ('afg-standard-' + [Guid]::NewGuid().ToString('N'))
$account = 'afg' + [Guid]::NewGuid().ToString('N').Substring(0, 12)
$password = ConvertTo-SecureString ('AfG!9a' + [Guid]::NewGuid().ToString('N')) -AsPlainText -Force
$user = $null
$process = $null
try {
  $user = New-LocalUser -Name $account -Password $password -AccountNeverExpires -PasswordNeverExpires
  $users = Get-LocalGroup -SID 'S-1-5-32-545'
  Add-LocalGroupMember -Group $users -Member $user
  New-Item -ItemType Directory -Path $fixture | Out-Null
  $privateExtension = Join-Path $fixture 'extension'
  New-Item -ItemType Directory -Path $privateExtension | Out-Null
  foreach ($name in @('package.json', 'dist', 'resources', 'scripts')) {
    Copy-Item -LiteralPath (Join-Path $extension $name) -Destination $privateExtension -Recurse
  }
  # Grant only this disposable fixture. The new account owns every probe object
  # it creates below it; original projects and their ACLs are never involved.
  & icacls.exe $fixture /grant ("*" + $user.SID.Value + ':(OI)(CI)M') /T /Q | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Could not grant the disposable standard-user fixture.' }
  $childScript = Join-Path $fixture 'run.ps1'
  $childReport = Join-Path $fixture 'report.json'
  @'
param([string]$Extension, [string]$Control, [string]$Report)
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Expected a standard account; refusing to count elevated execution as acceptance.' }
& "$Extension/resources/windows/runtime/node.exe" "$Extension/scripts/diagnose-windows.cjs" --extension $Extension --control $Control --output $Report
$code = $LASTEXITCODE
if (Test-Path -LiteralPath $Report) {
  $result = Get-Content -LiteralPath $Report -Raw | ConvertFrom-Json
  $result | Add-Member -NotePropertyName standardUser -NotePropertyValue $true
  $result | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $Report -Encoding utf8NoBOM
}
exit $code
'@ | Set-Content -LiteralPath $childScript -Encoding utf8NoBOM
  $credential = [PSCredential]::new("$env:COMPUTERNAME\$account", $password)
  $arguments = @('-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $childScript + '"'), '-Extension', ('"' + $privateExtension + '"'), '-Control', ('"' + $fixture + '"'), '-Report', ('"' + $childReport + '"'))
  $process = Start-Process -FilePath (Join-Path $PSHOME 'pwsh.exe') -Credential $credential -LoadUserProfile -ArgumentList $arguments -WorkingDirectory $fixture -PassThru
  if (-not $process.WaitForExit(360000)) {
    $process.Kill($true)
    [void]$process.WaitForExit(5000)
    throw 'Standard-user Windows acceptance exceeded six minutes.'
  }
  if (Test-Path -LiteralPath $childReport) { Copy-Item -LiteralPath $childReport -Destination $Report }
  if ($process.ExitCode -ne 0) { throw "Standard-user Windows acceptance failed (exit $($process.ExitCode)); see the diagnostic report." }
  $result = Get-Content -LiteralPath $Report -Raw | ConvertFrom-Json
  if (-not $result.success -or $result.standardUser -ne $true) { throw 'Standard-user proof is incomplete.' }
  Write-Host 'Standard-user Windows LPAC, runtime I/O and write-denial acceptance passed.'
} finally {
  if ($process) { $process.Dispose() }
  if ($user) { Remove-LocalUser -SID $user.SID -ErrorAction Continue }
  if (Test-Path -LiteralPath $fixture) { Remove-Item -LiteralPath $fixture -Recurse -Force -ErrorAction Continue }
}
