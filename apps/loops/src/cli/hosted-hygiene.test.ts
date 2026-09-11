import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import type { Loop, LoopRun } from "../types.js";

/**
 * The hosted arms of `loops expectations`, `loops hygiene names|duplicates|
 * scripts|route-tasks` and `loops health route-tasks` (W13 PORT-TO-API slice A2).
 *
 * All six refused outright on a hosted connection (`assertLocalOnlyCommand`) and
 * ran against `~/.hasna/loops/loops.db` otherwise — so on this fleet, where the
 * loops live in the control plane, they answered about the wrong population.
 * The classifiers are unchanged and shared; only the inventory's source differs.
 *
 * Each test asserts the answer came off `/v1` AND that no `*.db*` file appears
 * under the test HOME, which is what stops a "hosted" answer that was secretly
 * local.
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

/** Hosted `/v1` stub: loop inventory, per-loop runs, and the rename route. */
function serveHosted(loops: Loop[], runsByLoop: Record<string, LoopRun[]> = {}) {
  const paths: string[] = [];
  const renames: Array<{ id: string; name: string }> = [];
  const state = [...loops];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      paths.push(`${request.method} ${url.pathname}`);
      const renameMatch = url.pathname.match(/^\/v1\/loops\/([^/]+)\/rename$/);
      if (request.method === "POST" && renameMatch) {
        const id = decodeURIComponent(renameMatch[1]!);
        const body = (await request.json()) as { name?: string };
        const index = state.findIndex((loop) => loop.id === id);
        if (index < 0) return Response.json({ ok: false, error: "not_found" }, { status: 404 });
        renames.push({ id, name: String(body.name) });
        state[index] = { ...state[index]!, name: String(body.name) };
        return Response.json({ ok: true, loop: state[index] });
      }
      if (request.method !== "GET") {
        return Response.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
      }
      if (url.pathname === "/v1/loops") {
        const status = url.searchParams.get("status");
        const offset = Number(url.searchParams.get("offset") ?? "0");
        const limit = Number(url.searchParams.get("limit") ?? "200");
        const filtered = status ? state.filter((loop) => loop.status === status) : state;
        return Response.json({ ok: true, loops: filtered.slice(offset, offset + limit) });
      }
      if (url.pathname.startsWith("/v1/loops/")) {
        const id = decodeURIComponent(url.pathname.slice("/v1/loops/".length));
        const found = state.find((loop) => loop.id === id || loop.name === id);
        return found
          ? Response.json({ ok: true, loop: found })
          : Response.json({ ok: false, error: "not_found" }, { status: 404 });
      }
      if (url.pathname === "/v1/runs") {
        const loopId = url.searchParams.get("loopId") ?? "";
        const limit = Number(url.searchParams.get("limit") ?? "50");
        const source = loopId ? (runsByLoop[loopId] ?? []) : Object.values(runsByLoop).flat();
        return Response.json({ ok: true, runs: source.slice(0, limit) });
      }
      return Response.json({ ok: false, error: "not_found" }, { status: 404 });
    },
  });
  return { server, paths, renames, state };
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

