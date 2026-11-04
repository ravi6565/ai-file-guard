# Release status — 0.12.3

**Automated acceptance passed:** [CI run 41848429599](https://github.com/ravi6565/ai-file-guard/actions/runs/41848429599), source commit `81a4a8e6ceadf8fe34c049256ef82c1f6087c079`, passed all eight OS/Node jobs and runtime preparation on 4 November 2026. This includes both Windows versions, non-administrator execution, ignored child/grandchild streams, final npm security updates, native checks and installed VSIX acceptance. Publication remains subject to the affected-PC/provider workflow test.

AI File Guard 0.12.3 is a release candidate under publisher `ravikiranv`.
It corrects Windows verification, runtime pipe handling, failure recovery and
diagnostics. This is a changed native payload, so earlier release passes do not
qualify it. Require native and installed-VSIX checks, standard-user Windows
acceptance and a successful retest on the reported build-26300 PC before upload.
Public support/security contact: ravikiranv8919@gmail.com.

Build with `npm run package:release`. Targeted VSIX, SHA-256 and metadata sidecars
go to `artifacts/`. Follow `DEPLOYMENT.md` for acceptance and upload. Windows x64
requires the compatible private runtime built by CI, including its upstream
LICENSE and provenance hashes. macOS Apple Silicon packages exclude Windows
resources. No Docker/WSL dependency is required.

## Release qualification

- Keep the publisher ID, version 0.12.3, target and stable channel consistent in both platform packages.
- Run type checks, unit/service regressions, native OS-denial tests, actual protected-terminal checks and installed-package acceptance on each supported host.
- Verify lock/unlock, recursive folder policy, dynamic instructions, manual editing, preview/apply and persistence.
- Publish the exact tested VSIX files and check Marketplace validation. Do not upload the old preview packages.
- Disable the earlier local publisher extension before upgrading; verify imported locks before removing its data. Credentials, sessions and old permission records do not migrate.
- Retain the CI run, exact source commit, runtime provenance and installed-package checksums. See `WINDOWS-TEST-0.12.3.md` for the affected-PC test.

## Continuing support and security work

Enforcement covers Protected AI Terminal processes and the trusted apply service.
Ordinary external AI extensions remain unrestricted; instruction files are
cooperative. Account/model workflows depend on the chosen provider; automated
smoke tests establish installation/startup, not signed-in model execution.

Independent security review, long-term replacement of deprecated macOS
sandbox-exec, safe stale-lease recovery, grouped rename semantics and broader
provider/OS compatibility remain open. Current limitations are documented in
SECURITY.md and the local test guide. The stable release channel does not certify
universal interception or remove these limitations. Linux enforcement is unsupported.
