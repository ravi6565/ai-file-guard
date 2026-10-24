# User guide

## Lock and unlock

In 0.9.1, **Lock for AI** is unavailable and returns an explicit error without creating policy or changing file permissions. This applies to every configuration, including Review. No file is claimed to be protected from arbitrary AI writes.

The separate **Add Review Broker Policy (Does Not Block AI)** command and existing 0.9.0 policies support the review workflow only. A folder policy covers every descendant during broker application. Manual file writes, creation, renaming and deletion remain allowed. The status bar says **AI protection unavailable**. Saved policies use warnings, not padlocks.

Use **Remove Saved Review Policy** in Explorer or the Review Policies sidebar to remove an existing policy. Multiple selections are supported. Removing a covering policy requires confirmation; explicit child/other ancestor entries remain. A policy for a file deleted manually can still be removed.

Local policy is shared across windows of the same VS Code profile. Reopening a parent/subfolder does not lose it. New policy never goes into a project or Settings Sync.

## Apply agent changes through review

Run **Create Brokered Agent Workspace**, choose the project if multiple roots are open, and use the returned copy for the agent. In the original window, run **Review and Apply Agent Changes** and confirm the batch.

The broker checks current locks, including locks changed after the copy was created. It rejects protected creates/writes/deletes, nested instruction-policy changes, symlink/junction paths, traversal and concurrent edits to originals. File-content changes are supported; empty directories, metadata-only edits and explicit rename preservation are not represented. Renames appear as create/delete proposals.

The agent must be independently confined if strict protection is required. A copy does not prevent absolute-path or shell writes to originals.

## Commands and diagnostics

**Show Status** reports the actual capability and local policy location. **Open Local Lock Policy** opens the machine-local JSON for inspection; prefer lock/unlock commands to editing this file.

**Restore Legacy File Permissions** retries restoration of recorded 0.8 permissions and read-only patterns. It preserves current local policy. If a file had its own pre-existing read-only/immutable protection, restoring its original state does not remove that independent protection.

Optional monitoring is off by default. Enable it in user settings and reload to audit file changes. The audit labels their origin unknown, since a watcher cannot distinguish a developer from AI.

## Upgrade and Git behavior

0.9 restores recorded 0.8 filesystem locks so manual editing works. Older workspace locks are imported once into local policy when each workspace is opened. Opening another workspace does not reset shared policy.

The extension preserves existing repository instruction files from earlier releases. Review those old files before committing; previously committed instructions can still affect collaborators. New lock/unlock operations do not update them.

Do not install this build expecting automatic blocking of arbitrary AI sessions. **Lock for AI** rejects requests in every mode. See `docs/STRICT-PROTECTION.md` for the required architecture and unresolved workflow decision.
