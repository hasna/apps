import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, test, setDefaultTimeout } from "bun:test";
// Spawns child processes (CLI/server/scripts); bun's 5s default is too tight on a loaded host.
setDefaultTimeout(60_000);

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `todos list --inbox` against a server that PREDATES created_by.
 *
 * The deployed API was measured at 0.13.0 while npm was 0.13.4, and a probe through
 * the new CLI confirmed it drops created_by entirely (the key is absent from the
 * response) and ignores unknown query params. So the client has to enforce the
 * creator filter itself — and it must do so BEFORE applying --limit, or it reads an
 * already-truncated page and shrinks it further, returning fewer rows than asked for
 * while the real inbox was larger, with nothing to indicate it.
 *
 * The fixture server below deliberately ignores created_by / not_created_by, exactly
 * as the deployed one does. A test against a server that HONOURS them would pass on
 * the broken code and prove nothing.
 */

const REPO_ROOT = join(import.meta.dir, "../..");
const TEST_API_KEY = ["test", "api", "key"].join("-");
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function legacyTask(n: number, createdBy: string | null) {
  const base = {
    id: `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`,
    short_id: null,
    project_id: null,
    parent_id: null,
    plan_id: null,
    task_list_id: null,
    title: createdBy === "cassius" ? `mine ${n}` : `theirs ${n}`,
    description: null,
    status: "pending",
    priority: "medium",
    agent_id: null,
    assigned_to: "cassius",
    session_id: null,
    working_dir: null,
    tags: [],
    metadata: {},
    version: 1,
    locked_by: null,
    locked_at: null,
    created_at: "2026-07-10T00:00:00.000Z",
    updated_at: "2026-07-10T00:00:00.000Z",
  } as Record<string, unknown>;
  // A pre-created_by server would omit the key entirely. Include it so the CLIENT
  // filter has something to act on — this models a NEW client reading rows that a
  // NEW server stored but an OLD server failed to FILTER.
  base["created_by"] = createdBy;
  return base;
}

/** Ignores created_by/not_created_by exactly as the deployed 0.13.0 server does,
 *  but honours `limit` — which is what makes filter-then-truncate order matter. */
function startLegacyServer(rows: Array<Record<string, unknown>>, port = 0) {
  const seen: string[] = [];
  return {
    seen,
    server: Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch(req) {
        const url = new URL(req.url);
        seen.push(url.search);
        if (url.pathname === "/v1/tasks") {
          const limit = url.searchParams.get("limit");
          const offset = Number(url.searchParams.get("offset") ?? "0");
          const out = limit ? rows.slice(offset, offset + Number(limit)) : rows.slice(offset);
          return Response.json({ tasks: out, count: out.length, total: rows.length });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    }),
  };
}

async function runCli(args: string[], root: string, baseUrl: string, extraEnv: Record<string, string> = {}) {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: REPO_ROOT,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: root,
      HASNA_STATION: `fixture-${randomUUID()}`,
      TMPDIR: root,
      LANG: "C.UTF-8",
      TODOS_DB_PATH: join(root, "todos.db"),
      TODOS_AUTO_PROJECT: "false",
      HASNA_TODOS_API_URL: baseUrl,
      HASNA_TODOS_API_KEY: TEST_API_KEY,
      ...extraEnv,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  return { exitCode: await proc.exited, stdout, stderr };
}

