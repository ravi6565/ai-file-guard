# Security model — 0.10 local build

## Protected scope

Protection applies to AI tools launched through Protected AI Terminal and its child processes. The macOS kernel restricts their local filesystem writes to the agent copy, isolated project-specific agent home and temporary storage. They cannot directly write originals or authoritative policy; only the trusted extension-host service applies proposals.

Ordinary VS Code AI extensions and independent processes using developer credentials remain outside this boundary. Existing external chat sessions are not retroactively confined. All protected AI execution must use the controlled path.

The extension is not a universal AI-origin detector. The [VS Code extension host](https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security) has editor permissions, and file events do not authenticate human/AI origin.

## Runtime controls and limitations

The Windows candidate uses LPAC with ALL APPLICATION PACKAGES opted out, explicit SID grants only on private copy/home/temp and a read-only runtime, an explicit inherited-standard-handle list, and a kill-on-close job assigned before the process resumes. ACL and integrity-label changes use verified file handles and reject reparse points/hard links; original-project ACLs are not changed. Windows uses internet-client and registry-read capabilities, with no LAN/server capability or loopback exemption. Private AppContainer profile storage may persist. This backend requires real Windows token, mutation, child-process, named-pipe, loopback, terminal and provider acceptance before publication; macOS results do not establish Windows support.

A real filesystem denial probe is required before capability is available. Each generated profile is validated before terminal launch. No unconfined fallback exists.

macOS profiles deny by default. File reads are allowed; writes are limited to explicit writable roots. Forked/executed tools retain the OS restriction. Editor IPC environment, arbitrary Mach services, general UNIX sockets, incoming listeners and Apple Events are not granted. DNS uses its specific system service. The only TCP endpoint permitted to the child is its exact IPv4 HTTPS proxy endpoint; general IPv4/IPv6 control-service access is denied.

The trusted proxy supports CONNECT to public hostnames on port 443 only. It rejects literal IP authorities and private/local names, resolves through the host, rejects private/reserved results and pins the validated IPv4 address, preventing DNS rebinding to local services. It does not decrypt TLS or expose filesystem/extension APIs. CLIs must honor the supplied proxy configuration. IPv6-only providers, raw sockets and non-HTTPS endpoints are unsupported.

Agents may read local data and send network requests. Do not expose privileged remote/LAN services that can write originals on an agent's behalf, share host write handles, or grant independent computer-control tools outside the managed boundary. This is a filesystem/process restriction, not a complete information-flow or model-behavior guarantee.

Apple deprecates sandbox-exec and the profile interface is not stable public API. This build validates it on the current machine and refuses failed launches. Supported long-term OS backends and independent security review are required before a broad production release.

## Applying changes

The apply service owns the local policy transaction while validating/applying a batch. It checks explicit/inherited locks, future descendant paths, destructive ancestors and explicit-file aliases. Originals and staging reject symlinks/junction components; staged bytes must match the preview hash. Existing originals must match the session baseline.

Directory creation/removal is included. Deletion is non-recursive. Changing resource kind is unsupported; rename grouping and batch rollback are not implemented. Independent allowed changes may succeed while rejected changes stay unapplied.

A developer is trusted and can still edit originals; ordinary content conflicts are rejected. The JavaScript broker retains narrow TOCTOU windows against malicious unrestricted host processes. Those processes already lie outside this managed-runtime guarantee.

Only successful broker writes advance the baseline. Later developer changes are not silently accepted as baseline. Corrupt/missing observed policy fails evaluation. A crashed lease can cause a busy error until safely recovered.

## Human authority and local data

Manual editor/filesystem access remains unchanged. The sandboxed agent cannot write extension storage or use editor IPC to invoke unlock. The normal extension host is trusted; commands are not an authority boundary against another unrestricted extension in that host.

Policy, profiles, copies, agent credentials and audit logs stay outside repositories and Settings Sync. Copies and agent homes contain source/secrets. Credentials must be retained and removed according to local policy. Lock/unlock also projects cooperative guidance into managed sections of repository instruction files; custom text is preserved. These projections are normal files and can be shared through Git. Keep local lock sections out of commits when other developers must not inherit the guidance. Repository settings, Git ignore rules and index flags are not changed.

Instruction files do not confer enforcement against unrestricted agents and may require a new session to load. Unsaved edits, malformed markers, unsafe symlink targets, and write errors are reported without discarding the authoritative local policy. The managed broker rejects proposals to alter policy instruction files. Snapshots remain legacy utilities, not an AI-origin detector.

## Verified versus unverified

Verified locally: native mutation denial, alias/child-process attempts, local control-service denial, policy tampering denial, live lock/unlock application, actual VS Code protected-terminal writes, outbound public HTTPS, and a temporary Codex CLI version invocation.

Not verified: signed-in model tasks for every provider, Windows/Linux sandbox backends, OS security certification, unrestricted external-agent confinement, or resistance to unknown kernel/runtime vulnerabilities. Marketplace publication and broad security certification are deferred.
