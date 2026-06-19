/**
 * Cloudflare delegation helper for domains that should use Cloudflare DNS.
 *
 * After a domain is registered with ANY registrar, DNS is managed in Cloudflare:
 * create (or reuse) a Cloudflare zone, then point the registrar's nameservers at
 * the zone's assigned Cloudflare nameservers.
 *
 * Dependency-injected so it is fully unit-testable; the CLI wires the real
 * Cloudflare `createZone` and Route53 `updateNameservers`.
 */

export interface DelegateDeps {
  /** Create or reuse a Cloudflare zone; returns its id + assigned nameservers. */
  createCloudflareZone: (domain: string) => Promise<{ id: string; nameservers: string[] }>;
  /** Point the registrar's nameservers at the given set. */
  updateNameservers: (domain: string, nameservers: string[]) => Promise<{ operationId: string }>;
}

export interface DelegateResult {
  zoneId: string;
  nameservers: string[];
  operationId: string;
}

export async function delegateDomainToCloudflare(
  domain: string,
  deps: DelegateDeps,
): Promise<DelegateResult> {
  const zone = await deps.createCloudflareZone(domain);
  if (!zone.nameservers || zone.nameservers.length === 0) {
    throw new Error(`Cloudflare zone for ${domain} returned no nameservers; cannot delegate`);
  }
  const { operationId } = await deps.updateNameservers(domain, zone.nameservers);
  return { zoneId: zone.id, nameservers: zone.nameservers, operationId };
}
