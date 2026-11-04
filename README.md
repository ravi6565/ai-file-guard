# AI File Guard

Protect original files while working with AI tools in a managed terminal. Normal editor saves remain available; a review broker applies permitted changes from the agent's working copy.

**Version 0.12.3 · Windows x64 and macOS Apple Silicon · Publisher: ravikiranv**

[Marketplace](https://marketplace.visualstudio.com/items?itemName=ravikiranv.ai-file-guard) · [Documentation](https://github.com/ravi6565/ai-file-guard/blob/main/docs/README.md) · [Contributing](https://github.com/ravi6565/ai-file-guard/blob/main/CONTRIBUTING.md) · [Security](https://github.com/ravi6565/ai-file-guard/blob/main/SECURITY.md)

## Protection scope

AI tools must run through **AI File Guard: Open Protected AI Terminal**. These processes work in a private copy and cannot write original projects directly. **Review and Apply Agent Changes** rejects changes to currently locked files and folder descendants.

Ordinary Codex, Copilot, Claude and other chat extensions in an unrestricted VS Code window are outside this enforcement boundary. Generated agent instructions are cooperative guidance for those sessions.

| Platform | Enforcement | Requirements |
| --- | --- | --- |
| Windows x64 | Less-privileged AppContainer (LPAC), inherited child restrictions and a kill-on-close job | Local VS Code, .NET Framework 4.8 compiler, built-in tar.exe and the packaged private Node/npm runtime |
| macOS Apple Silicon | Native sandbox-exec profile and a managed HTTPS proxy | Local VS Code and a working sandbox-exec backend |

No administrator elevation, Docker, WSL or Windows loopback exemption is required. Every machine must pass native isolation verification before a managed terminal or lock is accepted. Failed verification never launches an unrestricted fallback. Linux, browser and remote workspaces have no supported enforcement backend.

## Install and use

Install **AI File Guard** by publisher **ravikiranv** from the Marketplace. For a test candidate, use **Extensions: Install from VSIX** with the package matching your OS, then reload VS Code.

1. Right-click an original file or folder and choose **Lock for AI**.
2. Run **AI File Guard: Open Protected AI Terminal** and start your AI CLI there.
3. Review proposals with **AI File Guard: Preview Agent Changes**.
4. Run **AI File Guard: Review and Apply Agent Changes**. Locked originals are rejected.
5. Choose **Unlock for AI** when you want to permit changes to that resource.

Folder locks cover all current and future descendants. The broker checks live locks, path containment and concurrent original edits each time it applies proposals. Manual editor and filesystem changes remain allowed.

Use the [user guide](https://github.com/ravi6565/ai-file-guard/blob/main/docs/USER_GUIDE.md) and [local test workflow](https://github.com/ravi6565/ai-file-guard/blob/main/docs/LOCAL-TEST.md) for detailed examples.

## Windows verification

Version 0.12.3 corrects runtime child-pipe handling, ignored child streams, startup deadlines, failure recovery and diagnostics. Windows Server 2022/2025, non-administrator execution and installed-VSIX acceptance passed [the qualified release run](https://github.com/ravi6565/ai-file-guard/actions/runs/41848429599). Codex CLI 0.166.0 installation/startup passed inside LPAC.

The reported Windows build 26300 and signed-in provider tasks still need device acceptance. Follow the [Windows test and diagnostic steps](https://github.com/ravi6565/ai-file-guard/blob/main/docs/WINDOWS-TEST-0.12.3.md). The private Node/npm runtime does not replace your installed Node or change original-project permissions.

## Agent instructions and local data

Lock and unlock operations synchronize managed sections in `AGENTS.md`, `AGENTS.override.md` where present, `.github/copilot-instructions.md`, `CLAUDE.md` and `.ai-file-guard/INSTRUCTIONS.md`. Existing content outside the managed section is preserved. Settings under `aiFileGuard.adapters` select the providers. Restart existing agent sessions after changing their instructions.

Authoritative locks, staged copies, audit logs and isolated credentials remain in local extension storage, outside Git and Settings Sync. Cloning this repository does not transfer that local lock database. Committing generated instruction files shares their relative locked paths.

When upgrading from the earlier local `ai-file-guard.ai-file-guard` publisher, disable it first and verify imported locks before removing its data. Close old terminals and start a new Protected AI Terminal. Existing credentials, sessions and legacy permission records are not migrated. For old 0.8 filesystem locks, restore legacy permissions before uninstalling.

## Development

Use Node.js 22 or 24:

```sh
npm ci
npm run lint
npm test
node --test scripts/test-windows-diagnostics.cjs
npm run test:sandbox
npm run test:integration
```

Native tests require a supported host that can launch its OS sandbox. Windows tests need the generated private runtime described in [resources/windows/RUNTIME.md](https://github.com/ravi6565/ai-file-guard/blob/main/resources/windows/RUNTIME.md). Skipped native tests do not establish enforcement.

`npm run package:release` writes a platform VSIX and checksum/metadata sidecars to `artifacts/`. Follow the [deployment guide](https://github.com/ravi6565/ai-file-guard/blob/main/docs/DEPLOYMENT.md) to test and publish the exact qualified package. Publishing is separate from building or merging source changes.

## Contributions and repository rules

Submit changes through a pull request to `main`. The versioned [ruleset](https://github.com/ravi6565/ai-file-guard/blob/main/.github/rulesets/main.json) requires the complete CI gate, blocks force pushes and deletion, and has no bypass actors. The repository owner must activate it in GitHub; committing the JSON alone does not enforce it. See [repository administration](https://github.com/ravi6565/ai-file-guard/blob/main/docs/REPOSITORY.md) for activation and verification.

## Privacy, support and license

AI File Guard does not call models or upload source itself. Agent tools may read local files and send data to their providers. macOS sandbox-exec is deprecated; OS updates and provider workflows require continued validation. See the [privacy policy](https://github.com/ravi6565/ai-file-guard/blob/main/PRIVACY.md) and [security boundaries](https://github.com/ravi6565/ai-file-guard/blob/main/docs/SECURITY.md).

For support or private vulnerability reports, email [ravikiranv8919@gmail.com](mailto:ravikiranv8919@gmail.com). Never include credentials or sensitive project content in public reports.

Released under the [MIT license](https://github.com/ravi6565/ai-file-guard/blob/main/LICENSE).
