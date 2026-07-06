import type { TraceDetail, TraceSummary } from "../types/index.js";

// Deterministic fixture dataset backing the v0 read-adapters. Two entities, a
// handful of agents, stable numbers so golden tests are reproducible.

export const FIXTURE_ENTITIES = [
  { id: "11111111-1111-4111-8111-111111111111", slug: "hasna-inc-us", name: "Hasna Inc" },
  { id: "22222222-2222-4222-8222-222222222222", slug: "acme-ro", name: "Acme RO" },
] as const;

export const HASNA_INC = FIXTURE_ENTITIES[0].id;
export const ACME_RO = FIXTURE_ENTITIES[1].id;

export interface FixtureAgent {
  entity_id: string;
  ref: string;
  requests: number;
  errors: number;
  latency_p95_ms: number;
  log_count: number;
  error_logs: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  models: { model: string; cost_usd: number; total_tokens: number }[];
  eval_score: number | null;
}

// window numbers are expressed per 30-day baseline window; the rollup scales by
// window_days / 30 so shorter/longer windows are proportional & deterministic.
export const FIXTURE_AGENTS: FixtureAgent[] = [
  {
    entity_id: HASNA_INC,
    ref: "researcher",
    requests: 12000,
    errors: 60,
    latency_p95_ms: 820,
    log_count: 48000,
    error_logs: 120,
    input_tokens: 18_000_000,
    output_tokens: 6_000_000,
    cost_usd: 540.5,
    models: [
      { model: "claude-opus", cost_usd: 400.0, total_tokens: 14_000_000 },
      { model: "claude-haiku", cost_usd: 140.5, total_tokens: 10_000_000 },
    ],
    eval_score: 0.92,
  },
  {
    entity_id: HASNA_INC,
    ref: "builder",
    requests: 8000,
    errors: 240,
    latency_p95_ms: 1500,
    log_count: 32000,
    error_logs: 500,
    input_tokens: 9_000_000,
    output_tokens: 4_500_000,
    cost_usd: 300.0,
    models: [{ model: "claude-sonnet", cost_usd: 300.0, total_tokens: 13_500_000 }],
    eval_score: 0.78,
  },
  {
    entity_id: HASNA_INC,
    ref: "triage",
    requests: 20000,
    errors: 20,
    latency_p95_ms: 300,
    log_count: 60000,
    error_logs: 40,
    input_tokens: 3_000_000,
    output_tokens: 1_000_000,
    cost_usd: 60.0,
    models: [{ model: "claude-haiku", cost_usd: 60.0, total_tokens: 4_000_000 }],
    eval_score: 0.95,
  },
  {
    entity_id: ACME_RO,
    ref: "sales-agent",
    requests: 5000,
    errors: 350,
    latency_p95_ms: 2100,
    log_count: 15000,
    error_logs: 700,
    input_tokens: 4_000_000,
    output_tokens: 2_000_000,
    cost_usd: 180.0,
    models: [{ model: "gpt-4o", cost_usd: 180.0, total_tokens: 6_000_000 }],
    eval_score: 0.61,
  },
];

export function agentsForEntity(entityId: string): FixtureAgent[] {
  return FIXTURE_AGENTS.filter((a) => a.entity_id === entityId);
}

export function entitySlug(entityId: string): string | null {
  return FIXTURE_ENTITIES.find((e) => e.id === entityId)?.slug ?? null;
}

// --- fixture traces (sessions) ---

function makeTrace(entityId: string, ref: string, index: number, status: "ok" | "error"): TraceDetail {
  const traceId = `trace-${ref}-${index}`;
  const startedAt = `2026-07-0${(index % 5) + 1}T10:0${index % 6}:00.000Z`;
  const duration = 400 + index * 250 + (status === "error" ? 1200 : 0);
  const tokens = 12000 + index * 3000;
  const cost = Math.round((tokens / 1_000_000) * 15 * 100) / 100;
  return {
    trace_id: traceId,
    entity_id: entityId,
    target_ref: ref,
    session_id: `sess-${ref}-${Math.floor(index / 2)}`,
    started_at: startedAt,
    duration_ms: duration,
    status,
    spans: 3,
    total_tokens: tokens,
    cost_usd: cost,
    spans_detail: [
      { span_id: `${traceId}-s0`, parent_span_id: null, name: "session.start", kind: "log", started_at: startedAt, duration_ms: 5, status: "ok", attributes: { agent: ref } },
      { span_id: `${traceId}-s1`, parent_span_id: `${traceId}-s0`, name: "llm.completion", kind: "llm", started_at: startedAt, duration_ms: duration - 100, status, attributes: { model: "claude-opus", tokens } },
      { span_id: `${traceId}-s2`, parent_span_id: `${traceId}-s1`, name: "tool.call", kind: "tool", started_at: startedAt, duration_ms: 90, status, attributes: { tool: "search" } },
    ],
  };
}

export function fixtureTraces(entityId: string, ref?: string): TraceDetail[] {
  const agents = agentsForEntity(entityId).filter((a) => !ref || a.ref === ref);
  const traces: TraceDetail[] = [];
  for (const agent of agents) {
    for (let i = 0; i < 4; i++) {
      traces.push(makeTrace(entityId, agent.ref, i, i === 3 ? "error" : "ok"));
    }
  }
  return traces;
}

export function toTraceSummary(t: TraceDetail): TraceSummary {
  const { spans_detail, ...summary } = t;
  void spans_detail;
  return summary;
}
