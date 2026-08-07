import { describe, expect, test } from "bun:test";
import { LoopsApiRequestError, logRunnerCommandFailure, runRunnerOnce } from "./index.js";

/**
 * A refused finalize must be logged with its status and retried, never dropped.
 *
 * Truncation alone does not close the defect: a 409 from a lapsed lease
 * abandons the run with exactly the same signature — an uncaught throw past
 * every writer — and until now the only record of which one had happened was a
 * message the failure logger discards on purpose.
 */

const CLAIM = {
  loop: { id: "loop-1", name: "loop-1", leaseMs: 10_000 },
  run: { id: "run-1", loopId: "loop-1", scheduledFor: "2026-01-01T00:00:00.000Z", startedAt: "2026-01-01T00:00:00.000Z" },
  claimToken: "claim-token",
};

const RESULT = {
  status: "failed" as const,
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T00:00:01.000Z",
  durationMs: 1_000,
  stdout: "output that will not fit",
  stderr: "",
  exitCode: 1,
};

function jsonResponse(body: unknown, status = 200): Response {
  return ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
}

function captureStderr(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...values: unknown[]) => { lines.push(values.map(String).join(" ")); };
  return { lines, restore: () => { console.error = original; } };
}

/** Finalize POSTs only, with the body each attempt actually sent. */
function finalizeAttempts(bodies: string[]): Array<Record<string, unknown>> {
  return bodies.map((body) => JSON.parse(body) as Record<string, unknown>);
}

