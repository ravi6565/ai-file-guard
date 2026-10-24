# Privacy

AI File Guard's lock policy, source copies, profiles, audits and session state remain on the local machine outside repositories and Settings Sync. The extension does not call a model or upload source by itself.

AI tools launched by the user may send source and other data to their configured providers. On macOS, the managed sandbox allows local reads and HTTPS through a local CONNECT proxy to public endpoints. TLS remains end-to-end; the proxy does not decrypt content or log credentials. The Windows candidate instead uses native LPAC filesystem/network capabilities with explicit private-storage access and an internet-client capability; it does not use the macOS proxy. Provider privacy/account terms still apply.

Protected terminals use an isolated, per-project home inside extension storage. Provider credentials created there persist across sessions. Selected host provider variables (OPENAI_API_KEY, ANTHROPIC_API_KEY, GITHUB_TOKEN and GH_TOKEN) are passed to the child when present; their values are not written to logs by this extension. Host credential files are not automatically copied.

Policy and runtime profiles are outside the agent-writable roots. Source copies and agent homes can contain sensitive data and should be retained/deleted according to local policy. Windows also creates local AppContainer profiles and a private copy of the installed Node.js/npm runtime. Uninstalling may leave this data behind.

Lock/unlock synchronizes managed sections in project agent instruction files, preserving custom guidance. These files contain relative locked paths and may be shared with AI providers when those tools load project instructions. They are ordinary files: committing them can share lock instructions with other developers. This repository ignores its generated instruction files to keep its own local rules out of commits; users of the extension must manage this separately in their projects. The authoritative local lock database is not transferred by Git commits or clones.

New locks do not alter project settings. Migration restores recorded legacy permissions and removes recorded extension-owned read-only settings.
