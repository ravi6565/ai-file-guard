# Private Windows runtime

The Windows candidate needs a Node runtime with libuv's AppContainer pipe fix.
Stock Node releases tested in CI hang while creating child-process pipes inside
AppContainer (https://github.com/nodejs/node/issues/66374).

`scripts/build-windows-runtime.ps1` builds pinned Node 24.22.1 source with only
the `src/win/pipe.c` change from libuv commit
`2cadaa40167050baf7c6905ac897e6fb57afb2c6`. The patch is MIT licensed; its
copyright and license are included in Node's bundled LICENSE. Upstream change:
https://github.com/libuv/libuv/commit/2cadaa40167050baf7c6905ac897e6fb57afb2c6.

This is a private extension runtime, not an official Node binary. It never
replaces system Node. The build checks the pinned source SHA-256 and produces
`runtime.json`, node.exe, npm.tar, npm/npx shims and the full upstream LICENSE.
The trusted extension validates the binary/archive hashes before copying them
into private read-only per-workspace runtime storage. No arbitrary host Node
fallback is permitted.

Generated `runtime/` files are excluded from Git. Windows CI builds and caches
them, then runs native and installed-VSIX acceptance with those exact files.
Windows release packaging must include this directory and pass those gates.
