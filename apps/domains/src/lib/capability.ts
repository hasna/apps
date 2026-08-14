/**
 * Registrar / DNS provider capability matrix (2026) and auto-selection.
 *
 * Captures what each provider can actually do via API, so callers never attempt
 * a gated path silently. Findings (research, 2026):
 *   - Route53 Domains: full self-serve buy API, not volume-gated → primary buy.
 *   - GoDaddy retail: availability remains threshold-gated; DNS/domain
 *     management is available for qualifying accounts; no direct buy adapter.
 *   - Brandsight / GoDaddy Corporate Domains: enterprise-contract-only, but
 *     official v2 API supports portfolio, registration, renewal, nameserver,
 *     and DNS operations.
 *   - Cloudflare: DNS only (no registration) → common default DNS provider.
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
  cloudflare: { canBuy: false, canDns: true, gated: false, notes: "DNS/zone management only; not a registrar." },
  namecheap: { canBuy: true, canDns: true, gated: false, notes: "Buy + DNS via API; requires API access + whitelisted IP." },
  godaddy: { canBuy: false, canDns: true, gated: true, notes: "Availability remains threshold-gated; this CLI supports sync/renew/DNS records where account access qualifies, but not direct automated purchase." },
  brandsight: { canBuy: true, canDns: true, gated: true, notes: "GoDaddy Corporate Domains (enterprise/contract-only); this CLI supports portfolio, registration, renewal, nameserver, and DNS operations through the official v2 API when the account contract permits it." },
  sedo: { canBuy: false, canDns: false, gated: true, notes: "Marketplace API only: search/portfolio/listings and recorded purchases; no registrar DNS or direct registration API in this CLI." },
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

/** Choose a DNS provider, defaulting to Cloudflare when no preference is set. */
export function selectDnsProvider(preference?: string): string {
  if (preference) {
    const c = getCapability(preference);
    if (!c.canDns) throw new Error(`Provider '${preference}' cannot manage DNS`);
    if (c.gated) throw new Error(`Provider '${preference}' DNS is gated and may require account approval: ${c.notes}`);
    return preference.toLowerCase();
  }
  return "cloudflare";
}
