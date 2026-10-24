# Strict protection scope — 0.11 candidate

The requested separation is implemented for the controlled execution path: the human editor retains original-file write access; agents launched in Protected AI Terminal must have OS-denied direct writes to originals; the trusted apply service rejects locked-file and locked-folder changes. macOS is verified locally. A native Windows LPAC backend is implemented as a candidate and requires real Windows native/terminal/provider acceptance; macOS tests do not establish that support. Docker and WSL are not used.

A lock affects current application policy immediately, including proposals from sessions created before the lock. Unlock permits application when optimistic developer-content checks pass. Agents do not acquire writable original-file handles.

This is an explicit managed-agent boundary. It cannot secure arbitrary AI extensions or terminal agents running in the user's normal unrestricted account context. All protected AI tools must launch through the controlled environment. A separate VS Code profile alone is insufficient.

Runtime self-tests verify denial before a lock can be acknowledged. Native tests cover create/modify/delete/rename/replacement, aliases and child tools; end-to-end tests cover locked folder proposals and subsequent unlock, including directories. Extension Host tests use the actual VS Code terminal.

The backend uses macOS sandbox-exec, which Apple marks deprecated. This local build checks actual runtime operation and has no unconfined fallback. Provider sign-in/model workflows, other OS backends and production security review remain separate acceptance items.

See `LOCAL-TEST.md` for the exact workflow and `SECURITY.md` for residual risks. Do not advertise this as universal control of every AI program on the machine.
