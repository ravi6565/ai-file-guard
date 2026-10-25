# Development milestones

| Phase | Scope | Status |
|---|---|---|
| 1 | Extension scaffold, commands, configuration, sidebar container | Complete |
| 2 | LockManager, ManifestStore, PathResolver, PolicyEngine, decorations, status UI | Complete; local workspaces only |
| 3 | Codex, Copilot, Claude and generic adapters; dynamic managed instruction sections | Implemented; file/folder lock, unlock, startup and cross-window synchronization tested |
| 4 | Monitoring, integrity hashes, snapshots, safe recovery, audit logging | Implemented; Extension Host acceptance pending |
| 5 | Brokered staging and trusted change application | Implemented with a verified managed macOS terminal; unrestricted AI extensions remain outside the boundary |
| 6 | Cross-platform integration and adversarial security test matrix | macOS and Windows native/terminal/installed-VSIX gates pass; Linux source/unit checks pass; signed-in provider matrix remains open |
| 7 | VSIX and marketplace/privacy/security documentation | Publisher/contact supplied; macOS Apple Silicon and Windows x64 packages installed and tested; local provider acceptance, manual upload and production review remain |

## Phase 1–2 validation gates

- TypeScript strict compilation.
- Unit tests for persistence, recursive locks, boundary-safe containment, Windows case handling, explicit unlock semantics, advisory behavior, and enforced policy decisions.
- The automated Extension Host smoke test verifies activation and command registration. Manual checks remain required for context menus, decorations, sidebar behavior, multi-root workspaces, and restart persistence.

## Production release gates

Production-ready status is prohibited until all phases are complete, the enforced boundary passes cross-platform TOCTOU/hard-link/rename/replacement tests, recovery never overwrites divergent developer content without confirmation, and the packaged VSIX passes installation and smoke tests on supported VS Code desktop platforms.
