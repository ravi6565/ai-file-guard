# Release review — 0.11.0 candidate

Status: NOT APPROVED for Marketplace publication. Windows native/installed-package gates and the developer's signed-in provider acceptance remain open. This report distinguishes executed checks from pending acceptance.

## Open release blockers

1. Windows qualification: the private runtime build succeeded and fixes the stock Node AppContainer pipe loop ([upstream issue](https://github.com/nodejs/node/issues/66374)). Seven native checks, including child write denial, shell/npm, HTTPS and host-control denial, now pass. The deep-profile/long-path case and real VS Code terminal/installed-VSIX gates still require successful verification. Platform packages are not approved from skipped or partially passing tests.
2. Signed-in provider workflows: CLI installation/version smoke tests do not establish a working Codex/Copilot/Claude model task. Verify the supported provider workflow locally before advertising it. Ordinary AI chat extensions remain outside enforcement.

## Scope

- Publisher: ravikiranv; public support/security contact: ravikiranv8919@gmail.com.
- Requested targets: local Windows and macOS VS Code, without Docker/WSL.
- Enforcement applies to the controlled AI terminal and live-policy apply service. Ordinary unrestricted AI extensions remain outside this boundary; generated instructions are cooperative.

## Corrections made in review

- Imported legacy publisher locks once without modifying old policy or reintroducing removed locks. Existing review sessions, credentials and legacy permission records are not silently migrated.
- Protected Codex overrides and differently cased instruction-policy names from broker proposals.
- Corrected the LPAC process attribute against Microsoft's SDK: input attribute 15, not desktop-app-policy attribute 18. The native probe additionally requires a real AppContainer and LPAC token.
- Replaced POSIX-only permission assumptions on Windows. Added a native test runner that works with both operating systems' shells.
- Added installed-VSIX tests using a fresh temporary profile and the running package's capability state.
- Updated publisher/contact, privacy, supported workflow and candidate status. Generated local metadata, packages, dependencies and test installations remain excluded from Git.
- Updated vulnerable development-tool dependencies. Scoped overrides keep VSCE on Azure Identity 4.13.0 (avoiding the affected MSAL 5–7.0 line) with patched CommonJS UUID, and Mocha on patched diff/serialize-javascript. These tools are not shipped as extension runtime dependencies. Revisit the overrides when upstream dependency ranges are fixed; CLI publisher authentication is not part of the manual-upload acceptance.

## Evidence and gates

- TypeScript and unit/service tests pass locally; native tests skipped on another OS are not evidence.
- macOS native enforcement (8 cases) and all 17 installed-VSIX tests pass on both current stable VS Code 1.143.1 and the declared minimum family (1.95.3) on macOS Apple Silicon. TypeScript checks and 50 local unit/service cases pass. After development-tool fixes, npm audit reports zero known vulnerabilities in the extension build/test dependency graph; the extension has no production npm dependencies.
- Windows native tests have run on hosted Windows CI. Live locked-folder application/unlock, loopback denial, junction/hard-link rejection and unchanged original ACLs passed. Named-pipe control denial now passes. The private runtime fixes the upstream child-pipe loop; shell/npm and public HTTPS also pass. The complete Windows long-profile and installed-VSIX gates have not yet passed.
- Actual signed-in Codex/Copilot/Claude CLI tasks require provider account acceptance; no model task has been performed by this release preparation.
- Audit the final VSIX metadata, native resource inclusion, privacy/security text, and absence of local credentials/policy before upload.

## Remaining limitations

- No universal interception of external AI processes; all protected execution must use the managed path.
- Windows LPAC backend and CLI compatibility remain unqualified until host acceptance passes. The Windows package requires its compatible private Node runtime, .NET Framework 4.8 with its compiler, and built-in tar.exe.
- macOS sandbox-exec is deprecated. Independent security review and long-term OS compatibility remain open.
- A crashed policy lease can require manual recovery while all other extension windows are closed. Automatic stale-lease recovery is not implemented.
- Rename proposals are independent create/delete operations; grouped rollback and file/directory kind conversion are not implemented.
- The broker has narrow races against malicious unrestricted host processes, which already lie outside the managed boundary. Trusted developer changes and normal content conflicts remain guarded by optimistic checks.