describe("hosted loops expectations (W13 PORT-TO-API)", () => {
  test("evaluates the hosted loops' expectations instead of refusing", async () => {
    const home = mkdtempSync(join(tmpdir(), "loops-hosted-expectations-"));
    const healthy = hostedLoop({ id: "loop-ok", name: "loop-ok" });
    const failing = hostedLoop({ id: "loop-bad", name: "loop-bad" });
    const { server, paths } = serveHosted([healthy, failing], {
      [healthy.id]: [hostedRun(healthy)],
      [failing.id]: [hostedRun(failing, { id: "run-bad", status: "failed", exitCode: 1, stderr: "boom" } as Partial<LoopRun>)],
    });
    try {
      const result = await runCli(home, ["--json", "expectations"], hostedEnv(server.port as number));
      expect(result.stderr).not.toContain("not available while flipped");
      // A failing expectation is a non-zero exit by design.
      expect([0, 1]).toContain(result.status);
      const value = JSON.parse(result.stdout) as {
        expectations: Array<{ ok: boolean; loop: { name: string } }>;
        backend: { transport: string };
        unchecked: unknown[];
      };
      expect(value.backend.transport).toBe("api");
      expect(value.expectations.map((entry) => entry.loop.name).sort()).toEqual(["loop-bad", "loop-ok"]);
      expect(value.expectations.find((entry) => entry.loop.name === "loop-bad")!.ok).toBe(false);
      expect(paths).toContain("GET /v1/loops");
      expect(paths).toContain("GET /v1/runs");
      expect(dbFilesUnder(home)).toEqual([]);
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("a single hosted loop is fetched by id or name", async () => {
    const home = mkdtempSync(join(tmpdir(), "loops-hosted-expectations-one-"));
    const loop = hostedLoop({ id: "loop-one", name: "loop-one" });
    const { server, paths } = serveHosted([loop], { [loop.id]: [hostedRun(loop)] });
    try {
      const result = await runCli(home, ["--json", "expectations", "loop-one"], hostedEnv(server.port as number));
      expect([0, 1]).toContain(result.status);
      const value = JSON.parse(result.stdout) as { expectation: { loop: { id: string } }; backend: { transport: string } };
      expect(value.expectation.loop.id).toBe("loop-one");
      expect(paths.some((path) => path.startsWith("GET /v1/loops/loop-one"))).toBe(true);
      expect(dbFilesUnder(home)).toEqual([]);
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("hosted loops hygiene (W13 PORT-TO-API)", () => {
  test("hygiene names plans canonical names from the hosted inventory", async () => {
    const home = mkdtempSync(join(tmpdir(), "loops-hosted-hygiene-names-"));
    const loop = hostedLoop({ id: "loop-nightly", name: "Nightly Backup" });
    const { server, paths, renames } = serveHosted([loop]);
    try {
      const result = await runCli(home, ["--json", "hygiene", "names"], hostedEnv(server.port as number));
      expect(result.stderr).not.toContain("not available while flipped");
      const value = JSON.parse(result.stdout) as {
        checked: number;
        changed: number;
        applied: boolean;
        changes: Array<{ id: string; oldName: string; newName: string; changed: boolean }>;
        backend: { transport: string };
      };
      expect(value.backend.transport).toBe("api");
      expect(value.checked).toBe(1);
      expect(value.changed).toBe(1);
      expect(value.applied).toBe(false);
      expect(value.changes[0]!.newName).toBe("machine-nightly-backup");
      // A check without --apply must not write.
      expect(renames).toEqual([]);
      expect(paths).toContain("GET /v1/loops");
      expect(dbFilesUnder(home)).toEqual([]);
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("hygiene names --apply renames through POST /v1/loops/{id}/rename and re-reads the result", async () => {
    const home = mkdtempSync(join(tmpdir(), "loops-hosted-hygiene-apply-"));
    const loop = hostedLoop({ id: "loop-nightly", name: "Nightly Backup" });
    const { server, paths, renames, state } = serveHosted([loop]);
    try {
      const result = await runCli(home, ["--json", "hygiene", "names", "--apply"], hostedEnv(server.port as number));
      expect(result.status).toBe(0);
      const value = JSON.parse(result.stdout) as { applied: boolean; changed: number; backend: { transport: string } };
      expect(value.applied).toBe(true);
      expect(renames).toEqual([{ id: "loop-nightly", name: "machine-nightly-backup" }]);
      expect(paths).toContain("POST /v1/loops/loop-nightly/rename");
      // The report is re-read after the rename, so `changed` reflects the control
      // plane's new state rather than the pre-apply hope.
      expect(value.changed).toBe(0);
      expect(state[0]!.name).toBe("machine-nightly-backup");
      expect(dbFilesUnder(home)).toEqual([]);
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("hygiene duplicates groups overlapping hosted loops", async () => {
    const home = mkdtempSync(join(tmpdir(), "loops-hosted-hygiene-dupes-"));
    const first = hostedLoop({ id: "loop-a", name: "machine-report-5m" });
    const second = hostedLoop({ id: "loop-b", name: "machine-report-10m" });
    const { server, paths } = serveHosted([first, second]);
    try {
      const result = await runCli(home, ["--json", "hygiene", "duplicates"], hostedEnv(server.port as number));
      expect(result.stderr).not.toContain("not available while flipped");
      const value = JSON.parse(result.stdout) as {
        checked: number;
        groups: Array<{ loops: Array<{ id: string }> }>;
        backend: { transport: string };
      };
      expect(value.backend.transport).toBe("api");
      expect(value.checked).toBe(2);
      expect(value.groups).toHaveLength(1);
      expect(value.groups[0]!.loops.map((entry) => entry.id).sort()).toEqual(["loop-a", "loop-b"]);
      expect(paths).toContain("GET /v1/loops");
      expect(dbFilesUnder(home)).toEqual([]);
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("hygiene scripts inventories script-backed hosted loops", async () => {
    const home = mkdtempSync(join(tmpdir(), "loops-hosted-hygiene-scripts-"));
    const scripted = hostedLoop({
      id: "loop-scripted",
      name: "machine-scripted",
      target: { type: "command", command: "bash", args: ["~/.hasna/loops/scripts/run.sh"] },
    } as Partial<Loop> & Pick<Loop, "id" | "name">);
    const plain = hostedLoop({ id: "loop-plain", name: "machine-plain" });
    const { server, paths } = serveHosted([scripted, plain]);
    try {
      const result = await runCli(home, ["--json", "hygiene", "scripts"], hostedEnv(server.port as number));
      expect(result.stderr).not.toContain("not available while flipped");
      const value = JSON.parse(result.stdout) as {
        checked: number;
        scriptBacked: number;
        loops: Array<{ id: string }>;
        backend: { transport: string };
      };
      expect(value.backend.transport).toBe("api");
      expect(value.checked).toBe(2);
      expect(value.scriptBacked).toBe(1);
      expect(value.loops[0]!.id).toBe("loop-scripted");
      expect(paths).toContain("GET /v1/loops");
      expect(dbFilesUnder(home)).toEqual([]);
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("hosted route-task READ side (W13 PORT-TO-API)", () => {
  // The todos upsert these two commands perform is an outbound `todos` CLI call
  // and is identical on both transports; what was local-only — and is asserted
  // here — is the report they route FROM. The tests therefore pin the hosted
  // read and the absence of any local database, and tolerate the todos side
  // being unavailable in a hermetic environment rather than faking it.
  test("hygiene route-tasks reads its findings from /v1", async () => {
    const home = mkdtempSync(join(tmpdir(), "loops-hosted-hygiene-route-"));
    const loop = hostedLoop({ id: "loop-nightly", name: "Nightly Backup" });
    const { server, paths } = serveHosted([loop]);
    try {
      const result = await runCli(
        home,
        ["hygiene", "route-tasks", "--dry-run", "--project", join(home, "project")],
        hostedEnv(server.port as number),
      );
      expect(result.stderr).not.toContain("not available while flipped");
      expect(result.stdout + result.stderr).toContain("hosted control plane");
      expect(paths).toContain("GET /v1/loops");
      expect(dbFilesUnder(home)).toEqual([]);
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("health route-tasks reads its health report from /v1", async () => {
    const home = mkdtempSync(join(tmpdir(), "loops-hosted-health-route-"));
    const failing = hostedLoop({ id: "loop-bad", name: "loop-bad" });
    const { server, paths } = serveHosted([failing], {
      [failing.id]: [hostedRun(failing, { id: "run-bad", status: "failed", exitCode: 1 } as Partial<LoopRun>)],
    });
    try {
      const result = await runCli(
        home,
        ["health", "route-tasks", "--dry-run", "--project", join(home, "project")],
        hostedEnv(server.port as number),
      );
      expect(result.stderr).not.toContain("not available while flipped");
      expect(result.stdout + result.stderr).toContain("hosted control plane");
      expect(paths).toContain("GET /v1/loops");
      expect(paths).toContain("GET /v1/runs");
      expect(dbFilesUnder(home)).toEqual([]);
    } finally {
      server.stop(true);
      rmSync(home, { recursive: true, force: true });
    }
  });
});
