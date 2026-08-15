/**
 * One scenario list, two engines.
 *
 * Incident projection is implemented twice — SQLite in src/lib/incident-projections.ts
 * and PostgreSQL in src/server/incident-projections.ts — and "the two agree" was
 * only ever asserted for the SQLite half. A divergence in the Postgres half
 * (conflict detection, replay identity, version chaining) is invisible to every
 * test in the suite and shows up as a projector that silently accepts a
 * transition the canonical authority considers impossible.
 *
 * These scenarios are declared once, engine-agnostically, so the live-Postgres
 * public-route verifier (./incident-projection-pg.verify.ts) and the
 * deterministic local lane (./incident-projection-equivalence.test.ts) exercise
 * byte-identical inputs and assert byte-identical outcomes. When the live gate
 * is unavailable, the local lane is a real substitute rather than a different
 * question asked more conveniently.
 */

import { computeIncidentProjectionIds } from "../lib/incident-projection-contract.js";
import type { IncidentProjectionRequestV1, IncidentProjectorContext } from "../types.js";

export const SCENARIO_CONTEXT: IncidentProjectorContext = {
  tenant_id: "incident-equivalence-tenant",
  authority_id: "todos.hasna.xyz:v1",
};

export const SCENARIO_INCIDENT_ID = "22222222-2222-4222-8222-222222222222";

/** A canonical, deterministic v1-grammar request for one incident version. */
export function scenarioRequest(
  version: number,
  overrides: {
    incident_id?: string;
    status?: string;
    severity?: string;
    occurred_at?: string;
    title?: string;
    blocked_scopes?: string[];
    supersedes_id?: string | null;
    superseded_by_id?: string | null;
  } = {},
): IncidentProjectionRequestV1 {
  const incidentId = overrides.incident_id ?? SCENARIO_INCIDENT_ID;
  const ids = computeIncidentProjectionIds(SCENARIO_CONTEXT.authority_id, incidentId, version);
  const occurredAt = overrides.occurred_at ?? `2026-07-18T20:0${version}:00Z`;
  const status = overrides.status ?? "investigating";
  // `contained` and `monitoring` are invalid without a containment statement.
  // Deriving it here keeps every scenario a VALID canonical request, so a
  // conflict outcome can only mean the engine refused the transition — never
  // that the fixture was malformed.
  const containment = status === "contained" || status === "monitoring"
    ? "Traffic drained to the standby projector"
    : null;
  return {
    schema_version: 1,
    source: "todos",
    authority_id: SCENARIO_CONTEXT.authority_id,
    incident_id: incidentId,
    transition_id: ids.transition_id,
    incident_version: version,
    occurred_at: occurredAt,
    event_id: ids.event_id,
    projection_key: ids.projection_key,
    incident: {
      id: incidentId,
      title: overrides.title ?? "Cross-engine incident equivalence",
      severity: (overrides.severity ?? "high") as never,
      status: status as never,
      owner: "projector-equivalence",
      affected_scopes: ["service:conversations"],
      blocked_scopes: overrides.blocked_scopes ?? ["agent:projector-equivalence", "channel:incident-equivalence"],
      containment,
      next_action: "Prove both engines agree",
      deadline: null,
      closure_evidence: [],
      supersedes_id: overrides.supersedes_id ?? null,
      superseded_by_id: overrides.superseded_by_id ?? null,
      resolved_at: null,
      version,
      created_at: "2026-07-18T20:01:00Z",
      updated_at: occurredAt,
    },
  } as IncidentProjectionRequestV1;
}

export type ScenarioOutcome =
  | { kind: "created" }
  | { kind: "replayed" }
  | { kind: "conflict" };

export interface IncidentProjectionScenario {
  name: string;
  /** Why this scenario discriminates: what a divergent engine would do instead. */
  rationale: string;
  request: IncidentProjectionRequestV1;
  expect: ScenarioOutcome;
}

/**
 * The append scenarios, in order. Order is load-bearing: several depend on state
 * an earlier scenario established, exactly as a real projector stream does.
 */
export function appendScenarios(): IncidentProjectionScenario[] {
  const v1 = scenarioRequest(1);
  const v2 = scenarioRequest(2, { status: "contained" });
  const divergentV1 = scenarioRequest(1, { title: "A different canonical body" });
  const skipAhead = scenarioRequest(4, { incident_id: "33333333-3333-4333-8333-333333333333" });

  return [
    {
      name: "v1-created",
      rationale: "A first canonical version must be accepted exactly once and marked not-replayed.",
      request: v1,
      expect: { kind: "created" },
    },
    {
      name: "v1-exact-replay",
      rationale:
        "Todos retries. An identical event id with an identical payload is idempotent replay, "
        + "not a second projection — an engine that inserts twice double-projects every retry.",
      request: v1,
      expect: { kind: "replayed" },
    },
    {
      name: "v1-payload-divergence-conflicts",
      rationale:
        "The same event id with a DIFFERENT payload is the dangerous case: accepting it lets a "
        + "later writer silently restate canonical history under an id another system already trusts.",
      request: divergentV1,
      expect: { kind: "conflict" },
    },
    {
      name: "v2-chains-onto-v1",
      rationale: "A successor version must chain onto its immediate predecessor's transition id.",
      request: v2,
      expect: { kind: "created" },
    },
    {
      name: "v2-exact-replay",
      rationale: "Replay identity must hold at every version, not only the root.",
      request: v2,
      expect: { kind: "replayed" },
    },
    {
      name: "duplicate-v1-after-v2-conflicts",
      rationale: "A fresh v1 for an incident that already has projections must be refused.",
      request: scenarioRequest(1, { title: "Late duplicate root" }),
      expect: { kind: "conflict" },
    },
    {
      name: "version-gap-conflicts",
      rationale:
        "A version with no projected predecessor must be refused; accepting it would leave a hole "
        + "in the canonical chain that neither engine could later reconcile.",
      request: skipAhead,
      expect: { kind: "conflict" },
    },
    {
      name: "backwards-occurred-at-conflicts",
      rationale:
        "Canonical time must not move backwards across a version boundary. The timestamp is still "
        + "after incident.created_at, so this is a VALID request the engine must nonetheless refuse — "
        + "a validation error here would not prove the ordering rule ran.",
      request: scenarioRequest(3, { status: "monitoring", occurred_at: "2026-07-18T20:01:30Z" }),
      expect: { kind: "conflict" },
    },
  ];
}

/** Event ids that must resolve, and one that must not. */
export function lookupScenarios(): Array<{ name: string; event_id: string; found: boolean }> {
  return [
    { name: "v1-resolves", event_id: scenarioRequest(1).event_id, found: true },
    { name: "v2-resolves", event_id: scenarioRequest(2).event_id, found: true },
    {
      name: "unknown-event-does-not-resolve",
      event_id: "iev_00000000000000000000000000000000",
      found: false,
    },
  ];
}
