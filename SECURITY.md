# Security policy

AI File Guard 0.10 includes a verified-on-launch macOS sandbox for managed AI terminals and a trusted change-application service. It does not confine ordinary AI extensions or unrelated host processes. All protected AI execution must use its controlled runtime.

The macOS sandbox interface is deprecated by Apple. This build is for local acceptance; production security review and broader compatibility validation remain open.

See `docs/SECURITY.md` and `docs/LOCAL-TEST.md` for the boundary and verified behavior. Marketplace publication is deferred; a public security contact and verified release metadata are required before publishing.
