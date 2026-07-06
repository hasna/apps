import type { TargetType, TraceDetail, TraceSummary } from "../types/index.js";

// Read-adapter interfaces for the upstream @hasna observability sources. fleet is
// a VIEW/aggregation layer: these adapters READ from upstream (monitor, logs,
// sessions, economy, evals) and NEVER write. v0 ships fixture implementations;
// v1 (gated by HASNA_FLEET_LIVE_UPSTREAM=1) swaps them for live MCP/CLI calls.

export interface AdapterQuery {
  entity_id: string;
  target_type: TargetType;
  /** Restrict to a single agent/company target, or omit for all under the entity. */
  target_ref?: string;
  window_days: number;
}

export interface MonitorSample {
  target_ref: string;
  requests: number;
  errors: number;
  latency_p95_ms: number;
  availability_pct: number;
}

export interface LogsSample {
  target_ref: string;
  log_count: number;
  error_count: number;
}

export interface EconomySample {
  target_ref: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  by_model: { model: string; cost_usd: number; total_tokens: number }[];
}

export interface EvalsSample {
  target_ref: string;
  score: number | null; // 0..1
}

export interface MonitorAdapter {
  readonly source: "monitor";
  getSamples(q: AdapterQuery): MonitorSample[];
}

export interface LogsAdapter {
  readonly source: "logs";
  getSamples(q: AdapterQuery): LogsSample[];
}

export interface SessionsAdapter {
  readonly source: "sessions";
  listTraces(q: AdapterQuery): TraceSummary[];
  getTrace(entityId: string, traceId: string): TraceDetail | null;
}

export interface EconomyAdapter {
  readonly source: "economy";
  getSamples(q: AdapterQuery): EconomySample[];
}

export interface EvalsAdapter {
  readonly source: "evals";
  getSamples(q: AdapterQuery): EvalsSample[];
}

export interface FleetAdapters {
  monitor: MonitorAdapter;
  logs: LogsAdapter;
  sessions: SessionsAdapter;
  economy: EconomyAdapter;
  evals: EvalsAdapter;
}
