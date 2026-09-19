import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deliverTodosApiKeyViaDisk } from "../testing.js";
import {
  MAX_MCP_COLLECTION_BYTES,
  MCP_COLLECTION_CURSOR_CONTRACT,
  MCP_COLLECTION_CURSOR_LENGTH,
  buildCollectionPage,
  truncateUtf8,
} from "./collection-page.js";

setDefaultTimeout(120_000);

const ROOT = join(import.meta.dir, "../..");
const TEST_KEY = "[REDACTED_SECRET]";
const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function longText(prefix: string, index: number, length = 4_000): string {
  return `${prefix}-${index}-` + "界".repeat(length);
}

function project(index: number) {
  return {
    id: `project-${String(index).padStart(5, "0")}`,
    short_id: `p${index}`,
    name: longText("Project", index, 120),
    status: "active",
    path: `/workspace/${index}/${"p".repeat(600)}`,
    description: longText("project description", index),
    task_list_id: null,
    task_counter: 0,
    task_prefix: null,
    parent_id: null,
    metadata: {},
    created_at: "2026-09-19T00:00:00.000Z",
    updated_at: "2026-09-19T00:00:00.000Z",
  };
}

function taskList(index: number) {
  return {
    id: `task-list-${String(index).padStart(5, "0")}`,
    project_id: null,
    slug: `list-${index}`,
    name: longText("Task list", index, 120),
    description: longText("task list description", index),
    status: "active",
    metadata: {},
    created_at: "2026-09-19T00:00:00.000Z",
    updated_at: "2026-09-19T00:00:00.000Z",
  };
}

function plan(index: number) {
  return {
    id: `plan-${String(index).padStart(5, "0")}`,
    slug: `plan-${index}`,
    project_id: null,
    task_list_id: null,
    agent_id: null,
    name: longText("Plan", index, 120),
    description: longText("plan description", index),
    status: "planning",
    start_date: null,
    end_date: null,
    created_at: "2026-09-19T00:00:00.000Z",
    updated_at: "2026-09-19T00:00:00.000Z",
  };
}

function agent(index: number) {
  return {
    id: `agent-${String(index).padStart(5, "0")}`,
    name: `athena${index}`,
    description: longText("agent description", index),
    role: longText("role", index, 80),
    title: longText("title", index, 80),
    level: "ic",
    permissions: ["*"],
    capabilities: [],
    reports_to: null,
    org_id: null,
    status: "active",
    metadata: {},
    created_at: "2026-09-19T00:00:00.000Z",
    last_seen_at: "2026-09-19T00:00:00.000Z",
    session_id: null,
    working_dir: null,
    active_project_id: null,
  };
}

function task(index: number, scope: { task_list_id?: string; plan_id?: string }) {
  return {
    id: `task-${String(index).padStart(5, "0")}`,
    short_id: `t${index}`,
    project_id: null,
    parent_id: null,
    plan_id: scope.plan_id ?? null,
    task_list_id: scope.task_list_id ?? null,
    title: longText("Task", index, 120),
    description: longText("task description", index),
    status: "pending",
    priority: "medium",
    agent_id: null,
    assigned_to: null,
    session_id: null,
    working_dir: null,
    tags: [],
    metadata: {},
    version: 1,
    locked_by: null,
    locked_at: null,
    created_at: "2026-09-19T00:00:00.000Z",
    updated_at: "2026-09-19T00:00:00.000Z",
    completed_at: null,
    due_at: null,
  };
}

