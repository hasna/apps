/**
 * Hosted-path proof for PORT-TO-API slice A2: the remaining `task-project-tools`
 * rewires plus `suggest_agent_name`.
 *
 * Same bar as slice A — each assertion names the tool and the exact `/v1`
 * method+path it must hit, and the harness fails the test if any `*.db*` file
 * appears under the fixture HOME.
 */
import { test, expect, setDefaultTimeout } from "bun:test";
setDefaultTimeout(30_000);

import { registerTaskProjectTools } from "./task-project-tools.js";
import { registerTaskAutoTools } from "./task-auto-tools.js";
import { registerAgentTools } from "./agents.js";
import { withHostedTools } from "./hosted-tool-harness.js";

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const agentPage = (agents: Array<Record<string, unknown>>, req: { query: URLSearchParams }) => ({
  agents,
  count: agents.length,
  total: agents.length,
  limit: Number(req.query.get("limit")),
  offset: Number(req.query.get("offset")),
  has_more: false,
  next_offset: null,
});

const task = (over: Record<string, unknown> = {}) => ({
  id: "aaaaaaaa-1111-0000-0000-000000000001",
  short_id: "T-1", title: "hosted task", status: "pending", priority: "high",
  project_id: null, task_list_id: null, plan_id: null, parent_id: null,
  agent_id: null, assigned_to: null, tags: [], metadata: {}, version: 4,
  estimated_minutes: null, due_at: null, completed_at: null, started_at: null,
  created_at: iso(-86_400_000), updated_at: iso(-3_600_000),
  ...over,
});

test("task-project: reschedule, bulk update/create/delete, list_comments, search and activity run on /v1", async () => {
  const base = task();
  await withHostedTools(
    registerTaskProjectTools as never,
    {
      "GET /v1/tasks": (req) => {
        const q = req.query.get("q");
        return { tasks: q ? [task({ title: `match for ${q}` })] : [base], total: 1 };
      },
      "GET /v1/tasks/:id": (req) => {
        const ref = req.path.split("/").pop()!;
        return { task: ref.toLowerCase() === "t-1" ? base : task({ id: ref }) };
      },
      "GET /v1/agents": (req) => agentPage([
        { id: "20000000-0000-4000-8000-000000000001", name: "worker", last_seen_at: iso(-1000) },
        { id: "20000000-0000-4000-8000-000000000002", name: "ada", last_seen_at: iso(-1000) },
      ], req),
      "PATCH /v1/tasks/:id": (req) => ({ task: { ...base, id: req.path.split("/").pop()!, ...(req.body as Record<string, unknown>) } }),
      "POST /v1/tasks/bulk-create": (req) => {
        const body = req.body as { schema_version: number; tasks: Array<{ temp_id?: string; title: string; depends_on?: string[] }> };
        expect(body.schema_version).toBe(1);
        expect(body.tasks.map((item) => item.title)).toEqual(["one", "two"]);
        expect(body.tasks[0]).toMatchObject({
          agent_id: "20000000-0000-4000-8000-000000000001",
          created_by: "20000000-0000-4000-8000-000000000001",
        });
        expect(body.tasks[1]).toMatchObject({ assigned_to: "20000000-0000-4000-8000-000000000002" });
        return {
          receipt: {
            schema_version: 1, atomic: true,
            created: [
              { temp_id: "first", id: "10000000-0000-4000-8000-000000000001", short_id: null, title: "one" },
              { temp_id: "second", id: "10000000-0000-4000-8000-000000000002", short_id: null, title: "two" },
            ],
            dependencies: [{ task_id: "10000000-0000-4000-8000-000000000002", depends_on: "10000000-0000-4000-8000-000000000001" }],
          },
        };
      },
      "POST /v1/tasks/bulk-delete": (req) => {
        const body = req.body as { schema_version: number; task_ids: string[]; force: boolean };
        expect(body).toEqual({ schema_version: 1, task_ids: [base.id], force: true });
        return {
          receipt: {
            schema_version: 1, atomic: true, force: true,
            results: [{ requested_id: base.id, task_id: base.id, outcome: "deleted", reason: null }],
          },
        };
      },
      "GET /v1/tasks/:id/comments": () => ({
        comments: [{ id: "c1", task_id: base.id, agent_id: "ada", content: "shared note", created_at: iso(-1000) }],
        count: 1, has_more: false, next_cursor: null, limit: 100,
      }),
      "GET /v1/tasks/:id/history": (req) => ({
        history: [{ id: "h1", task_id: base.id, action: "created", created_at: iso(-2000) }],
        count: 1, total: 1,
        limit: Number(req.query.get("limit")), offset: Number(req.query.get("offset")),
        order: req.query.get("order"), has_more: false, next_offset: null,
      }),
    },
    async (ctx) => {
      await ctx.call("reschedule_task", { task_id: base.id, deadline: "2026-12-01T00:00:00.000Z", version: 4 });
      const patched = ctx.requests.find((r) => r.method === "PATCH")!;
      expect(patched.path).toBe(`/v1/tasks/${base.id}`);
      expect(patched.body).toMatchObject({ due_at: "2026-12-01T00:00:00.000Z", version: 4 });

      expect(await ctx.call("bulk_update_tasks", { task_ids: ["T-1"], status: "completed", assigned_to: "Ada" }))
        .toBe("1 task(s) updated, 0 failed.");
      const bulkPatch = ctx.requests.filter((request) => request.method === "PATCH").at(-1)!;
      expect(bulkPatch.path).toBe(`/v1/tasks/${base.id}`);
      expect(bulkPatch.body).toMatchObject({ status: "completed", assigned_to: "20000000-0000-4000-8000-000000000002" });

      process.env.TODOS_AGENT_ID = "worker";
      const created = JSON.parse(await ctx.call("bulk_create_tasks", {
        tasks: [
          { temp_id: "first", title: "one" },
          { temp_id: "second", title: "two", assigned_to: "Ada", depends_on: ["first"] },
        ],
      }));
      delete process.env.TODOS_AGENT_ID;
      expect(created).toMatchObject({ schema_version: 1, atomic: true });
      expect(created.created.map((item: { id: string }) => item.id)).toEqual([
        "10000000-0000-4000-8000-000000000001",
        "10000000-0000-4000-8000-000000000002",
      ]);
      expect(created.dependencies).toEqual([{
        task_id: "10000000-0000-4000-8000-000000000002",
        depends_on: "10000000-0000-4000-8000-000000000001",
      }]);

      const deleted = JSON.parse(await ctx.call("bulk_delete_tasks", { task_ids: [base.id], force: true }));
      expect(deleted).toMatchObject({
        schema_version: 1, atomic: true, force: true,
        results: [{ requested_id: base.id, task_id: base.id, outcome: "deleted", reason: null }],
      });

      expect(await ctx.call("list_comments", { task_id: base.id })).toContain("shared note");
      expect(ctx.requests.some((r) => r.method === "GET" && r.path === `/v1/tasks/${base.id}/comments`)).toBe(true);

      expect(await ctx.call("search_tasks", { query: "deploy" })).toContain("match for deploy");
      expect(ctx.requests.some((r) => r.method === "GET" && r.path === "/v1/tasks" && r.query.get("q") === "deploy")).toBe(true);

      const timeline = JSON.parse(await ctx.call("get_activity_timeline", { entity_type: "task", entity_id: base.id }));
      expect(timeline.source).toBe("cloud");
      expect(timeline.entries).toHaveLength(1);
      // The hosted feed has no run evidence; say so rather than imply completeness.
      expect(timeline.omitted_sources).toEqual(["comments", "run_evidence"]);
      expect(ctx.requests.some((r) => r.method === "GET" && r.path === `/v1/tasks/${base.id}/history`)).toBe(true);

      expect(ctx.requests.every((r) => r.path.startsWith("/v1/"))).toBe(true);
    },
  );
});

