import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { defaultAdapters } from "../src/adapters/index.js";
import { HASNA_INC } from "../src/adapters/index.js";
import * as rollup from "../src/services/rollup-service.js";
import { configService } from "../src/services/index.js";
import { TraceNotFoundError } from "../src/types/index.js";
import { cleanupTestDatabase, getDbHelper, ownerCtx, seededDb, useTestDatabase } from "./helpers/database.js";

const adapters = defaultAdapters();
let dbPath: string;

beforeEach(() => {
  dbPath = useTestDatabase("fleet-rollup");
  seededDb();
});

afterEach(() => {
  cleanupTestDatabase(dbPath);
});

describe("fused health rollups (golden)", () => {
  it("computes per-agent health from monitor + evals", () => {
    const rows = rollup.agentHealth(adapters, HASNA_INC, 30);
    const researcher = rows.find((r) => r.target_ref === "researcher")!;
    expect(researcher.error_rate).toBe(0.5);
    expect(researcher.availability).toBe(99.5);
    expect(researcher.status).toBe("healthy");
    const builder = rows.find((r) => r.target_ref === "builder")!;
    expect(builder.error_rate).toBe(3);
    expect(builder.status).toBe("degraded");
  });

  it("aggregates company health across agents", () => {
    const company = rollup.companyHealth(adapters, HASNA_INC, 30);
    expect(company.requests).toBe(40000);
    expect(company.errors).toBe(320);
    expect(company.error_rate).toBe(0.8);
    expect(company.latency_p95_ms).toBe(1500);
    expect(company.eval_score).toBe(0.88);
    expect(company.status).toBe("healthy");
  });
});

describe("token burn + cost (golden)", () => {
  it("computes token burn per hour", () => {
    const burn = rollup.tokenBurn(adapters, HASNA_INC, 30, "researcher");
    expect(burn[0]!.total_tokens).toBe(24_000_000);
    expect(burn[0]!.tokens_per_hour).toBe(33_333);
  });

  it("computes cost per day and by model", () => {
    const cost = rollup.costSummary(adapters, HASNA_INC, 30, "researcher");
    expect(cost[0]!.cost_usd).toBe(540.5);
    expect(cost[0]!.cost_per_day_usd).toBe(18.02);
    expect(cost[0]!.by_model.length).toBe(2);
  });
});

describe("traces", () => {
  it("lists and drills into a trace", () => {
    const traces = rollup.listTraces(adapters, HASNA_INC, "researcher");
    expect(traces.length).toBe(4);
    const detail = rollup.getTrace(adapters, HASNA_INC, traces[0]!.trace_id);
    expect(detail.spans_detail.length).toBe(3);
  });

  it("throws for an unknown trace", () => {
    expect(() => rollup.getTrace(adapters, HASNA_INC, "nope")).toThrow(TraceNotFoundError);
  });
});

describe("SLO status + error budgets", () => {
  it("meets an availability SLO with budget remaining", () => {
    const ctx = ownerCtx();
    const slo = configService.createSlo(ctx, { entity_id: HASNA_INC, target_type: "agent", target_ref: "researcher", name: "avail", objective: "availability", target_value: 99 });
    configService.createErrorBudgetPolicy(ctx, { slo_id: slo.id, entity_id: HASNA_INC, budget_percent: 1, burn_alert_threshold: 0.8 });
    const status = rollup.evaluateSlo(getDbHelper(), adapters, slo);
    expect(status.meeting).toBe(true);
    expect(status.observed_value).toBe(99.5);
    expect(status.error_budget_consumed).toBe(0.5);
    expect(status.error_budget_remaining).toBe(0.5);
    expect(status.burn_alert).toBe(false);
    expect(status.state).toBe("ok");
  });

  it("breaches an error-rate SLO the agent misses", () => {
    const ctx = ownerCtx();
    const slo = configService.createSlo(ctx, { entity_id: HASNA_INC, target_type: "agent", target_ref: "builder", name: "err", objective: "error_rate", target_value: 0.3 });
    const status = rollup.evaluateSlo(getDbHelper(), adapters, slo);
    expect(status.observed_value).toBe(3);
    expect(status.meeting).toBe(false);
    expect(status.state).toBe("breaching");
  });
});

describe("alerts", () => {
  it("raises an alert when a threshold is breached", () => {
    const ctx = ownerCtx();
    configService.createAlertThreshold(ctx, { entity_id: HASNA_INC, metric: "error_rate", comparator: "gt", threshold_value: 0.5, severity: "warning" });
    const alerts = rollup.listAlerts(getDbHelper(), adapters, [HASNA_INC]);
    const threshold = alerts.find((a) => a.source === "threshold");
    expect(threshold).toBeDefined();
    expect(threshold!.observed_value).toBe(0.8);
    expect(threshold!.severity).toBe("warning");
  });

  it("raises SLO alerts for breaching SLOs", () => {
    const ctx = ownerCtx();
    configService.createSlo(ctx, { entity_id: HASNA_INC, target_type: "agent", target_ref: "builder", name: "err", objective: "error_rate", target_value: 0.3 });
    const alerts = rollup.listAlerts(getDbHelper(), adapters, [HASNA_INC]);
    expect(alerts.some((a) => a.source === "slo")).toBe(true);
  });
});
