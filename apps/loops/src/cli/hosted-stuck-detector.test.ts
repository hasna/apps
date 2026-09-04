import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { Loop, LoopRun } from "../types.js";

const cliPath = join(import.meta.dir, "index.ts");
const PAST = "2020-01-01T00:00:00.000Z";
const FUTURE = "2099-01-01T00:00:00.000Z";

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

async function runCli(
  dataDir: string,
  args: string[],
  env: Record<string, string>,
): Promise<CliResult> {
  const merged = {
    ...process.env,
    HOME: dataDir,
    LOOPS_DATA_DIR: dataDir,
    HASNA_LOOPS_API_URL: "",
    HASNA_LOOPS_API_KEY: "",
    HASNA_LOOPS_CONNECTION: "",
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

function hostedLoop(id: string, name = id): Loop {
  return {
    id,
    name,
    labels: [],
    status: "active",
    schedule: { type: "interval", everyMs: 300_000 },
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
  } as Loop;
}

function hostedRun(loop: Loop, overrides: Partial<LoopRun> = {}): LoopRun {
  return {
    id: `run-${loop.id}`,
    loopId: loop.id,
    loopName: loop.name,
    scheduledFor: PAST,
    attempt: 1,
    status: "running",
    startedAt: PAST,
    createdAt: PAST,
    updatedAt: PAST,
    leaseExpiresAt: PAST,
    ...overrides,
  };
}

function serveHosted(options: {
  loops: Loop[];
  runs: LoopRun[];
  loopsEnvelope?: unknown;
  runsEnvelope?: unknown;
  stuck?: { state: "clear" | "stuck"; candidates: Array<{ runId: string; loopId: string; snapshotId: string }> };
  stuckEnvelope?: unknown;
  stuckStatus?: number;
}) {
  const paths: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      paths.push(`${request.method} ${url.pathname}${url.search}`);
      if (request.method === "GET" && url.pathname === "/v1/loops") {
        if (options.loopsEnvelope !== undefined) return Response.json(options.loopsEnvelope);
        const status = url.searchParams.get("status");
        const limit = Number(url.searchParams.get("limit") ?? options.loops.length);
        const loops = options.loops
          .filter((loop) => (status ? loop.status === status : true))
          .slice(0, limit);
        return Response.json({ ok: true, loops });
      }
      if (request.method === "GET" && url.pathname === "/v1/runs") {
        return Response.json(options.runsEnvelope ?? { ok: true, runs: options.runs });
      }
      if (request.method === "GET" && url.pathname === "/v1/leases/stuck") {
        if (options.stuckStatus) {
          return Response.json({ ok: false, error: "not_found" }, { status: options.stuckStatus });
        }
        if (options.stuckEnvelope !== undefined) return Response.json(options.stuckEnvelope);
        return Response.json({
          ok: true,
          report: {
            state: options.stuck?.state ?? "clear",
            expiredBefore: "2026-08-10T00:00:00.000Z",
            candidates: options.stuck?.candidates ?? [],
            truncated: false,
          },
        });
      }
      return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    },
  });
  return { server, paths };
}

function hostedEnv(port: number | undefined): Record<string, string> {
  if (port === undefined) throw new Error("fake hosted server did not allocate a port");
  return {
    HASNA_LOOPS_API_URL: `http://127.0.0.1:${port}`,
    HASNA_LOOPS_API_KEY: "test-hosted-key",
  };
}

function expectMalformedHealthError(result: CliResult): void {
  expect(result.status).toBe(1);
  const output = JSON.parse(result.stdout) as Record<string, unknown>;
  expect(output).toMatchObject({ ok: false });
  expect(output).not.toHaveProperty("status", "ok");
  expect(output).not.toHaveProperty("counts");
  expect(output).not.toHaveProperty("findings");
}