test("agents: suggest_agent_name reads the shared roster, not this machine's", async () => {
  await withHostedTools(
    registerAgentTools as never,
    {
      "GET /v1/agents": (req) => agentPage([{ id: "a1", name: "caesar", last_seen_at: iso(-60_000) }], req),
    },
    async (ctx) => {
      const text = await ctx.call("suggest_agent_name", {});
      expect(ctx.requests.some((r) => r.method === "GET" && r.path === "/v1/agents")).toBe(true);
      // `caesar` is held on the shared roster, so it must not be suggested.
      expect(text).toContain("Active agents (avoid these names): caesar");
      const suggested = text.split("Suggested names: ")[1]!.split("\n")[0]!;
      expect(suggested).not.toContain("caesar");
      expect(suggested).toContain("augustus");
    },
  );
});

test("task-auto: archive_completed, unarchive_task, get_archived_tasks and rebalance_workload run on /v1", async () => {
  const old = task({ id: "arch-1", status: "completed", completed_at: iso(-60 * 60 * 1000), updated_at: iso(-30 * 24 * 60 * 60 * 1000) });
  const fresh = task({ id: "arch-2", status: "completed", completed_at: iso(-30 * 24 * 60 * 60 * 1000), updated_at: iso(-60 * 60 * 1000) });
  const archived = task({ id: "arch-3", short_id: "ARCH-3", status: "completed", archived_at: iso(-3600_000) });
  const patched: Array<{ id: string; body: Record<string, unknown> }> = [];
  await withHostedTools(
    registerTaskAutoTools as never,
    {
      "GET /v1/tasks": (req) => {
        if (req.query.get("archived_only") === "true") return { tasks: [archived], total: 1 };
        if (req.query.get("include_archived") === "false" && req.query.get("status") === "completed") return { tasks: [old, fresh], total: 2 };
        // rebalance: scalar pending/in_progress pages; the client must not rely
        // on a comma-separated multi-status response.
        if (req.query.get("status") === "pending") {
          return { tasks: [task({ id: "p1", status: "pending", assigned_to: "ada" }), task({ id: "p2", status: "pending", assigned_to: "ada" })], total: 2 };
        }
        if (req.query.get("status") === "in_progress") return { tasks: [], total: 0 };
        return { tasks: [], total: 0 };
      },
      "GET /v1/tasks/:id": (req) => ({ task: task({ id: req.path.split("/").pop()!, archived_at: iso(-3600_000) }) }),
      "PATCH /v1/tasks/:id": (req) => {
        const id = req.path.split("/").pop()!;
        patched.push({ id, body: req.body as Record<string, unknown> });
        return { task: task({ id, ...(req.body as Record<string, unknown>) }) };
      },
      "GET /v1/agents": (req) => agentPage([{ id: "ada", name: "ada", status: "active" }, { id: "grace", name: "grace", status: "active" }], req),
    },
    async (ctx) => {
      expect(await ctx.call("archive_completed", { days: 7 })).toBe("Archived 1 completed task(s) older than 7 days.");
      expect(patched.map((p) => p.id)).toEqual(["arch-1"]);
      expect(typeof patched[0]!.body.archived_at).toBe("string");
      expect(ctx.requests.some((r) => r.path === "/v1/tasks" && r.query.get("include_archived") === "false")).toBe(true);

      expect(await ctx.call("unarchive_task", { task_id: "arch-3" })).toContain("restored from archive");
      expect(patched.at(-1)).toMatchObject({ id: "arch-3", body: { archived_at: null } });

      const archivedList = await ctx.call("get_archived_tasks", {});
      expect(archivedList).toContain("ARCH-3");
      expect(archivedList).not.toContain("arch-1");  // only rows carrying archived_at
      expect(ctx.requests.some((r) => r.path === "/v1/tasks" && r.query.get("include_archived") === "true" && r.query.get("archived_only") === "true" && r.query.get("include_subtasks") === "true" && r.query.get("limit") === "50")).toBe(true);

      expect(await ctx.call("rebalance_workload", { max_per_agent: 1 })).toContain("moved 1 task(s)");
      expect(patched.at(-1)!.body).toMatchObject({ assigned_to: "grace" });
      expect(ctx.requests.some((r) => r.method === "GET" && r.path === "/v1/agents")).toBe(true);
      const rebalanceStatuses = ctx.requests
        .filter((request) => request.path === "/v1/tasks" && ["pending", "in_progress"].includes(request.query.get("status") ?? ""))
        .map((request) => request.query.get("status"));
      expect(rebalanceStatuses).toEqual(["pending", "in_progress"]);
    },
  );
});

