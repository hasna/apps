/**
 * Hosted-zone setup for a freshly registered domain.
 *
 * Route 53 AUTO-CREATES a hosted zone when a domain is registered, and the
 * registry delegation already points at it. Blindly calling CreateHostedZone
 * afterwards produces a SECOND zone with a different delegation set, leaving the
 * domain delegated to the (now orphaned) auto zone — DNS records added to the
 * new zone never resolve. This module reuses the existing zone when present and
 * only ever creates one if none exists, then reconciles the registry NS to the
 * managed zone so delegation is always correct.
 *
 * Dependency-injected (mirrors reconcileNsDrift) so the decision logic is unit
 * testable without hitting AWS.
 */

/** Order/case/trailing-dot-insensitive set comparison of two NS lists. */
export function nameserversMatch(a: string[], b: string[]): boolean {
  const norm = (ns: string[]) =>
    new Set(ns.map((n) => n.trim().toLowerCase().replace(/\.$/, "")));
  const sa = norm(a);
  const sb = norm(b);
  if (sa.size !== sb.size) return false;
  for (const n of sa) if (!sb.has(n)) return false;
  return true;
}

export interface ZoneSetupDeps {
  /** Find an existing hosted zone for the domain (including its NS), or null. */
  findExistingZone: (domain: string) => Promise<{ id: string; name_servers: string[] } | null>;
  /** Create a new hosted zone for the domain and return it (with NS). */
  createZone: (domain: string) => Promise<{ id: string; name_servers: string[] }>;
  /** Current registry/registrar nameservers for the domain. */
  getRegistrarNs: (domain: string) => Promise<string[]>;
  /** Point the registry/registrar delegation at the given nameservers. */
  setRegistrarNs: (domain: string, ns: string[]) => Promise<void>;
  log?: (event: string, detail: Record<string, unknown>) => void;
}

export interface ZoneSetupResult {
  zoneId: string;
  nameServers: string[];
  /** true if a new zone was created, false if an existing one was reused. */
  created: boolean;
  /** true if the registry delegation had to be repointed at the managed zone. */
  nsUpdated: boolean;
}

export async function setupDomainZone(
  domain: string,
  deps: ZoneSetupDeps,
): Promise<ZoneSetupResult> {
  const log = deps.log ?? (() => {});

  const existing = await deps.findExistingZone(domain);
  let zone: { id: string; name_servers: string[] };
  let created: boolean;

  if (existing) {
    zone = existing;
    created = false;
    log("zone_reused", { domain, zoneId: zone.id });
  } else {
    zone = await deps.createZone(domain);
    created = true;
    log("zone_created", { domain, zoneId: zone.id });
  }

  let nsUpdated = false;
  const registrarNs = await deps.getRegistrarNs(domain);
  if (!nameserversMatch(registrarNs, zone.name_servers)) {
    await deps.setRegistrarNs(domain, zone.name_servers);
    nsUpdated = true;
    log("ns_aligned", { domain, zoneId: zone.id, nameservers: zone.name_servers });
  }

  return { zoneId: zone.id, nameServers: zone.name_servers, created, nsUpdated };
}
