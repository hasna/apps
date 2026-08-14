import type { Database } from "bun:sqlite";
import type { AdapterQuery, FleetAdapters } from "../adapters/types.js";
import { listAlertThresholds, listSlos, getErrorBudgetPolicyForSlo, getSlo } from "../db/crud.js";
import {
  type CostSummary,
  type FleetAlert,
  type HealthRollup,
  type Slo,
  type SloStatus,
  type TokenBurn,
  type TraceDetail,
  type TraceSummary,
  TraceNotFoundError,
} from "../types/index.js";

// READ-ONLY fused-observability layer. Every function here derives values from
// the upstream read-adapters (never writes upstream). SLO/alert evaluation joins
// fleet's OWN config (slos, budgets, thresholds) with fused metrics.

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function nowIso(): string {
  return "2026-07-06T00:00:00.000Z"; // deterministic generation stamp for golden tests
}

function query(entityId: string, targetType: "agent" | "company", windowDays: number, targetRef?: string): AdapterQuery {
  return targetRef === undefined
    ? { entity_id: entityId, target_type: targetType, window_days: windowDays }
    : { entity_id: entityId, target_type: targetType, window_days: windowDays, target_ref: targetRef };
}

function classify(errorRate: number, evalScore: number | null): HealthRollup["status"] {
  if (errorRate >= 5) return "unhealthy";
  if (errorRate >= 1 || (evalScore !== null && evalScore < 0.7)) return "degraded";
  return "healthy";
}

/** Per-agent fused health for an entity (monitor + logs + evals). */
export function agentHealth(
  adapters: FleetAdapters,
  entityId: string,
  windowDays: number,
  targetRef?: string,
): HealthRollup[] {
  const monitor = adapters.monitor.getSamples(query(entityId, "agent", windowDays, targetRef));
  const evals = adapters.evals.getSamples(query(entityId, "agent", windowDays, targetRef));
  const evalByRef = new Map(evals.map((e) => [e.target_ref, e.score]));

  return monitor.map((m) => {
    const errorRate = m.requests > 0 ? round2((m.errors / m.requests) * 100) : 0;
    const successRate = round2(100 - errorRate);
    const evalScore = evalByRef.get(m.target_ref) ?? null;
    return {
      entity_id: entityId,
      target_type: "agent",
      target_ref: m.target_ref,
      window_days: windowDays,
      availability: m.availability_pct,
      success_rate: successRate,
      error_rate: errorRate,
      latency_p95_ms: m.latency_p95_ms,
      requests: m.requests,
      errors: m.errors,
      eval_score: evalScore,
      status: classify(errorRate, evalScore),
      generated_at: nowIso(),
    };
  });
}

/** Company-level fused health = aggregate of the entity's agents. */
export function companyHealth(adapters: FleetAdapters, entityId: string, windowDays: number): HealthRollup {
  const agents = agentHealth(adapters, entityId, windowDays);
  const requests = agents.reduce((s, a) => s + a.requests, 0);
  const errors = agents.reduce((s, a) => s + a.errors, 0);
  const errorRate = requests > 0 ? round2((errors / requests) * 100) : 0;
  const latency = agents.length > 0 ? Math.max(...agents.map((a) => a.latency_p95_ms)) : 0;
  const scored = agents.filter((a) => a.eval_score !== null);
  const evalScore = scored.length > 0 ? round2(scored.reduce((s, a) => s + (a.eval_score ?? 0), 0) / scored.length) : null;
  return {
    entity_id: entityId,
    target_type: "company",
    target_ref: entityId,
    window_days: windowDays,
    availability: round2(100 - errorRate),
    success_rate: round2(100 - errorRate),
    error_rate: errorRate,
    latency_p95_ms: latency,
    requests,
    errors,
    eval_score: evalScore,
    status: classify(errorRate, evalScore),
    generated_at: nowIso(),
  };
}

