import type { BalancesAdapter, CostAdapter, FxAdapter, UpstreamAdapters, UpstreamBalance, UpstreamCostFeed, UpstreamFxRate } from "./types.js";

// Deterministic fixture adapters for v0. Live upstream wiring (v1) is gated
// behind HASNA_TREASURY_LIVE_UPSTREAM=1 and is intentionally NOT built in this
// cohort — a fixture adapter returns coherent, testable data keyed by entity_id.

const AS_OF = "2026-07-01T00:00:00.000Z";

export class FixtureBalancesAdapter implements BalancesAdapter {
  readonly source = "fixture:banking";
  constructor(private readonly rows: UpstreamBalance[]) {}
  async fetchBalances(entityIds: string[]): Promise<UpstreamBalance[]> {
    const set = new Set(entityIds);
    return this.rows.filter((r) => set.has(r.entity_id));
  }
}

export class FixtureFxAdapter implements FxAdapter {
  readonly source = "fixture:fx";
  constructor(private readonly rows: UpstreamFxRate[]) {}
  async fetchRates(): Promise<UpstreamFxRate[]> {
    return [...this.rows];
  }
}

export class FixtureCostAdapter implements CostAdapter {
  readonly source = "fixture:cost";
  constructor(private readonly rows: UpstreamCostFeed[]) {}
  async fetchCostFeeds(entityIds: string[]): Promise<UpstreamCostFeed[]> {
    const set = new Set(entityIds);
    return this.rows.filter((r) => set.has(r.entity_id));
  }
}

export interface FixtureSeed {
  balances: (entityIds: string[]) => UpstreamBalance[];
  fx: UpstreamFxRate[];
  cost: (entityIds: string[]) => UpstreamCostFeed[];
}

/**
 * Build fixture adapters bound to two demo entities [usEntityId, roEntityId].
 * US entity: strong USD cash, modest burn. RO entity: EUR cash, higher burn
 * (short runway) — exercising FX exposure + a sweep recommendation.
 */
export function buildFixtureAdapters(usEntityId: string, roEntityId: string): UpstreamAdapters {
  const balances: UpstreamBalance[] = [
    { entity_id: usEntityId, account_ref: "mercury-1010", account_kind: "bank", currency: "USD", amount_minor: 250_000_00, as_of: AS_OF },
    { entity_id: usEntityId, account_ref: "wallet-usdc", account_kind: "wallet", currency: "USD", amount_minor: 30_000_00, as_of: AS_OF },
    { entity_id: roEntityId, account_ref: "bcr-2020", account_kind: "bank", currency: "EUR", amount_minor: 15_000_00, as_of: AS_OF },
  ];
  const fx: UpstreamFxRate[] = [
    { base_currency: "USD", quote_currency: "EUR", rate: 0.92, as_of: AS_OF },
  ];
  const cost: UpstreamCostFeed[] = [
    // US: healthy (large surplus -> a donor). RO: high burn, short runway -> needy.
    { entity_id: usEntityId, currency: "USD", monthly_burn_minor: 10_000_00, as_of: AS_OF },
    { entity_id: roEntityId, currency: "EUR", monthly_burn_minor: 20_000_00, as_of: AS_OF },
  ];
  return {
    balances: new FixtureBalancesAdapter(balances),
    fx: new FixtureFxAdapter(fx),
    cost: new FixtureCostAdapter(cost),
  };
}
