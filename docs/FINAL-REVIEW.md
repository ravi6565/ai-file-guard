# Release review — 0.11.0 candidate

Status: NOT APPROVED for Marketplace publication until the Windows native and installed-package gates pass. This report distinguishes local evidence from pending host/provider acceptance.

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

## Evidence and gates

- TypeScript and unit/service tests pass locally; native tests skipped on another OS are not evidence.
- macOS native enforcement passes locally. Installed VSIX tests passed before adding the Windows backend; the final combined artifact must be retested.
- Windows LPAC tests are authored but have not yet run on a Windows host. They must compile the native helper and prove token state, write/create/delete/rename/replacement denial, child confinement, junction/hard-link rejection, local control-service denial and live locked-folder application before/after unlock.
- Actual signed-in Codex/Copilot/Claude CLI tasks require provider account acceptance; no model task has been performed by this release preparation.
- Audit the final VSIX metadata, native resource inclusion, privacy/security text, and absence of local credentials/policy before upload.

## Remaining limitations

- No universal interception of external AI processes; all protected execution must use the managed path.
- Windows LPAC backend and CLI compatibility remain unqualified until host acceptance passes. Node.js/npm and the Windows .NET Framework compiler are prerequisites.
- macOS sandbox-exec is deprecated. Independent security review and long-term OS compatibility remain open.
- A crashed policy lease can require manual recovery while all other extension windows are closed. Automatic stale-lease recovery is not implemented.
- Rename proposals are independent create/delete operations; grouped rollback and file/directory kind conversion are not implemented.
- The broker has narrow races against malicious unrestricted host processes, which already lie outside the managed boundary. Trusted developer changes and normal content conflicts remain guarded by optimistic checks.
