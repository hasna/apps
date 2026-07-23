import { describe, expect, test } from "bun:test";
import type { LoopRun } from "../types.js";
import type { RunFailureClassification } from "./health.js";
import { buildHealthReport, buildHealthScan, classifyRunFailure, RESTART_INTERRUPTED_RUN_PREFIX } from "./health.js";
import { Store } from "./store.js";

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
      ["provider_capacity", { stderr: "Connection lost to https://agentn.global.api5.cursor.sh attempts 1-3\nRetriableError: [resource_exhausted] Error" }],
      ["provider_unavailable", { stderr: "Error: [unavailable] getaddrinfo EAI_AGAIN api2.cursor.sh" }],
      [
        "auth",
        {
          stdout: JSON.stringify({
            type: "result",
            subtype: "success",
            is_error: true,
            api_error_status: null,
            result: "Not logged in \u00b7 Please run /login",
          }),
        },
      ],
      ["model_not_found", { error: "model gpt-x not found" }],
      ["context_length", { stderr: "maximum context length exceeded" }],
      ["schema_response_format", { error: "response_format json schema validation failed" }],
      ["node_init", { stderr: "Error [ERR_MODULE_NOT_FOUND]: Cannot find module" }],
      ["preflight", { error: "runtime preflight failed: Executable not found in PATH: codewith" }],
      ["timeout", { status: "timed_out", error: "timed out after 1000ms" }],
      ["sigsegv", { error: "terminated by SIGSEGV" }],
      ["restart_interrupted", { status: "skipped", error: `${RESTART_INTERRUPTED_RUN_PREFIX}: child process terminated by SIGTERM during daemon stop/restart` }],
      ["skipped_previous_active", { status: "skipped", error: "previous run still active" }],
      ["unknown", { error: "provider exited unexpectedly" }],
    ];

    for (const [classification, patch] of cases) {
      const signal = classifyRunFailure(run(patch));
      expect(signal?.classification).toBe(classification);
      expect(signal?.fingerprint).toMatch(/^[a-f0-9]{16}$/);
    }
  });

  test("surfaces safe provider-unavailable evidence for Cursor DNS failures", () => {
    const signal = classifyRunFailure(run({
      error: "step cursor-inprogress-audit failed: process exited with code 1",
      stderr: "Error: [unavailable] getaddrinfo EAI_AGAIN api2.cursor.sh",
      exitCode: 1,
    }));

    expect(signal?.classification).toBe("provider_unavailable");
    expect(signal?.evidence.summary).toBe("provider DNS lookup failed: EAI_AGAIN api2.cursor.sh");
    expect(signal?.evidence.stderr).toMatch(/^\[redacted \d+ chars\]$/);
    expect(signal?.fingerprint).toMatch(/^[a-f0-9]{16}$/);
  });

  test("surfaces safe provider-capacity evidence for Cursor resource_exhausted failures", () => {
    const signal = classifyRunFailure(run({
      error: "step cursor-inprogress-audit failed: process exited with code 1",
      stderr: "Connection lost to https://agentn.global.api5.cursor.sh attempts 1-3\nRetriableError: [resource_exhausted] Error",
      exitCode: 1,
    }));

    expect(signal?.classification).toBe("provider_capacity");
    expect(signal?.evidence.summary).toBe("provider capacity exhausted: resource_exhausted agentn.global.api5.cursor.sh");
    expect(signal?.fingerprint).toMatch(/^[a-f0-9]{16}$/);
  });

  test("recognizes exact and valid subdomain Cursor hosts for provider capacity", () => {
    const cases = [
      ["https://cursor.sh", "cursor.sh"],
      ["HTTPS://API2.CURSOR.SH/v1/agents", "api2.cursor.sh"],
      ["agentn.global.api5.cursor.sh:443", "agentn.global.api5.cursor.sh"],
    ];

    for (const [reference, expectedHost] of cases) {
      const signal = classifyRunFailure(run({
        stderr: `Connection lost to ${reference}\nRetriableError: [resource_exhausted] Error`,
      }));

      expect(signal?.classification).toBe("provider_capacity");
      expect(signal?.evidence.summary).toBe(`provider capacity exhausted: resource_exhausted ${expectedHost}`);
    }
  });

  test("rejects hostile and malformed Cursor-like references for provider capacity", () => {
    const references = [
      "https://api.cursor.sh.evil.example",
      "https://cursor.sh.evil.example/path",
      "https://evilcursor.sh",
      "https://cursor-sh.example",
      "https://api.cursor.sh.",
      "https://api..cursor.sh",
      "https://-api.cursor.sh",
      "https://api-.cursor.sh",
      `https://${"a".repeat(64)}.cursor.sh`,
      "https://api.cursor.sh@evil.example",
      "https://evil.example/api.cursor.sh",
      "https://api.cursor.sh%2eevil.example",
      "https://%63ursor.sh",
      "https://api\u3002cursor.sh",
      "https://api.cursor.sh\\@evil.example",
    ];

    for (const reference of references) {
      const signal = classifyRunFailure(run({
        stderr: `Connection lost to ${reference}\nRetriableError: [resource_exhausted] Error`,
      }));

      expect(signal?.classification).toBe("unknown");
      expect(signal?.evidence.summary).toBeUndefined();
    }
  });

  test("does not broaden provider-unavailable classification to unrelated failures", () => {
    const cases: Array<[RunFailureClassification, Partial<LoopRun>]> = [
      ["auth", { stderr: "Error: unauthorized invalid token" }],
      ["model_not_found", { error: "404 model not found" }],
      ["model_not_found", { error: "[unavailable] model gpt-x not found" }],
      ["model_not_found", { error: "[unavailable] model gpt-x not found api2.cursor.sh" }],
      ["schema_response_format", { error: "json schema validation failed" }],
      ["schema_response_format", { error: "[unavailable] json schema validation failed" }],
      ["schema_response_format", { error: "[unavailable] json schema validation failed https://api2.cursor.sh" }],
      ["node_init", { stderr: "Error [ERR_MODULE_NOT_FOUND]: Cannot find module" }],
      ["node_init", { stderr: "[unavailable] Error [ERR_MODULE_NOT_FOUND]: Cannot find module" }],
      ["node_init", { stderr: "[unavailable] Error [ERR_MODULE_NOT_FOUND]: Cannot find module api2.cursor.sh" }],
      ["unknown", { error: "process exited with code 1" }],
      ["unknown", { error: "[unavailable] process exited with code 1" }],
      ["unknown", { error: "[unavailable] process exited with code 1 api2.cursor.sh" }],
      ["unknown", { stderr: "network error" }],
      ["unknown", { stderr: "socket hang up api2.cursor.sh" }],
      ["unknown", { stderr: "Error: [unavailable] ECONNRESET api2.cursor.sh" }],
      ["unknown", { stderr: "Error: [unavailable] getaddrinfo EAI_AGAIN github.com" }],
    ];

    for (const [classification, patch] of cases) {
      expect(classifyRunFailure(run(patch))?.classification).toBe(classification);
    }
  });

  test("does not broaden provider-capacity classification to unrelated resource_exhausted text", () => {
    const cases: Array<[RunFailureClassification, Partial<LoopRun>]> = [
      ["unknown", { error: "RetriableError: [resource_exhausted] Error" }],
      ["unknown", { stderr: "RetriableError: [resource_exhausted] Error https://api.github.com" }],
      ["rate_limit", { stderr: "quota exceeded while calling https://api2.cursor.sh" }],
    ];

    for (const [classification, patch] of cases) {
      expect(classifyRunFailure(run(patch))?.classification).toBe(classification);
    }
  });

  test("redacts evidence included in health JSON", () => {
    const signal = classifyRunFailure(run({ error: `prefix fake-project-secret ${"x".repeat(2_050)}` }));

    expect(signal?.evidence.error).toMatch(/^\[redacted \d+ chars\]$/);
    expect(signal?.evidence.error).not.toContain("fake-project-secret");
  });

  test("reports restart-interrupted latest runs as warnings, not unhealthy workload failures", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "restart-interrupted-loop",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "sleep", args: ["10"] },
      });
      store.createSkippedRun(
        loop,
        "2026-01-01T00:00:00.000Z",
        `${RESTART_INTERRUPTED_RUN_PREFIX}: child process terminated by SIGTERM during daemon stop/restart`,
      );

      const report = buildHealthReport(store);
      expect(report.ok).toBe(true);
      expect(report.summary.unhealthy).toBe(0);
      expect(report.summary.warnings).toBe(1);
      expect(report.classifications.restart_interrupted).toBe(1);
      expect(report.expectations[0]?.check.status).toBe("warn");
      expect(report.expectations[0]?.recommendedTask).toBeUndefined();
    } finally {
      store.close();
    }
  });

  test("health scan keeps restart-interrupted latest runs out of routeable findings", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop({
        name: "restart-interrupted-scan-loop",
        schedule: { type: "interval", everyMs: 60_000 },
        target: { type: "command", command: "sleep", args: ["10"] },
      });
      store.createSkippedRun(
        loop,
        "2026-01-01T00:00:00.000Z",
        `${RESTART_INTERRUPTED_RUN_PREFIX}: child process terminated by SIGTERM during daemon stop/restart`,
      );

      const scan = buildHealthScan(store, { now: new Date("2026-01-01T00:30:00Z") });
      expect(scan.ok).toBe(true);
      expect(scan.status).toBe("ok");
      expect(scan.health.classifications.restart_interrupted).toBe(1);
      expect(scan.health.summary.warnings).toBe(1);
      expect(scan.findings).toHaveLength(0);
      expect(scan.health.expectations[0]?.recommendedTask).toBeUndefined();
    } finally {
      store.close();
    }
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
      expect(scan.findings[0]?.fingerprint).toStartWith("openloops:health-scan:stale-running:");
      expect(scan.findings[0]?.recommendedTask?.dedupeKey).toBe(scan.findings[0]?.fingerprint);
      expect(scan.findings[0]?.recommendedTask?.tags).toContain("loops");
      expect(scan.findings[0]?.recommendedTask?.tags).not.toContain("openloops");
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

  test("exhausted provider-unavailable failures remain unhealthy and routeable", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "cursor-dns-terminal",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "agent" },
          maxAttempts: 1,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "test", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      store.finalizeRun(claim!.run.id, {
        status: "failed",
        finishedAt: "2026-01-01T00:00:01.000Z",
        durationMs: 1_000,
        stderr: "Error: [unavailable] getaddrinfo EAI_AGAIN api2.cursor.sh",
        error: "process exited with code 1",
        exitCode: 1,
      }, {
        claimedBy: "test",
        claimToken: claim!.claimToken,
        now: new Date("2026-01-01T00:00:01Z"),
      });

      const report = buildHealthReport(store);
      const expectation = report.expectations[0];
      expect(report.ok).toBe(false);
      expect(expectation?.ok).toBe(false);
      expect(expectation?.failure?.classification).toBe("provider_unavailable");
      expect(expectation?.recommendedTask?.priority).toBe("high");
      expect(expectation?.recommendedTask?.description).toContain("Summary: provider DNS lookup failed: EAI_AGAIN api2.cursor.sh");
    } finally {
      store.close();
    }
  });

  test("auth failures with pending retries remain unhealthy and routeable", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "auth-pending-retry",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "agent" },
          maxAttempts: 2,
          retryDelayMs: 1_000,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const scheduledFor = "2026-01-01T00:00:00.000Z";
      const claim = store.claimRun(loop, scheduledFor, "test", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      store.finalizeRun(claim!.run.id, {
        status: "failed",
        finishedAt: "2026-01-01T00:00:01.000Z",
        durationMs: 1_000,
        stderr: "Error: invalid token",
        error: "process exited with code 1",
        exitCode: 1,
      }, {
        claimedBy: "test",
        claimToken: claim!.claimToken,
        now: new Date("2026-01-01T00:00:01Z"),
      });
      store.updateLoop(loop.id, { retryScheduledFor: scheduledFor, nextRunAt: "2026-01-01T00:00:04.000Z" });

      const report = buildHealthReport(store);
      const expectation = report.expectations[0];
      expect(report.ok).toBe(false);
      expect(expectation?.ok).toBe(false);
      expect(expectation?.check.status).toBe("fail");
      expect(expectation?.failure?.classification).toBe("auth");
      expect(expectation?.recommendedTask?.priority).toBe("high");
    } finally {
      store.close();
    }
  });

  test("exhausted provider-capacity failures remain unhealthy and routeable", () => {
    const store = new Store(":memory:");
    try {
      const loop = store.createLoop(
        {
          name: "cursor-capacity-terminal",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "agent" },
          maxAttempts: 1,
        },
        new Date("2025-12-31T00:00:00Z"),
      );
      const claim = store.claimRun(loop, "2026-01-01T00:00:00.000Z", "test", new Date("2026-01-01T00:00:00Z"));
      expect(claim).toBeDefined();
      store.finalizeRun(claim!.run.id, {
        status: "failed",
        finishedAt: "2026-01-01T00:00:01.000Z",
        durationMs: 1_000,
        stderr: "Connection lost to https://agentn.global.api5.cursor.sh attempts 1-3\nRetriableError: [resource_exhausted] Error",
        error: "process exited with code 1",
        exitCode: 1,
      }, {
        claimedBy: "test",
        claimToken: claim!.claimToken,
        now: new Date("2026-01-01T00:00:01Z"),
      });

      const report = buildHealthReport(store);
      const expectation = report.expectations[0];
      expect(report.ok).toBe(false);
      expect(report.classifications.provider_capacity).toBe(1);
      expect(expectation?.ok).toBe(false);
      expect(expectation?.failure?.classification).toBe("provider_capacity");
      expect(expectation?.recommendedTask?.priority).toBe("high");
      expect(expectation?.recommendedTask?.description).toContain("Summary: provider capacity exhausted: resource_exhausted agentn.global.api5.cursor.sh");
    } finally {
      store.close();
    }
  });
});
