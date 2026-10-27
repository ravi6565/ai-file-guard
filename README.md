# AI File Guard

**Windows x64 + macOS Apple Silicon · Version 0.12.3 test candidate · Publisher: ravikiranv · Support: [ravikiranv8919@gmail.com](mailto:ravikiranv8919@gmail.com)**

AI File Guard 0.12 combines local file/folder locks, synchronized agent instructions, and native managed AI terminals. Your normal editor stays writable. AI tools launched in **Protected AI Terminal** cannot write original projects directly; the apply service rejects changes to locked originals.

**Use the Protected AI Terminal for protection. Ordinary Codex, Copilot or Claude chat extensions in your unrestricted VS Code window are outside this boundary. This extension does not intercept those sessions.**

Release targets are local VS Code desktop on macOS and Windows, with no Docker or WSL dependency. macOS uses `sandbox-exec`; Windows uses a native less-privileged AppContainer (LPAC) and a kill-on-close process job. Every machine must pass native token/write-denial verification; failed isolation never falls back to an unrestricted terminal. Native Windows, real-terminal and installed-VSIX checks pass on hosted Windows CI. Signed-in provider workflows still require local acceptance. Linux and remote/browser workspaces have no supported enforcement backend. Generated instruction files provide cooperative guidance, not universal AI write blocking. Independent security review and signed-in provider acceptance remain open.

Windows 0.12.2 has a reported verification timeout on build 26300. The hosted release passed on Windows Server build 26100. Corrections in this working tree still need a new runtime build and native acceptance on the affected PC; see the [Windows review and diagnostic procedure](docs/WINDOWS-REVIEW-2026-10-27.md).

On Windows, the .NET Framework compiler bundled with Windows builds the launcher locally. The Windows x64 package includes a private Node.js/npm runtime with the upstream AppContainer pipe fix; it does not replace your installed Node. Untested stock runtimes are not used as a fallback. Windows code grants access only to private copies/home/temp and runtime files; it does not change original-project permissions. No administrator elevation or loopback exemptions are requested. Windows uses the OS internet-client network capability rather than the macOS CONNECT proxy. Windows tests cover child processes, aliases, long paths and host-control denial. Codex 0.164.0 installation/version smoke passed inside LPAC without sign-in or a model request.

If upgrading from the earlier local build (`ai-file-guard.ai-file-guard`), disable it before enabling `ravikiranv.ai-file-guard`. On first activation, saved local locks are imported from its storage in the same VS Code profile; later unlocks are not re-imported. Verify the imported locks before uninstalling the old extension or deleting its data. Existing terminals, review sessions, agent credentials and old permission records are not migrated. Close old terminals and start a new Protected AI Terminal; sign in there again as needed. If upgrading from a 0.8 build with filesystem locks, use its Restore Legacy File Permissions command before removing it.

## Local test workflow

1. Install the VSIX and reload the VS Code window.
2. Right-click an original file/folder and choose **Lock for AI**. This first requires a successful OS write-denial self-test.
3. Run **AI File Guard: Open Protected AI Terminal**. Run your AI CLI in that terminal against its working copy.
4. Run **AI File Guard: Preview Agent Changes**, then **Review and Apply Agent Changes** from the original window. Locked proposals are rejected.
5. **Unlock for AI** permits subsequent proposals for that resource. The service checks current locks, including changes made after the terminal started.

Agents can propose edits in their copy; those are not edits to the locked original. Direct absolute-path writes to originals are denied by the OS. Manual editor/filesystem operations remain allowed.

See `docs/LOCAL-TEST.md` for a reproducible file/folder test and CLI setup.

## What is enforced

The macOS profile starts with deny-by-default permissions. It permits writes only inside the agent copy, a separate per-project agent home, and session temporary storage. Child processes inherit the restriction. Shell/Git writes to originals and policy-file tampering are denied. General TCP and host control-service access are not granted. On macOS, provider HTTPS uses a dedicated CONNECT proxy that accepts public hostnames on port 443, rejects private/loopback destinations, and pins validated IPv4 addresses. CLIs must support standard HTTP(S)_PROXY settings. No arbitrary editor IPC, UNIX socket access, Apple Events or incoming network listeners are granted to the macOS child.

The trusted extension-host service applies checked proposals. It checks live policy under a shared cross-window lease, symlink/junction containment, staged hashes and concurrent developer edits. It handles file writes/creates/deletes and directory creation/removal, and supports repeated application within a session.