describe("hosted stuck-detector CLI boundary", () => {
  test("health scan rejects a malformed hosted loops envelope instead of manufacturing a clean result", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-hosted-scan-malformed-loops-"));
    const { server, paths } = serveHosted({ loops: [], runs: [], loopsEnvelope: { ok: true } });
    try {
      const result = await runCli(dataDir, ["--json", "health", "scan"], hostedEnv(server.port));
      expectMalformedHealthError(result);
      expect(paths).toEqual([
        "GET /v1/loops?status=active&limit=200",
        "GET /v1/loops?status=paused&limit=200",
      ]);
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("health scan rejects a malformed hosted runs envelope instead of manufacturing a clean result", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-hosted-scan-malformed-runs-"));
    const loop = hostedLoop("loop-malformed-runs");
    const { server, paths } = serveHosted({ loops: [loop], runs: [], runsEnvelope: { ok: true } });
    try {
      const result = await runCli(dataDir, ["--json", "health", "scan"], hostedEnv(server.port));
      expectMalformedHealthError(result);
      expect(paths.some((path) => path.startsWith("GET /v1/loops?"))).toBe(true);
      expect(paths.some((path) => path.startsWith("GET /v1/runs?"))).toBe(true);
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("health scan accepts valid hosted envelopes for a healthy in-flight lease", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-hosted-scan-valid-"));
    const loop = hostedLoop("loop-valid");
    const run = hostedRun(loop, { id: "run-valid", leaseExpiresAt: FUTURE });
    const { server } = serveHosted({ loops: [loop], runs: [run] });
    try {
      const result = await runCli(dataDir, ["--json", "health", "scan"], hostedEnv(server.port));
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        status: "ok",
        counts: { loops: 1, staleRunning: 0, findings: 0 },
        backend: { transport: "api" },
        unchecked: [],
      });
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("isolated local SQLite health and hygiene controls remain clean", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-local-stuck-controls-"));
    const localEnv = {
      HASNA_LOOPS_API_URL: "",
      HASNA_LOOPS_API_KEY: "",
    };
    try {
      const health = await runCli(dataDir, ["--json", "health", "scan"], localEnv);
      expect(health.status).toBe(0);
      expect(JSON.parse(health.stdout)).toMatchObject({
        ok: true,
        status: "ok",
        counts: { loops: 0, staleRunning: 0, findings: 0 },
      });

      const hygiene = await runCli(dataDir, ["--json", "hygiene", "stuck"], localEnv);
      expect(hygiene.status).toBe(0);
      expect(JSON.parse(hygiene.stdout)).toMatchObject({
        ok: true,
        checked: 0,
        stuck: 0,
        liveDeferred: 0,
        applied: false,
      });
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("health scan reads hosted runs and reports an expired lease as stale-running", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-hosted-scan-"));
    const loop = hostedLoop("loop-stale");
    const run = hostedRun(loop, { id: "run-stale", leaseExpiresAt: PAST });
    const { server, paths } = serveHosted({ loops: [loop], runs: [run] });
    try {
      const result = await runCli(dataDir, ["--json", "health", "scan"], hostedEnv(server.port));
      expect(result.status).toBe(2);
      expect(result.stderr).not.toContain("not available while flipped");
      const output = JSON.parse(result.stdout) as {
        backend?: { transport?: string };
        status?: string;
        counts?: { loops?: number; staleRunning?: number; findings?: number };
        findings?: Array<{ kind?: string; run?: { id?: string; leaseExpiresAt?: string } }>;
      };
      expect(output.backend?.transport).toBe("api");
      expect(output.status).toBe("critical");
      expect(output.counts).toMatchObject({ loops: 1, staleRunning: 1, findings: 1 });
      expect(output.findings).toContainEqual(expect.objectContaining({
        kind: "stale-running",
        run: expect.objectContaining({ id: run.id, leaseExpiresAt: PAST }),
      }));
      expect(paths.some((path) => path.startsWith("GET /v1/loops?"))).toBe(true);
      expect(paths.some((path) => path.startsWith("GET /v1/runs?"))).toBe(true);
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("health scan fetches the requested hosted status before applying the overall limit", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-hosted-status-scan-"));
    const active = hostedLoop("loop-active-first");
    const paused = { ...hostedLoop("loop-paused"), status: "paused" as const };
    const { server, paths } = serveHosted({ loops: [active, paused], runs: [] });
    try {
      const result = await runCli(
        dataDir,
        ["--json", "health", "scan", "--include", "paused", "--limit", "1"],
        hostedEnv(server.port),
      );
      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout) as {
        status?: string;
        counts?: { loops?: number; paused?: number };
      };
      expect(output.status).toBe("ok");
      expect(output.counts).toMatchObject({ loops: 1, paused: 1 });
      expect(paths.some((path) => path.startsWith("GET /v1/loops?status=paused&limit=1"))).toBe(true);
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("hygiene stuck reads a hosted clear report and keeps zero findings explicit", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-hosted-hygiene-clear-"));
    const loop = hostedLoop("loop-clear");
    const { server, paths } = serveHosted({ loops: [loop], runs: [], stuck: { state: "clear", candidates: [] } });
    try {
      const result = await runCli(dataDir, ["--json", "hygiene", "stuck"], hostedEnv(server.port));
      expect(result.status).toBe(0);
      const output = JSON.parse(result.stdout) as {
        state?: string;
        candidates?: unknown[];
        applied?: boolean;
      };
      expect(output).toMatchObject({ state: "clear", candidates: [], applied: false });
      expect(paths).toContain("GET /v1/leases/stuck?limit=100");
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("hygiene stuck reports hosted candidates and a hosted API error cannot parse as zero", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-hosted-hygiene-errors-"));
    const loop = hostedLoop("loop-stuck");
    const candidate = { runId: "run-stuck", loopId: loop.id, snapshotId: "stuck_snapshot" };
    const positive = serveHosted({
      loops: [loop],
      runs: [hostedRun(loop, { id: candidate.runId })],
      stuck: { state: "stuck", candidates: [candidate] },
    });
    const negative = serveHosted({ loops: [loop], runs: [], stuckStatus: 404 });
    try {
      const found = await runCli(dataDir, ["--json", "hygiene", "stuck"], hostedEnv(positive.server.port));
      expect(found.status).toBe(1);
      expect(JSON.parse(found.stdout)).toMatchObject({
        state: "stuck",
        candidates: [candidate],
        applied: false,
      });

      const refused = await runCli(dataDir, ["--json", "hygiene", "stuck"], hostedEnv(negative.server.port));
      expect(refused.status).toBe(1);
      const error = JSON.parse(refused.stdout) as Record<string, unknown>;
      expect(error).toMatchObject({ ok: false });
      expect(error).not.toHaveProperty("state", "clear");
      expect(error).not.toHaveProperty("candidates", []);
    } finally {
      positive.server.stop(true);
      negative.server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("hygiene stuck rejects a malformed hosted report envelope without zero-shaped output", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-hosted-hygiene-malformed-"));
    const { server } = serveHosted({ loops: [], runs: [], stuckEnvelope: { ok: true } });
    try {
      const result = await runCli(dataDir, ["--json", "hygiene", "stuck"], hostedEnv(server.port));
      expect(result.status).toBe(1);
      const output = `${result.stdout}\n${result.stderr}`;
      expect(output).not.toContain('"state": "clear"');
      expect(output).not.toContain('"candidates": []');
      expect(output).not.toContain("candidates=0");
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
