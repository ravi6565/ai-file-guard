# AI File Guard

Version 0.10 adds a working macOS managed-agent sandbox and file/folder lock workflow. Your normal editor stays writable. AI tools launched in **Protected AI Terminal** cannot write original projects directly; the apply service rejects changes to locked originals.

**Use the Protected AI Terminal for protection. Ordinary Codex, Copilot or Claude chat extensions in your unrestricted VS Code window are outside this boundary. This extension does not intercept those sessions.**

## Local test workflow

1. Install the VSIX and reload the VS Code window.
2. Right-click an original file/folder and choose **Lock for AI**. This first requires a successful OS write-denial self-test.
3. Run **AI File Guard: Open Protected AI Terminal**. Run your AI CLI in that terminal against its working copy.
4. Run **AI File Guard: Preview Agent Changes**, then **Review and Apply Agent Changes** from the original window. Locked proposals are rejected.
5. **Unlock for AI** permits subsequent proposals for that resource. The service checks current locks, including changes made after the terminal started.

Agents can propose edits in their copy; those are not edits to the locked original. Direct absolute-path writes to originals are denied by the OS. Manual editor/filesystem operations remain allowed.

See `docs/LOCAL-TEST.md` for a reproducible file/folder test and CLI setup.

## What is enforced

The macOS profile starts with deny-by-default permissions. It permits writes only inside the agent copy, a separate per-project agent home, and session temporary storage. Child processes inherit the restriction. Shell/Git writes to originals and policy-file tampering are denied. General TCP and host control-service access are not granted. Provider HTTPS uses a dedicated CONNECT proxy that accepts public hostnames on port 443, rejects private/loopback destinations, and pins validated IPv4 addresses. CLIs must support standard HTTP(S)_PROXY settings. No arbitrary editor IPC, UNIX socket access, Apple Events or incoming network listeners are granted to the child.

The trusted extension-host service applies checked proposals. It checks live policy under a shared cross-window lease, symlink/junction containment, staged hashes and concurrent developer edits. It handles file writes/creates/deletes and directory creation/removal, and supports repeated application within a session.

Locks, source copies, profiles, audit data and agent credentials remain in local extension storage, outside Git and Settings Sync. Cloning a repository does not transfer the authoritative local lock database.

## Dynamic AI instructions (0.10.1)

**Lock for AI** and **Unlock for AI** now also synchronize managed sections in `AGENTS.md` (Codex), `.github/copilot-instructions.md` (Copilot), `CLAUDE.md` (Claude Code), and `.ai-file-guard/INSTRUCTIONS.md` (shared reference). A folder entry covers the folder itself and every existing or future descendant at every depth. Unlock removes the applicable entry while retaining other explicit locks. Existing project instructions outside the managed section are preserved.

Saved locks are synchronized on startup, changes from other windows are picked up automatically, and nested Git/instruction scopes along locked paths are updated too. Existing `AGENTS.override.md` files also receive the section because Codex gives them precedence. **AI File Guard: Sync AI Instructions** can retry synchronization manually. Unsaved instruction edits and malformed managed markers produce an explicit error; saving an instruction file retries automatically. Settings under `aiFileGuard.adapters` select the providers.

Instruction files are cooperative guidance, not write interception. Other agents must be configured to read an appropriate instruction file; there is no universal instruction filename. Restart existing Codex sessions after changing locks: [Codex discovers its instructions when a session starts](https://learn.chatgpt.com/docs/agent-configuration/agents-md). The managed terminal/apply service continues to enforce live policy independently of these instructions.

These instruction projections are ordinary repository files. Committing their managed sections shares those instructions with other clones. Keep local sections out of commits if your locks must remain private; ignoring a file does not hide changes to an already tracked file. The extension does not modify `.gitignore`, Git index flags, or `.vscode/settings.json`.

## Scope and requirements

This local build supports macOS with a functioning `sandbox-exec` runtime. Runtime and profile checks must pass; unsupported platforms never launch an unconfined fallback. Apple marks this interface deprecated, so support must be revalidated on OS updates.

The profile can read local files. Provider tools can send data using outbound networking according to their own behavior. Do not connect external privileged services that can write originals on an agent's behalf.

This is not universal control over arbitrary programs using your normal account. All protected AI work must use the managed execution path. A separate VS Code profile by itself does not supply isolation.

## Development

```sh
npm ci
npm run lint
npm run test:unit
npm run test:sandbox
npm run test:integration
npm run package
```

Native tests require macOS and an execution context permitted to launch the OS sandbox. Unit tests do not count skipped native tests as proof. The optional `dist/test/checkManagedNetwork.js` diagnostic verifies public npm DNS/HTTPS; setting `AI_FILE_GUARD_CLI_SMOKE=1` additionally installs/runs Codex CLI only in a temporary sandbox home, without a model request or sign-in.

Marketplace publication is deferred for local testing. Production release still requires broader platform/provider acceptance, lease crash recovery, security review and publisher metadata.
