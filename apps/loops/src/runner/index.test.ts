import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { createLoopsApiServer } from "../api/index.js";
import { createSqliteLoopStorage } from "../lib/storage/sqlite.js";
import { applyRunnerEnvFile } from "./env-file.js";
import {
  RUNNER_PERMANENT_DENIAL_EXIT_CODE,
  RunnerPermanentDenialError,
  logRunnerCommandFailure,
  LoopsApiError,
  runRunnerLoop,
  runRunnerOnce,
  runnerPermanentDenial,
  runnerStatus,
  RunnerRefusalError,
} from "./index.js";

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
  test("command failures surface a message with URL userinfo redacted", () => {
    const logged: string[] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]) => { logged.push(values.map(String).join(" ")); };
    try {
      logRunnerCommandFailure(Object.assign(new Error("postgres://user:secret@db.internal/loops"), {
        name: "postgres://name-secret@db.internal/loops",
        code: "postgres://code-secret@db.internal/loops",
      }));
    } finally {
      console.error = originalError;
    }
    const parsed = JSON.parse(logged[0]) as Record<string, unknown>;
    expect(parsed.evt).toBe("loops_runner_command_failed");
    expect(parsed.errorType).toBe("error");
    // The message surfaces redacted (userinfo stripped, host kept); the
    // name/code fields never appear in the line.
    expect(String(parsed.message)).toBe("postgres://db.internal/loops");
    expect(JSON.stringify(parsed)).not.toContain("user:secret");
  });

  test("runner refusals surface their static reason", () => {
    const logged: string[] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]) => { logged.push(values.map(String).join(" ")); };
    try {
      logRunnerCommandFailure(
        new RunnerRefusalError(
          "loops-runner --claim-scope bound requires a control plane advertising runner.claimScope; "
            + "this one does not, so the scope would be silently ignored and this runner would claim the whole fleet's "
            + "unbound loops. Refusing to claim.",
        ),
      );
      const parsed = JSON.parse(logged[0]) as Record<string, unknown>;
      expect(parsed.evt).toBe("loops_runner_command_failed");
      expect(parsed.errorType).toBe("error");
      expect(String(parsed.message)).toContain("runner.claimScope");
      expect(String(parsed.message)).toContain("Refusing to claim");
      // The refusal message is bounded even if constructed long.
      logRunnerCommandFailure(new RunnerRefusalError("x".repeat(10_000)));
      const bounded = JSON.parse(logged[1]) as Record<string, unknown>;
      expect(String(bounded.message).length).toBeLessThanOrEqual(500);
    } finally {
      console.error = originalError;
    }
  });

  // Regression 539165c0: an API answered 825x with a wrong_token_kind 403 via
  // postJson (a foreign LoopsApiError), and the old logger journaled an opaque
  // line with no message — an invisible outage. Foreign errors must now surface
  // their message so the failure reason is diagnosable.
  test("foreign API failures surface their message so a wrong_token_kind 403 outage stays diagnosable", () => {
    const logged: string[] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]) => { logged.push(values.map(String).join(" ")); };
    try {
      logRunnerCommandFailure(new LoopsApiError("wrong_token_kind", 403));
    } finally {
      console.error = originalError;
    }
    const parsed = JSON.parse(logged[0]) as Record<string, unknown>;
    expect(parsed.evt).toBe("loops_runner_command_failed");
    expect(parsed.errorType).toBe("error");
    expect(String(parsed.message)).toContain("wrong_token_kind");
  });

  // Regression 539165c0 (credential-safety half): messages now surface for every
  // error class, so the URL-userinfo redactor is what keeps the safety invariant
  // the opaque line used to provide — scheme://user:secret@host loses the
  // userinfo but keeps the host.
  test("URL userinfo is redacted from surfaced messages while the host survives", () => {
    const logged: string[] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]) => { logged.push(values.map(String).join(" ")); };
    try {
      logRunnerCommandFailure(new Error("postgres://user:secret@db.internal/loops"));
    } finally {
      console.error = originalError;
    }
    const parsed = JSON.parse(logged[0]) as Record<string, unknown>;
    expect(String(parsed.message)).toBe("postgres://db.internal/loops");
  });

  test("non-Error throws fall back to String() and are redacted too", () => {
    const logged: string[] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]) => { logged.push(values.map(String).join(" ")); };
    try {
      logRunnerCommandFailure("raw string failure postgres://u:s@db.internal/loops");
    } finally {
      console.error = originalError;
    }
    const parsed = JSON.parse(logged[0]) as Record<string, unknown>;
    expect(parsed.errorType).toBe("string");
    expect(String(parsed.message)).toBe("raw string failure postgres://db.internal/loops");
  });

  test("bound scope against a control plane that advertises no capabilities refuses with the reason", async () => {
    // The exact production failure measured 2026-08-20: the hosted control
    // plane (private; hostname deliberately not written here) ran server 0.4.28
    // whose /version carries no capabilities array, so a 0.5.3 runner installed
    // with --claim-scope bound refused every poll — and the old logger
    // discarded the reason, printing only errorType.
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ status: "ok", version: "0.4.28", service: "loops" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    let rejection: unknown;
    try {
      await runRunnerOnce({
        apiUrl: "https://loops.invalid/",
        apiKey: "test-token",
        env: {},
        runnerId: "station02",
        machineId: "station02",
        claimScope: "bound",
        fetchImpl,
      });
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(RunnerRefusalError);
    expect((rejection as Error).message).toContain("requires a control plane advertising runner.claimScope");
  });

  test("a foreign /version failure is classified, never interpolated, in the surfaced refusal", async () => {
    // P1 regression (adversarial review of PR #680): a fetchImpl rejection
    // carrying foreign provider detail used to be wrapped into the sentinel
    // class and its message surfaced. The catch path must classify the
    // failure with static text only.
    const FOREIGN_MARKER = "FOREIGN_PROVIDER_DETAIL_MARKER postgres://user:secret@db.internal/loops";
    const fetchImpl = (async () => {
      throw new Error(FOREIGN_MARKER);
    }) as unknown as typeof fetch;
    let rejection: unknown;
    try {
      await runRunnerOnce({
        apiUrl: "https://loops.invalid/",
        apiKey: "test-token",
        env: {},
        runnerId: "station02",
        machineId: "station02",
        claimScope: "bound",
        fetchImpl,
      });
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(RunnerRefusalError);
    const message = (rejection as Error).message;
    expect(message).toContain("the version request failed");
    expect(message).not.toContain("FOREIGN_PROVIDER_DETAIL_MARKER");
    expect(message).not.toContain("postgres://");
    // And the surfaced journal line carries the classified reason only.
    const logged: string[] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]) => { logged.push(values.map(String).join(" ")); };
    try {
      logRunnerCommandFailure(rejection);
    } finally {
      console.error = originalError;
    }
    const parsed = JSON.parse(logged[0]) as Record<string, unknown>;
    expect(String(parsed.message)).toContain("the version request failed");
    expect(String(parsed.message)).not.toContain("postgres://");
  });

  test("runRunnerLoop reports each failing poll through onError, legibly when composed with the logger", async () => {
    // Pins the composition the background `run` command wires: a failing
    // poll must reach onError per iteration, and logRunnerCommandFailure on
    // that refusal must journal the reason — the exact production invisibility
    // defect was zero journal lines across ten minutes of failing polls.
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ status: "ok", version: "0.4.28", service: "loops" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const reported: unknown[] = [];
    const logged: string[] = [];
    const originalError = console.error;
    console.error = (...values: unknown[]) => { logged.push(values.map(String).join(" ")); };
    try {
      const result = await runRunnerLoop({
        apiUrl: "https://loops.invalid/",
        apiKey: "test-token",
        env: {},
        runnerId: "station02",
        machineId: "station02",
        claimScope: "bound",
        fetchImpl,
        maxIterations: 2,
        pollIntervalMs: 1,
        onError: (error) => {
          reported.push(error);
          logRunnerCommandFailure(error);
        },
      });
      expect(result.errors).toBe(2);
      expect(reported).toHaveLength(2);
      for (const error of reported) expect(error).toBeInstanceOf(RunnerRefusalError);
      const lines = logged.map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(line.evt).toBe("loops_runner_command_failed");
        expect(String(line.message)).toContain("requires a control plane advertising runner.claimScope");
      }
    } finally {
      console.error = originalError;
    }
  });

  test("reports file connection authority by default", () => {
    const previousApiUrl = process.env.HASNA_LOOPS_API_URL;
    const previousApiKey = process.env.HASNA_LOOPS_API_KEY;
    delete process.env.HASNA_LOOPS_API_URL;
    delete process.env.HASNA_LOOPS_API_KEY;
    try {
      const status = runnerStatus();
      expect(status.ok).toBe(true);
      expect(status.service).toBe("loops-runner");
      expect(status.storageConnection.connection).toBe("file");
      expect(status.state).toBe("file_authoritative");
    } finally {
      if (previousApiUrl === undefined) delete process.env.HASNA_LOOPS_API_URL;
      else process.env.HASNA_LOOPS_API_URL = previousApiUrl;
      if (previousApiKey === undefined) delete process.env.HASNA_LOOPS_API_KEY;
      else process.env.HASNA_LOOPS_API_KEY = previousApiKey;
    }
  });

  test("fails closed for a partial API connection without a key", () => {
    const previousApiUrl = process.env.HASNA_LOOPS_API_URL;
    const previousApiKey = process.env.HASNA_LOOPS_API_KEY;
    const previousDatabaseUrl = process.env.HASNA_LOOPS_DATABASE_URL;
    process.env.HASNA_LOOPS_API_URL = "https://loops.example.test";
    delete process.env.HASNA_LOOPS_API_KEY;
    process.env.HASNA_LOOPS_DATABASE_URL = "postgres://loops.example.test/openloops";

    try {
      const status = runnerStatus("machine-test");

      expect(status.ok).toBe(false);
      expect(status.machineId).toBe("machine-test");
      expect(status.storageConnection.connection).toBe("file");
      expect(status.storageConnection.databaseUrlPresent).toBe(true);
      expect(status.state).toBe("missing_api_key");
    } finally {
      if (previousApiUrl === undefined) delete process.env.HASNA_LOOPS_API_URL;
      else process.env.HASNA_LOOPS_API_URL = previousApiUrl;
      if (previousApiKey === undefined) delete process.env.HASNA_LOOPS_API_KEY;
      else process.env.HASNA_LOOPS_API_KEY = previousApiKey;
      if (previousDatabaseUrl === undefined) delete process.env.HASNA_LOOPS_DATABASE_URL;
      else process.env.HASNA_LOOPS_DATABASE_URL = previousDatabaseUrl;
    }
  });

  test("reports ready when the API connection is fully configured", () => {
    const previousApiUrl = process.env.HASNA_LOOPS_API_URL;
    const previousApiKey = process.env.HASNA_LOOPS_API_KEY;
    process.env.HASNA_LOOPS_API_URL = "https://loops.example.test";
    process.env.HASNA_LOOPS_API_KEY = "token" + "-present";

    try {
      const status = runnerStatus("machine-test");

      expect(status.ok).toBe(true);
      expect(status.storageConnection.connection).toBe("api");
      expect(status.storageConnection.apiUrl).toBe("https://loops.example.test");
      expect(status.state).toBe("api_ready");
    } finally {
      if (previousApiUrl === undefined) delete process.env.HASNA_LOOPS_API_URL;
      else process.env.HASNA_LOOPS_API_URL = previousApiUrl;
      if (previousApiKey === undefined) delete process.env.HASNA_LOOPS_API_KEY;
      else process.env.HASNA_LOOPS_API_KEY = previousApiKey;
    }
  });

  test("an API key alone resolves the fleet gateway (no URL required)", () => {
    const previousApiUrl = process.env.HASNA_LOOPS_API_URL;
    const previousApiKey = process.env.HASNA_LOOPS_API_KEY;
    delete process.env.HASNA_LOOPS_API_URL;
    process.env.HASNA_LOOPS_API_KEY = "token" + "-present";

    try {
      const status = runnerStatus("machine-test");

      // The shared resolver defaults to https://api.hasna.com/loops once a
      // credential has resolved, so a station needs no inline URL.
      expect(status.ok).toBe(true);
      expect(status.storageConnection.connection).toBe("api");
      expect(status.storageConnection.apiUrl).toBe("https://api.hasna.com/loops");
      expect(status.state).toBe("api_ready");
    } finally {
      if (previousApiUrl === undefined) delete process.env.HASNA_LOOPS_API_URL;
      else process.env.HASNA_LOOPS_API_URL = previousApiUrl;
      if (previousApiKey === undefined) delete process.env.HASNA_LOOPS_API_KEY;
      else process.env.HASNA_LOOPS_API_KEY = previousApiKey;
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
      expect(await storage.countRuns({ status: "succeeded" })).toBe(1);
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  test("runRunnerOnce finalizes configured exit-75 declines as neutral skipped runs", async () => {
    const storage = createSqliteLoopStorage(":memory:");
    const server = createRunnerServer(
      storage,
      "runner-skip",
      () => new Date("2026-01-01T00:00:00Z"),
    );
    try {
      const loop = await storage.createLoop(
        {
          name: "runner-skip-loop",
          schedule: { type: "interval", everyMs: 60_000 },
          target: { type: "command", command: "exit 75", shell: true },
          overlap: "skip",
          maxAttempts: 3,
        },
        new Date("2025-12-31T00:00:00Z"),
      );

      const result = await runRunnerOnce({
        apiUrl: `http://127.0.0.1:${server.port}`,
        apiKey: "runner-key",
        runnerId: "runner-skip",
        now: new Date("2026-01-01T00:00:00Z"),
        execute: async (_loop, run) => ({
          status: "failed",
          startedAt: run.startedAt ?? "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout: "",
          stderr: "",
          error: "process exited with code 75",
          exitCode: 75,
        }),
      });

      expect(result).toMatchObject({ ok: true, claimed: 1 });
      expect(result.completed[0]).toMatchObject({ status: "skipped", exitCode: 75 });
      expect(await storage.getLoop(loop.id)).toMatchObject({
        status: "active",
        nextRunAt: "2026-01-01T00:01:00.000Z",
        retryScheduledFor: undefined,
      });
      expect(await storage.countRuns({ status: "skipped" })).toBe(1);
      expect(await storage.countRuns({ status: "failed" })).toBe(0);
    } finally {
      server.stop(true);
      await storage.close();
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

  describe("claim scope", () => {
    const succeed = async (_loop: unknown, run: { startedAt?: string }) => ({
      status: "succeeded" as const,
      startedAt: run.startedAt ?? "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:00:01.000Z",
      durationMs: 1_000,
      stdout: "",
      stderr: "",
      exitCode: 0,
    });

    async function runAgainstServer(
      loopMachineId: string | undefined,
      claimScope?: "fleet" | "bound",
    ): Promise<number> {
      const storage = createSqliteLoopStorage(":memory:");
      const server = createRunnerServer(storage, "runner-bound");
      try {
        await storage.createLoop(
          {
            name: loopMachineId ? "pinned" : "unbound",
            schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
            target: { type: "command", command: "true" },
            ...(loopMachineId ? { machine: { id: loopMachineId } } : {}),
          },
          new Date("2025-12-31T00:00:00Z"),
        );
        const result = await runRunnerOnce({
          apiUrl: `http://127.0.0.1:${server.port}`,
          apiKey: "test-token",
          runnerId: "runner-bound",
          claimScope,
          now: new Date("2026-01-01T00:00:00Z"),
          env: {},
          execute: succeed,
        });
        return result.claimed;
      } finally {
        server.stop(true);
        await storage.close();
      }
    }

    // The live carrier passes no --claim-scope. If this ever fails, the fleet's
    // only runner has stopped claiming the work it exists to run.
    test("a runner with no claim scope still claims machine-unbound loops", async () => {
      expect(await runAgainstServer(undefined)).toBe(1);
    });

    test("a bound runner leaves machine-unbound loops alone", async () => {
      expect(await runAgainstServer(undefined, "bound")).toBe(0);
    });

    test("a bound runner still claims loops pinned to it", async () => {
      expect(await runAgainstServer("runner-bound", "bound")).toBe(1);
    });

    test("an unrecognised claim scope is refused before any request is made", async () => {
      let called = false;
      await expect(runRunnerOnce({
        apiUrl: "http://127.0.0.1:1",
        apiKey: "test-token",
        runnerId: "runner-bound",
        claimScope: "machine" as never,
        env: {},
        fetchImpl: (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch,
      })).rejects.toThrow("claimScope must be one of: fleet, bound");
      expect(called).toBe(false);
    });

    // The deployed control plane is many versions behind this package, so a
    // server that accepts claimScope and ignores it is the expected day-one
    // state. It must claim NOTHING rather than silently drain the fleet.
    test("a bound runner refuses to claim when the server cannot enforce the scope", async () => {
      const paths: string[] = [];
      const fetchImpl = (async (url: string | URL) => {
        const path = new URL(String(url)).pathname;
        paths.push(path);
        if (path.endsWith("/version")) {
          return new Response(JSON.stringify({ status: "ok", capabilities: [] }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ ok: true, claims: [] }), {
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch;

      await expect(runRunnerOnce({
        apiUrl: "http://127.0.0.1:1",
        apiKey: "test-token",
        runnerId: "runner-bound",
        claimScope: "bound",
        env: {},
        fetchImpl,
      })).rejects.toThrow("requires a control plane advertising runner.claimScope");
      expect(paths.some((path) => path.includes("claim"))).toBe(false);
    });

    test("a bound runner refuses a claim response that does not echo the scope", async () => {
      const fetchImpl = (async (url: string | URL) => {
        const path = new URL(String(url)).pathname;
        if (path.endsWith("/version")) {
          return new Response(JSON.stringify({ capabilities: ["runner.claimScope"] }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ ok: true, runner: { id: "runner-bound" }, claims: [] }), {
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch;

      await expect(runRunnerOnce({
        apiUrl: "http://127.0.0.1:1",
        apiKey: "test-token",
        runnerId: "runner-bound",
        claimScope: "bound",
        env: {},
        fetchImpl,
      })).rejects.toThrow("was not echoed by the control plane");
    });

    test("LOOPS_RUNNER_CLAIM_SCOPE configures the scope without a flag", async () => {
      const paths: string[] = [];
      const fetchImpl = (async (url: string | URL) => {
        paths.push(new URL(String(url)).pathname);
        return new Response(JSON.stringify({ status: "ok", capabilities: [] }), {
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch;

      await expect(runRunnerOnce({
        apiUrl: "http://127.0.0.1:1",
        apiKey: "test-token",
        runnerId: "runner-bound",
        env: { LOOPS_RUNNER_CLAIM_SCOPE: "bound" } as NodeJS.ProcessEnv,
        fetchImpl,
      })).rejects.toThrow("requires a control plane advertising runner.claimScope");
      expect(paths.some((path) => path.endsWith("/version"))).toBe(true);
    });
  });
});

describe("runner env-file integration", () => {
  const RUNNER_ENV_KEYS = ["HASNA_LOOPS_API_URL", "HASNA_LOOPS_API_KEY", "LOOPS_RUNNER_MACHINE_ID", "LOOPS_RUNNER_CLAIM_SCOPE"] as const;

  function withRunnerEnv(dataDir: string, contents: string): () => void {
    const previousDataDir = process.env.LOOPS_DATA_DIR;
    const previousKeys: Record<string, string | undefined> = {};
    for (const key of RUNNER_ENV_KEYS) previousKeys[key] = process.env[key];
    process.env.LOOPS_DATA_DIR = dataDir;
    for (const key of RUNNER_ENV_KEYS) delete process.env[key];
    mkdirSync(dataDir, { recursive: true });
    const path = join(dataDir, "runner.env");
    writeFileSync(path, contents, { mode: 0o600 });
    chmodSync(path, 0o600);
    return () => {
      if (previousDataDir === undefined) delete process.env.LOOPS_DATA_DIR;
      else process.env.LOOPS_DATA_DIR = previousDataDir;
      for (const key of RUNNER_ENV_KEYS) {
        if (previousKeys[key] === undefined) delete process.env[key];
        else process.env[key] = previousKeys[key] as string;
      }
      rmSync(dataDir, { recursive: true, force: true });
    };
  }

  test("runnerStatus reflects the mode-600 runner env file when the shell env is unset", () => {
    const dataDir = `${tmpdir()}/loops-runner-status-${process.pid}-${Date.now()}`;
    const restore = withRunnerEnv(
      dataDir,
      [
        "HASNA_LOOPS_API_URL=https://loops.example.test",
        `${RUNNER_ENV_KEYS[1]}=fixture-key-value`,
        "LOOPS_RUNNER_MACHINE_ID=station01",
        "LOOPS_RUNNER_CLAIM_SCOPE=fleet",
      ].join("\n") + "\n",
    );
    try {
      applyRunnerEnvFile();
      const status = runnerStatus();
      expect(status.ok).toBe(true);
      expect(status.state).toBe("api_ready");
      expect(status.machineId).toBe("station01");
      expect(status.claimScope).toBe("fleet");
    } finally {
      restore();
    }
  });

  test("runRunnerLoop stops promptly when the shutdown signal aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const sleeps: number[] = [];
    const result = await runRunnerLoop({
      apiUrl: "https://loops.example.test",
      apiKey: "test-key",
      runnerId: "runner-loop",
      maxIterations: 5,
      signal: controller.signal,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(result.stopped).toBe(true);
    expect(result.iterations).toBe(0);
    expect(sleeps).toEqual([]);
  });

  test("a wrong_token_kind claim denial surfaces as an actionable permanent denial", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: "wrong_token_kind" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

    await expect(runRunnerOnce({
      apiUrl: "http://127.0.0.1:1",
      apiKey: "test-token",
      runnerId: "runner-denied",
      env: {},
      fetchImpl,
    })).rejects.toMatchObject({
      name: "RunnerPermanentDenialError",
      reason: "wrong_token_kind",
      route: "/v1/runners/claim",
    });
    const denial = runnerPermanentDenial(Object.assign(new Error("wrong_token_kind"), { reason: "wrong_token_kind", route: "/v1/runners/claim" }));
    expect(denial).toBeInstanceOf(RunnerPermanentDenialError);
    expect(denial?.message).toMatch(/machine.*service/i);
    expect(denial?.message).toMatch(/loops:runner/i);
    expect(denial?.message).toMatch(/wrong_token_kind/);
  });

  test("permanent-denial exit code is distinct from a generic failure", () => {
    expect(RUNNER_PERMANENT_DENIAL_EXIT_CODE).toBe(4);
    expect(RUNNER_PERMANENT_DENIAL_EXIT_CODE).not.toBe(1);
  });

  test("transient server failures are NOT classified as permanent denials", () => {
    expect(runnerPermanentDenial(new Error("loops-api request failed: 503"))).toBeUndefined();
    expect(runnerPermanentDenial(new Error("wrong_token_kind"))).toBeUndefined();
    expect(runnerPermanentDenial(null)).toBeUndefined();
    expect(runnerPermanentDenial("wrong_token_kind")).toBeUndefined();
  });

  test("runRunnerLoop stops immediately on a permanent denial instead of retrying forever", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: "wrong_token_kind" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

    const result = await runRunnerLoop({
      apiUrl: "http://127.0.0.1:1",
      apiKey: "test-token",
      runnerId: "runner-loop-denied",
      env: {},
      fetchImpl,
      pollIntervalMs: 5,
      maxIterations: 100,
    });
    expect(result).toMatchObject({ ok: false, permanent: true, errors: 1, iterations: 1 });
    expect(result.permanentMessage).toMatch(/machine.*service/i);
  });
});
