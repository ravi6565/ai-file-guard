# Security policy

AI File Guard 0.12 is a Windows/macOS extension with native verified-on-launch isolation for managed AI terminals and a trusted change-application service. Windows native, real-terminal and installed-VSIX acceptance pass on hosted CI; signed-in provider workflows still require local acceptance. It does not confine ordinary AI extensions or unrelated host processes. All protected AI execution must use its controlled runtime.

Report suspected vulnerabilities privately to **ravikiranv8919@gmail.com**. Include the extension, VS Code and OS versions, the affected workflow, and a minimal reproduction. Do not send credentials or sensitive project files. General support is available at the same address. No response-time guarantee or independent security certification is claimed.

The macOS sandbox interface is deprecated by Apple. Windows uses LPAC with explicit private-storage ACLs/labels, restricted inherited handles and a kill-on-close job; original-project permissions are not changed. Windows internet access uses its native capability boundary, not the macOS proxy. Docker, WSL, administrator elevation and loopback exemptions are not required. Independent security review, signed-in provider acceptance, long-term OS support, stale-lease crash recovery and broader provider compatibility remain open work. The stable release channel does not remove these limitations. Linux, remote workspaces and browser VS Code have no supported enforcement backend.

See `docs/SECURITY.md` and `docs/LOCAL-TEST.md` for the boundary and verified behavior.
