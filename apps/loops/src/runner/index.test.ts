import { describe, expect, test } from "bun:test";
import { createLoopsApiServer } from "../api/index.js";
import { createSqliteLoopStorage } from "../lib/storage/sqlite.js";
import { logRunnerCommandFailure, runRunnerOnce, runnerStatus } from "./index.js";

function createRunnerServer(storage: ReturnType<typeof createSqliteLoopStorage>, principalId: string, now?: () => Date) {
  const principal = {
    tenantId: "tenant-test", principalId, requestId: "request-test", kid: "kid-test", agent: principalId,
    scopes: ["loops:runner"], roles: ["worker" as const], tokenKind: "machine" as const,
    claims: { v: 1, kid: "kid-test", app: "loops", agent: principalId, scopes: ["loops:runner"], iat: 1, exp: null },
  };
  return createLoopsApiServer({
    host: "127.0.0.1", port: 0, now,
    authenticator: { authenticate: async () => ({ ok: true as const, status: 200 as const, principal }) },
    withTenantStorage: (_principal, fn) => fn(storage),
  });
}

describe("loops-runner foundation", () => {
  test("command failures use stable logs without provider details", () => {
    const logged: string[] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]) => { logged.push(values.map(String).join(" ")); };
    try {
      logRunnerCommandFailure(Object.assign(new Error("postgres://user:secret@db.internal/loops"), {
        name: "postgres://name-secret@db.internal/loops",
        code: "postgres://code-secret@db.internal/loops",
      }));
      expect(logged).toEqual([JSON.stringify({ evt: "loops_runner_command_failed", errorType: "error" })]);
    } finally {
      console.error = originalError;
    }
  });

  test("reports local daemon authority by default", () => {
    const previous = process.env.HASNA_LOOPS_STORAGE_MODE;
    process.env.HASNA_LOOPS_STORAGE_MODE = "local";
    const status = runnerStatus();
    if (previous === undefined) delete process.env.HASNA_LOOPS_STORAGE_MODE;
    else process.env.HASNA_LOOPS_STORAGE_MODE = previous;

    expect(status.ok).toBe(true);
    expect(status.service).toBe("loops-runner");
    expect(status.deployment.deploymentMode).toBe("local");
    expect(status.state).toBe("local_daemon_authoritative");
  });

  test("fails closed for configured self-hosted mode without an API URL", () => {
    const previousMode = process.env.HASNA_LOOPS_STORAGE_MODE;
    const previousDatabaseUrl = process.env.HASNA_LOOPS_DATABASE_URL;
    const previousApiUrl = process.env.HASNA_LOOPS_API_URL;
    process.env.HASNA_LOOPS_STORAGE_MODE = "self_hosted";
    process.env.HASNA_LOOPS_DATABASE_URL = "postgres://loops.example.test/openloops";
    delete process.env.HASNA_LOOPS_API_URL;

    try {
      const status = runnerStatus("machine-test");

      expect(status.ok).toBe(false);
      expect(status.machineId).toBe("machine-test");
      expect(status.deployment.deploymentMode).toBe("self_hosted");
      expect(status.deployment.controlPlane.configured).toBe(true);
      expect(status.state).toBe("missing_control_plane_api_url");
    } finally {
      if (previousMode === undefined) delete process.env.HASNA_LOOPS_STORAGE_MODE;
      else process.env.HASNA_LOOPS_STORAGE_MODE = previousMode;
      if (previousDatabaseUrl === undefined) delete process.env.HASNA_LOOPS_DATABASE_URL;
      else process.env.HASNA_LOOPS_DATABASE_URL = previousDatabaseUrl;
      if (previousApiUrl === undefined) delete process.env.HASNA_LOOPS_API_URL;
      else process.env.HASNA_LOOPS_API_URL = previousApiUrl;
    }
  });

  test("reports ready when a self-hosted API URL and token are configured", () => {
    const previousMode = process.env.HASNA_LOOPS_STORAGE_MODE;
    const previousApiUrl = process.env.HASNA_LOOPS_API_URL;
    const previousToken = process.env.HASNA_LOOPS_API_KEY;
    process.env.HASNA_LOOPS_STORAGE_MODE = "self_hosted";
    process.env.HASNA_LOOPS_API_URL = "https://loops.example.test";
    process.env.HASNA_LOOPS_API_KEY = "token-present";

    try {
      const status = runnerStatus("machine-test");

      expect(status.ok).toBe(true);
      expect(status.state).toBe("control_plane_ready");
    } finally {
      if (previousMode === undefined) delete process.env.HASNA_LOOPS_STORAGE_MODE;
      else process.env.HASNA_LOOPS_STORAGE_MODE = previousMode;
      if (previousApiUrl === undefined) delete process.env.HASNA_LOOPS_API_URL;
      else process.env.HASNA_LOOPS_API_URL = previousApiUrl;
      if (previousToken === undefined) delete process.env.HASNA_LOOPS_API_KEY;
      else process.env.HASNA_LOOPS_API_KEY = previousToken;
    }
  });

  test("runRunnerOnce claims, executes, and finalizes one API run", async () => {
    const storage = createSqliteLoopStorage(":memory:");
    const server = createRunnerServer(storage, "runner-once");
    try {
      const loop = await storage.createLoop(
        {
          name: "runner-once-loop",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
        },
        new Date("2025-12-31T00:00:00Z"),
      );

      const result = await runRunnerOnce({
        apiUrl: `http://127.0.0.1:${server.port}`,
        runnerId: "runner-once",
        now: new Date("2026-01-01T00:00:00Z"),
        execute: async (_loop, run) => ({
          status: "succeeded",
          startedAt: run.startedAt ?? "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: "done",
          stderr: "",
          exitCode: 0,
        }),
      });

      expect(result).toMatchObject({ ok: true, claimed: 1 });
      expect(result.completed[0]).toMatchObject({ status: "succeeded", claimedBy: "runner-once" });
      expect(await storage.getLoop(loop.id)).toMatchObject({ status: "stopped", nextRunAt: undefined });
      expect(await storage.countRuns("succeeded")).toBe(1);
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("runRunnerOnce heartbeats while executing so another runner cannot steal the claim", async () => {
    const storage = createSqliteLoopStorage(":memory:");
    let serverNow = new Date("2026-01-01T00:00:00Z");
    const server = createRunnerServer(storage, "runner-a", () => serverNow);
    let releaseExecution!: () => void;
    const executionReleased = new Promise<void>((resolve) => {
      releaseExecution = resolve;
    });
    let executionStarted!: () => void;
    const executionStartedPromise = new Promise<void>((resolve) => {
      executionStarted = resolve;
    });

    try {
      const loop = await storage.createLoop(
        {
          name: "runner-heartbeat-loop",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "command", command: "true" },
          overlap: "allow",
          leaseMs: 10,
        },
        new Date("2025-12-31T00:00:00Z"),
      );

      const runner = runRunnerOnce({
        apiUrl: `http://127.0.0.1:${server.port}`,
        runnerId: "runner-a",
        execute: async (_loop, run) => {
          executionStarted();
          await executionReleased;
          return {
            status: "succeeded",
            startedAt: run.startedAt ?? "2026-01-01T00:00:00.000Z",
            finishedAt: "2026-01-01T00:00:01.300Z",
            durationMs: 1_300,
            stdout: "",
            stderr: "",
            exitCode: 0,
          };
        },
      });

      await executionStartedPromise;
      serverNow = new Date("2026-01-01T00:00:00.700Z");
      await new Promise((resolve) => setTimeout(resolve, 600));
      serverNow = new Date("2026-01-01T00:00:01.200Z");

      const duplicate = await fetch(`http://127.0.0.1:${server.port}/v1/runners/claim`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runnerId: "runner-b", maxClaims: 1 }),
      });
      expect(duplicate.status).toBe(403);
      expect(await duplicate.json()).toMatchObject({ ok: false, error: "runner_identity_mismatch" });

      releaseExecution();
      const result = await runner;
      expect(result).toMatchObject({ ok: true, claimed: 1 });
      expect(await storage.getLoop(loop.id)).toMatchObject({ status: "stopped", nextRunAt: undefined });
      expect(await storage.listRuns({ loopId: loop.id })).toHaveLength(1);
    } finally {
      releaseExecution?.();
      server.stop(true);
      await storage.close();
    }
  });

  test("runRunnerOnce rejects non-local API URLs without a token", async () => {
    await expect(runRunnerOnce({ apiUrl: "https://loops.example.test", runnerId: "runner", env: {} })).rejects.toThrow("requires HASNA_LOOPS_API_KEY");
  });

  // Regression (MEDIUM 4): if control-plane heartbeats keep failing, the lease is
  // (almost certainly) lost and the run may be reassigned. The runner must abort
  // execution after N consecutive heartbeat failures instead of running blind on
  // a lost lease and racing a second executor.
  test("runRunnerOnce aborts execution after consecutive heartbeat failures", async () => {
    const claim = {
      loop: { id: "l1", name: "l1", leaseMs: 10_000 },
      run: { id: "r1", loopId: "l1", scheduledFor: "2026-01-01T00:00:00.000Z", startedAt: "2026-01-01T00:00:00.000Z" },
      claimToken: "tok",
    };
    const jsonResponse = (body: unknown, status = 200): Response =>
      ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
    let heartbeatCalls = 0;
    // First heartbeat succeeds (it is awaited before execution starts); every
    // subsequent one fails to simulate a lost lease.
    const fetchImpl = (async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith("/v1/runners/claim")) return jsonResponse({ ok: true, claims: [claim] });
      if (u.includes("/heartbeat")) {
        heartbeatCalls += 1;
        return heartbeatCalls === 1 ? jsonResponse({ ok: true }) : jsonResponse({ error: "lease lost" }, 409);
      }
      if (u.includes("/finalize")) return jsonResponse({ run: { ...claim.run, status: "timed_out" } });
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;

    let sawAbort = false;
    await runRunnerOnce({
      apiUrl: "http://127.0.0.1:1/",
      runnerId: "runner-hb",
      heartbeatIntervalMs: 5,
      fetchImpl,
      execute: async (_loop, _run, opts) => {
        await new Promise<void>((resolve) => {
          if (opts?.signal?.aborted) {
            sawAbort = true;
            resolve();
            return;
          }
          opts?.signal?.addEventListener(
            "abort",
            () => {
              sawAbort = true;
              resolve();
            },
            { once: true },
          );
        });
        return {
          status: "timed_out",
          startedAt: "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:00:00.100Z",
          durationMs: 100,
          stdout: "",
          stderr: "",
          error: "aborted after heartbeat failures",
        };
      },
    });

    expect(sawAbort).toBe(true);
    // One success plus three consecutive failures trips the abort.
    expect(heartbeatCalls).toBeGreaterThanOrEqual(4);
  });
});
