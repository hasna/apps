import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { createLoopsApiServer } from "../api/index.js";
import { createSqliteLoopStorage } from "../lib/storage/sqlite.js";
import { logRunnerCommandFailure, runRunnerLoop, runRunnerOnce, runnerStatus } from "./index.js";

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

describe("loops-runner", () => {
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
        apiKey: "test-token",
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

  test("runRunnerOnce emits best-effort Knowledge feedback after API finalization", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-runner-knowledge-"));
    const finalizedMarker = join(root, "finalized.txt");
    const observedMarker = join(root, "observed.txt");
    const command = join(root, "knowledge-fixture.ts");
    const secret = ["ghp", "1234567890abcdef1234567890abcdef"].join("_");
    writeFileSync(command, [
      "#!/usr/bin/env bun",
      'import { existsSync, writeFileSync } from "node:fs";',
      `writeFileSync(${JSON.stringify(observedMarker)}, JSON.stringify({`,
      `  phase: existsSync(${JSON.stringify(finalizedMarker)}) ? "after-finalize" : "before-finalize",`,
      "  args: process.argv.slice(2),",
      "}));",
      "process.exit(9);",
      "",
    ].join("\n"));
    chmodSync(command, 0o755);

    const claim = {
      loop: {
        id: "loop-knowledge-runner",
        name: "runner-knowledge-loop",
        status: "active",
        schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
        target: {
          type: "command",
          command: "true",
          knowledgeFeedback: { enabled: true, command },
        },
        catchUp: "latest",
        catchUpLimit: 1,
        overlap: "skip",
        maxAttempts: 1,
        retryDelayMs: 1_000,
        leaseMs: 60_000,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      run: {
        id: "run-knowledge-runner",
        loopId: "loop-knowledge-runner",
        loopName: "runner-knowledge-loop",
        scheduledFor: "2026-01-01T00:00:00.000Z",
        attempt: 1,
        status: "running",
        startedAt: "2026-01-01T00:00:00.000Z",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      claimToken: "knowledge-claim-token",
    };
    const response = (body: unknown, status = 200): Response => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }) as Response;
    const fetchImpl = (async (url: string | URL) => {
      const path = String(url);
      if (path.endsWith("/v1/runners/claim")) {
        return response({ ok: true, claims: [claim] });
      }
      if (path.includes("/heartbeat")) {
        return response({ ok: true });
      }
      if (path.includes("/finalize")) {
        writeFileSync(finalizedMarker, "finalized");
        return response({
          ok: true,
          run: {
            ...claim.run,
            status: "failed",
            finishedAt: "2026-01-01T00:00:01.000Z",
            durationMs: 1_000,
            error: "runner failure",
            exitCode: 1,
          },
        });
      }
      return response({ error: "not_found" }, 404);
    }) as unknown as typeof fetch;

    try {
      const result = await runRunnerOnce({
        apiUrl: "http://127.0.0.1:1/",
        apiKey: "test-token",
        runnerId: "runner-knowledge",
        fetchImpl,
        execute: async (_loop, run) => ({
          status: "failed",
          startedAt: run.startedAt ?? "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: `runner stdout ${secret}`,
          stderr: `runner stderr ${secret}`,
          error: `runner failure ${secret}`,
          exitCode: 1,
        }),
      });

      expect(result).toMatchObject({ ok: false, claimed: 1 });
      expect(result.completed[0]?.status).toBe("failed");
      const observed = JSON.parse(readFileSync(observedMarker, "utf8")) as {
        phase: string;
        args: string[];
      };
      expect(observed.phase).toBe("after-finalize");
      expect(observed.args.join("\n")).not.toContain(secret);
      expect(observed.args.join("\n")).toContain("[SCRUBBED]");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("runRunnerOnce executes a workflow claim through runner-scoped API state", async () => {
    const root = mkdtempSync(join(tmpdir(), "loops-runner-workflow-"));
    const marker = join(root, "marker.txt");
    const storage = createSqliteLoopStorage(":memory:");
    const server = createRunnerServer(storage, "runner-workflow", () => new Date("2026-01-01T00:00:00Z"));
    try {
      const workflow = await storage.createWorkflow({
        name: "runner-remote-workflow",
        steps: [{
          id: "write-marker",
          target: { type: "command", command: `printf remote-workflow > ${JSON.stringify(marker)}`, shell: true },
        }],
      });
      const loop = await storage.createLoop(
        {
          name: "runner-remote-workflow-loop",
          schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
          target: { type: "workflow", workflowId: workflow.id },
          leaseMs: 60_000,
        },
        new Date("2025-12-31T00:00:00Z"),
      );

      const result = await runRunnerOnce({
        apiUrl: `http://127.0.0.1:${server.port}`,
        apiKey: "test-token",
        runnerId: "runner-workflow",
        now: new Date("2026-01-01T00:00:00Z"),
        heartbeatIntervalMs: 10_000,
      });

      expect(result).toMatchObject({ ok: true, claimed: 1 });
      expect(result.completed[0]).toMatchObject({ id: expect.any(String), status: "succeeded" });
      expect(readFileSync(marker, "utf8")).toBe("remote-workflow");
      const loopRuns = await storage.listRuns({ loopId: loop.id });
      expect(loopRuns).toHaveLength(1);
      expect(loopRuns[0]).toMatchObject({ status: "succeeded", claimedBy: "runner-workflow" });
      const workflowRuns = await storage.listWorkflowRuns({ workflowId: workflow.id });
      expect(workflowRuns).toHaveLength(1);
      expect(workflowRuns[0]).toMatchObject({ loopRunId: loopRuns[0]!.id, status: "succeeded" });
      expect((await storage.listWorkflowStepRuns(workflowRuns[0]!.id))[0]).toMatchObject({
        stepId: "write-marker",
        status: "succeeded",
      });
      expect(await storage.getLoop(loop.id)).toMatchObject({ status: "stopped", nextRunAt: undefined });
    } finally {
      server.stop(true);
      await storage.close();
      rmSync(root, { recursive: true, force: true });
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
        apiKey: "test-token",
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

  test("runRunnerLoop keeps polling while idle without real sleeps", async () => {
    const claimCalls: string[] = [];
    const sleeps: number[] = [];
    const fetchImpl = (async (url: string | URL) => {
      claimCalls.push(String(url));
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, claims: [] }),
      } as Response;
    }) as unknown as typeof fetch;

    const result = await runRunnerLoop({
      apiUrl: "https://loops.example.test",
      apiKey: "test-key",
      runnerId: "runner-loop",
      maxIterations: 3,
      pollIntervalMs: 25,
      fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(result).toMatchObject({ ok: true, claimed: 0, completed: [], iterations: 3, errors: 0, idle: false });
    expect(claimCalls.filter((url) => url.endsWith("/v1/runners/claim"))).toHaveLength(3);
    expect(sleeps).toEqual([25, 25]);
  });

  test("runRunnerLoop drains a claimed run before sleeping again", async () => {
    const claim = {
      loop: { id: "loop-1", name: "loop-1", leaseMs: 10_000 },
      run: { id: "run-1", loopId: "loop-1", scheduledFor: "2026-01-01T00:00:00.000Z", startedAt: "2026-01-01T00:00:00.000Z" },
      claimToken: "claim-token",
    };
    let claimCalls = 0;
    const sleeps: number[] = [];
    const fetchImpl = (async (url: string | URL) => {
      const text = String(url);
      if (text.endsWith("/v1/runners/claim")) {
        claimCalls += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ ok: true, claims: claimCalls === 1 ? [claim] : [] }),
        } as Response;
      }
      if (text.includes("/heartbeat")) {
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
      }
      if (text.includes("/finalize")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, run: { ...claim.run, status: "succeeded" } }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({ error: "not_found" }) } as Response;
    }) as unknown as typeof fetch;

    const result = await runRunnerLoop({
      apiUrl: "https://loops.example.test",
      apiKey: "test-key",
      runnerId: "runner-loop",
      maxIterations: 2,
      pollIntervalMs: 25,
      fetchImpl,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      execute: async (_loop, run) => ({
        status: "succeeded",
        startedAt: run.startedAt ?? "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:01.000Z",
        durationMs: 1_000,
        stdout: "",
        stderr: "",
        exitCode: 0,
      }),
    });

    expect(result).toMatchObject({ ok: true, claimed: 1, iterations: 2, errors: 0 });
    expect(result.completed[0]).toMatchObject({ id: "run-1", status: "succeeded" });
    expect(sleeps).toEqual([]);
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
      apiKey: "test-token",
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
