import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deliverTodosApiKeyViaDisk } from "../testing.js";

setDefaultTimeout(120_000);

const ROOT = join(import.meta.dir, "../..");
const tempRoots: string[] = [];
const TEST_KEY = "[REDACTED_SECRET]";

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function task(index: number) {
  const stamp = new Date(Date.UTC(2026, 8, 18, 12, 0, 0) - index * 1_000).toISOString();
  return {
    id: `task-${String(index).padStart(5, "0")}`,
    title: `Task ${index}`,
    status: "pending",
    priority: "medium",
    created_at: stamp,
    updated_at: stamp,
    tags: [],
  };
}

async function callMcp(baseUrl: string, calls: Array<Record<string, unknown>>) {
  const root = mkdtempSync(join(tmpdir(), "todos-mcp-list-page-"));
  tempRoots.push(root);
  const script = join(root, "run.ts");
  writeFileSync(script, `
    const { registerTaskCrudTools } = await import(${JSON.stringify(join(ROOT, "src/mcp/tools/task-crud.ts"))});
    const tools = new Map();
    const server = { tool(name, description, schema, handler) { tools.set(name, { description, schema, handler }); } };
    registerTaskCrudTools(server, {
      shouldRegisterTool: () => true,
      resolveId: (value) => value,
      formatError: (error) => error instanceof Error ? error.message : String(error),
      formatTask: (task) => \`${"${task.id}"} ${"${task.status}"} ${"${task.priority}"} ${"${task.title}"}\`,
      formatTaskDetail: () => "",
      getAgentFocus: () => undefined,
      applyFocus: () => {},
    });
    const tool = tools.get("list_tasks");
    const calls = JSON.parse(process.env.MCP_CALLS);
    const pages = [];
    for (const params of calls) {
      const result = await tool.handler(params);
      pages.push({ isError: result.isError === true, payload: JSON.parse(result.content[0].text) });
    }
    console.log(JSON.stringify(pages));
  `);
  const proc = Bun.spawn(["bun", "run", script], {
    cwd: ROOT,
    env: deliverTodosApiKeyViaDisk({
      PATH: process.env.PATH ?? "",
      HOME: root,
      TMPDIR: root,
      LANG: "C.UTF-8",
      HASNA_TODOS_API_URL: baseUrl,
      HASNA_TODOS_API_KEY: TEST_KEY,
      MCP_CALLS: JSON.stringify(calls),
    }),
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  expect(await proc.exited).toBe(0);
  expect(stderr).toBe("");
  return JSON.parse(stdout) as Array<{ isError: boolean; payload: Record<string, unknown> }>;
}

describe("MCP list_tasks authoritative pagination", () => {
  test("uses one authoritative response, so an insert between the old page/probe requests cannot race", async () => {
    const rows = Array.from({ length: 100 }, (_, index) => task(index));
    const requests: URL[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push(url);
        if (requests.length > 1) rows.unshift(task(9_999));
        const offset = Number(url.searchParams.get("offset") ?? "0");
        const limit = Number(url.searchParams.get("limit") ?? "50");
        return Response.json({
          tasks: rows.slice(offset, offset + limit),
          count: Math.min(limit, rows.length - offset),
          total: rows.length,
          limit,
          offset,
          has_more: offset + limit < rows.length,
          next_offset: offset + limit < rows.length ? offset + limit : null,
        });
      },
    });
    try {
      const pages = await callMcp(`http://127.0.0.1:${server.port}/todos`, [{ status: "pending" }]);
      expect(requests).toHaveLength(1);
      expect(requests[0]!.pathname).toBe("/todos/v1/tasks");
      expect(requests[0]!.searchParams.get("limit")).toBe("50");
      expect(pages[0]).toMatchObject({
        isError: false,
        payload: { count: 50, total: 100, requested_limit: 50, limit: 50, offset: 0, has_more: true, next_offset: 50 },
      });
    } finally {
      server.stop(true);
    }
  });

  test("preserves an authority cap, total, consumed offset, snapshot, and cursor", async () => {
    const requests: URL[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push(url);
        return Response.json({
          tasks: Array.from({ length: 20 }, (_, index) => task(index + 10)),
          count: 20,
          total: 100,
          limit: 20,
          cap: 20,
          offset: 10,
          has_more: true,
          next_offset: 30,
          next_cursor: "snapshot-1:30",
          snapshot: "snapshot-1",
          complete: false,
        });
      },
    });
    try {
      const pages = await callMcp(`http://127.0.0.1:${server.port}/todos`, [{ status: "pending", limit: 50, offset: 10 }]);
      expect(requests).toHaveLength(1);
      expect(pages[0]!.payload).toMatchObject({
        count: 20,
        total: 100,
        requested_limit: 50,
        limit: 20,
        server_cap: 20,
        offset: 10,
        consumed: 20,
        has_more: true,
        next_offset: 30,
        next_cursor: "snapshot-1:30",
        snapshot: "snapshot-1",
        complete: false,
      });
    } finally {
      server.stop(true);
    }
  });

  test("uses an authority cursor for a concurrent next page without overlap", async () => {
    const original = Array.from({ length: 100 }, (_, index) => task(index));
    const snapshotRows = original.slice();
    const requests: URL[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        requests.push(url);
        const cursor = url.searchParams.get("cursor");
        if (cursor === "snapshot-A:50") {
          return Response.json({
            tasks: snapshotRows.slice(50), count: 50, total: 100, limit: 50, offset: 50,
            has_more: false, next_offset: null, next_cursor: null, snapshot: "snapshot-A", complete: true,
          });
        }
        original.unshift(task(9_999));
        return Response.json({
          tasks: snapshotRows.slice(0, 50), count: 50, total: 100, limit: 50, offset: 0,
          has_more: true, next_offset: 50, next_cursor: "snapshot-A:50", snapshot: "snapshot-A", complete: false,
        });
      },
    });
    try {
      const first = await callMcp(`http://127.0.0.1:${server.port}/todos`, [{ status: "pending" }]);
      const cursor = first[0]!.payload.next_cursor as string;
      const second = await callMcp(`http://127.0.0.1:${server.port}/todos`, [{ status: "pending", cursor }]);
      expect(requests.map((url) => url.searchParams.get("cursor"))).toEqual([null, "snapshot-A:50"]);
      expect(requests[1]!.searchParams.get("offset")).toBeNull();
      const firstTasks = new Set(first[0]!.payload.tasks as string[]);
      const secondTasks = new Set(second[0]!.payload.tasks as string[]);
      expect(firstTasks.intersection(secondTasks).size).toBe(0);
      expect(second[0]!.payload).toMatchObject({ offset: 50, total: 100, has_more: false, next_cursor: null, complete: true });
    } finally {
      server.stop(true);
    }
  });

  test("legacy envelopes without total return unknown completeness and a consumed-offset continuation", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({ tasks: [task(0), task(1)], count: 2 }),
    });
    try {
      const pages = await callMcp(`http://127.0.0.1:${server.port}/todos`, [{ status: "pending" }]);
      expect(pages[0]).toMatchObject({
        isError: false,
        payload: { count: 2, total: null, has_more: null, next_offset: 2, complete: null, offset: 0, consumed: 2 },
      });
    } finally {
      server.stop(true);
    }
  });
});
