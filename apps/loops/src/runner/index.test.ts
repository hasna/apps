import { describe, expect, test } from "bun:test";
import { createLoopsApiServer } from "../api/index.js";
import { createSqliteLoopStorage } from "../lib/storage/sqlite.js";
import { runRunnerOnce, runnerStatus } from "./index.js";

describe("loops-runner foundation", () => {
  test("reports local daemon authority by default", () => {
    const status = runnerStatus();

    expect(status.ok).toBe(true);
    expect(status.service).toBe("loops-runner");
    expect(status.deployment.deploymentMode).toBe("local");
    expect(status.state).toBe("local_daemon_authoritative");
  });

  test("fails closed for configured self-hosted mode without an API URL", () => {
    const previousMode = process.env.LOOPS_MODE;
    const previousDatabaseUrl = process.env.LOOPS_DATABASE_URL;
    const previousApiUrl = process.env.LOOPS_API_URL;
    process.env.LOOPS_MODE = "self_hosted";
    process.env.LOOPS_DATABASE_URL = "postgres://loops.example.test/openloops";
    delete process.env.LOOPS_API_URL;

    try {
      const status = runnerStatus("machine-test");

      expect(status.ok).toBe(false);
      expect(status.machineId).toBe("machine-test");
      expect(status.deployment.deploymentMode).toBe("self_hosted");
      expect(status.deployment.controlPlane.configured).toBe(true);
      expect(status.state).toBe("missing_control_plane_api_url");
    } finally {
      if (previousMode === undefined) delete process.env.LOOPS_MODE;
      else process.env.LOOPS_MODE = previousMode;
      if (previousDatabaseUrl === undefined) delete process.env.LOOPS_DATABASE_URL;
      else process.env.LOOPS_DATABASE_URL = previousDatabaseUrl;
      if (previousApiUrl === undefined) delete process.env.LOOPS_API_URL;
      else process.env.LOOPS_API_URL = previousApiUrl;
    }
  });

  test("reports ready when a self-hosted API URL and token are configured", () => {
    const previousMode = process.env.LOOPS_MODE;
    const previousApiUrl = process.env.LOOPS_API_URL;
    const previousToken = process.env.LOOPS_API_TOKEN;
    process.env.LOOPS_MODE = "self_hosted";
    process.env.LOOPS_API_URL = "https://loops.example.test";
    process.env.LOOPS_API_TOKEN = "token-present";

    try {
      const status = runnerStatus("machine-test");

      expect(status.ok).toBe(true);
      expect(status.state).toBe("control_plane_ready");
    } finally {
      if (previousMode === undefined) delete process.env.LOOPS_MODE;
      else process.env.LOOPS_MODE = previousMode;
      if (previousApiUrl === undefined) delete process.env.LOOPS_API_URL;
      else process.env.LOOPS_API_URL = previousApiUrl;
      if (previousToken === undefined) delete process.env.LOOPS_API_TOKEN;
      else process.env.LOOPS_API_TOKEN = previousToken;
    }
  });

  test("runRunnerOnce claims, executes, and finalizes one API run", async () => {
    const storage = createSqliteLoopStorage(":memory:");
    const server = createLoopsApiServer({ host: "127.0.0.1", port: 0, storage });
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
    const server = createLoopsApiServer({ host: "127.0.0.1", port: 0, storage, now: () => serverNow });
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
      expect(duplicate.status).toBe(200);
      expect(await duplicate.json()).toMatchObject({ ok: true, claims: [] });

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
    await expect(runRunnerOnce({ apiUrl: "https://loops.example.test", runnerId: "runner" })).rejects.toThrow("non-local loops-runner requires");
  });
});