describe("--inbox against a server that cannot attribute at all", () => {
  test("warns that results are unfiltered when the server omits created_by entirely", async () => {
    // A server predating the field omits the key, so every row reads as unattributed
    // and the filter excludes nothing. Measured against the deployed 0.13.0 API.
    // Returning that silently would be an inbox that looks filtered and is not.
    const rows = Array.from({ length: 3 }, (_, i) => {
      const r = legacyTask(i + 1, null);
      delete r["created_by"];
      return r;
    });
    const { server } = startLegacyServer(rows);
    const root = mkdtempSync(join(tmpdir(), "todos-legacy-noattr-"));
    tempRoots.push(root);
    try {
      const result = await runCli(["--json", "list", "--inbox"], root, `http://127.0.0.1:${server.port}`, {
        TODOS_AGENT_ID: "cassius",
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stderr).toContain("does not record task authorship");
      // The rows are still returned — unfiltered but honest, not silently dropped.
      expect(JSON.parse(result.stdout)).toHaveLength(3);
    } finally {
      server.stop(true);
    }
  }, 30000);

  test("does NOT warn when the server records authorship and simply has unattributed rows", async () => {
    // created_by present but null is a genuinely unattributed row, not a server that
    // cannot attribute — conflating the two would train agents to ignore the warning.
    const rows = [legacyTask(1, null), legacyTask(2, "brutus")];
    const { server } = startLegacyServer(rows);
    const root = mkdtempSync(join(tmpdir(), "todos-legacy-nullattr-"));
    tempRoots.push(root);
    try {
      const result = await runCli(["--json", "list", "--inbox"], root, `http://127.0.0.1:${server.port}`, {
        TODOS_AGENT_ID: "cassius",
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stderr).not.toContain("does not record task authorship");
    } finally {
      server.stop(true);
    }
  }, 30000);
});

describe("--inbox against a server that ignores the creator filter", () => {
  test("returns a full --limit page of OTHERS' tasks, not a truncated one", async () => {
    // 10 of the caller's own filings first, then 5 filed by someone else. A server
    // honouring `limit=5` returns only the first five — all of them the caller's own —
    // so a client that filters AFTER truncating ends up with zero.
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => legacyTask(i + 1, "cassius")),
      ...Array.from({ length: 5 }, (_, i) => legacyTask(i + 11, "brutus")),
    ];
    const { server, seen } = startLegacyServer(rows);
    const root = mkdtempSync(join(tmpdir(), "todos-legacy-inbox-"));
    tempRoots.push(root);
    try {
      const result = await runCli(
        ["--json", "list", "--inbox", "--limit", "5"],
        root,
        `http://127.0.0.1:${server.port}`,
        { TODOS_AGENT_ID: "cassius" },
      );
      expect(result.exitCode, result.stderr).toBe(0);
      const titles = (JSON.parse(result.stdout) as Array<{ title: string }>).map((t) => t.title);
      expect(titles).toEqual(["theirs 11", "theirs 12", "theirs 13", "theirs 14", "theirs 15"]);
      // The caller's five-row OUTPUT limit must not truncate the compatibility
      // scan before creator filtering. The bounded total probe reports 15, then
      // the two scalar status reads each carry that exact finite bound.
      const limitsSent = seen
        .map((search) => new URLSearchParams(search).get("limit"))
        .filter((value): value is string => value !== null);
      expect(limitsSent).toEqual(["5", "5", "5"]);
      const statusesSent = seen
        .map((search) => new URLSearchParams(search).get("status"))
        .filter((value): value is string => value !== null)
        .sort();
      expect(statusesSent).toEqual(["pending,in_progress", "pending,in_progress", "pending,in_progress"]);
    } finally {
      server.stop(true);
    }
  }, 30000);

  test("still honours --limit as a ceiling once the filter has been applied", async () => {
    const rows = Array.from({ length: 9 }, (_, i) => legacyTask(i + 1, "brutus"));
    const { server } = startLegacyServer(rows);
    const root = mkdtempSync(join(tmpdir(), "todos-legacy-inbox-cap-"));
    tempRoots.push(root);
    try {
      const result = await runCli(
        ["--json", "list", "--inbox", "--limit", "4"],
        root,
        `http://127.0.0.1:${server.port}`,
        { TODOS_AGENT_ID: "cassius" },
      );
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toHaveLength(4);
    } finally {
      server.stop(true);
    }
  }, 30000);

  test("a scalar-status --limit list with no creator filter still lets the server truncate", async () => {
    const rows = Array.from({ length: 9 }, (_, i) => legacyTask(i + 1, "brutus"));
    const { server, seen } = startLegacyServer(rows);
    const root = mkdtempSync(join(tmpdir(), "todos-legacy-plain-limit-"));
    tempRoots.push(root);
    try {
      const result = await runCli(
        ["--json", "list", "--status", "pending", "--limit", "3"],
        root,
        `http://127.0.0.1:${server.port}`,
      );
      expect(result.exitCode, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toHaveLength(3);
      // One authoritative three-row page; no separate total/probe request.
      const limits = seen.map((q) => new URLSearchParams(q).get("limit"));
      expect(limits).toEqual(["3"]);
      expect(result.stderr).toContain("Continue with --offset 3");
    } finally {
      server.stop(true);
    }
  }, 30000);
});

// A wildcard listener can share a loopback port on macOS and route our client
// into a different fixture. Allocation must use the exact requested interface.
test("legacy fixture refuses an occupied loopback endpoint", () => {
  const occupied = Bun.serve({hostname:"127.0.0.1",port:0,fetch:()=>new Response("occupied fixture",{status:403})});
  let contender: ReturnType<typeof startLegacyServer> | undefined;
  try { expect(() => { contender = startLegacyServer([], occupied.port); }).toThrow(); }
  finally { contender?.server.stop(true); occupied.stop(true); }
});
