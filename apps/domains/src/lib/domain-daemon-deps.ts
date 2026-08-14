/**
 * Real deps for the domain provisioning daemon — gather live signals and run
 * the next action for a domain (toward "ready" = registered + CF zone + NS
 * delegated + propagated + zone active). DNS is always Cloudflare.
 */

import { getDomainDetail } from "./route53.js";
import { getZone, ensureZone } from "./cloudflare.js";
import { updateNameservers } from "./route53.js";
import type { DomainReconcileDeps } from "./domain-daemon.js";
import type { DomainSignals } from "./provision-state.js";

const CF_NS_SUFFIX = ".ns.cloudflare.com";

function allCloudflare(ns: string[]): boolean {
  return ns.length > 0 && ns.every((n) => n.toLowerCase().replace(/\.$/, "").endsWith(CF_NS_SUFFIX));
}

export function makeDomainDaemonDeps(): DomainReconcileDeps {
  return {
    async gatherSignals(domain: string): Promise<DomainSignals> {
      const signals: DomainSignals = {};
      const detail = await getDomainDetail(domain).catch(() => null);
      signals.registered = !!detail;
      signals.registrarNsAreCloudflare = allCloudflare(detail?.nameservers ?? []);
      const zone = await getZone(domain).catch(() => null);
      signals.zoneExists = !!zone;
      signals.zoneActive = zone?.status === "active";
      try {
        const dns = await import("node:dns");
        const ns = await dns.promises.resolveNs(domain).catch(() => [] as string[]);
        signals.publicNsAreCloudflare = allCloudflare(ns);
      } catch {
        signals.publicNsAreCloudflare = false;
      }
      return signals;
    },
    async runAction(domain, action) {
      switch (action) {
        case "register":
          // Buying is a deliberate, paid action — use `domains domain buy`.
          throw new Error(`${domain} is not registered; buy it first: domains domain buy ${domain} --wait --dns cloudflare`);
        case "create_cf_zone":
          await ensureZone(domain);
          return;
        case "delegate_ns": {
          const zone = await ensureZone(domain);
          await updateNameservers(domain, zone.nameservers);
          return;
        }
        // These states resolve as live signals catch up on the next tick.
        case "check_ns_propagation":
        case "verify_dns":
        case "finalize":
          return;
      }
    },
  };
}
