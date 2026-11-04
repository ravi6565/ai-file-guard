# Contributing

Create a short-lived branch from the latest `main` and open a pull request. Explain the problem, the resulting behavior and the checks you ran. Keep unrelated changes separate.

## Required checks

Run `npm ci`, `npm run lint`, `npm test` and `node --test scripts/test-windows-diagnostics.cjs`. Changes to enforcement also need native tests on the affected supported OS. CI tests Node 22/24 on Windows 2022/2025, macOS 15 Intel and Ubuntu 24.04, and requires all jobs to pass through `CI gate`.

Do not weaken native verification, treat skipped native tests as passes, change original-project permissions to repair Windows startup, or replace the tested private runtime with stock Node. Keep generated packages, runtime binaries, credentials and machine-local policies out of Git.

## Review and merge

Resolve review conversations and keep the PR current with `main`. Maintainers should review outside contributions before merging. The default ruleset requires PRs and CI without bypass actors. Its numeric approval quota is zero so a sole maintainer can merge their own PR after CI; increase it when a second reviewer is available. `CODEOWNERS` identifies the maintainer and does not itself enforce approval.

Merge using a merge commit when consolidating release branches so their commits remain ancestors of `main`. Delete short-lived branches only after their work is merged. Never discard an unmerged branch just because its name looks old.

Repository rules must be activated in GitHub. See [repository administration](docs/REPOSITORY.md). See [deployment](docs/DEPLOYMENT.md) for release acceptance and [SECURITY.md](SECURITY.md) for private vulnerability reporting.

## Runner coverage

CI uses pinned Ubuntu 24.04 and macOS 15 Intel images for repeatable tests.
GitHub ARM runner capacity has prevented jobs from starting, so Apple Silicon
release acceptance must additionally run on an ARM Mac. Use native and installed
VSIX checks on that host; the 0.12.3 runtime was also qualified by hosted ARM
checks in run 41848429599. Headless Linux disables GPU acceleration, and VS Code
integration steps have a five-minute deadline so a hung workbench cannot consume
the entire CI job. These deadlines fail the check; they never convert a timeout
into successful acceptance.
