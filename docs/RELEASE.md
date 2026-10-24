# Release status

0.10 is ready for the documented local macOS acceptance workflow, not a universal-security certification. Marketplace publication is deferred at the user's request.

Local gates include type checks, unit/service regressions, native OS-denial tests, actual VS Code protected-terminal verification, directory operations, repeated apply/concurrency checks, outbound DNS/HTTPS, and isolated Codex CLI installation/version smoke testing. Model sign-in and real provider tasks require user account acceptance.

Before production publication:

- Validate the packaged VSIX in the user's installed profile and all supported provider workflows.
- Resolve sandbox-exec deprecation/long-term OS support and obtain an independent security review.
- Add verified native backends before supporting Windows/Linux enforcement.
- Add safe stale-lease recovery, grouped rename behavior and stronger batch/failure semantics.
- Test OS updates, Unicode/case aliases, inherited handles, external-service bypass and malicious host-process races.
- Supply verified publisher, repository and security-contact metadata.
- Keep the managed-agent scope explicit in Marketplace descriptions. Never claim arbitrary external AI sessions are restricted.

A configured CI matrix is not proof that those external platforms or provider tasks passed.