test("get_archived_tasks selects the bounded archived subset on a fleet-sized corpus", async () => {
  const archived = task({ id: "fleet-archived", short_id: "ARCH-FLEET", archived_at: iso(-3600_000) });
  await withHostedTools(
    registerTaskAutoTools as never,
    {
      "GET /v1/tasks": (req) => {
        if (req.query.get("archived_only") !== "true") {
          return { tasks: [], total: 10_001 };
        }
        return { tasks: [archived], total: 1 };
      },
    },
    async (ctx) => {
      expect(await ctx.call("get_archived_tasks", { limit: 10 })).toContain("ARCH-FLEET");
      expect(ctx.requests).toHaveLength(1);
      expect(ctx.requests[0]!.query.get("archived_only")).toBe("true");
      expect(ctx.requests[0]!.query.get("include_archived")).toBe("true");
      expect(ctx.requests[0]!.query.get("limit")).toBe("10");
      expect(ctx.requests[0]!.query.get("offset")).toBe("0");
      expect(ctx.requests[0]!.query.get("include_subtasks")).toBe("true");
    },
  );
});

test("bulk mutation tools reject unsupported or contradictory hosted receipts without local fallback", async () => {
  await withHostedTools(
    registerTaskProjectTools as never,
    {
      "POST /v1/tasks/bulk-create": () => ({
        receipt: { schema_version: 1, atomic: false, created: [], dependencies: [] },
      }),
      "POST /v1/tasks/bulk-delete": () => ({
        receipt: { schema_version: 1, atomic: true, force: false, results: [] },
      }),
    },
    async (ctx) => {
      expect(await ctx.callExpectingError("bulk_create_tasks", { tasks: [{ title: "one" }] }))
        .toContain("atomic=true");
      expect(await ctx.callExpectingError("bulk_delete_tasks", { task_ids: ["task-1"] }))
        .toContain("incomplete result set");
      expect(ctx.requests.map((request) => request.path)).toEqual([
        "/v1/tasks/bulk-create",
        "/v1/tasks/bulk-delete",
      ]);
    },
  );

  await withHostedTools(
    registerTaskProjectTools as never,
    {},
    async (ctx) => {
      expect(await ctx.callExpectingError("bulk_create_tasks", { tasks: [{ title: "one" }] }))
        .toContain("/v1/tasks/bulk-create");
      expect(ctx.requests).toHaveLength(1);
    },
  );
});