describe("runner finalize failure handling", () => {
  test("keeps the claim lease alive while a refused finalize is retried", async () => {
    let leaseExpiresAt = 0;
    let finalizeCalls = 0;
    let storedStatus = "running";
    const fetchImpl = (async (url: string | URL) => {
      const target = String(url);
      if (target.endsWith("/v1/runners/claim")) return jsonResponse({ ok: true, claims: [CLAIM] });
      if (target.includes("/heartbeat")) {
        leaseExpiresAt = Date.now() + 1_000;
        return jsonResponse({ ok: true });
      }
      if (target.includes("/finalize")) {
        finalizeCalls += 1;
        if (Date.now() >= leaseExpiresAt) return jsonResponse({ error: "stale_claim" }, 409);
        if (finalizeCalls === 1) {
          // The first refusal and the runner's 500 ms retry delay together
          // cross the 1 s lease unless the heartbeat survives execution.
          await Bun.sleep(200);
          return jsonResponse({ error: "body_too_large" }, 413);
        }
        storedStatus = "failed";
        return jsonResponse({ ok: true, run: { ...CLAIM.run, status: storedStatus } });
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;

    const capture = captureStderr();
    let result;
    try {
      result = await runRunnerOnce({
        apiUrl: "http://127.0.0.1:1/",
        apiKey: "[REDACTED_SECRET]",
        runnerId: "runner-lease-retry",
        heartbeatIntervalMs: 500,
        fetchImpl,
        execute: async () => {
          await Bun.sleep(950);
          return RESULT;
        },
      });
    } finally {
      capture.restore();
    }

    expect(finalizeCalls).toBe(2);
    expect(storedStatus).toBe("failed");
    expect(result.completed[0]).toMatchObject({ id: "run-1", status: "failed" });
  });

  test("a refused finalize is retried rather than abandoning the run", async () => {
    const finalizeBodies: string[] = [];
    let finalizeCalls = 0;
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith("/v1/runners/claim")) return jsonResponse({ ok: true, claims: [CLAIM] });
      if (target.includes("/heartbeat")) return jsonResponse({ ok: true });
      if (target.includes("/finalize")) {
        finalizeCalls += 1;
        finalizeBodies.push(String(init?.body ?? ""));
        // Transient failure on the first attempt, accepted on the retry.
        if (finalizeCalls === 1) return jsonResponse({ error: "storage_unavailable" }, 503);
        return jsonResponse({ ok: true, run: { ...CLAIM.run, status: "failed" } });
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;

    const capture = captureStderr();
    let result;
    try {
      result = await runRunnerOnce({
        apiUrl: "http://127.0.0.1:1/",
        apiKey: "test-token",
        runnerId: "runner-retry",
        heartbeatIntervalMs: 10_000,
        fetchImpl,
        execute: async () => RESULT,
      });
    } finally {
      capture.restore();
    }

    expect(finalizeCalls).toBe(2);
    expect(result.completed[0]).toMatchObject({ id: "run-1", status: "failed" });

    // The failure carried its status, which is what distinguishes 413 from 409.
    const failures = capture.lines.map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.evt === "loops_runner_finalize_failed");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ runId: "run-1", attempt: 1, status: 503, code: "storage_unavailable" });
  });

  // The compensating write. If the control plane will not take the output, the
  // run's terminal status still has to land, because a run stuck in `running`
  // suppresses its loop indefinitely under overlap:skip.
  test("a persistently oversized body still finalizes, without its output", async () => {
    const finalizeBodies: string[] = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith("/v1/runners/claim")) return jsonResponse({ ok: true, claims: [CLAIM] });
      if (target.includes("/heartbeat")) return jsonResponse({ ok: true });
      if (target.includes("/finalize")) {
        const body = String(init?.body ?? "");
        finalizeBodies.push(body);
        const parsed = JSON.parse(body) as Record<string, unknown>;
        // Refuse anything still carrying output, however small.
        if ((parsed.stdout as string).length > 0) return jsonResponse({ error: "body_too_large" }, 413);
        return jsonResponse({ ok: true, run: { ...CLAIM.run, status: "failed" } });
      }
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;

    const capture = captureStderr();
    let result;
    try {
      result = await runRunnerOnce({
        apiUrl: "http://127.0.0.1:1/",
        apiKey: "test-token",
        runnerId: "runner-degraded",
        heartbeatIntervalMs: 10_000,
        fetchImpl,
        execute: async () => RESULT,
      });
    } finally {
      capture.restore();
    }

    expect(result.completed[0]).toMatchObject({ id: "run-1", status: "failed" });

    const attempts = finalizeAttempts(finalizeBodies);
    expect(attempts).toHaveLength(3);
    // The accepted body kept the terminal status and said why the output is gone.
    expect(attempts[2]).toMatchObject({ status: "failed", exitCode: 1, stdout: "", stderr: "" });
    expect(String(attempts[2]!.error)).toContain("body_too_large");

    const events = capture.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events.some((entry) => entry.evt === "loops_runner_finalize_degraded")).toBe(true);
    expect(events.filter((entry) => entry.evt === "loops_runner_finalize_failed").map((entry) => entry.status)).toEqual([413, 413]);
  });

  test("a run whose lease has lapsed reports 409 rather than a bare error type", async () => {
    const fetchImpl = (async (url: string | URL) => {
      const target = String(url);
      if (target.endsWith("/v1/runners/claim")) return jsonResponse({ ok: true, claims: [CLAIM] });
      if (target.includes("/heartbeat")) return jsonResponse({ ok: true });
      if (target.includes("/finalize")) return jsonResponse({ error: "run_finalization_conflict" }, 409);
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;

    const capture = captureStderr();
    try {
      await expect(runRunnerOnce({
        apiUrl: "http://127.0.0.1:1/",
        apiKey: "test-token",
        runnerId: "runner-conflict",
        heartbeatIntervalMs: 10_000,
        fetchImpl,
        execute: async () => RESULT,
      })).rejects.toThrow("run_finalization_conflict");
    } finally {
      capture.restore();
    }

    const statuses = capture.lines.map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry.evt === "loops_runner_finalize_failed")
      .map((entry) => entry.status);
    // Two budgeted attempts plus the minimal-body compensating write.
    expect(statuses).toEqual([409, 409, 409]);
  });

  test("logRunnerCommandFailure carries the status and code for control-plane failures", () => {
    const capture = captureStderr();
    try {
      logRunnerCommandFailure(new LoopsApiRequestError(413, "body_too_large"));
    } finally {
      capture.restore();
    }
    expect(JSON.parse(capture.lines[0]!)).toEqual({
      evt: "loops_runner_command_failed",
      status: 413,
      code: "body_too_large",
      errorType: "error",
    });
  });

  // The negative arm of the same logger: an ordinary Error still has its message
  // suppressed, because that message can be a connection string.
  test("logRunnerCommandFailure still suppresses provider details for ordinary errors", () => {
    const capture = captureStderr();
    try {
      logRunnerCommandFailure(new Error("postgres://user:secret@db.internal/loops"));
    } finally {
      capture.restore();
    }
    expect(capture.lines[0]).not.toContain("secret");
    expect(JSON.parse(capture.lines[0]!)).toEqual({ evt: "loops_runner_command_failed", errorType: "error" });
  });
});
