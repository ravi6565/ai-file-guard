# Release status — 0.12.2

AI File Guard 0.12.2 is prepared for the stable Marketplace channel under publisher
`ravikiranv`. The developer reports successful validation of the 0.11.0 preview.
Stable packages remove Preview labeling and pre-release metadata while preserving
the tested runtime behavior. New stable payloads must pass their own platform and
installed-VSIX checks. Public support/security contact: ravikiranv8919@gmail.com.

Build with `npm run package:release`. Targeted VSIX, SHA-256 and metadata sidecars
go to `artifacts/`. Follow `DEPLOYMENT.md` for acceptance and upload. Windows x64
requires the compatible private runtime built by CI, including its upstream
LICENSE and provenance hashes. macOS Apple Silicon packages exclude Windows
resources. No Docker/WSL dependency is required.

## Release qualification

- Keep the publisher ID, version 0.12.2, target and stable channel consistent in both platform packages.
- Run type checks, unit/service regressions, native OS-denial tests, actual protected-terminal checks and installed-package acceptance on each supported host.
- Verify lock/unlock, recursive folder policy, dynamic instructions, manual editing, preview/apply and persistence.
- Publish the exact tested VSIX files and check Marketplace validation. Do not upload the old preview packages.
- Disable the earlier local publisher extension before upgrading; verify imported locks before removing its data. Credentials, sessions and old permission records do not migrate.

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
