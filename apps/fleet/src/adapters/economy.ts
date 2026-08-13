import type { AdapterQuery, EconomyAdapter, EconomySample } from "./types.js";
import { agentsForEntity } from "./fixtures.js";

// Fixture read-adapter for @hasna/economy (token usage + cost by model).
export class FixtureEconomyAdapter implements EconomyAdapter {
  readonly source = "economy" as const;

  getSamples(q: AdapterQuery): EconomySample[] {
    const scale = q.window_days / 30;
    return agentsForEntity(q.entity_id)
      .filter((a) => !q.target_ref || a.ref === q.target_ref)
      .map((a) => ({
        target_ref: a.ref,
        input_tokens: Math.round(a.input_tokens * scale),
        output_tokens: Math.round(a.output_tokens * scale),
        cost_usd: round2(a.cost_usd * scale),
        by_model: a.models.map((m) => ({
          model: m.model,
          cost_usd: round2(m.cost_usd * scale),
          total_tokens: Math.round(m.total_tokens * scale),
        })),
      }));
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
