/**
 * Registrar / DNS provider capability matrix (2026) and auto-selection.
 *
 * Captures what each provider can actually do via API, so callers never attempt
 * a gated path silently. Findings (research, 2026):
 *   - Route53 Domains: full self-serve buy API, not volume-gated → primary buy.
 *   - GoDaddy retail: Domains API gated behind account thresholds (≥10 / DDC)
 *     since 2024; purchase + DNS writes unreliable → gated.
 *   - Brandsight / GoDaddy Corporate Domains: enterprise-contract-only → gated.
 *   - Cloudflare: DNS only (no registration) → always our DNS.
 *   - Namecheap: buy + DNS via API (sandbox/whitelist required) → usable.
 */

export interface ProviderCapability {
  canBuy: boolean;
  canDns: boolean;
  /** True when the API path exists but requires special access we may not have. */
  gated: boolean;
  notes: string;
}

export const PROVIDER_CAPABILITIES: Record<string, ProviderCapability> = {
  route53: { canBuy: true, canDns: true, gated: false, notes: "Full self-serve buy + hosted zones via AWS API; primary buy path." },
  cloudflare: { canBuy: false, canDns: true, gated: false, notes: "DNS/zone management only; not a registrar. Always our DNS." },
  namecheap: { canBuy: true, canDns: true, gated: false, notes: "Buy + DNS via API; requires API access + whitelisted IP." },
  godaddy: { canBuy: true, canDns: true, gated: true, notes: "Domains API gated behind account thresholds (>=10 / Discount Domain Club) since 2024; purchase + DNS writes unreliable." },
  brandsight: { canBuy: true, canDns: true, gated: true, notes: "GoDaddy Corporate Domains (enterprise/contract-only); credentials issued to onboarded clients, not self-serve." },
};

const UNKNOWN: ProviderCapability = { canBuy: false, canDns: false, gated: true, notes: "Unknown provider." };

export function getCapability(name: string): ProviderCapability {
  return PROVIDER_CAPABILITIES[name.toLowerCase()] ?? UNKNOWN;
}

export function canBuy(name: string): boolean {
  const c = getCapability(name);
  return c.canBuy && !c.gated;
}

/**
 * Choose the registrar to buy through. Defaults to Route53 (the only reliable
 * self-serve API). An explicit preference is honored only if it is non-gated.
 */
export function selectBuyRegistrar(preference?: string): string {
  if (preference) {
    const c = getCapability(preference);
    if (!c.canBuy) throw new Error(`Registrar '${preference}' cannot buy domains`);
    if (c.gated) throw new Error(`Registrar '${preference}' is gated/enterprise-only and not available for automated purchase: ${c.notes}`);
    return preference.toLowerCase();
  }
  return "route53";
}

/** DNS is always Cloudflare, regardless of where the domain was bought. */
export function selectDnsProvider(): string {
  return "cloudflare";
}
