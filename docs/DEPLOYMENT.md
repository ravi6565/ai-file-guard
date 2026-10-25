# Deploying the 0.11 preview

Publisher: **ravikiranv**. Extension ID: **ravikiranv.ai-file-guard**.
Support/security contact: **ravikiranv8919@gmail.com**.

The release is a managed-terminal preview. Ordinary AI chat extensions are not
confined. Keep this scope visible in the Marketplace description and README.

## Prepare the packages

Run `npm ci`, `npm run lint`, `npm test`, and `npm run test:sandbox` on the
corresponding supported host. Then run:

```sh
npm run package:preview
```

The command creates a platform-specific VSIX and matching `.sha256` and `.json`
sidecars under `artifacts/`. It sets the pre-release property, checks publisher
metadata, and leaves Marketplace unchanged. macOS packages exclude Windows
resources. Windows x64 packaging requires the checksum-verified private runtime
from the `windows-lpac-runtime` CI artifact, extracted into
`resources/windows/runtime/`. There is no Docker/WSL dependency or stock Node
fallback. For a source build, see `resources/windows/RUNTIME.md`.

CI uploads each candidate only after its installed-VSIX tests pass. Use the
artifact for the host/architecture actually tested; do not upload the development
universal VSIX produced by `npm run package`. A target filename alone does not
prove acceptance. Check the workflow result and the target in the JSON sidecar.

## Accept the exact VSIX locally

Install the chosen VSIX through **Extensions: Install from VSIX**. Disable the old
`ai-file-guard.ai-file-guard` extension first; verify migrated locks before
uninstalling it or deleting its data. Run the automated acceptance against that
same file on the corresponding host:

```sh
npm run test:vsix -- artifacts/ai-file-guard-0.11.0-darwin-arm64-preview.vsix
```

For Windows, substitute the `win32-x64` filename. Follow `LOCAL-TEST.md`: verify the
sandbox; lock two files and a recursive folder; confirm instruction updates;
confirm manual editing; deny managed original writes and locked proposals; then
unlock and apply. Restart and confirm lock persistence. Run a real signed-in AI
CLI task inside Protected AI Terminal. Authentication/model tasks have not been
performed by packaging or unsigned CLI version smoke tests.

Resolve every blocker in `FINAL-REVIEW.md` before upload. Keep the exact tested
VSIX and checksum; do not rebuild after acceptance and upload a different file.

## Upload after acceptance

Open [Manage Publishers & Extensions](https://marketplace.visualstudio.com/manage)
and select publisher **ravikiranv**. For the first package choose **New extension
→ Visual Studio Code**, then upload the tested platform-specific VSIX. Add the
other tested platform package under the same extension/version, preserving the
pre-release channel. Review the Preview label, platform, icon, README and support
contact before completing publication. Do not upload checksum/JSON sidecars.

If the portal's listing already exists, use its update action. Individual
engineers can publish through their own publisher; a company is not needed.
This preparation does not verify publisher-account ownership or publish anything.

For automated publishing later, keep the Marketplace credential in a repository
secret, not in source, instructions or a VSIX. No publishing token is needed for
this manual-upload workflow. See the
[official publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
for platform packages and pre-release behavior.
