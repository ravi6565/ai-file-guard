# Changelog

## 0.12.3 — Windows verification test candidate

- Separate slow Windows permission setup from bounded runtime execution and retain stage/timing diagnostics on verification errors.
- Avoid rewriting matching private-runtime DACLs; retain path, link and token checks.
- Retry failed verification without requiring a reload, and reject changed or incomplete private runtime caches on reuse.
- Harden the private libuv AppContainer patch against token-query errors and unbounded pipe-name retries. A new private runtime build and native Windows acceptance are required.
- Add a standalone Windows diagnostic report and explicit Windows Server 2022/2025 CI coverage. The reported client build 26300 still needs acceptance.
- Support clean local runtime builds without a CI-only temporary-directory variable.

## 0.12.2 — Marketplace resource-link correction

- Remove the optional Issues resource generated from bugs.email; Marketplace rejected its mailto URL. Keep public support and security contact details in the README and author metadata.
- Omit private-repository resource links to prevent VSCE from automatically generating an inaccessible issues URL. Keep the public developer profile as homepage.
- Validate generated resource links and reject unintended Issues/private-source metadata before accepting a release package. Protection behavior is unchanged.

## 0.12.1 — Marketplace homepage correction

- Replace the self-referencing Marketplace homepage URL with the developer’s public GitHub profile. The source repository remains private.
- Reject Marketplace listing URLs in release packaging and verify the packaged homepage matches the source manifest.
- Retain the stable release channel and the previously validated protection behavior.

## 0.12.0 — Windows/macOS stable release

- Publish the validated managed-terminal workflow on the stable release channel; disable Preview metadata and pre-release packaging.
- Provide separate Windows x64 and macOS Apple Silicon packages with checksums and runtime provenance validation.
- Preserve dynamic file/folder lock instructions, manual editing, live-policy application and native OS confinement for Protected AI Terminal processes. Ordinary external AI chat extensions remain outside enforcement.
- Include the Windows foreground-interruption fix: Ctrl+C stops the foreground command while the protected terminal remains usable.
- The developer reports successful preview acceptance. New stable payloads require their own installed-package checks before upload.

## 0.11.0 — native Windows/macOS preview candidate

- Set publisher identity to ravikiranv and add the developer's public support/security contact.
- Add Preview metadata and reproducible pre-release packaging. Update release, privacy, support and upgrade guidance without expanding enforcement claims to unrestricted AI extensions.
- Implement a Windows LPAC candidate using native APIs and a kill-on-close job, with no Docker/WSL dependency. Grants apply to private storage/runtime only. Real Windows acceptance remains required before publication.
- Build a private Windows Node.js/npm runtime from pinned upstream source with the libuv AppContainer child-pipe fix. Validate binary/archive hashes and runtime child I/O; never silently fall back to a stock host runtime. Windows acceptance is still required.
- Import saved locks once from the earlier local publisher identity, without modifying the old policy or reintroducing locks after unlock. Sessions, credentials and legacy permission records are not migrated; disable the old extension before using this preview.
- Prepare platform-specific VSIXs with SHA-256 sidecars, runtime-provenance checks and a manual deployment handoff. Reject substituted macOS home/temp roots; handle short Windows sharing violations without changing permissions or bypassing instruction conflict checks.
- Add a fresh-profile installed-VSIX acceptance runner. Correct a POSIX-only permission assertion on Windows and bound CI job duration; this does not add Windows enforcement support.

## 0.10.1 — dynamic AI instruction synchronization

- Reconnected lock/unlock to instruction synchronization for AGENTS.md, Copilot instructions, CLAUDE.md, and the shared INSTRUCTIONS.md reference. Folder rules cover all nested and future paths.
- Backfill saved locks at startup; synchronize shared policy changes across windows; retain nested scopes so the final unlock clears stale instructions. Update existing Codex AGENTS.override.md files too.
- Preserve custom text and file permissions. Report unsaved edits, malformed markers, symlink targets, and write errors; retry after save or with Sync AI Instructions. Recreate deleted generated instruction files.
- Preserve manual editing and the managed sandbox/apply boundary. Instructions are cooperative, existing chats may need restarting, and committed instruction sections are shared with other clones.

## 0.10.0 — managed macOS runtime (local acceptance)

