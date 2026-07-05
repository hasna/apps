import { describe, expect, test } from "bun:test";
import type { LoopRun } from "../types.js";
import type { RunFailureClassification } from "./health.js";
import { Store } from "./store.js";
import { buildHealthScan, classifyRunFailure } from "./health.js";

function run(patch: Partial<LoopRun>): LoopRun {
  return {
    id: "run",
    loopId: "loop",
    loopName: "health-loop",
    scheduledFor: "2026-01-01T00:00:00.000Z",
    attempt: 1,
    status: "failed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

describe("loop health classification", () => {
  test("classifies common agent-run failures", () => {
    const cases: Array<[RunFailureClassification, Partial<LoopRun>]> = [
      ["rate_limit", { error: "429 too many requests" }],
      ["auth", { stderr: "invalid token" }],
      ["model_not_found", { error: "model gpt-x not found" }],
      ["context_length", { stderr: "maximum context length exceeded" }],
      ["schema_response_format", { error: "response_format json schema validation failed" }],
      ["node_init", { stderr: "Error [ERR_MODULE_NOT_FOUND]: Cannot find module" }],
      ["preflight", { error: "runtime preflight failed: Executable not found in PATH: codewith" }],
      ["timeout", { status: "timed_out", error: "timed out after 1000ms" }],
      ["sigsegv", { error: "terminated by SIGSEGV" }],
      ["skipped_previous_active", { status: "skipped", error: "previous run still active" }],
      ["unknown", { error: "provider exited unexpectedly" }],
    ];

    for (const [classification, patch] of cases) {
      const signal = classifyRunFailure(run(patch));
      expect(signal?.classification).toBe(classification);
      expect(signal?.fingerprint).toMatch(/^[a-f0-9]{16}$/);
    }
  });

  test("redacts evidence included in health JSON", () => {
    const signal = classifyRunFailure(run({ error: `prefix fake-project-secret ${"x".repeat(2_050)}` }));

    expect(signal?.evidence.error).toMatch(/^\[redacted \d+ chars\]$/);
    expect(signal?.evidence.error).not.toContain("fake-project-secret");
  });

  test("health scan reports stale running runs without treating fresh running runs as findings", () => {
    const store = new Store(":memory:");
    try {
      const stale = store.createLoop({
        name: "stale-running",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "sleep", args: ["60"] },
        leaseMs: 60_000,
      });
      const fresh = store.createLoop({
        name: "fresh-running",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "sleep", args: ["1"] },
        leaseMs: 60_000,
      });
      store.claimRun(stale, "2026-01-01T00:00:00.000Z", "seed", new Date("2026-01-01T00:00:00Z"));
      store.claimRun(fresh, "2026-01-01T00:29:30.000Z", "seed", new Date("2026-01-01T00:29:30Z"));

      const scan = buildHealthScan(store, { now: new Date("2026-01-01T00:30:00Z") });

      expect(scan.status).toBe("critical");
      expect(scan.counts.staleRunning).toBe(1);
      expect(scan.findings.map((finding) => finding.kind)).toEqual(["stale-running"]);
      expect(scan.findings[0]).toMatchObject({
        severity: "critical",
        loop: { id: stale.id, name: "stale-running" },
      });
      expect(scan.findings[0]?.fingerprint).toContain(stale.id);
      expect(scan.findings[0]?.recommendedTask?.dedupeKey).toBe(scan.findings[0]?.fingerprint);
    } finally {
      store.close();
    }
  });

  test("health scan status and counts include findings hidden by the output limit", () => {
    const store = new Store(":memory:");
    try {
      const stale = store.createLoop({
        name: "bounded-stale-running",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "sleep", args: ["60"] },
        leaseMs: 60_000,
      });
      store.claimRun(stale, "2026-01-01T00:00:00.000Z", "seed", new Date("2026-01-01T00:00:00Z"));

      const scan = buildHealthScan(store, { now: new Date("2026-01-01T00:30:00Z"), maxFindings: 0 });

      expect(scan.status).toBe("critical");
      expect(scan.ok).toBe(false);
      expect(scan.counts.findings).toBe(1);
      expect(scan.counts.staleRunning).toBe(1);
      expect(scan.counts.reportedFindings).toBe(0);
      expect(scan.counts.truncatedFindings).toBe(1);
      expect(scan.findings).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  test("health scan applies the limit after filtering included statuses", () => {
    const store = new Store(":memory:");
    try {
      const active = store.createLoop({
        name: "included-active",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      const expired = store.createLoop({
        name: "excluded-expired",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      const paused = store.createLoop({
        name: "included-paused",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "true" },
      });
      store.updateLoop(expired.id, { status: "expired" });
      store.updateLoop(paused.id, { status: "paused" });

      const scan = buildHealthScan(store, { includeStatuses: ["active", "paused"], limit: 2 });

      expect(scan.counts.loops).toBe(2);
      expect(scan.counts.active).toBe(1);
      expect(scan.counts.paused).toBe(1);
      expect(scan.health.expectations.map((expectation) => expectation.loop.id)).toEqual([active.id, paused.id]);
    } finally {
      store.close();
    }
  });

  test("health scan turns doctor preflight checks into bounded deduped findings", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "preflight-loop",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "missing-command" },
      });
      const scan = buildHealthScan(store, {
        doctor: {
          ok: false,
          checks: [
            { id: "loop-runs", status: "warn", message: "historical failures" },
            { id: `loop:${loop.id}:preflight`, status: "fail", message: "active loop target preflight failed", detail: "missing-command" },
          ],
        },
      });

      expect(scan.counts.preflightFindings).toBe(1);
      expect(scan.findings).toHaveLength(1);
      expect(scan.findings[0]).toMatchObject({
        kind: "preflight",
        severity: "high",
        loop: { id: loop.id, name: "preflight-loop" },
      });
      expect(scan.findings[0]?.recommendedTask?.futureNativeUpsert.command).toBe("todos task upsert");
    } finally {
      store.close();
    }
  });
});
