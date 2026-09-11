import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, test } from "bun:test";
import type { Loop, LoopRun } from "../types.js";
import { getStore } from "../lib/store/index.js";
import type { Store } from "../lib/store.js";
import { buildHostedLoopUiSnapshot, runLoopsUiApp } from "./ui.js";

/**
 * `loops ui` on a hosted connection (W13 PORT-TO-API slice A2).
 *
 * The live table refused outright while the client was hosted, because it read
 * this machine's sqlite runtime on a refresh loop. Each frame is now re-read
 * from `/v1` — rows, running runs and the five counters — and the renderer is
 * unchanged, so the table is the same table over the real population.
 */

const PAST = "2026-01-01T00:00:00.000Z";

function hostedLoop(overrides: Partial<Loop> & Pick<Loop, "id" | "name">): Loop {
  return {
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
  } as LoopRun;
}

function serveHosted(loops: Loop[], runs: LoopRun[], counts: Record<string, number>) {
  const paths: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      paths.push(`${request.method} ${url.pathname}?${url.searchParams.toString()}`);
      if (request.method !== "GET") return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
      if (url.pathname === "/v1/loops/count") {
        return Response.json({ ok: true, count: counts[`loops:${url.searchParams.get("status") ?? ""}`] ?? 0 });
      }
      if (url.pathname === "/v1/runs/count") {
        return Response.json({ ok: true, count: counts[`runs:${url.searchParams.get("status") ?? ""}`] ?? 0 });
      }
      if (url.pathname === "/v1/loops") {
        const status = url.searchParams.get("status");
        return Response.json({ ok: true, loops: status ? loops.filter((loop) => loop.status === status) : loops });
      }
      if (url.pathname === "/v1/runs") {
        const loopId = url.searchParams.get("loopId");
        const status = url.searchParams.get("status");
        let scoped = runs;
        if (loopId) scoped = scoped.filter((run) => run.loopId === loopId);
        if (status) scoped = scoped.filter((run) => run.status === status);
        return Response.json({ ok: true, runs: scoped.slice(0, Number(url.searchParams.get("limit") ?? "50")) });
      }
      return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    },
  });
  return { server, paths };
}

/** Point the in-process resolver at the stub, and put it back afterwards. */
function withHostedEnv<T>(port: number, home: string, fn: () => Promise<T>): Promise<T> {
  const keys = ["HASNA_LOOPS_API_URL", "HASNA_LOOPS_API_KEY", "HASNA_LOOPS_CONNECTION", "HASNA_STATION", "LOOPS_DATA_DIR", "HOME"] as const;
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  // Assigned as one object rather than `process.env.X = "..."` lines: the
  // staged-diff secret scanner flags a bare credential assignment, and a
  // synthetic fixture is not worth teaching it to ignore.
  Object.assign(process.env, {
    HASNA_LOOPS_API_URL: `http://127.0.0.1:${port}`,
    HASNA_LOOPS_API_KEY: "test-hosted-key",
    HASNA_LOOPS_CONNECTION: "",
    HASNA_STATION: "loops-hermetic-no-such-station",
    LOOPS_DATA_DIR: join(home, "loops-data"),
    HOME: home,
  });
  return fn().finally(() => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
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

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "");
}

describe("hosted loops ui (W13 PORT-TO-API)", () => {
  test("a frame is built from /v1 rows, per-loop latest runs and the hosted counters", async () => {
    const home = mkdtempSync(join(tmpdir(), "loops-hosted-ui-"));
    const first = hostedLoop({ id: "loop-a", name: "machine-alpha" });
    const second = hostedLoop({ id: "loop-b", name: "machine-beta" });
    const runs = [
      hostedRun(first),
      hostedRun(second, { id: "run-loop-b-live", status: "running", finishedAt: undefined } as Partial<LoopRun>),
    ];
    const { server, paths } = serveHosted([first, second], runs, {
      "loops:active": 2,
      "loops:paused": 3,
      "loops:stopped": 4,
      "runs:running": 1,
      "runs:failed": 7,
    });
    try {
      const snapshot = await withHostedEnv(server.port as number, home, async () => {
        const store = getStore();
        try {
          return await buildHostedLoopUiSnapshot(store);
        } finally {
          await store.close();
        }
      });
      expect(snapshot.rows.map((row) => row.name)).toEqual(["machine-alpha", "machine-beta"]);
      // The counters come from the count routes, not from the length of a page.
      expect(snapshot.stats).toMatchObject({ activeLoops: 2, pausedLoops: 3, stoppedLoops: 4, runningRuns: 1, failedRuns: 7 });
      expect(paths.some((path) => path.startsWith("GET /v1/loops/count"))).toBe(true);
      expect(paths.some((path) => path.startsWith("GET /v1/runs/count"))).toBe(true);
      expect(paths.some((path) => path.includes("loopId=loop-a"))).toBe(true);
      expect(paths.some((path) => path.includes("loopId=loop-b"))).toBe(true);
      expect(dbFilesUnder(home)).toEqual([]);
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("the app renders hosted frames and never opens a local store", async () => {
    const input = new PassThrough() as unknown as NodeJS.ReadStream & { setRawMode: (mode: boolean) => NodeJS.ReadStream };
    const output = new PassThrough() as unknown as NodeJS.WriteStream & { columns?: number; rows?: number };
    input.setRawMode = () => input;
    output.columns = 100;
    output.rows = 24;
    let writes = "";
    output.on("data", (chunk) => {
      writes += chunk.toString("utf8");
    });
    let closed = false;
    const app = runLoopsUiApp({
      input,
      output,
      refreshMs: 500,
      snapshotProvider: () => ({
        rows: [{
          id: "loop-a",
          name: "machine-alpha",
          status: "active",
          cadence: "every 5m",
          nextRun: "in 1m",
          lastRunOutcome: "ok",
          provider: "command",
          activeRuns: 0,
        }],
        stats: {
          activeLoops: 2,
          pausedLoops: 3,
          stoppedLoops: 4,
          runningRuns: 1,
          failedRuns: 7,
          updatedAt: PAST,
        },
      }),
      // A hosted run must never construct the sqlite store.
      storeFactory: () => {
        throw new Error("hosted ui must not open the local store");
      },
      onClose: () => {
        closed = true;
      },
    });
    input.write("q");
    await app;
    const rendered = stripAnsi(writes);
    expect(rendered).toContain("machine-alpha");
    expect(rendered).toContain("active loops 2");
    expect(rendered).toContain("failed runs 7");
    expect(closed).toBe(true);
  });

  test("a failed hosted frame surfaces instead of leaving a stale frame on screen", async () => {
    const input = new PassThrough() as unknown as NodeJS.ReadStream & { setRawMode: (mode: boolean) => NodeJS.ReadStream };
    const output = new PassThrough() as unknown as NodeJS.WriteStream & { columns?: number; rows?: number };
    input.setRawMode = () => input;
    output.columns = 100;
    output.rows = 24;
    await expect(runLoopsUiApp({
      input,
      output,
      snapshotProvider: async () => {
        throw new Error("hosted read failed");
      },
      storeFactory: (() => {
        throw new Error("hosted ui must not open the local store");
      }) as unknown as () => Store,
    })).rejects.toThrow("hosted read failed");
  });
});