test("PATCH-based hosted arms reject malformed or contradictory 2xx responses", async () => {
  const base = task();
  await withHostedTools(
    registerTaskProjectTools as never,
    { "PATCH /v1/tasks/:id": () => ({ task: { id: base.id, due_at: "2026-12-01T00:00:00.000Z" } }) },
    async (ctx) => {
      expect(await ctx.callExpectingError("reschedule_task", { task_id: base.id, deadline: "2026-12-01T00:00:00.000Z" }))
        .toContain("returned an incomplete task record");
    },
  );

  await withHostedTools(
    registerTaskAutoTools as never,
    {
      "GET /v1/tasks": () => ({ tasks: [task({ status: "completed", updated_at: iso(-30 * 86400000) })], total: 1 }),
      "PATCH /v1/tasks/:id": (req) => ({ task: task({ id: req.path.split("/").pop()!, archived_at: null }) }),
    },
    async (ctx) => {
      expect(await ctx.callExpectingError("archive_completed", { days: 7 })).toContain("did not preserve requested field archived_at");
    },
  );
});

test("bulk create canonicalizes external dependency refs and rejects alias duplicates before POST", async () => {
  const existing = task({ id: "30000000-0000-4000-8000-000000000001", short_id: "EXT-1" });
  await withHostedTools(
    registerTaskProjectTools as never,
    {
      "GET /v1/tasks/:id": () => ({ task: existing }),
      "POST /v1/tasks/bulk-create": () => {
        throw new Error("bulk POST must not run after duplicate canonical dependencies");
      },
    },
    async (ctx) => {
      const text = await ctx.callExpectingError("bulk_create_tasks", {
        tasks: [{ title: "duplicate refs", depends_on: [existing.id.slice(0, 12), "EXT-1"] }],
      });
      expect(text).toContain("BULK_CREATE_DUPLICATE_DEPENDENCY");
      expect(ctx.requests.map((request) => request.method)).toEqual(["GET", "GET"]);
    },
  );
});

test("archive and rebalance refuse incomplete or oversized hosted task selections before mutation", async () => {
  await withHostedTools(
    registerTaskAutoTools as never,
    {
      "GET /v1/tasks": () => ({ tasks: [], total: 10_001 }),
      "GET /v1/agents": (req) => agentPage([{ id: "ada", name: "ada", status: "active" }], req),
      "PATCH /v1/tasks/:id": () => {
        throw new Error("mutation must not run after an oversized read");
      },
    },
    async (ctx) => {
      expect(await ctx.callExpectingError("archive_completed", { days: 7 })).toContain("REMOTE_RESULT_TOO_LARGE");
      expect(await ctx.callExpectingError("rebalance_workload", { max_per_agent: 1 })).toContain("REMOTE_RESULT_TOO_LARGE");
      expect(ctx.requests.every((request) => request.method === "GET")).toBe(true);
    },
  );

  await withHostedTools(
    registerTaskAutoTools as never,
    {
      "GET /v1/tasks": () => ({ tasks: [task({ status: "pending" })], total: 1 }),
      "PATCH /v1/tasks/:id": () => {
        throw new Error("mutation must not run after a widened selection");
      },
    },
    async (ctx) => {
      expect(await ctx.callExpectingError("archive_completed", { days: 7 })).toContain("outside the requested bounded selection");
      expect(ctx.requests.every((request) => request.method === "GET")).toBe(true);
    },
  );

  await withHostedTools(
    registerTaskAutoTools as never,
    {
      "GET /v1/tasks": () => ({ tasks: [{ ...task({ status: "completed" }), updated_at: undefined, version: undefined }], total: 1 }),
      "PATCH /v1/tasks/:id": () => { throw new Error("mutation must not run for incomplete tasks"); },
    },
    async (ctx) => {
      expect(await ctx.callExpectingError("archive_completed", { days: 7 })).toContain("without updated_at and version");
      expect(ctx.requests.every((request) => request.method === "GET")).toBe(true);
    },
  );

  await withHostedTools(
    registerTaskAutoTools as never,
    { "GET /v1/tasks": () => ({ tasks: [] }) },
    async (ctx) => {
      expect(await ctx.callExpectingError("archive_completed", { days: 7 })).toContain("authoritative total");
      expect(ctx.requests).toHaveLength(1);
    },
  );
});
