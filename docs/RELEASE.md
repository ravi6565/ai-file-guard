# Release status

0.11.0 targets a native Windows/macOS preview for publisher `ravikiranv`, not a universal-security certification. Public support/security contact: ravikiranv8919@gmail.com. Windows LPAC is implemented as a candidate and must pass native Windows tests and the real VS Code terminal tests before publication. Marketplace upload is performed manually after package validation and user acceptance.

Build with `npm run package:preview`. The platform-specific VSIX, SHA-256 and metadata sidecars go to `artifacts/`. Follow `DEPLOYMENT.md` for the local-acceptance and manual-upload handoff. Windows x64 packaging requires the private runtime artifact built by CI (or scripts/build-windows-runtime.ps1); packaging without it cannot provide a working Windows protected terminal. Include its upstream LICENSE and runtime.json hashes. A host-specific candidate can be built using `npm run package:preview -- --target darwin-arm64` or `--target win32-x64`. Packages must contain the new publisher ID, Preview flag, pre-release property and current privacy/security documentation. Run `npm run test:vsix -- <candidate.vsix>` on the corresponding host before uploading. The previous local build uses a different extension ID; disable it first. Local policy imports once from its storage in the same profile, but sessions, credentials and old permission records do not migrate. No Docker or WSL dependency is permitted for this release.

Local gates include type checks, unit/service regressions, native OS-denial tests, actual VS Code protected-terminal verification, directory operations, repeated apply/concurrency checks, outbound DNS/HTTPS, and isolated Codex CLI installation/version smoke testing. Model sign-in and real provider tasks require user account acceptance.

Before production publication:

- Validate the packaged VSIX in the user's installed profile and all supported provider workflows.
- Resolve sandbox-exec deprecation/long-term OS support and obtain an independent security review.
- Pass the Windows native and installed-package gates before advertising Windows enforcement; Linux has no backend.
- Add safe stale-lease recovery, grouped rename behavior and stronger batch/failure semantics.
- Test OS updates, Unicode/case aliases, inherited handles, external-service bypass and malicious host-process races.
- Keep publisher, repository and support/security-contact metadata current. The publisher ID/contact were supplied by the developer; Marketplace account ownership/validation is performed by the portal.
- Keep the managed-agent scope explicit in Marketplace descriptions. Never claim arbitrary external AI sessions are restricted.

A configured CI matrix is not proof that those external platforms or provider tasks passed.
