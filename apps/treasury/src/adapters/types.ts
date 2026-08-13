// Read-adapter interfaces for treasury's upstream dependencies (BUILD-SPEC §1a).
// treasury is a cross-app INTEGRATOR: v0 ships these interfaces backed by
// fixtures (below). v1 (gated behind HASNA_TREASURY_LIVE_UPSTREAM=1) swaps the
// fixture impls for live MCP/CLI calls to iapp-wallets / iapp-banking / an FX
// provider / a cost feed. treasury never persists upstream data as
// source-of-truth — it caches snapshots with provenance.

import type { AccountKind } from "../types/index.js";

export interface UpstreamBalance {
  entity_id: string;
  account_ref: string;
  account_kind: AccountKind;
  currency: string;
  amount_minor: number;
  as_of: string;
}

export interface UpstreamFxRate {
  base_currency: string;
  quote_currency: string;
  rate: number;
  as_of: string;
}

export interface UpstreamCostFeed {
  entity_id: string;
  currency: string;
  monthly_burn_minor: number;
  as_of: string;
}

/** Reads live/cached bank + wallet balances (iapp-banking / iapp-wallets). */
export interface BalancesAdapter {
  readonly source: string;
  fetchBalances(entityIds: string[]): Promise<UpstreamBalance[]>;
}

/** Reads FX rates from a market data provider. */
export interface FxAdapter {
  readonly source: string;
  fetchRates(): Promise<UpstreamFxRate[]>;
}

/** Reads per-entity monthly burn from a cost/accounting feed. */
export interface CostAdapter {
  readonly source: string;
  fetchCostFeeds(entityIds: string[]): Promise<UpstreamCostFeed[]>;
}

export interface UpstreamAdapters {
  balances: BalancesAdapter;
  fx: FxAdapter;
  cost: CostAdapter;
}
