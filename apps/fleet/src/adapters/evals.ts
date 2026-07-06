import type { AdapterQuery, EvalsAdapter, EvalsSample } from "./types.js";
import { agentsForEntity } from "./fixtures.js";

// Fixture read-adapter for @hasna/evals (quality scores per agent).
export class FixtureEvalsAdapter implements EvalsAdapter {
  readonly source = "evals" as const;

  getSamples(q: AdapterQuery): EvalsSample[] {
    return agentsForEntity(q.entity_id)
      .filter((a) => !q.target_ref || a.ref === q.target_ref)
      .map((a) => ({ target_ref: a.ref, score: a.eval_score }));
  }
}
