export interface EnforcementCapability { readonly available: boolean; readonly backend: string; readonly reason: string; readonly scope: 'managed-agents-only'; }

let verified: EnforcementCapability | undefined;
export function setEnforcementCapability(capability: EnforcementCapability): void { verified = capability; }

export function detectEnforcementCapability(platform: NodeJS.Platform = process.platform): EnforcementCapability {
  if (platform === process.platform && verified) return verified;
  return {
    available: false,
    backend: platform,
    scope: 'managed-agents-only',
    reason: ['darwin', 'win32'].includes(platform) ? 'Managed sandbox has not been verified yet.' : 'No native managed sandbox is available on this platform. No unconfined fallback will be started.',
  };
}
