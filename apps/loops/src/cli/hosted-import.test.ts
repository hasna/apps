import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { LOOPS_MIGRATION_SCHEMA, migrationHash, type LoopsMigrationBundle } from "../lib/migration.js";
import { importRequestDigest, LOOPS_IMPORT_RECEIPT_CONTRACT } from "../lib/import-contract.js";
import type { Loop, LoopRun, WorkflowSpec } from "../types.js";

/**
 * `loops import` on a hosted connection (W13 PORT-TO-API).
 *
 * Before this port the command opened `~/.hasna/loops/loops.db` unconditionally,
 * so on a station using the hosted API it planned against — and wrote into
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
function serveHosted(
  existing: { loops: Loop[]; workflows: WorkflowSpec[]; runs: LoopRun[] },
  behavior: { importResponse?: unknown; loopResponse?: Loop; workflowCount?: unknown } = {},
) {
  const paths: string[] = [];
  const posted: Array<Record<string, unknown>> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      paths.push(`${request.method} ${url.pathname}`);
      if (request.method === "GET" && url.pathname === "/v1/version") {
        return Response.json({ status: "ok", version: "0.8.0", capabilities: ["loops.import.v2"] });
      }
      if (request.method === "POST" && url.pathname === "/v1/import") {
        const body = (await request.json()) as Record<string, unknown>;
        posted.push(body);
        const ids = (key: "workflows" | "loops" | "runs") =>
          (Array.isArray(body[key]) ? (body[key] as Array<{ id: string }>).map((row) => row.id) : []);
        const requestBody = body as { operationId: string; workflows?: WorkflowSpec[]; loops?: Loop[]; runs?: LoopRun[]; replace?: boolean };
        return Response.json(behavior.importResponse ?? {
          ok: true,
          imported: { workflows: ids("workflows").length, loops: ids("loops").length, runs: ids("runs").length },
          skippedRunning: 0,
          skippedExisting: { workflows: 0, loops: 0, runs: 0 },
          receipt: {
            contract: LOOPS_IMPORT_RECEIPT_CONTRACT,
            operationId: requestBody.operationId,
            requestDigest: importRequestDigest(requestBody),
            importedIds: { workflows: ids("workflows"), loops: ids("loops"), runs: ids("runs") },
            skippedRunningIds: [],
            skippedExistingIds: { workflows: [], loops: [], runs: [] },
          },
        });
      }
      if (request.method === "GET" && url.pathname === "/v1/workflows/count") {
        const status = url.searchParams.get("status");
        return Response.json({
          ok: true,
          count: behavior.workflowCount ?? existing.workflows.filter((entry) => (status ? entry.status === status : true)).length,
        });
      }
      if (request.method === "GET" && url.pathname === "/v1/workflows") {
        const status = url.searchParams.get("status");
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? 200);
        return Response.json({
          ok: true,
          workflows: existing.workflows
            .filter((entry) => (status ? entry.status === status : true))
            .slice(offset, offset + limit),
        });
      }
      if (request.method === "GET" && url.pathname === "/v1/runs/count") {
        const loopId = url.searchParams.get("loopId") ?? "";
        return Response.json({ ok: true, count: existing.runs.filter((entry) => entry.loopId === loopId).length });
      }
      if (request.method === "GET" && url.pathname === "/v1/runs") {
        const loopId = url.searchParams.get("loopId") ?? "";
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const limit = Number(url.searchParams.get("limit") ?? 100);
        return Response.json({
          ok: true,
          runs: existing.runs.filter((entry) => entry.loopId === loopId).slice(offset, offset + limit),
        });
      }
      if (request.method === "GET" && url.pathname.startsWith("/v1/loops/")) {
        const id = decodeURIComponent(url.pathname.slice("/v1/loops/".length));
        const found = behavior.loopResponse ?? existing.loops.find((entry) => entry.id === id);
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
      expect(result.stderr).not.toContain("REMOTE_COMMAND_UNSUPPORTED");
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
      expect(paths.filter((path) => path === "GET /v1/workflows/count")).toHaveLength(4);
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
      expect(result.stderr).not.toContain("REMOTE_COMMAND_UNSUPPORTED");
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
      expect(posted).toEqual([]);
      expect(dbFilesUnder(home)).toEqual([]);
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("resolves authority before reading the migration file", async () => {
    const home = mkdtempSync(join(tmpdir(), "loops-hosted-import-authority-first-"));
    try {
      const result = await runCli(home, ["--json", "import", join(home, "does-not-exist.json")], {
        HASNA_LOOPS_API_URL: "",
        HASNA_LOOPS_API_KEY: "",
        HASNA_LOOPS_LOCAL: "",
        LOOPS_LOCAL: "",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("no loops client connection is configured");
      expect(result.stderr).not.toContain("failed to read JSON file");
      expect(dbFilesUnder(home)).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("refuses an old server before reading the import file", async () => {
    const home = mkdtempSync(join(tmpdir(), "loops-hosted-import-capability-first-"));
    const paths: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        paths.push(`${request.method} ${url.pathname}`);
        return Response.json({ status: "ok", version: "0.7.0", capabilities: [] });
      },
    });
    try {
      const result = await runCli(
        home,
        ["--json", "import", join(home, "does-not-exist.json")],
        hostedEnv(server.port as number),
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("capabilities to include loops.import.v2");
      expect(result.stderr).not.toContain("ENOENT");
      expect(paths).toEqual(["GET /v1/version"]);
      expect(dbFilesUnder(home)).toEqual([]);
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("refuses a hosted row whose identity does not match the requested id", async () => {
    const home = mkdtempSync(join(tmpdir(), "loops-hosted-import-wrong-id-"));
    const file = bundleFile(home, { workflows: [], loops: [loop("loop-1")], runs: [] });
    const { server, posted } = serveHosted(
      { loops: [], workflows: [], runs: [] },
      { loopResponse: loop("different-loop") },
    );
    try {
      const result = await runCli(home, ["--json", "import", file, "--apply"], hostedEnv(server.port as number));
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("loop.id to equal requested id 'loop-1'");
      expect(posted).toEqual([]);
      expect(dbFilesUnder(home)).toEqual([]);
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("refuses malformed count responses before posting an import", async () => {
    const home = mkdtempSync(join(tmpdir(), "loops-hosted-import-bad-count-"));
    const file = bundleFile(home, { workflows: [], loops: [], runs: [] });
    const { server, posted } = serveHosted(
      { loops: [], workflows: [], runs: [] },
      { workflowCount: "zero" },
    );
    try {
      const result = await runCli(home, ["--json", "import", file, "--apply"], hostedEnv(server.port as number));
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("'count' to be a non-negative safe integer");
      expect(posted).toEqual([]);
      expect(dbFilesUnder(home)).toEqual([]);
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("marks an untrustworthy import receipt as reconciliation-required", async () => {
    const home = mkdtempSync(join(tmpdir(), "loops-hosted-import-bad-receipt-"));
    const file = bundleFile(home, { workflows: [], loops: [loop("loop-1")], runs: [] });
    const { server, posted } = serveHosted(
      { loops: [], workflows: [], runs: [] },
      { importResponse: { ok: true, imported: { workflows: 0, loops: 0, runs: 0 }, skippedRunning: 0 } },
    );
    try {
      const result = await runCli(home, ["--json", "import", file, "--apply"], hostedEnv(server.port as number));
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("do not retry blindly");
      expect(posted).toHaveLength(1);
      expect(dbFilesUnder(home)).toEqual([]);
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  });


  test("requires --replace before re-posting an id represented by a public hosted row", async () => {
    const home = mkdtempSync(join(tmpdir(), "loops-hosted-import-replace-"));
    const existingLoop = loop("loop-1");
    const file = bundleFile(home, { workflows: [], loops: [{ ...existingLoop, description: "replacement" }], runs: [] });
    const { server, posted } = serveHosted({ loops: [existingLoop], workflows: [], runs: [] });
    try {
      const result = await runCli(
        home,
        ["--json", "import", file, "--apply", "--replace"],
        hostedEnv(server.port as number),
      );
      expect(result.status).toBe(0);
      expect(posted).toHaveLength(1);
      expect((posted[0] as { replace?: boolean }).replace).toBe(true);
      expect((posted[0] as { loops: Loop[] }).loops.map((entry) => entry.id)).toEqual(["loop-1"]);
      expect(dbFilesUnder(home)).toEqual([]);
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("refuses hosted import row sets above the bounded planner ceiling", async () => {
    const home = mkdtempSync(join(tmpdir(), "loops-hosted-import-row-cap-"));
    const loops = Array.from({ length: 501 }, (_, index) => loop(`loop-${index}`));
    const file = bundleFile(home, { workflows: [], loops, runs: [] });
    const { server, paths, posted } = serveHosted({ loops: [], workflows: [], runs: [] });
    try {
      const result = await runCli(home, ["--json", "import", file], hostedEnv(server.port as number));
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("at most 500 selected rows");
      expect(paths).toEqual(["GET /v1/version"]);
      expect(posted).toEqual([]);
      expect(dbFilesUnder(home)).toEqual([]);
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("refuses apply when a referenced loop exceeds the bounded run-slot window", async () => {
    const home = mkdtempSync(join(tmpdir(), "loops-hosted-import-slot-cap-"));
    const existingLoop = loop("loop-1");
    const historicalRuns = Array.from({ length: 501 }, (_, index) => ({
      ...run(`historical-${index}`, existingLoop.id),
      scheduledFor: new Date(Date.parse(PAST) + index * 1_000).toISOString(),
    }));
    const incoming = run("incoming-run", existingLoop.id);
    const file = bundleFile(home, { workflows: [], loops: [existingLoop], runs: [incoming] });
    const { server, posted } = serveHosted({ loops: [existingLoop], workflows: [], runs: historicalRuns });
    try {
      const preview = await runCli(home, ["--json", "import", file], hostedEnv(server.port as number));
      expect(preview.status).toBe(0);
      const previewValue = JSON.parse(preview.stdout) as { unchecked: Array<{ id: string }> };
      expect(previewValue.unchecked.map((entry) => entry.id)).toContain("run-slots:loop-1");

      const apply = await runCli(home, ["--json", "import", file, "--apply"], hostedEnv(server.port as number));
      expect(apply.status).toBe(1);
      expect(apply.stderr).toContain("scheduled-slot check(s) exceeded the bounded safety window");
      expect(posted).toEqual([]);
      expect(dbFilesUnder(home)).toEqual([]);
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  });

});
