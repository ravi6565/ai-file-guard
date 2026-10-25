# User guide — 0.11 Windows/macOS preview candidate

## Lock and unlock

Right-click an original local file or folder and choose **Lock for AI**. A successful native sandbox self-test is required. Manual editor/filesystem access stays writable. Protection is enforced for agents launched in **AI File Guard: Open Protected AI Terminal** and proposals checked by the apply service; ordinary unrestricted AI chat panels are not confined.

Folder locks cover all current and future nested files and folders. The separate **Add Review Broker Policy (Does Not Block AI)** command can save application policy without claiming OS confinement. UI status distinguishes a verified managed sandbox from unavailable enforcement.

Use **Unlock for AI** in Explorer or the Managed AI Locks sidebar. Multiple selections are supported. Unlocking an inherited child requires confirmation to unlock its covering resource; explicit child/other ancestor entries remain. A lock for a file deleted manually can still be removed.

Authoritative local policy is shared across windows of the same VS Code profile, outside projects and Settings Sync. Lock/unlock also updates managed sections in AGENTS.md, existing AGENTS.override.md, Copilot instructions, CLAUDE.md, and the shared INSTRUCTIONS.md reference. Existing custom text is preserved. Instruction projections are ordinary project files and can be shared through Git if committed. Restart existing AI sessions to load changed instructions; these files are cooperative guidance, not enforcement.

## Apply agent changes through review

Run **Open Protected AI Terminal**, choose the project if multiple roots are open, and run your AI CLI in its sandboxed working copy. Original-file writes are OS-denied to that process and its descendants. In the original window, run **Preview Agent Changes**, then **Review and Apply Agent Changes** and confirm the batch. Locked original paths are rejected; unlock to allow subsequent applications if developer-content checks pass.

The broker checks current locks, including changes after the copy was created. It rejects protected creates/writes/deletes, nested instruction-policy changes, symlink/junction paths, traversal and concurrent edits to originals. File changes and directory creation/removal are supported. Renames appear as separate create/delete proposals; atomic rename grouping and file/directory kind conversion are not supported. Independent allowed changes can succeed while others are rejected.

**Create Brokered Agent Workspace** is a separate review-only workflow: its copy does not independently prevent absolute-path or shell writes. Use Protected AI Terminal for the managed OS boundary.

## Commands and diagnostics

**Show Status** reports the actual capability and local policy location. **Open Local Lock Policy** opens the machine-local JSON for inspection; prefer lock/unlock commands to editing this file.

**Sync AI Instructions** retries instruction synchronization. Save dirty instruction files first; malformed markers, unsafe symlink targets and write errors are reported without discarding local policy. **Verify Managed Sandbox** repeats the native write-denial probe.

**Restore Legacy File Permissions** retries restoration of recorded 0.8 permissions and read-only patterns. It preserves current local policy. If a file had its own pre-existing read-only/immutable protection, restoring its original state does not remove that independent protection.

Optional monitoring is off by default. Enable it in user settings and reload to audit file changes. The audit labels their origin unknown, since a watcher cannot distinguish a developer from AI.

## Upgrade and Git behavior

0.9 restores recorded 0.8 filesystem locks so manual editing works. Older workspace locks are imported once into local policy when each workspace is opened. Opening another workspace does not reset shared policy.

The Marketplace identity is `ravikiranv.ai-file-guard`. Disable the previous `ai-file-guard.ai-file-guard` local extension first. Verify the imported locks before uninstalling it or deleting its storage. Saved policy imports once from its storage in the same VS Code profile; subsequent unlocks are not re-imported. Existing sessions, credentials and legacy permission records do not migrate. Close old terminals and start a fresh protected terminal; sign in there as needed. For 0.8 filesystem-lock builds, restore legacy permissions using the old extension before removing it.

Keep generated local instruction sections out of commits when collaborators must not inherit them. This repository's ignore rules do not automatically apply to other projects where you use the extension.

Local Windows and macOS are release targets, with native and installed-VSIX acceptance passing on both platforms; signed-in provider acceptance is still required. No Docker or WSL is used. The Windows x64 package requires the .NET Framework 4.8 compiler and built-in tar.exe; its compatible private Node.js/npm runtime is included, and host Node is not used as a fallback. The macOS sandbox interface is deprecated by Apple; signed-in provider acceptance, independent security review and long-term OS support remain open. See `LOCAL-TEST.md` and `STRICT-PROTECTION.md` for the exact workflow. Support and private security reports: ravikiranv8919@gmail.com.