/** Token burn per agent (from economy). */
export function tokenBurn(
  adapters: FleetAdapters,
  entityId: string,
  windowDays: number,
  targetRef?: string,
): TokenBurn[] {
  const hours = windowDays * 24;
  return adapters.economy.getSamples(query(entityId, "agent", windowDays, targetRef)).map((e) => {
    const total = e.input_tokens + e.output_tokens;
    return {
      entity_id: entityId,
      target_type: "agent",
      target_ref: e.target_ref,
      window_days: windowDays,
      input_tokens: e.input_tokens,
      output_tokens: e.output_tokens,
      total_tokens: total,
      tokens_per_hour: hours > 0 ? Math.round(total / hours) : 0,
      generated_at: nowIso(),
    };
  });
}

/** Cost summary per agent (from economy). */
export function costSummary(
  adapters: FleetAdapters,
  entityId: string,
  windowDays: number,
  targetRef?: string,
): CostSummary[] {
  return adapters.economy.getSamples(query(entityId, "agent", windowDays, targetRef)).map((e) => ({
    entity_id: entityId,
    target_type: "agent",
    target_ref: e.target_ref,
    window_days: windowDays,
    cost_usd: round2(e.cost_usd),
    cost_per_day_usd: windowDays > 0 ? round2(e.cost_usd / windowDays) : 0,
    by_model: e.by_model,
    generated_at: nowIso(),
  }));
}

/** Traces for an entity (from sessions). */
export function listTraces(adapters: FleetAdapters, entityId: string, targetRef?: string, windowDays = 30): TraceSummary[] {
  return adapters.sessions.listTraces(query(entityId, "agent", windowDays, targetRef));
}

export function getTrace(adapters: FleetAdapters, entityId: string, traceId: string): TraceDetail {
  const trace = adapters.sessions.getTrace(entityId, traceId);
  if (!trace) throw new TraceNotFoundError(traceId);
  return trace;
}

// --- SLO status + error budget ---

function observedForObjective(objective: Slo["objective"], h: HealthRollup): number {
  switch (objective) {
    case "availability":
      return h.availability;
    case "success_rate":
      return h.success_rate;
    case "error_rate":
      return h.error_rate;
    case "latency_p95":
      return h.latency_p95_ms;
  }
}

function meets(objective: Slo["objective"], observed: number, target: number): boolean {
  if (objective === "error_rate" || objective === "latency_p95") return observed <= target;
  return observed >= target;
}

function healthForSlo(adapters: FleetAdapters, slo: Slo): HealthRollup {
  if (slo.target_type === "company") return companyHealth(adapters, slo.entity_id, slo.window_days);
  const agents = agentHealth(adapters, slo.entity_id, slo.window_days, slo.target_ref);
  return (
    agents[0] ?? {
      entity_id: slo.entity_id,
      target_type: "agent",
      target_ref: slo.target_ref,
      window_days: slo.window_days,
      availability: 100,
      success_rate: 100,
      error_rate: 0,
      latency_p95_ms: 0,
      requests: 0,
      errors: 0,
      eval_score: null,
      status: "healthy",
      generated_at: nowIso(),
    }
  );
}

export function evaluateSlo(db: Database, adapters: FleetAdapters, slo: Slo): SloStatus {
  const health = healthForSlo(adapters, slo);
  const observed = round2(observedForObjective(slo.objective, health));
  const meeting = meets(slo.objective, observed, slo.target_value);

  const policy = getErrorBudgetPolicyForSlo(db, slo.id);
  let budgetPercent: number | null = null;
  let consumed: number | null = null;
  let remaining: number | null = null;
  let burnAlert = false;

  if (policy && slo.objective !== "latency_p95") {
    budgetPercent = policy.budget_percent;
    const actualError = slo.objective === "error_rate" ? observed : 100 - observed;
    consumed = policy.budget_percent > 0 ? round2(actualError / policy.budget_percent) : 0;
    remaining = round2(Math.max(0, 1 - consumed));
    burnAlert = consumed >= policy.burn_alert_threshold;
  }

  const state: SloStatus["state"] = consumed !== null && consumed >= 1 ? "exhausted" : !meeting || burnAlert ? "breaching" : "ok";

  return {
    slo_id: slo.id,
    entity_id: slo.entity_id,
    target_type: slo.target_type,
    target_ref: slo.target_ref,
    objective: slo.objective,
    target_value: slo.target_value,
    observed_value: observed,
    window_days: slo.window_days,
    meeting,
    error_budget_percent: budgetPercent,
    error_budget_consumed: consumed,
    error_budget_remaining: remaining,
    burn_alert: burnAlert,
    state,
    generated_at: nowIso(),
  };
}

