export interface EnforcementCapability { readonly available: boolean; readonly backend: string; readonly reason: string; readonly scope: 'managed-agents-only'; }

let verified: EnforcementCapability | undefined;
export function setEnforcementCapability(capability: EnforcementCapability): void { verified = capability; }

export function detectEnforcementCapability(platform: NodeJS.Platform = process.platform): EnforcementCapability {
  if (platform === process.platform && verified) return verified;
  return {
    available: false,
    backend: platform,
    scope: 'managed-agents-only',
    reason: platform === 'darwin' ? 'Managed sandbox has not been verified yet.' : 'The macOS managed sandbox is unavailable on this platform. No unconfined fallback will be started.',
  };
}
