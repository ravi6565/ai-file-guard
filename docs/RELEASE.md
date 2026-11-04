# Release status — 0.12.3

**Publication pending affected-PC acceptance:** the rebuilt runtime passed all
eight matrix jobs in CI run 41693923880, including ignored child streams,
non-administrator execution and installed VSIX acceptance on Windows 2022/2025.
Keep those tests enabled. The final npm security updates and strengthened startup
verification must pass a fresh full CI run before delivering the candidate.

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
