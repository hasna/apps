/**
 * Domain provisioning daemon — reconciles a set of domains toward `ready`.
 *
 * Each tick: gather live signals per domain, derive its lifecycle state, and run
 * the next action (register / create_cf_zone / delegate_ns / check_ns_propagation
 * / verify_dns / finalize). Signals + actions are injected so the loop is fully
 * testable; the CLI wires real Route53/Cloudflare/DNS calls. State is derived
 * live (no separate persistence needed), so a restart simply re-derives.
 */

import {
  deriveDomainState,
  domainActionFor,
  isDomainTerminal,
  type DomainSignals,
  type DomainProvAction,
} from "./provision-state.js";

export interface DomainReconcileDeps {
  gatherSignals: (domain: string) => Promise<DomainSignals>;
  runAction: (domain: string, action: DomainProvAction) => Promise<void>;
  log?: (event: string, detail: Record<string, unknown>) => void;
}

export interface DomainReconcileSummary {
  processed: number;
  advanced: number;
  ready: number;
  errors: number;
}

export async function reconcileDomainTick(
  domains: string[],
  deps: DomainReconcileDeps,
): Promise<DomainReconcileSummary> {
  const log = deps.log ?? (() => {});
  const summary: DomainReconcileSummary = { processed: 0, advanced: 0, ready: 0, errors: 0 };

  for (const domain of domains) {
    summary.processed++;
    try {
      const signals = await deps.gatherSignals(domain);
      const state = deriveDomainState(signals);
      if (isDomainTerminal(state)) {
        if (state === "ready") summary.ready++;
        log("domain_terminal", { domain, state });
        continue;
      }
      const action = domainActionFor(state)!;
      await deps.runAction(domain, action);
      summary.advanced++;
      log("domain_advanced", { domain, state, action });
    } catch (err) {
      summary.errors++;
      log("domain_error", { domain, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return summary;
}

export interface DomainDaemonOptions extends DomainReconcileDeps {
  intervalSec?: number;
  maxTicks?: number;
  shouldStop?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
}

export async function runDomainDaemon(
  domains: () => Promise<string[]>,
  opts: DomainDaemonOptions,
): Promise<DomainReconcileSummary> {
  const intervalSec = opts.intervalSec ?? 30;
  const maxTicks = opts.maxTicks ?? Infinity;
  const shouldStop = opts.shouldStop ?? (() => false);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const total: DomainReconcileSummary = { processed: 0, advanced: 0, ready: 0, errors: 0 };

  let ticks = 0;
  while (!shouldStop() && ticks < maxTicks) {
    const list = await domains();
    const s = await reconcileDomainTick(list, opts);
    total.processed += s.processed; total.advanced += s.advanced; total.ready += s.ready; total.errors += s.errors;
    ticks++;
    if (shouldStop() || ticks >= maxTicks) break;
    await sleep(intervalSec * 1000);
  }
  return total;
}
