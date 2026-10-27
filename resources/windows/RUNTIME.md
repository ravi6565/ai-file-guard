# Private Windows runtime

The Windows candidate needs a Node runtime with libuv's AppContainer pipe fix.
Stock Node releases tested in CI hang while creating child-process pipes inside
AppContainer (https://github.com/nodejs/node/issues/66374).

`scripts/build-windows-runtime.ps1` builds pinned Node 24.22.1 source with
the `src/win/pipe.c` fix from libuv commit
`2cadaa40167050baf7c6905ac897e6fb57afb2c6` plus private error-handling changes.
The patch is MIT licensed; its
copyright and license are included in Node's bundled LICENSE. Upstream change:
https://github.com/libuv/libuv/commit/2cadaa40167050baf7c6905ac897e6fb57afb2c6.

The private additions query `TokenIsAppContainer` through the documented current
process token pseudo-handle, propagate token-query errors instead of silently
selecting the global pipe namespace, and bound pipe-name collision retries.
An access-denied error must reach Node rather than spin forever inside pipe
creation, before `spawnSync` can start its own timeout. These changes need native
Windows qualification; they do not establish the cause of the build-26300 report.
See [Microsoft's pseudo-handle contract](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getcurrentprocesstoken).

This is a private extension runtime, not an official Node binary. It never
replaces system Node. The build checks the pinned source SHA-256 and produces
`runtime.json`, node.exe, npm.tar, npm/npx shims and the full upstream LICENSE.
The trusted extension validates the binary/archive hashes before copying them
into private read-only per-workspace runtime storage. No arbitrary host Node
fallback is permitted.

Generated `runtime/` files are excluded from Git. Windows CI builds and caches
them, then runs native and installed-VSIX acceptance with those exact files.
Windows release packaging must include this directory and pass those gates.

For a developer-only source build, use a Windows x64 host with PowerShell 7,
Git, Python 3.12, NASM and the Visual Studio C++/ClangCL toolchain described in
[Node's build prerequisites](https://github.com/nodejs/node/blob/v24.22.1/BUILDING.md#windows-prerequisites).
The build uses a fresh temporary directory, with the system temporary directory
as fallback when `RUNNER_TEMP` is absent. Use a short `RUNNER_TEMP` path if the
Node toolchain rejects your local temporary path. Building Node can take
substantially longer than extension tests. A bounded host child-pipe smoke runs
before runtime provenance is written; LPAC acceptance remains a separate gate.
These source-build tools are not requirements for users installing a complete,
tested Windows VSIX; the runtime is already included in that package.

The managed Node environment sets only the fixed `--preserve-symlinks` and
`--preserve-symlinks-main` compatibility flags. This avoids module-loader
ancestor inspection of the host drive root; no host ancestor ACLs are granted.
These flags can change behavior for symlinked native modules, so provider CLI
compatibility must still be tested. npm --version and public registry HTTPS
have passed in native Windows CI.

The derived npm copy appends `npm-private-roots.cjs` to the checksum-pinned
Arborist helper. It seeds npm's path cache with the launcher's verified canonical
private roots, then retains npm's original lstat/readlink checks below those
roots. Host ancestors are not scanned or granted; access failures still propagate.
This is compatibility metadata, not an enforcement decision: the LPAC token
continues to govern every filesystem operation even if a child changes its env.
The source addition is included in the runtime cache key and runtime-build.json.
The base npm archive and its upstream licenses remain in the Windows package.

The read-only `guard-bin/codex` adapter takes precedence in the protected PATH.
It launches the native payload from the complete npm-installed Codex package,
preserving npm ownership metadata, arguments, stdio and termination signals.
It avoids the npm CLI's JavaScript wrapper scanning inaccessible host ancestors;
the installed Codex package is not rewritten. This adapter runs only as a child
of the LPAC launcher, never in the unrestricted extension host. Its files also
participate in the private-runtime cache key and provenance record.

The native launcher reports setup/child stages to captured stderr, leaving probe
stdout intact and interactive terminals quiet. It inspects every private object
on each run, including reparse/hard-link checks, but only writes a DACL when the
required package-SID grant is missing. `TimeoutMilliseconds` in a trusted probe
configuration bounds child execution after resume; zero preserves the protected
terminal's unlimited lifetime. An outer host deadline must still bound setup.

Use [the Windows diagnostic procedure](../../docs/WINDOWS-REVIEW-2026-10-27.md)
to distinguish permission setup, runtime startup and child I/O. Do not bypass
the extension's verification or infer Windows client support from a server pass.
