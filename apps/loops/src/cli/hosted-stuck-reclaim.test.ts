// todos 2582d190. `loops hygiene stuck` documents itself as the remedy for
// 7cf8d8c1 ("overlap:skip then blocks the loop forever") and then refused
// against the hosted store — where the wedged loops actually are:
//
//     rc=1
//     error: 'loops hygiene stuck' operates on this machine's local runtime and
//     is not available while flipped to the hosted Loops API. ...
//
// Four loops were measured stuck `running` for 60-74h against 30-50m leases, so
// the tool that fixes the defect could not reach the population that had it.
//
// The error's own advice is a trap and is deliberately NOT the fix: unsetting
// HASNA_LOOPS_API_URL/HASNA_LOOPS_API_KEY does not make the verb work on those
// loops, it points the CLI at a DIFFERENT store (the local one) which does not
// contain them. It would run happily and reclaim nothing that matters.
//
// This mirrors the ratified hosted-mode pattern already applied to `loops
// health` and `loops doctor` (19cc44ba): answer against the hosted control
// plane rather than refusing.
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

async function runCli(dataDir: string, args: string[], env: Record<string, string> = {}): Promise<CliResult> {
  const child = Bun.spawn([process.execPath, cliPath, ...args], {
    env: {
      ...process.env,
      HOME: dataDir,
      HASNA_LOOPS_STORAGE_MODE: "local",
      HASNA_LOOPS_API_URL: "",
      HASNA_LOOPS_API_KEY: "",
      LOOPS_DATA_DIR: dataDir,
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

const PAST = "2020-01-01T00:00:00.000Z";
const FUTURE = "2099-01-01T00:00:00.000Z";

function hostedLoop(overrides: Partial<Loop> & Pick<Loop, "id" | "name">): Loop {
  return {
    labels: [],
    status: "active",
    schedule: { type: "every", every: "10m" },
    target: { type: "command", command: "true" },
    nextRunAt: PAST,
    catchUp: "latest",
    catchUpLimit: 1,
    overlap: "skip",
    maxAttempts: 1,
    retryDelayMs: 0,
    leaseMs: 600_000,
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
    status: "running",
    startedAt: PAST,
    claimedBy: "runner-dead",
    // Expired long ago — this is the wedge shape from the incident.
    leaseExpiresAt: PAST,
    createdAt: PAST,
    updatedAt: PAST,
    ...overrides,
  } as LoopRun;
}

/**
 * Fake hosted `/v1` backend. Records every path AND method so a test can assert
 * both that the command reached the hosted API and — for the preview path —
 * that it issued no mutating request at all.
 */
function serveHosted(runs: LoopRun[], opts: { recoverStatus?: number } = {}) {
  const calls: string[] = [];
  let recovered: LoopRun[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      calls.push(`${request.method} ${url.pathname}`);
      if (url.pathname === "/v1/runs" && request.method === "GET") {
        const status = url.searchParams.get("status");
        const limit = Number(url.searchParams.get("limit") ?? "100");
        const matching = status ? runs.filter((run) => run.status === status) : runs;
        return Response.json({ ok: true, runs: matching.slice(0, limit) });
      }
      if (url.pathname === "/v1/leases/recover" && request.method === "POST") {
        if (opts.recoverStatus && opts.recoverStatus !== 200) {
          return Response.json({ ok: false, error: "maintenance_principal_required" }, { status: opts.recoverStatus });
        }
        recovered = runs.filter((run) => run.status === "running");
        return Response.json({
          ok: true,
          abandoned: recovered.map((run) => ({ ...run, status: "abandoned" })),
          deferred: [],
          advancementDeferred: [],
        });
      }
      return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    },
  });
  return { server, calls, recoveredCount: () => recovered.length };
}

function hostedEnv(port: number | undefined): Record<string, string> {
  return {
    HASNA_LOOPS_STORAGE_MODE: "self_hosted",
    HASNA_LOOPS_API_URL: `http://127.0.0.1:${port}`,
    HASNA_LOOPS_API_KEY: "test-hosted-key",
  };
}

describe("hosted hygiene stuck (2582d190)", () => {
  test("reports against the hosted store instead of refusing", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-hosted-stuck-"));
    const loop = hostedLoop({ id: "loop-wedged", name: "agent-chief-finance-coordination-10m" });
    const { server, calls } = serveHosted([hostedRun(loop)]);

    try {
      const result = await runCli(dataDir, ["--json", "hygiene", "stuck"], hostedEnv(server.port));
      // The failing state is the refusal; the passing state is a parsable report.
      expect(result.stderr).not.toContain("not available while flipped");
      const report = JSON.parse(result.stdout) as {
        ok?: boolean;
        stuck?: number;
        checked?: number;
        applied?: boolean;
        backend?: { transport?: string };
        entries?: Array<{ runId: string; loopName: string }>;
        unchecked?: Array<{ id: string; reason: string }>;
      };
      expect(report.backend?.transport).toBe("cloud-http");
      expect(report.applied).toBe(false);
      expect(report.stuck).toBe(1);
      expect(report.entries?.[0]?.runId).toBe("run-loop-wedged");
      // The hosted preview selects on lease expiry alone, so it must say out
      // loud that it did not check process liveness — `stuck` is an upper
      // bound, not a prediction of what --apply would reclaim.
      expect((report.unchecked ?? []).map((entry) => entry.id)).toContain("run-liveness");
      expect(report.unchecked?.every((entry) => entry.reason.length > 0)).toBe(true);
      // It really read the hosted API rather than a local sqlite island.
      expect(calls).toContain("GET /v1/runs");
      // The API key must never reach output.
      expect(result.stdout).not.toContain("test-hosted-key");
      expect(result.stderr).not.toContain("test-hosted-key");
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  // The preview half must be safe to run against production. `POST
  // /v1/leases/recover` mutates loop cadence (it advances nextRunAt), so a
  // read-only preview must never issue it.
  test("preview issues no mutating request", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-hosted-stuck-preview-"));
    const loop = hostedLoop({ id: "loop-wedged", name: "loop-wedged" });
    const { server, calls, recoveredCount } = serveHosted([hostedRun(loop)]);

    try {
      await runCli(dataDir, ["--json", "hygiene", "stuck"], hostedEnv(server.port));
      expect(calls.filter((call) => call.startsWith("POST"))).toEqual([]);
      expect(recoveredCount()).toBe(0);
      // Positive control on the same recorder: it does capture calls, so the
      // empty POST list above is an observation and not a broken probe.
      expect(calls).toContain("GET /v1/runs");
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  test("--apply calls the hosted reclaim endpoint and reports what it reclaimed", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-hosted-stuck-apply-"));
    const loop = hostedLoop({ id: "loop-wedged", name: "loop-wedged" });
    const { server, calls, recoveredCount } = serveHosted([hostedRun(loop)]);

    try {
      const result = await runCli(dataDir, ["--json", "hygiene", "stuck", "--apply", "--limit", "1"], hostedEnv(server.port));
      expect(result.stderr).not.toContain("not available while flipped");
      const report = JSON.parse(result.stdout) as {
        applied?: boolean;
        stuck?: number;
        unchecked?: Array<{ id: string; reason: string }>;
      };
      expect(calls).toContain("POST /v1/leases/recover");
      expect(recoveredCount()).toBe(1);
      expect(report.applied).toBe(true);
      expect(report.stuck).toBe(1);
      // `--limit` is advertised as "maximum runs to reclaim in one pass" and the
      // hosted endpoint accepts no bound at all. A flag that appears to work and
      // silently does nothing is the defect class this command exists to fix, so
      // the report must say the bound was not enforced rather than drop it.
      expect((report.unchecked ?? []).map((entry) => entry.id)).toContain("apply-limit-not-enforced");
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  // The other half of the incident: "the JSON body parsed cleanly and yielded
  // `stuck runs found: 0`". A refusal or a transport failure must never present
  // as a clean zero to anyone scripting this check.
  test("a hosted failure does not present as a clean zero report", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "loops-hosted-stuck-fail-"));
    const loop = hostedLoop({ id: "loop-wedged", name: "loop-wedged" });
    const { server } = serveHosted([hostedRun(loop)], { recoverStatus: 403 });

    try {
      const result = await runCli(dataDir, ["--json", "hygiene", "stuck", "--apply"], hostedEnv(server.port));
      expect(result.status).not.toBe(0);
      const body = JSON.parse(result.stdout) as { ok?: boolean; stuck?: number; error?: { message?: string } };
      // ok:false is what distinguishes this from a real all-clear.
      expect(body.ok).toBe(false);
      // And it must NOT look like a successful survey that found nothing.
      expect(body.stuck).toBeUndefined();
      expect(body.error?.message ?? "").not.toBe("");
      expect(result.stdout).not.toContain("test-hosted-key");
    } finally {
      server.stop(true);
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