export function listSloStatus(db: Database, adapters: FleetAdapters, entityIds?: string[]): SloStatus[] {
  return listSlos(db, entityIds).map((slo) => evaluateSlo(db, adapters, slo));
}

export function sloStatusById(db: Database, adapters: FleetAdapters, slo: Slo): SloStatus {
  return evaluateSlo(db, adapters, slo);
}

// --- Alerts (SLO breaches + threshold breaches) ---

function compare(comparator: string, observed: number, threshold: number): boolean {
  switch (comparator) {
    case "gt":
      return observed > threshold;
    case "gte":
      return observed >= threshold;
    case "lt":
      return observed < threshold;
    case "lte":
      return observed <= threshold;
    default:
      return false;
  }
}

export function listAlerts(db: Database, adapters: FleetAdapters, entityIds?: string[]): FleetAlert[] {
  const alerts: FleetAlert[] = [];

  // SLO-derived alerts: any SLO not meeting or burning budget.
  for (const status of listSloStatus(db, adapters, entityIds)) {
    if (status.state === "ok") continue;
    alerts.push({
      id: `slo:${status.slo_id}:${status.window_days}`,
      entity_id: status.entity_id,
      source: "slo",
      ref_id: status.slo_id,
      target_ref: status.target_ref,
      metric: status.objective,
      severity: status.state === "exhausted" ? "critical" : "warning",
      observed_value: status.observed_value,
      threshold_value: status.target_value,
      message: `SLO ${status.slo_id} ${status.state}: observed ${status.observed_value} vs target ${status.target_value} (${status.objective})`,
      state: status.state,
      generated_at: nowIso(),
    });
  }

  // Threshold-derived alerts: metric comparisons over fused health.
  for (const threshold of listAlertThresholds(db, entityIds)) {
    if (!threshold.enabled) continue;
    const observed = observedMetric(db, adapters, threshold.entity_id, threshold.metric, threshold.slo_id);
    if (observed === null) continue;
    const breaching = compare(threshold.comparator, observed, threshold.threshold_value);
    if (!breaching) continue;
    alerts.push({
      id: `threshold:${threshold.id}`,
      entity_id: threshold.entity_id,
      source: "threshold",
      ref_id: threshold.id,
      target_ref: threshold.slo_id ?? threshold.entity_id,
      metric: threshold.metric,
      severity: threshold.severity,
      observed_value: round2(observed),
      threshold_value: threshold.threshold_value,
      message: `Threshold ${threshold.metric} ${threshold.comparator} ${threshold.threshold_value} breached (observed ${round2(observed)})`,
      state: "breaching",
      generated_at: nowIso(),
    });
  }

  return alerts;
}

function observedMetric(
  db: Database,
  adapters: FleetAdapters,
  entityId: string,
  metric: string,
  sloId: string | null,
): number | null {
  const health = companyHealth(adapters, entityId, 30);
  switch (metric) {
    case "error_rate":
      return health.error_rate;
    case "availability":
      return health.availability;
    case "latency_p95_ms":
      return health.latency_p95_ms;
    case "cost_usd_per_day": {
      const costs = costSummary(adapters, entityId, 30);
      return round2(costs.reduce((s, c) => s + c.cost_per_day_usd, 0));
    }
    case "error_budget_consumed": {
      if (!sloId) return null;
      const slo = getSlo(db, sloId);
      if (!slo) return null;
      return evaluateSlo(db, adapters, slo).error_budget_consumed;
    }
    default:
      return null;
  }
}
