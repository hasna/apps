import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import type { Loop, LoopRun } from "../types.js";

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "index.ts");

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

async function runCli(
  dataDir: string,
  args: string[],
  env: Record<string, string> = {},
): Promise<CliResult> {
  const merged = {
    ...process.env,
    HOME: dataDir,
    HASNA_LOOPS_API_URL: "",
    HASNA_LOOPS_API_KEY: "",
    HASNA_LOOPS_CONNECTION: "",
    LOOPS_DATA_DIR: dataDir,
    ...env,
  };
  if (!merged.HASNA_LOOPS_CONNECTION?.trim() && !merged.HASNA_LOOPS_API_URL?.trim() && !merged.HASNA_LOOPS_API_KEY?.trim()) {
    // No API env: this spawn runs against the local file store, which requires
    // the explicit opt-in (fail-closed policy).
    merged.HASNA_LOOPS_CONNECTION = "file";
  }
  const child = Bun.spawn([process.execPath, cliPath, ...args], {
    env: merged,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, status] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { status, stdout, stderr };
}

const PAST = "2020-01-01T00:00:00.000Z";
const FUTURE = "2099-01-01T00:00:00.000Z";

function hostedLoop(overrides: Partial<Loop> & Pick<Loop, "id" | "name">): Loop {
  return {
    labels: [],
    status: "active",
    schedule: { type: "every", every: "5m" },
    target: { type: "command", command: "true" },
    nextRunAt: FUTURE,
    catchUp: "latest",
    catchUpLimit: 1,
    overlap: "skip",
    maxAttempts: 1,
    retryDelayMs: 0,
    leaseMs: 60_000,
    createdAt: PAST,
    updatedAt: PAST,
    ...overrides,
  } as Loop;
}

function hostedRun(loop: Loop, overrides: Partial<LoopRun> = {}): LoopRun {
  return {
    id: `run-${loop.id}`,
    loopId: loop.id,
    loopName: loop.name,
    scheduledFor: PAST,
    attempt: 1,
    status: "succeeded",
    startedAt: PAST,
    finishedAt: PAST,
    createdAt: PAST,
    updatedAt: PAST,
    ...overrides,
  };
}

/**
 * Fake hosted `/v1` backend serving only the read endpoints the diagnostics
 * need. Any other path 404s, so a diagnostic that reaches for an endpoint the
 * hosted contract does not expose fails the test loudly rather than silently
 * degrading.
 */
function serveHosted(loops: Loop[], runsByLoop: Record<string, LoopRun[]>) {
  const paths: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      paths.push(`${request.method} ${url.pathname}`);
      if (request.method !== "GET") {
        return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
      }
      if (url.pathname === "/v1/loops") {
        const offset = Number(url.searchParams.get("offset") ?? "0");
        const limit = Number(url.searchParams.get("limit") ?? "200");
        return Response.json({ ok: true, loops: loops.slice(offset, offset + limit) });
      }
      if (url.pathname === "/v1/runs") {
        const loopId = url.searchParams.get("loopId") ?? "";
        const limit = Number(url.searchParams.get("limit") ?? "50");
        return Response.json({ ok: true, runs: (runsByLoop[loopId] ?? []).slice(0, limit) });
      }
      return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    },
  });
  return { server, paths };
}

function hostedEnv(port: number | undefined): Record<string, string> {
  return {
    HASNA_LOOPS_API_URL: `http://127.0.0.1:${port}`,
    HASNA_LOOPS_API_KEY: "test-hosted-key",
  };
}

