import type { GlLine } from "../types/index.js";
import { FIXTURE_ENTITY_RO, FIXTURE_ENTITY_US } from "./entities.js";

// Read-adapter for the iapp-accounting GL / trial-balance source (§1a v0).
// MOCKED for the build: fixtures return per-entity, per-period trial balances in
// each entity's functional currency. v1 swaps this for a live accounting adapter
// behind HASNA_CONSOLIDATIONS_LIVE_UPSTREAM=1.

export interface TrialBalance {
  entity_id: string;
  period: string;
  currency: string;
  lines: GlLine[];
}

export interface GlSource {
  fetchTrialBalance(entityId: string, period: string): Promise<TrialBalance | null>;
}

// Deterministic fixtures for period 2026-Q1. Sign convention: debit positive,
// credit negative (a balanced trial balance sums to zero). Intercompany balances
// are constructed to net exactly at group after FX translation.
const FIXTURES: TrialBalance[] = [
  {
    entity_id: FIXTURE_ENTITY_US,
    period: "2026-Q1",
    currency: "USD",
    lines: [
      { account_code: "1000", account_name: "Operating Cash", account_type: "asset", balance: 100000 },
      { account_code: "1200", account_name: "Due from Hasna SRL", account_type: "asset", balance: 20000 },
      { account_code: "4000", account_name: "Service Revenue", account_type: "revenue", balance: -80000 },
      { account_code: "4100", account_name: "Intercompany Revenue", account_type: "revenue", balance: -15000 },
      { account_code: "6000", account_name: "Operating Expense", account_type: "expense", balance: 50000 },
      { account_code: "3000", account_name: "Common Equity", account_type: "equity", balance: -75000 },
    ],
  },
  {
    entity_id: FIXTURE_ENTITY_RO,
    period: "2026-Q1",
    currency: "RON",
    lines: [
      { account_code: "1000", account_name: "Cont Curent", account_type: "asset", balance: 250000 },
      { account_code: "2200", account_name: "Datorii Intragrup", account_type: "liability", balance: -80000 },
      { account_code: "6100", account_name: "Cheltuieli Intragrup", account_type: "expense", balance: 75000 },
      { account_code: "7000", account_name: "Venituri", account_type: "revenue", balance: -300000 },
      { account_code: "6000", account_name: "Cheltuieli Operationale", account_type: "expense", balance: 150000 },
      { account_code: "1010", account_name: "Capital Social", account_type: "equity", balance: -95000 },
    ],
  },
];

export class FixtureGlSource implements GlSource {
  async fetchTrialBalance(entityId: string, period: string): Promise<TrialBalance | null> {
    return FIXTURES.find((tb) => tb.entity_id === entityId && tb.period === period) ?? null;
  }
}

/** The active GL source (fixture in v0). Provenance string recorded on imports. */
export function glSource(): { source: GlSource; provenance: string } {
  return { source: new FixtureGlSource(), provenance: "iapp-accounting:fixture" };
}
