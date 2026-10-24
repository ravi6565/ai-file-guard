# Local validation — 0.10.0

Validated on the current macOS machine on 24 October 2026. These results establish the documented managed-agent path, not universal control over unrelated AI programs.

- 35 unit/service tests pass. Native cases are intentionally separate from the default unit command and are not counted when skipped.
- 6 native enforcement cases pass, alongside the 2 shared profile checks in `npm run test:sandbox`.
- 12 real VS Code Extension Host cases pass in a fresh temporary profile, including the actual protected terminal and read-only change preview.
- TypeScript checks pass. Production-dependency audit reports zero vulnerabilities.
- Protected DNS/HTTPS diagnostic succeeds through the trusted CONNECT proxy.
- Codex CLI 0.164.0 was installed only inside a temporary sandbox home and its version command succeeded. No provider sign-in or model request was performed.

Native cases exercise original-file writes/creates/deletes/renames, atomic replacement, symlink/hard-link and child-process attempts, policy tampering, live locks applied after session creation, file/directory proposals before and after unlock, IPv4/IPv6/mapped loopback, UNIX sockets and other loopback services on the proxy port. Addresses that the OS cannot bind cannot host the test service.

The proxy additionally has unit coverage for literal IP/authority rejection and private/reserved DNS-result rejection. Public targets are connected using the validated IPv4 address rather than resolving again.

The user must test signed-in AI workflows in Protected AI Terminal. Ordinary VS Code AI chat panels are outside the boundary. Windows/Linux backends, long-term macOS runtime support, stale-lease recovery and broader provider/security acceptance remain release work.
