# Local acceptance test — 0.10

## Required execution path

Use **AI File Guard: Open Protected AI Terminal** for AI work. The ordinary VS Code AI chat panels are not sandboxed by this extension. Testing in those panels will bypass this boundary.

The original project remains open for your manual edits. The protected terminal works in a separate copy. Its original-project filesystem writes are denied by macOS. Proposed changes enter originals only through **Review and Apply Agent Changes**.

## Install and verify

Install `ai-file-guard-0.10.1.vsix` through **Extensions: Install from VSIX**, then reload all VS Code windows using this extension. Run **AI File Guard: Verify Managed Sandbox**. It must report verified OS write denial. If verification fails, no unconfined agent is launched.

Lock an original file or folder. The Explorer tooltip and status bar identify the scope as managed agents. Manual editing/saving in the original editor should still work.

## Check automatic instruction updates

Select two files in Explorer and choose **Lock for AI**. Open `AGENTS.md`, `.github/copilot-instructions.md`, `CLAUDE.md`, and `.ai-file-guard/INSTRUCTIONS.md`: each managed section should list both relative paths. Existing guidance outside the markers must remain intact.

Lock a folder. Its entry explicitly covers every nested and future file/folder; it does not need to enumerate descendants. Unlock one file and confirm its entry disappears. Unlock the folder and confirm its entry disappears while other explicit file locks remain. Reload VS Code with a lock still active: the saved rule must be synchronized automatically. **AI File Guard: Sync AI Instructions** provides an explicit retry. Save unsaved instruction edits before retrying.

Start a fresh AI session to load the changed instructions. [Codex reads its instruction chain once per session](https://learn.chatgpt.com/docs/agent-configuration/agents-md). Instruction loading and compliance in each provider remain separate from OS enforcement: the extension cannot force every arbitrary AI chat window to read or obey these files.

## Run your AI CLI

Open Protected AI Terminal. Installed CLIs on PATH can be invoked there. Alternatively, install a CLI inside the protected home. npm global installations are redirected to that isolated home; they do not alter your normal global packages.

For Codex, installation has been smoke-tested inside the runtime:

```sh
npm install -g @openai/codex
codex --version
codex -c 'cli_auth_credentials_store="file"' login --device-auth
codex
```

Device authentication avoids a local callback server, which the sandbox intentionally does not allow. Open the displayed sign-in URL manually in your normal browser. Credentials are retained in the isolated per-project home. No existing host credentials are automatically copied.

The installation package and device-auth guidance follow [official OpenAI CLI documentation](https://learn.chatgpt.com/docs/codex/cli) and [authentication documentation](https://learn.chatgpt.com/docs/auth). Account/workspace device-auth support and a valid provider account are required. The smoke test did not sign in or run a model task.

Other AI CLIs must likewise run inside this terminal and use their own compatible authentication. CLI filesystem confinement is provider-independent; actual provider sign-in/model workflows require your local acceptance test.

## Check a locked original

Ask the agent to alter the locked resource. An attempt against its absolute original path must fail with an OS permission error. The agent may still edit a proposal in its copy; that does not change the original.

Run **Preview Agent Changes** in the original window. The locked proposal should say DENY. Run **Review and Apply Agent Changes** and confirm: the original must remain unchanged.

Repeat for a locked folder: file modification, file deletion, new files, new nested folders and empty-directory deletion must all be rejected for originals. Parent delete/rename policy checks cover locked descendants.

## Unlock and repeat

Unlock the original resource. Apply the same outstanding proposal again. Allowed changes should now appear in the original, provided it has not diverged since the copy was created.

Continue editing in the same managed terminal and apply again. The baseline advances only for changes the service actually applied. A developer edit to the same original must be rejected as a concurrency conflict and must not be overwritten.

## Git and restart behavior

Lock/unlock now updates managed sections in repository instruction files, preserving custom guidance. `.vscode/settings.json` is not modified. Policy and agent storage remain outside the project. Reloading retains local locks and active review-session metadata; terminal processes themselves close when the extension deactivates. Open a new protected terminal to launch another agent.

Keep managed sections out of Git commits if you want instructions to remain local; committed instruction files are shared with other developers. Git ignore rules do not suppress edits to tracked files. The authoritative lock database is never copied into the repository.

## Known limits for this local build

Only the macOS controlled-terminal path is implemented. Normal external AI sessions remain unrestricted. Empty directories are supported, but file/directory kind conversion and atomic rename grouping are not. Independent allowed changes can apply even when other proposals are rejected. A crashed cross-window lease can require recovery; do not delete it while another window is applying changes.

The macOS sandbox interface is deprecated by Apple. A verified supported runtime is a requirement, not an assumption. CLIs must honor HTTP(S)_PROXY and reach public HTTPS endpoints on port 443; direct TCP, private/local destinations and IPv6-only endpoints are not supported. Windows/Linux backends, real provider-account flows and broader release/security review remain outside the current local validation.
