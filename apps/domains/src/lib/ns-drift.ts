/**
 * NS drift reconciler — enforces the always-Cloudflare-DNS invariant across the
 * portfolio: every domain's nameservers must point to Cloudflare. Detects drift
 * (registrar NS not Cloudflare) and can re-delegate. Pure detection + an
 * injected reconcile loop, so it is fully testable.
 */

const CF_SUFFIX = ".ns.cloudflare.com";

export function isCloudflareNs(ns: string[]): boolean {
  return ns.length > 0 && ns.every((n) => n.toLowerCase().replace(/\.$/, "").endsWith(CF_SUFFIX));
}

export interface NsDriftVerdict {
  domain: string;
  drifted: boolean;
  reason: string;
}

export function classifyNsDrift(domain: string, registrarNs: string[]): NsDriftVerdict {
  if (registrarNs.length === 0) return { domain, drifted: true, reason: "no nameservers set" };
  if (!isCloudflareNs(registrarNs)) return { domain, drifted: true, reason: `registrar NS not Cloudflare: ${registrarNs.join(", ")}` };
  return { domain, drifted: false, reason: "Cloudflare" };
}

export interface NsReconcileDeps {
  getRegistrarNs: (domain: string) => Promise<string[]>;
  getCloudflareNs: (domain: string) => Promise<string[]>;
  setRegistrarNs: (domain: string, ns: string[]) => Promise<void>;
  log?: (event: string, detail: Record<string, unknown>) => void;
}

export interface NsReconcileSummary {
  checked: number;
  drifted: NsDriftVerdict[];
  fixed: string[];
  errors: number;
}

export async function reconcileNsDrift(
  domains: string[],
  deps: NsReconcileDeps,
  opts: { fix?: boolean } = {},
): Promise<NsReconcileSummary> {
  const log = deps.log ?? (() => {});
  const summary: NsReconcileSummary = { checked: 0, drifted: [], fixed: [], errors: 0 };
  for (const domain of domains) {
    summary.checked++;
    try {
      const registrarNs = await deps.getRegistrarNs(domain);
      const verdict = classifyNsDrift(domain, registrarNs);
      if (!verdict.drifted) continue;
      summary.drifted.push(verdict);
      log("ns_drift", { domain, reason: verdict.reason });
      if (opts.fix) {
        const cfNs = await deps.getCloudflareNs(domain);
        if (!isCloudflareNs(cfNs)) throw new Error(`Cloudflare zone for ${domain} has no usable NS`);
        await deps.setRegistrarNs(domain, cfNs);
        summary.fixed.push(domain);
        log("ns_fixed", { domain, ns: cfNs });
      }
    } catch (err) {
      summary.errors++;
      log("ns_error", { domain, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return summary;
}
