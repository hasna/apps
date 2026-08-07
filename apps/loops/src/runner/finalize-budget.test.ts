import { describe, expect, test } from "bun:test";
import { createLoopsApiServer } from "../api/index.js";
import { createSqliteLoopStorage } from "../lib/storage/sqlite.js";
import { runRunnerOnce } from "./index.js";

/**
 * Regression for the permanently-`running` run.
 *
 * The executor captures up to DEFAULT_MAX_OUTPUT_BYTES (256 KiB) per stream and
 * the runner posted that verbatim to `/v1/runs/<id>/finalize`, whose server-side
 * body limit is DEFAULT_BODY_LIMIT_BYTES (64 KiB). The server rejected the body
 * with 413 before the handler ran, `postJson` threw, and nothing ever wrote the
 * run row again — so the run stayed `running` forever and, with overlap:skip,
 * suppressed its loop permanently.
 *
 * These tests exercise the real API server rather than a fetch stub, so the
 * 64 KiB gate is the actual gate and not a restatement of it.
 */

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

async function createOnceLoop(storage: ReturnType<typeof createSqliteLoopStorage>, name: string) {
  return await storage.createLoop(
    {
      name,
      schedule: { type: "once", at: "2026-01-01T00:00:00Z" },
      target: { type: "command", command: "true" },
    },
    new Date("2025-12-31T00:00:00Z"),
  );
}

describe("runner finalize body budget", () => {
  // THE DEFECT. Before the fix this run stays `running` and runRunnerOnce
  // rejects with `body_too_large`.
  test("a run whose output exceeds the server body limit still reaches a terminal status", async () => {
    const storage = createSqliteLoopStorage(":memory:");
    const server = createRunnerServer(storage, "runner-oversized");
    try {
      const loop = await createOnceLoop(storage, "runner-oversized-loop");

      // Each stream alone is under the 64 KiB body limit; together they are
      // over it. Budgeting per field rather than per body does not save this.
      const stdout = "o".repeat(60 * 1024);
      const stderr = "e".repeat(60 * 1024);

      const result = await runRunnerOnce({
        apiUrl: `http://127.0.0.1:${server.port}`,
        apiKey: "test-token",
        runnerId: "runner-oversized",
        now: new Date("2026-01-01T00:00:00Z"),
        execute: async (_loop, run) => ({
          status: "failed",
          startedAt: run.startedAt ?? "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout,
          stderr,
          exitCode: 1,
          error: "command failed",
        }),
      });

      expect(result.claimed).toBe(1);

      const runs = await storage.listRuns({ loopId: loop.id });
      expect(runs).toHaveLength(1);
      // The whole point: not `running`.
      expect(runs[0]!.status).toBe("failed");
      expect(await storage.countRuns("running")).toBe(0);
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  // Output that JSON-escapes to several bytes per character is the case a
  // char-count budget gets wrong: 40k control characters serialise to ~240 KiB.
  test("output that expands under JSON escaping still finalizes", async () => {
    const storage = createSqliteLoopStorage(":memory:");
    const server = createRunnerServer(storage, "runner-escaped");
    try {
      const loop = await createOnceLoop(storage, "runner-escaped-loop");
      // A U+0001 control character serialises as the six characters \u0001.
      const stdout = "\u0001".repeat(40 * 1024);

      const result = await runRunnerOnce({
        apiUrl: `http://127.0.0.1:${server.port}`,
        apiKey: "test-token",
        runnerId: "runner-escaped",
        now: new Date("2026-01-01T00:00:00Z"),
        execute: async (_loop, run) => ({
          status: "succeeded",
          startedAt: run.startedAt ?? "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout,
          stderr: "",
          exitCode: 0,
        }),
      });

      expect(result.claimed).toBe(1);
      const runs = await storage.listRuns({ loopId: loop.id });
      expect(runs[0]!.status).toBe("succeeded");
      expect(await storage.countRuns("running")).toBe(0);
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  // The negative arm. A short run must not be truncated, must carry byte-exact
  // output, and must behave exactly as it did before this change.
  test("a run with small output is stored byte-for-byte and carries no truncation marker", async () => {
    const storage = createSqliteLoopStorage(":memory:");
    const server = createRunnerServer(storage, "runner-small");
    try {
      const loop = await createOnceLoop(storage, "runner-small-loop");
      const stdout = "the quick brown fox\nsecond line\n";
      const stderr = "a warning\n";

      await runRunnerOnce({
        apiUrl: `http://127.0.0.1:${server.port}`,
        apiKey: "test-token",
        runnerId: "runner-small",
        now: new Date("2026-01-01T00:00:00Z"),
        execute: async (_loop, run) => ({
          status: "succeeded",
          startedAt: run.startedAt ?? "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout,
          stderr,
          exitCode: 0,
        }),
      });

      const runs = await storage.listRuns({ loopId: loop.id });
      expect(runs[0]!.status).toBe("succeeded");
      expect(runs[0]!.stdout).toBe(stdout);
      expect(runs[0]!.stderr).toBe(stderr);
      expect(runs[0]!.stdout ?? "").not.toContain("truncated");
    } finally {
      server.stop(true);
      await storage.close();
    }
  });

  // Truncated output must say so, and must keep the tail — the end of a killed
  // process's output is where the failure is.
  test("truncated output keeps the tail and names what was dropped", async () => {
    const storage = createSqliteLoopStorage(":memory:");
    const server = createRunnerServer(storage, "runner-marker");
    try {
      const loop = await createOnceLoop(storage, "runner-marker-loop");
      const stdout = `HEAD-SENTINEL\n${"o".repeat(200 * 1024)}\nTAIL-SENTINEL`;

      await runRunnerOnce({
        apiUrl: `http://127.0.0.1:${server.port}`,
        apiKey: "test-token",
        runnerId: "runner-marker",
        now: new Date("2026-01-01T00:00:00Z"),
        execute: async (_loop, run) => ({
          status: "failed",
          startedAt: run.startedAt ?? "2026-01-01T00:00:00.000Z",
          finishedAt: "2026-01-01T00:00:01.000Z",
          durationMs: 1_000,
          stdout,
          stderr: "",
          exitCode: 137,
        }),
      });

      const runs = await storage.listRuns({ loopId: loop.id });
      expect(runs[0]!.status).toBe("failed");
      const stored = runs[0]!.stdout ?? "";
      expect(stored).toContain("TAIL-SENTINEL");
      expect(stored).toContain("truncated");
      expect(stored.length).toBeLessThan(stdout.length);
    } finally {
      server.stop(true);
      await storage.close();
    }
  });
});
