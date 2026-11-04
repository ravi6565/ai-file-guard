# Windows 0.12.3 test candidate

Install `ai-file-guard-0.12.3-win32-x64.vsix` through VS Code's **Extensions:
Install from VSIX**, then reload all VS Code windows using AI File Guard. This
is a local test candidate; Marketplace publication is a separate step.

1. Run **AI File Guard: Verify Managed Sandbox**. The first check may take longer
   while Windows prepares private runtime permissions. No administrator access,
   Docker, WSL, or loopback exemption is required.
2. Lock a disposable file, then a folder containing nested files. Confirm manual
   editor saves still work.
3. Open **AI File Guard: Open Protected AI Terminal**. Check `node --version`
   and `npm --version`. Test your AI CLI from that terminal.
4. Attempt an absolute-path write to a locked original; it must be denied.
   Proposals in the private copy may change, but **Review and Apply Agent
   Changes** must reject locked originals.
5. Unlock, apply the same proposal, and confirm it succeeds. Reload VS Code and
   check that remaining locks persist.

If verification fails, retain the complete error and run the bundled diagnostic
from a normal PowerShell terminal. Replace the example extension directory with
the installed 0.12.3 Windows extension directory:

```powershell
$extension = 'C:\Users\YOUR_NAME\.vscode\extensions\ravikiranv.ai-file-guard-0.12.3-win32-x64'
& "$extension\resources\windows\runtime\node.exe" "$extension\scripts\diagnose-windows.cjs" --extension "$extension" --output "$env:USERPROFILE\Desktop\ai-file-guard-windows.json"
```

The runner tests disposable files, records Windows build/runtime hashes, and
checks startup, child-process I/O, original-write denial and cold/warm behavior.
The JSON report helps distinguish slow permission setup from a runtime failure.
The original build-26300 incident is resolved only after successful acceptance
on the affected PC. See [the technical review](WINDOWS-REVIEW-2026-10-27.md).