- Implemented an OS-verified managed sandbox and Protected AI Terminal. Agent descendants cannot directly mutate original projects or authoritative policy; manual editor access remains unchanged.
- Restored Lock for AI after a successful runtime denial test. Scope is explicitly managed agents; arbitrary external AI extensions remain unconfined.
- Added isolated per-project agent homes, sanitized terminal environment, outbound provider connectivity and localhost control-service denial.
- Added directory creation/removal proposals, live lock/unlock checks, preview, and repeated application with safe baseline advancement.
- Verified real terminal writes, alias/child-process attempts, metadata tampering, protected proposals before/after unlock, outbound HTTPS and an isolated Codex CLI version invocation.
- Added the exact local-test workflow. Marketplace publication is deferred; macOS sandbox-exec deprecation and production compatibility/security gates remain explicit.

## 0.9.1 (safety correction; universal enforcement unavailable)

- Made Lock for AI refuse requests in every configuration without creating metadata-only locks or changing permissions.
- Preserved existing review policies while removing padlock badges and active-lock wording from their UI.
- Separated the review-policy command from Lock for AI; public status explicitly reports enforcement inactive.
- Documented the required controlled-agent architecture. This update does not implement universal AI write blocking.

## 0.9.0 (review build)

- Changed normal locks to machine-local review-broker policy with manual editing allowed. This is a breaking change from 0.8 filesystem-wide read-only locks.
- Removed automatic repository instruction/settings writes from lock/unlock. Restored recorded legacy permission controls while preserving user settings.
- Added shared local policy with atomic persistence, cross-window transactions, current-policy evaluation, and errors for corrupted or missing policy.
- Fixed ancestor delete/rename checks, symlink escapes, baseline inventory races, temporary-file collisions, executable permissions and audit queue recovery.
- Persisted review sessions; added multi-selection unlock, active-editor fallback and support for local files outside the open workspace.
- Replaced modal watcher recovery with optional origin-unknown audit events.
- Reported strict agent protection as unavailable and rejected new strict lock requests. Universal external-AI prevention is not implemented.
- Added regression tests and a complete architecture/security review with explicit production release gates.

## 0.8.2

- Scoped permission and editor read-only state to each workspace so opening another project cannot break existing locks.
- Migrated and cleaned stale 0.8.0/0.8.1 global permission and read-only state.
- Made lock and unlock transactional: failures restore both the lock manifest and filesystem enforcement.
- Canonicalized macOS workspace paths so folder locks and nested repositories work across `/var` and `/private/var` aliases.
- Made agent instruction adapters react to settings changes without requiring an extension reload.
- Added progress notifications and end-to-end coverage for repeated file locks and inherited folder locks.

## 0.8.1

- Added a real Extension Host lock/unlock round-trip test that verifies macOS write denial and permission restoration.
- Unlocking an inherited child now identifies the explicit parent-folder lock and offers to unlock it.
- Locking an already protected resource now explains whether protection is explicit or inherited.
- Added **AI File Guard: Repair Hard Locks** for migrated or interrupted installations.

## 0.8.0

- Replaced Advisory as the default with persistent Hard Lock semantics.
- Added VS Code `files.readonlyInclude` synchronization for locked files and recursive folders.
- Added recursive filesystem permission enforcement with exact original-mode restoration on unlock and restart.
- Added macOS user-immutable flags to block normal modification, deletion, rename, and replacement operations.
- Added transactional permission suspension for extension-authorized instruction updates.
- Added nearest nested-repository discovery so locks update the `AGENTS.md` Codex actually loads.
- Migrates existing Advisory workspace configuration to Hard Lock.

## 0.7.1

- Detect protected in-memory text-document edits made through VS Code before they reach the filesystem.
- Show a modal choice to keep an intentional developer edit or revert to the verified lock-time snapshot.
- Explain after locking that Advisory mode detects and recovers writes but cannot prevent them, and that a new Codex conversation is needed to load updated `AGENTS.md` instructions.

## 0.7.0

- Added Codex, Copilot, and generic instruction adapters with bounded managed sections.
- Added content-addressed snapshots, integrity monitoring, safe recovery, and JSONL audit events.
- Added brokered staging workspaces with protected-path evaluation and concurrent-change rejection.
- Added hard-link checks, nested path canonicalization, cross-platform CI, and security tests.
- Added marketplace, privacy, security, and user documentation.

Strict OS sandbox enforcement is not bundled. Enforced mode remains fail-closed and does not claim to secure independently running agents.

## 0.1.0

- Added the Phase 1–2 scaffold, lock persistence, policy evaluation, Explorer decorations, sidebar, and status UI.