Locks, source copies, profiles, audit data and agent credentials remain in local extension storage, outside Git and Settings Sync. Cloning a repository does not transfer the authoritative local lock database.

## Dynamic AI instructions (0.10.1)

**Lock for AI** and **Unlock for AI** now also synchronize managed sections in `AGENTS.md` (Codex), `.github/copilot-instructions.md` (Copilot), `CLAUDE.md` (Claude Code), and `.ai-file-guard/INSTRUCTIONS.md` (shared reference). A folder entry covers the folder itself and every existing or future descendant at every depth. Unlock removes the applicable entry while retaining other explicit locks. Existing project instructions outside the managed section are preserved.

Saved locks are synchronized on startup, changes from other windows are picked up automatically, and nested Git/instruction scopes along locked paths are updated too. Existing `AGENTS.override.md` files also receive the section because Codex gives them precedence. **AI File Guard: Sync AI Instructions** can retry synchronization manually. Unsaved instruction edits and malformed managed markers produce an explicit error; saving an instruction file retries automatically. Settings under `aiFileGuard.adapters` select the providers.

Instruction files are cooperative guidance, not write interception. Other agents must be configured to read an appropriate instruction file; there is no universal instruction filename. Restart existing Codex sessions after changing locks: [Codex discovers its instructions when a session starts](https://learn.chatgpt.com/docs/agent-configuration/agents-md). The managed terminal/apply service continues to enforce live policy independently of these instructions.

These instruction projections are ordinary repository files. Committing their managed sections shares those instructions with other clones. Keep local sections out of commits if your locks must remain private; ignoring a file does not hide changes to an already tracked file. The extension does not modify `.gitignore`, Git index flags, or `.vscode/settings.json`.

## Scope and requirements

Native macOS and Windows runtime checks must pass; unsupported platforms never launch an unconfined fallback. Apple marks `sandbox-exec` deprecated, so support must be revalidated on OS updates. Windows x64 requires functioning LPAC APIs, .NET Framework 4.8 with its compiler, built-in tar.exe, and the compatible private runtime included in the tested Windows package. No Windows support claim is established by macOS-only tests.

The profile can read local files. Provider tools can send data using outbound networking according to their own behavior. Do not connect external privileged services that can write originals on an agent's behalf.

This is not universal control over arbitrary programs using your normal account. All protected AI work must use the managed execution path. A separate VS Code profile by itself does not supply isolation.

## Development

```sh
npm ci
npm run lint
npm run test:unit
node --test scripts/test-windows-diagnostics.cjs
npm run test:sandbox
npm run test:integration
npm run package:release
```

Native tests require the corresponding supported host and an execution context permitted to launch its OS sandbox. Windows tests also require the generated private runtime; see resources/windows/RUNTIME.md. Unit tests do not count skipped native tests as proof. The optional `dist/test/checkManagedNetwork.js` diagnostic verifies public npm DNS/HTTPS; setting `AI_FILE_GUARD_CLI_SMOKE=1` additionally installs/runs Codex CLI only in a temporary sandbox home, without a model request or sign-in.

Build the Marketplace candidate with `npm run package:release`. It writes the host-targeted VSIX, SHA-256 checksum and metadata to `artifacts/`; Windows packaging validates the bundled compatible runtime and macOS packages exclude Windows binaries. See `docs/DEPLOYMENT.md` for exact acceptance and manual-upload steps. Packages use the stable release channel with Preview labeling disabled. Platform-specific release artifacts must be packaged and tested on their supported hosts; a universal candidate is not proof of cross-platform enforcement. Publishing remains a manual action after both native acceptance gates pass. A build passing local checks is not a security certification or proof of every provider's signed-in workflow.

## Privacy and support

AI File Guard does not call a model or upload source itself. Local policy, copies, audits and isolated agent credentials remain in extension storage; uninstalling may leave them behind. Agent tools may read local files and send data to their providers. Generated instruction files contain relative locked paths and can be read by those tools or shared through Git if committed. Keep local instruction sections out of commits when they must stay private.

For support or private vulnerability reports, email [ravikiranv8919@gmail.com](mailto:ravikiranv8919@gmail.com). Do not include credentials or sensitive project content. The source repository is private; email is the public support route. The optional Issues and Repository links are omitted from Marketplace metadata because there is no public issue tracker.