describe("hosted-mode diagnostics (e3b6f1d4)", () => {
  test("loops health answers against the hosted control plane instead of refusing", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-hosted-health-"));
    const healthy = hostedLoop({ id: "loop-ok", name: "loop-ok" });
    const broken = hostedLoop({ id: "loop-bad", name: "loop-bad" });
    const { server, paths } = serveHosted([healthy, broken], {
      "loop-ok": [
        hostedRun(healthy, { id: "run-ok-3", exitCode: 1 }),
        hostedRun(healthy, { id: "run-ok-2", exitCode: 0 }),
        hostedRun(healthy, { id: "run-ok-1", exitCode: 0 }),
      ],
      "loop-bad": [
        hostedRun(broken, { id: "run-bad-3", status: "failed", error: "boom", exitCode: 1 }),
        hostedRun(broken, { id: "run-bad-2", status: "failed", error: "boom", exitCode: 1 }),
        hostedRun(broken, { id: "run-bad-1", status: "failed", error: "boom", exitCode: 1 }),
      ],
    });

    try {
      const result = await runCli(dataDir, ["--json", "health"], hostedEnv(server.port));
      // A hosted health report classifies one failing loop, so the command
      // exits 1 exactly as the local path does — the failing state is "rc=2 /
      // refusal / no JSON", the passing state is "a parsable report".
      expect(result.stderr).not.toContain("not available while flipped");
      const report = JSON.parse(result.stdout) as {
        backend?: { transport?: string; apiUrl?: string };
        report?: { summary?: { loops?: number; healthy?: number; unhealthy?: number } };
        executionTruth?: Array<{
          loopId: string;
          state: string;
          finishedRuns: number;
          acceptedRuns: number;
          failedRuns: number;
          windowLimit: number;
        }>;
        unchecked?: Array<{ id: string }>;
      };
      expect(report.backend?.transport).toBe("api");
      expect(report.report?.summary?.loops).toBe(2);
      expect(report.report?.summary?.healthy).toBe(1);
      expect(report.report?.summary?.unhealthy).toBe(1);
      expect(report.executionTruth).toContainEqual({
        loopId: healthy.id,
        state: "healthy",
        finishedRuns: 3,
        acceptedRuns: 3,
        failedRuns: 0,
        windowLimit: 10,
      });
      expect(report.executionTruth).toContainEqual({
        loopId: broken.id,
        state: "dead_cadence",
        finishedRuns: 3,
        acceptedRuns: 0,
        failedRuns: 3,
        windowLimit: 10,
      });
      // It really read the hosted API rather than a local sqlite island.
      expect(paths).toContain("GET /v1/loops");
      expect(paths.filter((path) => path === "GET /v1/runs").length).toBeGreaterThanOrEqual(2);
      expect(result.stdout).not.toContain("test-hosted-key");
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("hosted health reports insufficient terminal history as UNPROVEN instead of healthy", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-hosted-health-unproven-"));
    const loop = hostedLoop({ id: "loop-unproven", name: "loop-unproven" });
    const { server } = serveHosted([loop], {
      "loop-unproven": [hostedRun(loop, { id: "run-only", status: "succeeded", exitCode: 0 })],
    });

    try {
      const result = await runCli(dataDir, ["--json", "health"], hostedEnv(server.port));
      const report = JSON.parse(result.stdout) as {
        report?: {
          ok?: boolean;
          summary?: { healthy?: number; unhealthy?: number };
          expectations?: Array<{ ok?: boolean; check?: { message?: string } }>;
        };
        executionTruth?: Array<{
          loopId: string;
          state: string;
          finishedRuns: number;
          acceptedRuns: number;
          failedRuns: number;
          windowLimit: number;
        }>;
      };
      expect(report.executionTruth).toContainEqual({
        loopId: loop.id,
        state: "unproven",
        finishedRuns: 1,
        acceptedRuns: 1,
        failedRuns: 0,
        windowLimit: 10,
      });
      expect(report.report?.ok).toBe(false);
      expect(report.report?.summary).toMatchObject({ healthy: 0, unhealthy: 1 });
      expect(report.report?.expectations?.[0]?.check?.message).toContain("UNPROVEN");
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("incident 691568 classes execution truth independently of schedule freshness or failure mechanism", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-hosted-health-691568-"));
    const dead = Array.from({ length: 5 }, (_, index) =>
      hostedLoop({ id: `dead-${index + 1}`, name: `dead-${index + 1}`, nextRunAt: FUTURE })
    );
    const neverRun = Array.from({ length: 9 }, (_, index) =>
      hostedLoop({ id: `never-${index + 1}`, name: `never-${index + 1}`, nextRunAt: FUTURE })
    );
    const nonterminal = Array.from({ length: 2 }, (_, index) =>
      hostedLoop({ id: `nonterminal-${index + 1}`, name: `nonterminal-${index + 1}`, nextRunAt: FUTURE })
    );
    const belowFloor = hostedLoop({ id: "below-floor", name: "below-floor", nextRunAt: FUTURE });
    const contractExcused = hostedLoop({ id: "contract-excused", name: "contract-excused", nextRunAt: FUTURE });
    const loops = [...dead, ...neverRun, ...nonterminal, belowFloor, contractExcused];
    const runsByLoop: Record<string, LoopRun[]> = {};

    dead.forEach((loop, index) => {
      runsByLoop[loop.id] = Array.from({ length: index + 3 }, (_, runIndex) =>
        hostedRun(loop, {
          id: `${loop.id}-failed-${runIndex + 1}`,
          status: "failed",
          exitCode: 1,
          error: "mechanism intentionally unspecified",
        })
      );
    });
    neverRun.forEach((loop) => {
      runsByLoop[loop.id] = [];
    });
    nonterminal.forEach((loop, index) => {
      runsByLoop[loop.id] = [
        hostedRun(loop, {
          id: `${loop.id}-running`,
          status: "running",
          finishedAt: undefined,
          exitCode: undefined,
        }),
        hostedRun(loop, {
          id: `${loop.id}-abandoned`,
          status: "abandoned",
          exitCode: undefined,
        }),
      ].slice(index, index + 1);
    });
    runsByLoop[belowFloor.id] = [
      hostedRun(belowFloor, { id: "below-floor-failed", status: "failed", exitCode: 1 }),
    ];
    runsByLoop[contractExcused.id] = Array.from({ length: 3 }, (_, index) =>
      hostedRun(contractExcused, {
        id: `contract-excused-${index + 1}`,
        status: "succeeded",
        exitCode: 1,
      })
    );

    const { server } = serveHosted(loops, runsByLoop);
    try {
      const result = await runCli(dataDir, ["--json", "health"], hostedEnv(server.port));
      const report = JSON.parse(result.stdout) as {
        executionTruth: Array<{
          loopId: string;
          state: "healthy" | "dead_cadence" | "unproven";
          finishedRuns: number;
          acceptedRuns: number;
          failedRuns: number;
        }>;
      };
      const byState = (state: "healthy" | "dead_cadence" | "unproven") =>
        report.executionTruth.filter((entry) => entry.state === state);

      expect(byState("dead_cadence")).toHaveLength(5);
      expect(byState("dead_cadence").every((entry) =>
        entry.finishedRuns >= 3 && entry.acceptedRuns === 0
      )).toBe(true);
      expect(byState("unproven")).toHaveLength(12);
      expect(neverRun.every((loop) =>
        report.executionTruth.some((entry) =>
          entry.loopId === loop.id && entry.state === "unproven" && entry.finishedRuns === 0
        )
      )).toBe(true);
      expect(nonterminal.every((loop) =>
        report.executionTruth.some((entry) =>
          entry.loopId === loop.id && entry.state === "unproven" && entry.finishedRuns === 0
        )
      )).toBe(true);
      expect(report.executionTruth).toContainEqual(expect.objectContaining({
        loopId: belowFloor.id,
        state: "unproven",
        finishedRuns: 1,
        acceptedRuns: 0,
        failedRuns: 1,
      }));
      expect(report.executionTruth).toContainEqual(expect.objectContaining({
        loopId: contractExcused.id,
        state: "healthy",
        finishedRuns: 3,
        acceptedRuns: 3,
        failedRuns: 0,
      }));
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("hosted hygiene stuck previews and reconciles the exact API-issued candidate without local fallback", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-hosted-stuck-"));
    const candidate = {
      runId: "run-known-stuck",
      loopId: "loop-known-stuck",
      snapshotId: `stuck_${"a".repeat(64)}`,
    };
    const requests: Array<{ method: string; path: string; body?: unknown }> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const body = request.method === "POST" ? await request.json() : undefined;
        requests.push({ method: request.method, path: url.pathname, body });
        if (request.method === "GET" && url.pathname === "/v1/leases/stuck") {
          return Response.json({
            ok: true,
            report: {
              state: "stuck",
              expiredBefore: "2026-08-09T00:00:00.000Z",
              candidates: [candidate],
              truncated: false,
            },
          });
        }
        if (request.method === "POST" && url.pathname === "/v1/leases/reconcile") {
          return Response.json({
            ok: true,
            reconciliation: {
              outcomes: [{ runId: candidate.runId, outcome: "recovered" }],
            },
          });
        }
        return Response.json({ ok: false, error: "not_found" }, { status: 404 });
      },
    });

    try {
      const preview = await runCli(dataDir, ["--json", "hygiene", "stuck"], hostedEnv(server.port));
      expect(preview.status).toBe(1);
      expect(JSON.parse(preview.stdout)).toMatchObject({
        state: "stuck",
        candidates: [candidate],
        applied: false,
      });
      expect(requests).toEqual([{ method: "GET", path: "/v1/leases/stuck", body: undefined }]);

      requests.length = 0;
      const applied = await runCli(dataDir, ["--json", "hygiene", "stuck", "--apply"], hostedEnv(server.port));
      expect(applied.status).toBe(0);
      expect(JSON.parse(applied.stdout)).toMatchObject({
        state: "stuck",
        candidates: [candidate],
        applied: true,
        reconciliation: {
          outcomes: [{ runId: candidate.runId, outcome: "recovered" }],
        },
      });
      expect(requests).toEqual([
        { method: "GET", path: "/v1/leases/stuck", body: undefined },
        { method: "POST", path: "/v1/leases/reconcile", body: { candidates: [candidate] } },
      ]);
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("hosted hygiene stuck surfaces API refusal as an error rather than zero findings", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-hosted-stuck-refusal-"));
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return Response.json({ ok: false, error: "insufficient_scope" }, { status: 403 });
      },
    });

    try {
      const result = await runCli(dataDir, ["--json", "hygiene", "stuck"], hostedEnv(server.port));
      expect(result.status).toBe(1);
      expect(result.stdout).not.toContain('"candidates": []');
      expect(`${result.stdout}\n${result.stderr}`).toContain("-> 403");
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("hosted health names what it does not check instead of printing a bare clean summary", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-hosted-health-unchecked-"));
    const loop = hostedLoop({ id: "loop-ok", name: "loop-ok" });
    const { server } = serveHosted([loop], { "loop-ok": [hostedRun(loop)] });

    try {
      const result = await runCli(dataDir, ["--json", "health"], hostedEnv(server.port));
      const report = JSON.parse(result.stdout) as { unchecked?: Array<{ id: string; reason: string }> };
      const ids = (report.unchecked ?? []).map((entry) => entry.id);
      // The whole point of the incident: an all-green report must say out loud
      // that runner liveness is not among the things it verified.
      expect(ids).toContain("runner-liveness");
      expect(report.unchecked?.every((entry) => entry.reason.length > 0)).toBe(true);
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("hosted health flags an active loop whose scheduled slot went unclaimed", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-hosted-health-overdue-"));
    // Latest run succeeded, so every existing check is green; only the unclaimed
    // slot distinguishes a live scheduler from a dead one.
    const loop = hostedLoop({ id: "loop-stalled", name: "loop-stalled", nextRunAt: PAST });
    const { server } = serveHosted([loop], { "loop-stalled": [hostedRun(loop)] });

    try {
      const result = await runCli(dataDir, ["--json", "health"], hostedEnv(server.port));
      const report = JSON.parse(result.stdout) as {
        report?: {
          summary?: { overdue?: number };
          expectations?: Array<{ overdue?: { nextRunAt?: string; byMs?: number } }>;
        };
      };
      expect(report.report?.summary?.overdue).toBe(1);
      expect(report.report?.expectations?.[0]?.overdue?.nextRunAt).toBe(PAST);
      expect(report.report?.expectations?.[0]?.overdue?.byMs).toBeGreaterThan(0);
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  // The other half of the same signal. `nextRunAt` is only advanced once a run
  // FINISHES (`advanceLoop` in src/daemon/daemon.ts), so a loop whose run is
  // legitimately executing has its slot sitting in the past for the whole run.
  // Reporting that as "unclaimed" tells an operator mid-incident that a healthy
  // 20-minute run is a stalled scheduler — it manufactures the incident the
  // check exists to detect. 20 of 200 recent runs on this fleet exceed 10min.
  test("hosted health does not report a slot as unclaimed while its run is in flight", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-hosted-health-inflight-"));
    const loop = hostedLoop({ id: "loop-running", name: "loop-running", nextRunAt: PAST });
    const inFlight = hostedRun(loop, {
      status: "running",
      scheduledFor: PAST, // the slot the daemon claimed == loop.nextRunAt
      claimedBy: "station01-daemon",
      finishedAt: undefined,
    });
    const { server } = serveHosted([loop], { "loop-running": [inFlight] });

    try {
      const result = await runCli(dataDir, ["--json", "health"], hostedEnv(server.port));
      const report = JSON.parse(result.stdout) as {
        report?: {
          summary?: { overdue?: number };
          expectations?: Array<{ overdue?: unknown }>;
        };
      };
      expect(report.report?.summary?.overdue).toBe(0);
      expect(report.report?.expectations?.[0]?.overdue).toBeUndefined();
      expect(result.stdout).not.toContain("unclaimed for");
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  // Guards the over-fix. Suppressing `overdue` for ANY running run would silence
  // the dead-scheduler case this PR exists to detect: a run wedged on an OLD
  // slot means the CURRENT slot was still never claimed, which is a stall.
  // Only a run in flight AT the current slot is evidence the scheduler is alive.
  test("hosted health still flags an unclaimed slot when the in-flight run belongs to an older slot", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-hosted-health-stale-inflight-"));
    const OLDER = "2019-01-01T00:00:00.000Z";
    const loop = hostedLoop({ id: "loop-wedged", name: "loop-wedged", nextRunAt: PAST });
    const wedged = hostedRun(loop, {
      status: "running",
      scheduledFor: OLDER, // != loop.nextRunAt -> the current slot went unclaimed
      claimedBy: "station01-daemon",
      finishedAt: undefined,
    });
    const { server } = serveHosted([loop], { "loop-wedged": [wedged] });

    try {
      const result = await runCli(dataDir, ["--json", "health"], hostedEnv(server.port));
      const report = JSON.parse(result.stdout) as {
        report?: {
          summary?: { overdue?: number };
          expectations?: Array<{ overdue?: { nextRunAt?: string } }>;
        };
      };
      expect(report.report?.summary?.overdue).toBe(1);
      expect(report.report?.expectations?.[0]?.overdue?.nextRunAt).toBe(PAST);
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("loops doctor answers against the hosted control plane and labels each check's scope", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-hosted-doctor-"));
    const loop = hostedLoop({ id: "loop-ok", name: "loop-ok" });
    const { server } = serveHosted([loop], { "loop-ok": [hostedRun(loop)] });

    try {
      const result = await runCli(dataDir, ["--json", "doctor"], hostedEnv(server.port));
      expect(result.stderr).not.toContain("not available while flipped");
      const report = JSON.parse(result.stdout) as {
        backend?: { transport?: string };
        report?: { checks?: Array<{ id: string; scope?: string; status: string }> };
        unchecked?: Array<{ id: string }>;
      };
      expect(report.backend?.transport).toBe("api");
      const checks = report.report?.checks ?? [];
      expect(checks.length).toBeGreaterThan(0);
      // Every check states whether it looked at this machine or at the hosted
      // control plane; a scope-less check is how "clean report about the wrong
      // runtime" happens.
      expect(checks.every((check) => check.scope === "machine" || check.scope === "control-plane")).toBe(true);
      expect(checks.some((check) => check.scope === "machine")).toBe(true);
      expect(checks.some((check) => check.scope === "control-plane")).toBe(true);
      expect((report.unchecked ?? []).length).toBeGreaterThan(0);
      expect(result.stdout).not.toContain("test-hosted-key");
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  // The two checks above are only worth anything if they can also come back
  // bad. These construct the failing halves so neither is a verdict dressed as
  // a check.
  test("hosted doctor fails loudly when the control plane cannot be reached", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-hosted-doctor-down-"));
    // Bind and immediately release a port so the URL is well-formed and dead.
    const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
    const deadPort = probe.port;
    probe.stop(true);

    try {
      const result = await runCli(dataDir, ["--json", "doctor"], hostedEnv(deadPort));
      const report = JSON.parse(result.stdout) as {
        report?: { ok?: boolean; checks?: Array<{ id: string; status: string; scope?: string }> };
      };
      expect(report.report?.ok).toBe(false);
      const controlPlane = report.report?.checks?.find((check) => check.id === "control-plane");
      expect(controlPlane?.status).toBe("fail");
      expect(controlPlane?.scope).toBe("control-plane");
      expect(result.status).toBe(1);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("hosted doctor counts failed runs read from the hosted API", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-hosted-doctor-failed-"));
    const loop = hostedLoop({ id: "loop-ok", name: "loop-ok" });
    const failedRuns = [
      hostedRun(loop, { id: "run-f1", status: "failed", error: "boom" }),
      hostedRun(loop, { id: "run-f2", status: "failed", error: "boom" }),
    ];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/v1/loops") return Response.json({ ok: true, loops: [loop] });
        if (url.pathname === "/v1/runs") {
          // Honour the status filter the way the real /v1 contract does.
          const status = url.searchParams.get("status");
          if (status === "failed") return Response.json({ ok: true, runs: failedRuns });
          return Response.json({ ok: true, runs: [] });
        }
        return Response.json({ ok: false, error: "not_found" }, { status: 404 });
      },
    });

    try {
      const result = await runCli(dataDir, ["--json", "doctor"], hostedEnv(server.port));
      const report = JSON.parse(result.stdout) as {
        report?: { checks?: Array<{ id: string; status: string; message: string }> };
      };
      const runsCheck = report.report?.checks?.find((check) => check.id === "loop-runs");
      expect(runsCheck?.status).toBe("warn");
      expect(runsCheck?.message).toContain("2 failed loop run(s) recorded");
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("local mode keeps the unlabelled local reports (no hosted envelope)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-local-diagnostics-"));
    try {
      const health = await runCli(dataDir, ["--json", "health"]);
      expect(health.status).toBe(0);
      const healthReport = JSON.parse(health.stdout) as Record<string, unknown>;
      expect(healthReport.backend).toBeUndefined();
      expect(healthReport.summary).toBeDefined();

      const doctor = await runCli(dataDir, ["--json", "doctor"]);
      const doctorReport = JSON.parse(doctor.stdout) as Record<string, unknown>;
      expect(doctorReport.backend).toBeUndefined();
      expect(Array.isArray(doctorReport.checks)).toBe(true);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
