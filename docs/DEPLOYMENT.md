# Deploying AI File Guard 0.12.0

Publisher: **ravikiranv**. Extension ID: **ravikiranv.ai-file-guard**.
Support/security contact: **ravikiranv8919@gmail.com**.

This release uses the stable Marketplace channel. Protection applies to the
Protected AI Terminal and trusted apply service. Ordinary AI chat extensions are
outside enforcement; instruction files provide cooperative guidance. Keep this
scope visible in the listing.

## Build and validate

Run `npm ci`, `npm run lint`, `npm test`, and `npm run test:sandbox` on the
corresponding supported host, then:

```sh
npm run package:release
```

The command writes a platform-specific VSIX and matching `.sha256` and `.json`
sidecars under `artifacts/`. It requires `preview: false`, disables the pre-release
property and validates publisher identity and Windows runtime provenance.
macOS packages exclude Windows resources. Windows x64 requires the compatible
private runtime from the `windows-lpac-runtime` CI artifact, extracted into
`resources/windows/runtime/`; see `resources/windows/RUNTIME.md` for source builds.
There is no Docker/WSL dependency or stock Node fallback.

CI uploads each package only after its installed-VSIX tests pass. Release targets
qualified by testing are Windows x64 and macOS Apple Silicon. The universal
VSIX from `npm run package` is for development. Use the target packages from the
successful stable-release CI run. Verify their version, target, channel and hash.

Install the exact package through **Extensions: Install from VSIX**. Disable the
old `ai-file-guard.ai-file-guard` extension first; verify migrated locks before
removing old data. Automated package acceptance uses:

```sh
npm run test:vsix -- artifacts/ai-file-guard-0.12.0-darwin-arm64.vsix
```

For Windows substitute `win32-x64`. Follow `LOCAL-TEST.md` for manual checks.
The developer reports successful acceptance of the 0.11.0 preview. The stable
release keeps its runtime behavior and needs fresh package acceptance for the
changed version/channel. CLI installation/version tests do not independently
validate authentication or signed-in model workflows.

## Publish the tested files

Open [Manage Publishers & Extensions](https://marketplace.visualstudio.com/manage)
and select **ravikiranv**. For the first upload choose **New extension → Visual
Studio Code** and select the tested macOS VSIX. If the extension already exists,
use its update action. Use the same listing's update action to add the Windows
VSIX at version **0.12.0**. Both packages must use the **stable** release channel,
with no Preview label. Upload only `.vsix` files, retaining JSON/checksum sidecars
as release records. Wait for Marketplace validation, then check both targets and
install the published build on each supported host.

Alternatively, after configuring publishing authentication locally, publish the
exact packages with the installed VSCE CLI:

```sh
node node_modules/@vscode/vsce/vsce publish --packagePath artifacts/ai-file-guard-0.12.0-darwin-arm64.vsix artifacts/ai-file-guard-0.12.0-win32-x64.vsix
```

This command uses existing files. Do not rebuild an accepted package or add the
`--pre-release` flag. Keep credentials out of source, chat, JSON sidecars and VSIXs.
Manual browser upload does not require a publishing token. Account creation by
itself does not authenticate this development session for CLI publishing.

The stable channel does not imply independent security certification or universal
AI interception. See `SECURITY.md` for supported boundaries and remaining risks.
Publication is complete only after Marketplace confirms it; local packaging does
not publish anything. Follow the [official publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
for current authentication and platform-package rules.
