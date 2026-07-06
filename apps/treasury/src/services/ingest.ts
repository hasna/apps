import { guard, type RunContext } from "./context.js";
import { recordBalance } from "./balances.js";
import { recordFxRate } from "./fx.js";
import { recordCostFeed } from "./runway.js";
import { listEntities } from "./entities.js";
import type { UpstreamAdapters } from "../adapters/types.js";

export interface IngestResult {
  balances_ingested: number;
  fx_rates_ingested: number;
  cost_feeds_ingested: number;
  sources: { balances: string; fx: string; cost: string };
}

/**
 * Pull balances / FX / cost from read-adapters and cache them with provenance.
 * v0 uses fixture adapters; v1 swaps in live upstream calls. Deny-by-default:
 * the caller must hold write scope and be scoped to the entities it ingests.
 */
export async function ingestFromAdapters(rc: RunContext, adapters: UpstreamAdapters): Promise<IngestResult> {
  guard(rc, "treasury:write", "write");
  const entities = await listEntities(rc);
  const ids = entities.map((e) => e.entity_id);

  const rates = await adapters.fx.fetchRates();
  for (const r of rates) {
    await recordFxRate(rc, { base_currency: r.base_currency, quote_currency: r.quote_currency, rate: r.rate, as_of: r.as_of, source: adapters.fx.source });
  }
  const balances = await adapters.balances.fetchBalances(ids);
  for (const b of balances) {
    await recordBalance(rc, { entity_id: b.entity_id, account_ref: b.account_ref, account_kind: b.account_kind, currency: b.currency, amount_minor: b.amount_minor, as_of: b.as_of, source: adapters.balances.source });
  }
  const feeds = await adapters.cost.fetchCostFeeds(ids);
  for (const f of feeds) {
    await recordCostFeed(rc, { entity_id: f.entity_id, currency: f.currency, monthly_burn_minor: f.monthly_burn_minor, as_of: f.as_of, source: adapters.cost.source });
  }
  return {
    balances_ingested: balances.length,
    fx_rates_ingested: rates.length,
    cost_feeds_ingested: feeds.length,
    sources: { balances: adapters.balances.source, fx: adapters.fx.source, cost: adapters.cost.source },
  };
}
