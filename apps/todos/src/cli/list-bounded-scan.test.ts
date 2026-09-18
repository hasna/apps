/** Regression coverage for bounded, truthful `todos list` pages. */
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { runMigrations } from "../db/schema.js";
import { createProject } from "../db/projects.js";
import { createTask } from "../db/tasks.js";
import { localRoutingTestEnv } from "../test/local-routing-env.fixture.test.js";

setDefaultTimeout(30_000);

const REPO_ROOT = join(import.meta.dir, "../..");
const TEST_API_KEY = "[REDACTED_SECRET]";

type RemoteResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  taskQueries: URLSearchParams[];
};

function stubTask(index: number): Record<string, unknown> {
  const stamp = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    short_id: `stub${index}`,
    title: `Stub task ${index}`,
    status: "pending",
    priority: "medium",
    created_at: stamp,
    updated_at: stamp,
  };
}

async function runRemote(args: string[], rowCount: number): Promise<RemoteResult> {
  const tasks = Array.from({ length: rowCount }, (_, i) => stubTask(i));
  const taskQueries: URLSearchParams[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/v1/tasks") {
        taskQueries.push(new URLSearchParams(url.searchParams));
        const offset = Number(url.searchParams.get("offset") ?? "0");
        const limit = Number(url.searchParams.get("limit") ?? String(tasks.length));
        const status = url.searchParams.get("status");
        const matching = status === "in_progress" ? [] : tasks;
        const served = matching.slice(offset, offset + limit);
        return Response.json({ tasks: served, count: served.length, total: matching.length });
      }
      if (url.pathname === "/v1/projects") return Response.json({ projects: [] });
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });
  const root = mkdtempSync(join(tmpdir(), "todos-list-bound-"));
  try {
    const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
      cwd: REPO_ROOT,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: join(root, "home"),
        TMPDIR: root,
        LANG: "C.UTF-8",
        TODOS_DB_PATH: join(root, "todos.db"),
        TODOS_AUTO_PROJECT: "false",
        HASNA_TODOS_API_URL: server.url.origin,
        HASNA_TODOS_API_KEY: TEST_API_KEY,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, exitCode, taskQueries };
  } finally {
    server.stop(true);
    rmSync(root, { recursive: true, force: true });
  }
}

describe("todos list bounds every remote task request", () => {
  test("omitted limit is one authoritative 50-row page", async () => {
    const result = await runRemote(["list", "--status", "pending", "--json"], 100);
    expect(result.exitCode).toBe(0);
    expect(result.taskQueries.map((query) => query.get("limit"))).toEqual(["50"]);
    expect(result.taskQueries.map((query) => query.get("offset"))).toEqual(["0"]);
    expect((JSON.parse(result.stdout) as unknown[])).toHaveLength(50);
    expect(result.stderr).toContain("Continue with --offset 50");
  });

  test("explicit limit is sent exactly, never replaced by an unbounded scan", async () => {
    const result = await runRemote(["list", "--status", "pending", "--limit", "2", "--json"], 5);
    expect(result.exitCode).toBe(0);
    expect(result.taskQueries.map((query) => query.get("limit"))).toEqual(["2"]);
    expect((JSON.parse(result.stdout) as unknown[])).toHaveLength(2);
    expect(result.stderr).toContain("Continue with --offset 2");
  });

  test.each([
    ["updated"],
    ["created"],
    ["priority"],
    ["status"],
  ])("page-local --sort %s stays bounded without claiming the whole snapshot", async (sort) => {
    const result = await runRemote(["list", "--sort", sort, "--limit", "2", "--json"], 6);
    expect(result.exitCode).toBe(0);
    expect(result.taskQueries.map((query) => query.get("limit"))).toEqual(["2"]);
    expect(result.taskQueries.every((query) => Number(query.get("limit")) <= 50)).toBe(true);
    const rows = JSON.parse(result.stdout) as Array<{ title: string }>;
    expect(rows).toHaveLength(2);
    if (sort === "updated" || sort === "created") {
      expect(rows.map((row) => row.title)).toEqual(["Stub task 1", "Stub task 0"]);
    }
  });

  test("structured output reports truthful continuation instead of warning", async () => {
    const result = await runRemote(["list", "--status", "pending", "--limit", "2", "--format", "json"], 5);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({
      count: 2,
      total: 5,
      limit: 2,
      offset: 0,
      has_more: true,
      next_offset: 2,
      complete: false,
    });
  });
});

describe("todos list keeps the legacy local JSON contract while disclosing truncation", () => {
  async function runLocal(args: string[], taskCount: number) {
    const root = mkdtempSync(join(tmpdir(), "todos-local-list-bound-"));
    const dbPath = join(root, "todos.db");
    const db = new Database(dbPath);
    try {
      runMigrations(db);
      const project = createProject({ name: "TruncLocal", path: join(root, "proj") }, db);
      db.transaction(() => {
        for (let i = 0; i < taskCount; i += 1) {
          createTask({ title: `Local task ${i}`, project_id: project.id, status: "pending", priority: "medium" }, db);
        }
      })();
    } finally {
      db.close();
    }
    try {
      const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
        cwd: REPO_ROOT,
        env: localRoutingTestEnv({
          HOME: join(root, "home"),
          TMPDIR: root,
          TODOS_DB_PATH: dbPath,
          TODOS_AUTO_PROJECT: "false",
        }),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { stdout, stderr, exitCode };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  test("a bounded local bare array warns and can continue", async () => {
    const result = await runLocal(["list", "--status", "pending", "--limit", "2", "--json"], 5);
    expect(result.exitCode).toBe(0);
    expect((JSON.parse(result.stdout) as unknown[])).toHaveLength(2);
    expect(result.stderr).toContain("Continue with --offset 2");
    expect(result.stderr).toContain("--offset 2");
  });

  test("a complete local page stays silent", async () => {
    const result = await runLocal(["list", "--status", "pending", "--limit", "5", "--json"], 5);
    expect(result.exitCode).toBe(0);
    expect((JSON.parse(result.stdout) as unknown[])).toHaveLength(5);
    expect(result.stderr).not.toContain("more than --limit");
  });
});
