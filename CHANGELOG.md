# Changelog

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
