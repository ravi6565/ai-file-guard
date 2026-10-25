# Release review — 0.11.0 candidate

Status: PREPARED for local pre-release acceptance. All automated platform/package gates passed in [review CI](https://github.com/ravi6565/ai-file-guard/actions/runs/40167753578). Marketplace publication remains pending the developer's signed-in provider acceptance. No model task, Marketplace upload or production security certification has been performed.

## Remaining acceptance

Install the exact prepared VSIX on your device and run a signed-in AI CLI task using `LOCAL-TEST.md`. CLI installation/version tests establish startup, not a complete authenticated model workflow. Ordinary AI chat extensions remain outside enforcement. Publishing is a separate manual step described in `DEPLOYMENT.md`.

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
- Rejected macOS home/temp symlink substitution before granting write roots. Initialized provider state from inside the confined child. Added Windows sharing retries with conflict/dirty-buffer checks before each instruction replacement.
- Updated publisher/contact, privacy, supported workflow and candidate status. Generated local metadata, packages, dependencies and test installations remain excluded from Git.
- Updated vulnerable development-tool dependencies. Scoped overrides keep VSCE on Azure Identity 4.13.0 (avoiding the affected MSAL 5–7.0 line) with patched CommonJS UUID, and Mocha on patched diff/serialize-javascript. These tools are not shipped as extension runtime dependencies. Revisit the overrides when upstream dependency ranges are fixed; CLI publisher authentication is not part of the manual-upload acceptance.

## Evidence and gates

- TypeScript and unit/service tests pass locally; native tests skipped on another OS are not evidence.
- macOS native enforcement (9 cases) and all 17 installed-VSIX tests pass on both current stable VS Code 1.143.1 and the declared minimum family (1.95.3) on macOS Apple Silicon. TypeScript checks and 50 local unit/service cases pass. After development-tool fixes, npm audit reports zero known vulnerabilities in the extension build/test dependency graph; package.json declares only development dependencies; Windows separately bundles a private Node/npm runtime.
- Windows native tests have run on hosted Windows CI. Live locked-folder application/unlock, loopback denial, junction/hard-link rejection and unchanged original ACLs passed. Named-pipe control denial now passes. The private runtime fixes the upstream child-pipe loop; shell/npm and public HTTPS also pass. Both Windows Node 22/24 CI jobs passed native and installed-package acceptance. The confined CLI smoke installed and started Codex 0.164.0 without signing in or calling a model.
- Actual signed-in Codex/Copilot/Claude CLI tasks require provider account acceptance; no model task has been performed by this release preparation.
- Packaging now emits platform-specific VSIXs with SHA-256 and metadata sidecars, validates Windows runtime provenance, excludes Windows resources from macOS, and excludes local policies, test/dependency installations and development review reports. Keep the exact tested file for upload.

## Remaining limitations

- No universal interception of external AI processes; all protected execution must use the managed path.
- Windows LPAC native, real-terminal and installed-VSIX gates pass on hosted Windows CI. Local signed-in provider acceptance remains required. The Windows package requires its compatible private Node runtime, .NET Framework 4.8 with its compiler, and built-in tar.exe.
- macOS sandbox-exec is deprecated. Independent security review and long-term OS compatibility remain open.
- A crashed policy lease can require manual recovery while all other extension windows are closed. Automatic stale-lease recovery is not implemented.
- Rename proposals are independent create/delete operations; grouped rollback and file/directory kind conversion are not implemented.
- The broker has narrow races against malicious unrestricted host processes, which already lie outside the managed boundary. Trusted developer changes and normal content conflicts remain guarded by optimistic checks.