async function callCollectionTools(baseUrl: string, calls: Array<{ name: string; args: Record<string, unknown> }>) {
  const root = mkdtempSync(join(tmpdir(), "todos-mcp-collection-pages-"));
  tempRoots.push(root);
  const script = join(root, "run.ts");
  writeFileSync(script, `
    const [{ registerTaskProjectTools }, { registerAgentTools }] = await Promise.all([
      import(${JSON.stringify(join(ROOT, "src/mcp/tools/task-project-tools.ts"))}),
      import(${JSON.stringify(join(ROOT, "src/mcp/tools/agents.ts"))}),
    ]);
    const tools = new Map();
    const server = { resource() {}, tool(name, description, schema, handler) { tools.set(name, { description, schema, handler }); } };
    const context = {
      shouldRegisterTool: () => true,
      resolveId: (value) => value,
      formatError: (error) => error instanceof Error ? error.message : String(error),
      formatTask: (task) => task.id,
      formatTaskDetail: (task) => task.id,
      getAgentFocus: () => undefined,
      agentFocusMap: new Map(),
    };
    registerTaskProjectTools(server, context);
    registerAgentTools(server, context);
    const calls = JSON.parse(process.env.MCP_CALLS);
    const results = [];
    for (const call of calls) {
      const result = await tools.get(call.name).handler(call.args);
      results.push({ name: call.name, isError: result.isError === true, text: result.content[0].text });
    }
    console.log(JSON.stringify(results));
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
  return JSON.parse(stdout) as Array<{ name: string; isError: boolean; text: string }>;
}

describe("MCP residual collection pagination", () => {
  test("generic pages use a canonical snapshot-bound cursor, stable identity ordering, and a 32 KiB ceiling", () => {
    const rows = Array.from({ length: 1_000 }, (_, index) => ({
      id: `row-${String(999 - index).padStart(4, "0")}`,
      group: "same-order-key",
      value: longText("value", index),
    }));
    const input = {
      collection: "fixture",
      query: { status: "active" },
      order: "group:asc,id:asc:v1",
      key: "items",
      rows,
      project: (row: (typeof rows)[number]) => ({ id: row.id, value: truncateUtf8(row.value, 240) }),
      identity: (row: (typeof rows)[number]) => row.id,
      orderKey: (row: (typeof rows)[number]) => row.group,
      snapshotValue: (row: (typeof rows)[number]) => row,
    };
    const first = buildCollectionPage(input);
    const firstText = JSON.stringify(first);
    expect(first).toMatchObject({
      cursor_contract: MCP_COLLECTION_CURSOR_CONTRACT, count: 20, total: 1_000, offset: 0,
      has_more: true, next_offset: 20, complete: false,
    });
    expect((first.items as Array<{ id: string }>).map((item) => item.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `row-${String(index).padStart(4, "0")}`),
    );
    expect(Buffer.byteLength(firstText, "utf8")).toBeLessThanOrEqual(MAX_MCP_COLLECTION_BYTES);
    expect((first.items as Array<{ value: string }>)[0]!.value.endsWith("...")).toBe(true);
    expect(first.next_cursor).toHaveLength(MCP_COLLECTION_CURSOR_LENGTH);
    expect(first.next_cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    const decoded = JSON.parse(Buffer.from(first.next_cursor!, "base64url").toString("utf8"));
    expect(Object.keys(decoded)).toEqual(["b", "c", "o", "p", "q", "s", "v"]);
    expect(decoded).toMatchObject({ p: "0000000000000014", v: 1 });

    const second = buildCollectionPage({ ...input, cursor: first.next_cursor! });
    expect(second).toMatchObject({ count: 20, total: 1_000, offset: 20, next_offset: 40, has_more: true });

    const mutated = rows.map((row, index) => index === 0 ? { ...row, value: `${row.value} changed` } : row);
    expect(() => buildCollectionPage({ ...input, rows: mutated, cursor: first.next_cursor! })).toThrow(/COLLECTION_MUTATED/);
    expect(() => buildCollectionPage({ ...input, query: { status: "archived" }, cursor: first.next_cursor! })).toThrow(/COLLECTION_CURSOR_MISMATCH/);
    const tampered = `${first.next_cursor!.slice(0, -1)}${first.next_cursor!.endsWith("A") ? "B" : "A"}`;
    expect(() => buildCollectionPage({ ...input, cursor: tampered })).toThrow(/INVALID_COLLECTION_CURSOR/);
  });

  test("actual MCP handlers reject tamper/mutation and keep 500-task final responses under 32 KiB", async () => {
    const projects = Array.from({ length: 1_000 }, (_, index) => project(index));
    const lists = Array.from({ length: 1_000 }, (_, index) => taskList(index));
    lists[0] = { ...taskList(0), id: "task-list-focus", slug: "focus-list", name: "Focus list" };
    const plans = Array.from({ length: 1_000 }, (_, index) => plan(index));
    plans[0] = { ...plan(0), id: "plan-focus", slug: "focus-plan", name: "Focus plan" };
    const agents = Array.from({ length: 1_000 }, (_, index) => agent(index));
    projects[1] = { ...projects[1]!, name: "000 shared project order" };
    projects[2] = { ...projects[2]!, name: "000 shared project order" };
    lists[1] = { ...lists[1]!, name: "000 shared task-list order" };
    lists[2] = { ...lists[2]!, name: "000 shared task-list order" };
    plans[1] = { ...plans[1]!, name: "000 shared plan order" };
    plans[2] = { ...plans[2]!, name: "000 shared plan order" };
    agents[1] = { ...agents[1]!, name: "000-shared-agent-order" };
    agents[2] = { ...agents[2]!, name: "000-shared-agent-order" };
    const listTasks = Array.from({ length: 500 }, (_, index) => task(index, { task_list_id: "task-list-focus" }));
    const planTasks = Array.from({ length: 500 }, (_, index) => task(index + 1_000, { plan_id: "plan-focus" }));

    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/todos/v1/projects") return Response.json({ projects, count: projects.length, total: projects.length });
        if (url.pathname === "/todos/v1/task-lists") return Response.json({ task_lists: lists, count: lists.length });
        if (url.pathname === "/todos/v1/plans") return Response.json({ plans, count: plans.length, total: plans.length });
        if (url.pathname === "/todos/v1/agents") {
          const offset = Number(url.searchParams.get("offset") ?? "0");
          const limit = Number(url.searchParams.get("limit") ?? "500");
          const page = agents.slice(offset, offset + limit);
          const hasMore = offset + page.length < agents.length;
          return Response.json({ agents: page, count: page.length, total: agents.length, limit, offset, has_more: hasMore, next_offset: hasMore ? offset + page.length : null });
        }
        if (url.pathname === "/todos/v1/tasks") {
          const rows = url.searchParams.get("task_list_id") === "task-list-focus" ? listTasks : planTasks;
          const offset = Number(url.searchParams.get("offset") ?? "0");
          const limit = Number(url.searchParams.get("limit") ?? "200");
          const page = rows.slice(offset, offset + limit);
          return Response.json({ tasks: page, count: page.length, total: rows.length, limit, offset, has_more: offset + page.length < rows.length, next_offset: offset + page.length < rows.length ? offset + page.length : null });
        }
        return Response.json({ error: `unexpected route ${url.pathname}` }, { status: 404 });
      },
    });

    try {
      const first = await callCollectionTools(`http://127.0.0.1:${server.port}/todos`, [
        { name: "list_projects", args: {} },
        { name: "list_task_lists", args: {} },
        { name: "list_plans", args: {} },
        { name: "list_agents", args: {} },
        { name: "get_task_list", args: { task_list_id: "focus-list" } },
        { name: "get_task_list", args: { task_list_id: "focus-list", include_tasks: true, tasks_limit: 500 } },
        { name: "get_plan", args: { plan_id: "focus-plan" } },
        { name: "get_plan", args: { plan_id: "focus-plan", include_tasks: true, tasks_limit: 500 } },
        { name: "get_plan", args: { plan_id: "focus-plan", full: true } },
      ]);
      expect(first.every((result) => !result.isError)).toBe(true);

      for (const index of [0, 1, 2, 3]) {
        const payload = JSON.parse(first[index]!.text);
        expect(payload).toMatchObject({ count: 20, total: 1_000, has_more: true, next_offset: 20, complete: false });
        expect(payload.next_cursor).toEqual(expect.any(String));
        expect(Buffer.byteLength(first[index]!.text, "utf8")).toBeLessThanOrEqual(MAX_MCP_COLLECTION_BYTES);
      }
      const assertTieBreak = (items: Array<{ id: string }>, firstId: string, secondId: string) => {
        const firstIndex = items.findIndex((item) => item.id === firstId);
        expect(firstIndex).toBeGreaterThanOrEqual(0);
        expect(items[firstIndex + 1]?.id).toBe(secondId);
      };
      assertTieBreak(JSON.parse(first[0]!.text).projects, "project-00001", "project-00002");
      assertTieBreak(JSON.parse(first[1]!.text).task_lists, "task-list-00001", "task-list-00002");
      assertTieBreak(JSON.parse(first[2]!.text).plans, "plan-00001", "plan-00002");
      assertTieBreak(JSON.parse(first[3]!.text).agents, "agent-00001", "agent-00002");

      const taskListMetadata = JSON.parse(first[4]!.text);
      expect(taskListMetadata).toMatchObject({ task_count: 500 });
      expect(taskListMetadata.tasks).toBeUndefined();
      const taskListDetail = JSON.parse(first[5]!.text);
      expect(taskListDetail.task_count).toBe(500);
      expect(taskListDetail.tasks.total).toBe(500);
      expect(taskListDetail.tasks.count).toBeGreaterThan(0);
      expect(taskListDetail.tasks.count).toBeLessThanOrEqual(500);
      expect(taskListDetail.tasks).toMatchObject({ has_more: true, next_offset: taskListDetail.tasks.count });
      expect((taskListDetail.tasks.tasks as Array<{ id: string }>).map((item) => item.id))
        .toEqual([...taskListDetail.tasks.tasks].map((item: { id: string }) => item.id).sort());
      expect(Buffer.byteLength(first[5]!.text, "utf8")).toBeLessThanOrEqual(MAX_MCP_COLLECTION_BYTES);

      const planMetadata = JSON.parse(first[6]!.text);
      expect(planMetadata).toMatchObject({ task_count: 500 });
      expect(planMetadata.tasks).toBeUndefined();
      const planDetail = JSON.parse(first[7]!.text);
      expect(planDetail.task_count).toBe(500);
      expect(planDetail.tasks.total).toBe(500);
      expect(planDetail.tasks.count).toBeGreaterThan(0);
      expect(planDetail.tasks.count).toBeLessThanOrEqual(500);
      expect(planDetail.tasks).toMatchObject({ has_more: true, next_offset: planDetail.tasks.count });
      expect(Buffer.byteLength(first[7]!.text, "utf8")).toBeLessThanOrEqual(MAX_MCP_COLLECTION_BYTES);
      expect(first[8]!.text).toContain("Tasks: 500");

      const projectCursor = JSON.parse(first[0]!.text).next_cursor as string;
      expect(projectCursor).toHaveLength(MCP_COLLECTION_CURSOR_LENGTH);
      expect(projectCursor).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(Object.keys(JSON.parse(Buffer.from(projectCursor, "base64url").toString("utf8"))))
        .toEqual(["b", "c", "o", "p", "q", "s", "v"]);
      const second = await callCollectionTools(`http://127.0.0.1:${server.port}/todos`, [
        { name: "list_projects", args: { cursor: projectCursor } },
      ]);
      expect(JSON.parse(second[0]!.text)).toMatchObject({ offset: 20, count: 20, total: 1_000, next_offset: 40 });

      const tampered = `${projectCursor.slice(0, -1)}${projectCursor.endsWith("A") ? "B" : "A"}`;
      const tamperResult = await callCollectionTools(`http://127.0.0.1:${server.port}/todos`, [
        { name: "list_projects", args: { cursor: tampered } },
      ]);
      expect(tamperResult[0]).toMatchObject({ isError: true });
      expect(tamperResult[0]!.text).toContain("INVALID_COLLECTION_CURSOR");

      projects[0] = { ...projects[0]!, description: `${projects[0]!.description} mutated` };
      const mutationResult = await callCollectionTools(`http://127.0.0.1:${server.port}/todos`, [
        { name: "list_projects", args: { cursor: projectCursor } },
      ]);
      expect(mutationResult[0]).toMatchObject({ isError: true });
      expect(mutationResult[0]!.text).toContain("COLLECTION_MUTATED");

      const filterMismatch = await callCollectionTools(`http://127.0.0.1:${server.port}/todos`, [
        { name: "list_projects", args: { status: "archived", cursor: projectCursor } },
      ]);
      expect(filterMismatch[0]).toMatchObject({ isError: true });
      expect(filterMismatch[0]!.text).toContain("COLLECTION_CURSOR_MISMATCH");

      const nestedCursor = taskListDetail.tasks.next_cursor as string;
      expect(nestedCursor).toHaveLength(MCP_COLLECTION_CURSOR_LENGTH);
      listTasks[0] = { ...listTasks[0]!, description: `${listTasks[0]!.description} mutated` };
      const nestedMutation = await callCollectionTools(`http://127.0.0.1:${server.port}/todos`, [
        { name: "get_task_list", args: {
          task_list_id: "focus-list", include_tasks: true, tasks_limit: 500, tasks_cursor: nestedCursor,
        } },
      ]);
      expect(nestedMutation[0]).toMatchObject({ isError: true });
      expect(nestedMutation[0]!.text).toContain("COLLECTION_MUTATED");
    } finally {
      server.stop(true);
    }
  });
});
