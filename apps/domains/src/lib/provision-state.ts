/**
 * Domain provisioning state machine (open-domains side) — pure transitions plus
 * a `deriveDomainState` that maps live signals (registered? zone? NS delegated?
 * propagated? active?) to the current lifecycle state. The CLI `provision-status`
 * command derives state live so no extra persistence is required, while the
 * daemon advances domains transition-by-transition.
 */

export type DomainProvState =
  | "requested"
  | "registered"
  | "cf_zone_ready"
  | "ns_delegated"
  | "ns_propagated"
  | "dns_managed"
  | "ready"
  | "failed";

export type DomainProvAction =
  | "register"
  | "create_cf_zone"
  | "delegate_ns"
  | "check_ns_propagation"
  | "verify_dns"
  | "finalize";

interface Step { action: DomainProvAction; next: DomainProvState }

export const DOMAIN_FLOW: Record<Exclude<DomainProvState, "ready" | "failed">, Step> = {
  requested: { action: "register", next: "registered" },
  registered: { action: "create_cf_zone", next: "cf_zone_ready" },
  cf_zone_ready: { action: "delegate_ns", next: "ns_delegated" },
  ns_delegated: { action: "check_ns_propagation", next: "ns_propagated" },
  ns_propagated: { action: "verify_dns", next: "dns_managed" },
  dns_managed: { action: "finalize", next: "ready" },
};

const TERMINAL = new Set<DomainProvState>(["ready", "failed"]);

export function isDomainTerminal(s: DomainProvState): boolean {
  return TERMINAL.has(s);
}
export function domainActionFor(s: DomainProvState): DomainProvAction | null {
  if (isDomainTerminal(s)) return null;
  return DOMAIN_FLOW[s as keyof typeof DOMAIN_FLOW]?.action ?? null;
}
export function domainNext(s: DomainProvState): DomainProvState | null {
  if (isDomainTerminal(s)) return null;
  return DOMAIN_FLOW[s as keyof typeof DOMAIN_FLOW]?.next ?? null;
}
export function domainHappyPath(): DomainProvState[] {
  return [...(Object.keys(DOMAIN_FLOW) as DomainProvState[]), "ready"];
}

export interface DomainSignals {
  registered?: boolean;
  zoneExists?: boolean;
  registrarNsAreCloudflare?: boolean;
  publicNsAreCloudflare?: boolean;
  zoneActive?: boolean;
}

/** Map observed live signals to the furthest lifecycle state reached. */
export function deriveDomainState(sig: DomainSignals): DomainProvState {
  if (!sig.registered) return "requested";
  if (!sig.zoneExists) return "registered";
  if (!sig.registrarNsAreCloudflare) return "cf_zone_ready";
  if (!sig.publicNsAreCloudflare) return "ns_delegated";
  if (!sig.zoneActive) return "ns_propagated";
  return "ready";
}
