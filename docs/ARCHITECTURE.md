# Architecture — managed runtime

## Current boundary

```text
Human editor -------------------------------> original project (manual writes)
Lock/unlock ----------------> machine-local policy
Protected AI Terminal -> sandboxed agent -> writable copy
                                           |
                              preview/apply request by user
                                           |
Trusted extension-host service -> live policy + concurrency checks -> originals
```

The OS denies direct original-project writes by the managed process and its descendants. Unlocked changes still pass through the service. This makes new locks effective at application time without granting agents writable original-file handles.

Ordinary AI extensions and terminal processes in the developer's unrestricted host are outside this boundary. Do not describe their writes as intercepted.

## Runtime

The Windows candidate uses a native .NET Framework launcher compiled locally from the packaged C# source. It creates LPAC processes, requires the ALL APPLICATION PACKAGES opt-out attribute, verifies the suspended child's AppContainer token and private-SID access semantics, and assigns a kill-on-close job before resumption. Only stdin/stdout/stderr handles are inherited. The child's default object DACL includes its private package SID for child-process I/O; host control objects are not granted. Grants and low-integrity labels apply only to individually verified private objects, with reparse/hard-link rejection and automatic descendant security propagation disabled. Original-project ACLs are never changed. Windows uses internet-client/registry-read capabilities; native host acceptance remains a release gate. Its packaged private Node runtime is built from checksum-pinned source with the upstream libuv AppContainer pipe fix; stock Node child-process I/O hangs in this boundary. Binary/archive checksums and an actual child-process I/O probe are checked before accepting a Windows lock. See resources/windows/RUNTIME.md. The macOS runtime below uses its separate Seatbelt/proxy boundary.

`ManagedSandbox` performs a real denial self-test before accepting managed locks or launching a protected terminal. It writes a private profile outside agent-writable areas and validates it before launch. macOS Seatbelt starts deny-by-default, permits local reads, selected process/system operations, DNS and the exact trusted proxy endpoint, and permits writes only to staging, isolated agent home and temporary storage.

`ManagedNetworkProxy` accepts HTTPS CONNECT only. It rejects literal IP and private/local authorities, resolves public hostnames to IPv4, rejects non-public results and pins the validated address before connecting on port 443. TLS remains end-to-end. The agent cannot connect to other host services directly, including IPv4-mapped IPv6 routes. Clients must use the supplied HTTP(S)_PROXY environment; there is no raw-network fallback.

TerminalOptions uses `strictEnv`. VS Code IPC hooks, shell startup configuration, SSH agent sockets and Node injection settings are not inherited. Selected provider token environment variables are passed only to the managed child. Agent homes are stable per canonical project; source copies and temporary directories are per session.

Missing/failed sandbox support has no unconfined fallback. Capability and UI identify protection as managed-agents-only. macOS sandbox-exec is deprecated and runtime verification is mandatory.

## Trusted service

The extension host remains outside the agent's restriction. It presents preview/apply UI and evaluates current canonical-path policy. The broker uses the same cross-window lease as lock/unlock, so a batch and a policy mutation cannot race through that store.

Proposals carry staged content hashes. Both roots reject symlink/junction components and traversal; native process restrictions prevent the managed agent from racing destination directories in originals. The service detects ordinary concurrent developer edits, uses exclusive unique temporary writes and preserves existing permission bits.

Directories appear in inventory as explicit entries. Creation is ordered parents-first; removals are ordered children-first. Directory deletion is non-recursive and refuses unexpected remaining content. Rename operations are currently represented as independent proposals, not atomic groups. File/directory kind replacement is rejected.

After application, only successfully applied paths advance the baseline. The service does not inventory new developer content as a trusted agent baseline. Session state and policy remain local.

## Persistence and migration

LocalManifestStore persists canonical-path locks outside repositories and Settings Sync. Writes use a private temporary file plus atomic rename. A directory lease serializes local windows. Corrupt or unexpectedly removed policy stops evaluation. A crashed process may leave a lease that fails busy; automatic stale ownership recovery remains a release item.

Earlier workspace locks import once. Recorded old chmod/immutable/read-only controls are restored so manual editing remains allowed. The current lock path does not use watcher rollback for enforcement.

InstructionCoordinator projects current policy into bounded sections in provider instruction files on lock/unlock, activation, and cross-window policy changes. Synchronization takes the same policy lease, so an older window cannot overwrite a completed unlock with stale rules. Remembered nested scopes are cleared even after their final lock is removed. Relative directory rules include all current and future descendants. Writes preserve custom text and permissions, refuse symlinked targets, detect changed bytes, and preserve dirty editor buffers with an explicit error. Existing Codex overrides are updated alongside AGENTS.md. Repository instruction projections are cooperative, can be committed, and are distinct from the machine-local authoritative policy. They are not a live injection API into existing chat contexts.

## Acceptance evidence

Unit/service tests cover policy and application logic. Native tests cover OS-denied mutation, child-process and alias attempts, policy tampering, local control sockets, live lock/unlock and file/directory application. Extension Host tests launch the actual protected terminal and verify its write denial. A separate network/CLI smoke test verifies outbound DNS/TLS and a temporary Codex CLI installation/version invocation; it does not authenticate or call a model.
