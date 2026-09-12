import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { LOOPS_MIGRATION_SCHEMA, migrationHash, type LoopsMigrationBundle } from "../lib/migration.js";
import type { Loop, LoopRun, WorkflowSpec } from "../types.js";

/**
 * `loops import` on a hosted connection (W13 PORT-TO-API).
 *
 * Before this port the command opened `~/.hasna/loops/loops.db` unconditionally,
 * so on a station flipped to the hosted API it planned against — and wrote into
 * — a local island nothing reads, while `POST /v1/import` went unused. These
 * tests pin the hosted transport: the preview must be computed from `/v1` reads,
 * the apply must be the single bulk POST, and NEITHER may create a sqlite file.
 */

const cliPath = join(dirname(fileURLToPath(import.meta.url)), "index.ts");
const PAST = "2026-01-01T00:00:00.000Z";

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

async function runCli(home: string, args: string[], env: Record<string, string>): Promise<CliResult> {
  const child = Bun.spawn([process.execPath, cliPath, ...args], {
    env: {
      ...process.env,
      HOME: home,
      HASNA_HOME: home,
      HASNA_CONFIG_HOME: home,
      LOOPS_DATA_DIR: join(home, "loops-data"),
      HASNA_LOOPS_CONNECTION: "",
      // A provisioned station's real keychain/disk credential outranks nothing
      // here, but pin a station that owns no item so the env tier is the only
      // credential source in play.
      HASNA_STATION: "loops-hermetic-no-such-station",
      ...env,
    },
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

function hostedEnv(port: number): Record<string, string> {
  return {
    HASNA_LOOPS_API_URL: `http://127.0.0.1:${port}`,
    HASNA_LOOPS_API_KEY: "test-hosted-key",
  };
}

function workflow(id: string): WorkflowSpec {
  return {
    id,
    name: id,
    status: "active",
    steps: [{ id: "step-1", target: { type: "command", command: "true" } }],
    createdAt: PAST,
    updatedAt: PAST,
  } as WorkflowSpec;
}

function loop(id: string): Loop {
  return {
    id,
    name: id,
    labels: [],
    status: "active",
    schedule: { type: "interval", everyMs: 300_000 },
    target: { type: "command", command: "true" },
    nextRunAt: "2099-01-01T00:00:00.000Z",
    catchUp: "none",
    catchUpLimit: 1,
    overlap: "skip",
    maxAttempts: 1,
    retryDelayMs: 0,
    leaseMs: 60_000,
    createdAt: PAST,
    updatedAt: PAST,
  } as Loop;
}

function run(id: string, loopId: string): LoopRun {
  return {
    id,
    loopId,
    loopName: loopId,
    scheduledFor: PAST,
    attempt: 1,
    status: "succeeded",
    startedAt: PAST,
    finishedAt: PAST,
    createdAt: PAST,
    updatedAt: PAST,
  } as LoopRun;
}

/** A schema-valid, integrity-hashed bundle built without touching sqlite. */
function bundleFile(dir: string, data: { workflows: WorkflowSpec[]; loops: Loop[]; runs: LoopRun[] }): string {
  const body = {
    schema: LOOPS_MIGRATION_SCHEMA as typeof LOOPS_MIGRATION_SCHEMA,
    packageVersion: "0.0.0-test",
    exportedAt: PAST,
    source: { backend: "sqlite" as const, schemaVersion: 1, hostname: "test-host" },
    checks: {
      unsupportedCounts: {
        workflowInvocations: 0,
        workflowWorkItems: 0,
        workflowRuns: 0,
        workflowStepRuns: 0,
        workflowEvents: 0,
        goals: 0,
        goalPlanNodes: 0,
        goalRuns: 0,
      },
      volatileCounts: {
        daemonLeases: 0,
        activeDaemonLeases: 0,
        runningLoopRuns: 0,
        runningWorkflowRuns: 0,
        runningWorkflowStepRuns: 0,
        leasedWorkflowWorkItems: 0,
      },
    },
    importable: true,
    counts: { workflows: data.workflows.length, loops: data.loops.length, runs: data.runs.length },
    data,
    blockers: [],
    warnings: [],
  };
  const bundle: LoopsMigrationBundle = { ...body, hash: migrationHash(body) } as LoopsMigrationBundle;
  const file = join(dir, "bundle.json");
  writeFileSync(file, `${JSON.stringify(bundle, null, 2)}\n`);
  return file;
}

/** Hosted `/v1` stub. Anything the port did not implement 404s loudly. */
function serveHosted(existing: { loops: Loop[]; workflows: WorkflowSpec[]; runs: LoopRun[] }) {
  const paths: string[] = [];
  const posted: Array<Record<string, unknown>> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      paths.push(`${request.method} ${url.pathname}`);
      if (request.method === "POST" && url.pathname === "/v1/import") {
        const body = (await request.json()) as Record<string, unknown>;
        posted.push(body);
        const counted = (key: string) => (Array.isArray(body[key]) ? (body[key] as unknown[]).length : 0);
        return Response.json({
          ok: true,
          imported: { workflows: counted("workflows"), loops: counted("loops"), runs: counted("runs") },
          skippedRunning: 0,
        });
      }
      if (request.method === "GET" && url.pathname === "/v1/workflows") {
        const status = url.searchParams.get("status");
        return Response.json({
          ok: true,
          workflows: existing.workflows.filter((entry) => (status ? entry.status === status : true)),
        });
      }
      if (request.method === "GET" && url.pathname === "/v1/runs") {
        const loopId = url.searchParams.get("loopId") ?? "";
        return Response.json({ ok: true, runs: existing.runs.filter((entry) => entry.loopId === loopId) });
      }
      if (request.method === "GET" && url.pathname.startsWith("/v1/loops/")) {
        const id = decodeURIComponent(url.pathname.slice("/v1/loops/".length));
        const found = existing.loops.find((entry) => entry.id === id);
        return found
          ? Response.json({ ok: true, loop: found })
          : Response.json({ ok: false, error: "not_found" }, { status: 404 });
      }
      if (request.method === "GET" && url.pathname.startsWith("/v1/workflows/")) {
        const id = decodeURIComponent(url.pathname.slice("/v1/workflows/".length));
        const found = existing.workflows.find((entry) => entry.id === id);
        return found
          ? Response.json({ ok: true, workflow: found })
          : Response.json({ ok: false, error: "not_found" }, { status: 404 });
      }
      if (request.method === "GET" && url.pathname.startsWith("/v1/runs/")) {
        const id = decodeURIComponent(url.pathname.slice("/v1/runs/".length));
        const found = existing.runs.find((entry) => entry.id === id);
        return found
          ? Response.json({ ok: true, run: found })
          : Response.json({ ok: false, error: "not_found" }, { status: 404 });
      }
      return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    },
  });
  return { server, paths, posted };
}

function dbFilesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.includes(".db")) found.push(full);
    }
  };
  walk(dir);
  return found;
}

describe("hosted loops import (W13 PORT-TO-API)", () => {
  test("preview plans against /v1 reads and never opens a local sqlite file", async () => {
    const home = mkdtempSync(join(tmpdir(), "loops-hosted-import-preview-"));
    const file = bundleFile(home, { workflows: [workflow("wf-1")], loops: [loop("loop-1")], runs: [] });
    const { server, paths, posted } = serveHosted({ loops: [], workflows: [], runs: [] });
    try {
      const result = await runCli(home, ["--json", "import", file], hostedEnv(server.port as number));
      expect(result.stderr).not.toContain("not available while flipped");
      expect(result.status).toBe(0);
      const value = JSON.parse(result.stdout) as {
        operation: string;
        dryRun: boolean;
        summary: { insert: number; blocked: number; conflict: number };
        backend: { transport: string; apiUrl?: string };
        unchecked: Array<{ id: string }>;
      };
      expect(value.operation).toBe("import");
      expect(value.dryRun).toBe(true);
      // One workflow + one loop are new to the hosted control plane.
      expect(value.summary.insert).toBe(2);
      expect(value.summary.blocked).toBe(0);
      expect(value.summary.conflict).toBe(0);
      expect(value.backend.transport).toBe("api");
      // The destination census it could NOT run is named, not silently passed.
      expect(value.unchecked.map((entry) => entry.id)).toContain("destination-table-census");
      // Proof the plan came from the hosted API.
      expect(paths).toContain("GET /v1/workflows");
      expect(paths).toContain("GET /v1/loops/loop-1");
      expect(paths).toContain("GET /v1/workflows/wf-1");
      // A preview writes nothing, anywhere.
      expect(posted).toEqual([]);
      expect(dbFilesUnder(home)).toEqual([]);
      expect(result.stdout).not.toContain("test-hosted-key");
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("--apply posts the bundle to POST /v1/import and creates no local database", async () => {
    const home = mkdtempSync(join(tmpdir(), "loops-hosted-import-apply-"));
    const file = bundleFile(home, {
      workflows: [workflow("wf-1")],
      loops: [loop("loop-1")],
      runs: [run("run-1", "loop-1")],
    });
    const { server, paths, posted } = serveHosted({ loops: [], workflows: [], runs: [] });
    try {
      const result = await runCli(home, ["--json", "import", file, "--apply"], hostedEnv(server.port as number));
      expect(result.stderr).not.toContain("not available while flipped");
      expect(result.status).toBe(0);
      const value = JSON.parse(result.stdout) as {
        ok: boolean;
        imported: { workflows: number; loops: number; runs: number };
        backfillSafety: { workflowsArchived: boolean; loopsPausedAndUnscheduled: boolean };
        backend: { transport: string };
      };
      expect(value.ok).toBe(true);
      expect(value.imported).toEqual({ workflows: 1, loops: 1, runs: 1 });
      expect(value.backend.transport).toBe("api");
      // The route's backfill safety is reported, not hidden.
      expect(value.backfillSafety).toEqual({ workflowsArchived: true, loopsPausedAndUnscheduled: true });
      expect(paths).toContain("POST /v1/import");
      expect(posted).toHaveLength(1);
      const body = posted[0] as { workflows: WorkflowSpec[]; loops: Loop[]; runs: LoopRun[]; preserveLoopScheduling?: boolean };
      expect(body.workflows.map((entry) => entry.id)).toEqual(["wf-1"]);
      expect(body.loops.map((entry) => entry.id)).toEqual(["loop-1"]);
      expect(body.runs.map((entry) => entry.id)).toEqual(["run-1"]);
      // No preserve override: the server's backfill safety stays in force.
      expect(body.preserveLoopScheduling).toBeUndefined();
      expect(dbFilesUnder(home)).toEqual([]);
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("rows the hosted control plane already holds unchanged are skipped, not re-posted", async () => {
    const home = mkdtempSync(join(tmpdir(), "loops-hosted-import-skip-"));
    const existingLoop = loop("loop-1");
    const file = bundleFile(home, { workflows: [], loops: [existingLoop], runs: [] });
    const { server, posted } = serveHosted({ loops: [existingLoop], workflows: [], runs: [] });
    try {
      const result = await runCli(home, ["--json", "import", file, "--apply"], hostedEnv(server.port as number));
      expect(result.status).toBe(0);
      const value = JSON.parse(result.stdout) as { imported: { loops: number }; plan: { summary: { skip: number } } };
      expect(value.plan.summary.skip).toBe(1);
      expect(value.imported.loops).toBe(0);
      expect((posted[0] as { loops: Loop[] }).loops).toEqual([]);
      expect(dbFilesUnder(home)).toEqual([]);
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  });
});
