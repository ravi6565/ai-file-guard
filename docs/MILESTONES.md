# Development milestones

| Phase | Scope | Status |
|---|---|---|
| 1 | Extension scaffold, commands, configuration, sidebar container | Complete |
| 2 | LockManager, ManifestStore, PathResolver, PolicyEngine, decorations, status UI | Complete; local workspaces only |
| 3 | Codex, Copilot, and generic adapters; managed instruction sections | Implemented and unit-tested |
| 4 | Monitoring, integrity hashes, snapshots, safe recovery, audit logging | Implemented; Extension Host acceptance pending |
| 5 | Brokered staging and trusted change application | Implemented; OS process sandbox unavailable, Enforced fails closed |
| 6 | Cross-platform integration and adversarial security test matrix | CI matrix authored; Windows/Linux execution and manual matrix pending |
| 7 | VSIX and marketplace/privacy/security documentation | VSIX prepared; publication metadata and release gates pending |

## Phase 1–2 validation gates

- TypeScript strict compilation.
- Unit tests for persistence, recursive locks, boundary-safe containment, Windows case handling, explicit unlock semantics, advisory behavior, and enforced policy decisions.
- The automated Extension Host smoke test verifies activation and command registration. Manual checks remain required for context menus, decorations, sidebar behavior, multi-root workspaces, and restart persistence.

## Production release gates

Production-ready status is prohibited until all phases are complete, the enforced boundary passes cross-platform TOCTOU/hard-link/rename/replacement tests, recovery never overwrites divergent developer content without confirmation, and the packaged VSIX passes installation and smoke tests on supported VS Code desktop platforms.
