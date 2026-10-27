# Windows lock failure review — 27 October 2026

The screenshot and attached investigation show that Windows verification fails
before **Lock for AI** accepts the lock. The reported native filesystem probe
passed (`GUARD_VERIFIED:5`), while the following runtime probe exceeded 15–20
seconds. This identifies the failing verification step, but does not establish
whether Node started or reached child-process pipe creation.

## Evidence and findings

| Finding | Evidence | Implication |
| --- | --- | --- |
| Permission preparation shares the old 15-second deadline with runtime execution. | `WindowsSandbox.verify()` launches `GuardLauncher`, which recursively grants the full private runtime before starting Node. Packaged npm has 2,610 entries. | Slow disk or antivirus can exhaust the deadline before child I/O begins. This is a hypothesis for this machine, not a reproduced cause. |
| Existing grants were rewritten on each invocation. | `GrantPrivateTree()` called `SetSecurityInfo` even when the required SID grant existed. | Warm starts performed thousands of unnecessary permission writes. |
| Pipe creation could loop indefinitely on a policy denial. | The pinned libuv server loop retried `ERROR_ACCESS_DENIED` as a name collision without a bound. | Node's child timeout cannot help while synchronous pipe setup has not returned. |
| Token detection converted query failures into a negative result. | The former patch used `OpenProcessToken`, then selected the global namespace on failure. | A denied token query could select an invalid pipe namespace. This mechanism remains unconfirmed on the affected PC. |
| Failed verification stayed cached. | `ManagedSandbox.verify()` retained unavailable results until an explicit retry/reload. | Subsequent Lock clicks could keep showing a transient startup failure. |
| Cache reuse checked only that Node existed. | Bundled hashes were verified, but a previously copied runtime was not checked on reuse. | A damaged cache could persist; the attachment's matching Node hash makes this an unlikely explanation for this incident. |

The local 0.12.2 Windows VSIX matches its recorded release checksum; bundled
Node/npm match the runtime manifest. The screenshot's launcher hash matches
that package. There is no evidence that reinstalling the identical package will
correct the failure.

The [0.12.2 release job](https://github.com/ravi6565/ai-file-guard/actions/runs/40183837455/job/121140423863)
ran on Windows Server 2025 build 26100. It passed 8 native tests, CLI smoke and
17 tests in each development/installed-VSIX integration run. The attached report
identifies build 26300. A server pass does not establish compatibility with that
Windows client/build. The existing tests already exercise captured child pipes,
the Lock command, and the actual protected terminal.

## Corrections in this working tree

- The launcher reports setup, token, child-resume and exit stages with elapsed
  time to captured stderr. Probe stdout retains its strict success protocol.
- Existing matching DACLs are retained. Every object still undergoes handle,
  resolved-path, reparse-point and hard-link validation.
- Trusted probe configurations can bound child execution separately from setup;
  normal interactive terminals retain their unlimited lifetime.
- Verification allows up to 120 seconds per launcher invocation for setup, with
  separate native child limits of 5 seconds for the denial probe and 10 seconds
  for runtime I/O. Errors identify the verification stage, last launcher stage,
  startup evidence, timeout/exit status and bounded captured output.
- Failed verification retries on the next request while concurrent callers share
  an active check. Successful checks remain cached. Runtime reuse checks cached
  Node, launcher/shim bytes, build provenance and the npm compatibility helper.
- The private libuv patch uses the documented current-token pseudo-handle,
  propagates token-query errors and stops after 128 pipe-name attempts.
- The runtime builder supports local temporary directories, fresh builds,
  cleanup and a host child-pipe smoke before writing provenance.
- A standalone diagnostic runner records OS build, runtime hashes, the existing
  verification result and independent cold/warm child-I/O and write-denial probes.
- CI adds explicit Windows Server 2022 and 2025 runs and saves diagnostic JSON.
  Windows client acceptance remains required.

The upstream naming fix is described in the [libuv commit](https://github.com/libuv/libuv/commit/2cadaa40167050baf7c6905ac897e6fb57afb2c6).
The extra error handling is a private runtime change. Microsoft's
[current-token pseudo-handle contract](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getcurrentprocesstoken)
provides query access on Windows 8 and newer without opening a separate token
handle. These source changes require a new Windows runtime build; existing
0.12.2 packages do not contain them.

## Reproduce on the affected Windows PC

Run the diagnostic script from this checkout in a normal Windows terminal with
Node 22 or newer. Point it at the installed extension, or at the `extension`
directory of an unpacked Windows VSIX:

```powershell
node .\scripts\diagnose-windows.cjs --extension "C:\path\to\ravikiranv.ai-file-guard-0.12.2-win32-x64" --output "$env:USERPROFILE\Desktop\ai-file-guard-windows.json"
```

New candidate Windows packages also contain `scripts/diagnose-windows.cjs`.
Their shipped `resources/windows/runtime/node.exe` can run it if host Node is
unavailable. The runner creates disposable originals and a fresh runtime copy;
it does not change the project's permissions or lock policy. It omits provider
credentials from probe environments and redacts common local paths in reports.
Use `--help` for custom storage/deadlines or retention. On an old package, native
stage logs and its own child deadline are unavailable; the outer deadline still
applies. A failing baseline verification keeps the overall result failed even if
the longer independent probes succeed.

Interpret the final native stage together with stdout:

- `grant-readonly-trees` without `RUNTIME_STARTED`: runtime permission setup has
  not finished; a child-pipe diagnosis is premature.
- `wait-child` without `RUNTIME_STARTED`: Node has not demonstrated startup.
- `RUNTIME_STARTED` without `CHILD_RESULT`: the runtime reached child launch;
  investigate pipes/process creation with the captured error and OS build.
- `RUNTIME_VERIFIED` and preserved originals: that independent run passed;
  examine the baseline result separately.

## Validation and release gate

Local validation of the final working tree: `npm test` passes 67 portable tests
with 16 platform-gated tests pending; `npm run lint` passes; the standalone
diagnostic suite passes all 11 tests. The revised patch applies to the exact
pinned Node source and a portable C harness passes six injected token/pipe
error scenarios. VSCE's file list includes the diagnostic runner and excludes
its tests/build scripts. Windows packaging rejects the old runtime provenance,
as expected after changing the patch; no replacement Windows VSIX was produced.

Native macOS regression execution was blocked by the managed tool sandbox
(`sandbox_apply: Operation not permitted` and denied local sockets). No native
Windows execution was performed on this Mac. PowerShell and the Windows C#
compiler are unavailable here.

Portable tests and pinned-source patch application can run on macOS. They do
not compile the Windows launcher or validate LPAC behavior. Rebuild the private
runtime, run unit/native/installed-VSIX checks on Windows, and repeat this
diagnostic on the affected build before declaring the incident resolved. Include
process cleanup after timeouts, cold/warm starts, spaces and long paths, manual
edits, locked-file and recursive-folder denial, and broker apply after unlock.

Do not publish a replacement under the already released 0.12.2 version. Prepare
a new version only after the changed Windows payload passes acceptance. Keep
verification fail-closed; removing the runtime test would conceal this failure.
