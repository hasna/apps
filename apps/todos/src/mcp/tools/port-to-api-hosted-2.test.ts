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
  const created: Record<string, unknown>[] = [];
  const deps: Array<{ task: string; depends_on: string }> = [];
  const deleted: string[] = [];
  await withHostedTools(
    registerTaskProjectTools as never,
    {
      "GET /v1/tasks": (req) => {
        const q = req.query.get("q");
        return { tasks: q ? [task({ title: `match for ${q}` })] : [base], total: 1 };
      },
      "GET /v1/tasks/:id": (req) => ({ task: task({ id: req.path.split("/").pop()! }) }),
      "PATCH /v1/tasks/:id": (req) => ({ task: { ...base, id: req.path.split("/").pop()!, ...(req.body as Record<string, unknown>) } }),
      "POST /v1/tasks": (req) => {
        const body = req.body as Record<string, unknown>;
        const row = task({ id: `made-${created.length}`, title: body.title as string });
        created.push(body);
        return { task: row };
      },
      "POST /v1/tasks/:id/dependencies": (req) => {
        const id = req.path.split("/")[3]!;
        const dependsOn = (req.body as { depends_on: string }).depends_on;
        deps.push({ task: id, depends_on: dependsOn });
        return { dependency: { task_id: id, depends_on: dependsOn } };
      },
      "DELETE /v1/tasks/:id": (req) => { deleted.push(req.path.split("/").pop()!); return { deleted: true }; },
      "GET /v1/tasks/:id/comments": () => ({
        comments: [{ id: "c1", task_id: base.id, agent_id: "ada", content: "shared note", created_at: iso(-1000) }],
        count: 1, has_more: false, next_cursor: null, limit: 100,
      }),
      "GET /v1/activity": () => ({
        activity: [
          { id: "h1", task_id: base.id, action: "created", created_at: iso(-2000) },
          { id: "h2", task_id: "other", action: "completed", created_at: iso(-1000) },
        ],
        count: 2,
      }),
    },
    async (ctx) => {
      await ctx.call("reschedule_task", { task_id: base.id, deadline: "2026-12-01T00:00:00.000Z", version: 4 });
      const patched = ctx.requests.find((r) => r.method === "PATCH")!;
      expect(patched.path).toBe(`/v1/tasks/${base.id}`);
      expect(patched.body).toMatchObject({ due_at: "2026-12-01T00:00:00.000Z", version: 4 });

      expect(await ctx.call("bulk_update_tasks", { task_ids: [base.id, "second"], status: "completed" }))
        .toBe("2 task(s) updated, 0 failed.");
      expect(ctx.requests.filter((r) => r.method === "PATCH")).toHaveLength(3);

      expect(await ctx.call("bulk_create_tasks", { tasks: [{ title: "one" }, { title: "two", depends_on: ["made-0"] }] }))
        .toBe("2 task(s) created.");
      expect(created.map((c) => c.title)).toEqual(["one", "two"]);
      expect(deps).toEqual([{ task: "made-1", depends_on: "made-0" }]);

      expect(await ctx.call("bulk_delete_tasks", { task_ids: [base.id] })).toContain("1 task(s) deleted");
      expect(deleted).toEqual([base.id]);

      expect(await ctx.call("list_comments", { task_id: base.id })).toContain("shared note");
      expect(ctx.requests.some((r) => r.method === "GET" && r.path === `/v1/tasks/${base.id}/comments`)).toBe(true);

      expect(await ctx.call("search_tasks", { query: "deploy" })).toContain("match for deploy");
      expect(ctx.requests.some((r) => r.method === "GET" && r.path === "/v1/tasks" && r.query.get("q") === "deploy")).toBe(true);

      const timeline = JSON.parse(await ctx.call("get_activity_timeline", { entity_type: "task", entity_id: base.id }));
      expect(timeline.source).toBe("cloud");
      expect(timeline.entries).toHaveLength(1);
      // The hosted feed has no run evidence; say so rather than imply completeness.
      expect(timeline.omitted_sources).toEqual(["run_evidence"]);
      expect(ctx.requests.some((r) => r.method === "GET" && r.path === "/v1/activity")).toBe(true);

      expect(ctx.requests.every((r) => r.path.startsWith("/v1/"))).toBe(true);
    },
  );
});

test("agents: suggest_agent_name reads the shared roster, not this machine's", async () => {
  await withHostedTools(
    registerAgentTools as never,
    {
      "GET /v1/agents": () => ({
        agents: [{ id: "a1", name: "caesar", last_seen_at: iso(-60_000) }],
        count: 1,
      }),
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
  // archive_completed selects on updated_at, matching the local archiveTasks
  // predicate (src/db/task-relations.ts:164-168) — not completed_at.
  const old = task({ id: "arch-1", status: "completed", completed_at: iso(-30 * 24 * 60 * 60 * 1000), updated_at: iso(-30 * 24 * 60 * 60 * 1000) });
  const fresh = task({ id: "arch-2", status: "completed", completed_at: iso(-60 * 60 * 1000), updated_at: iso(-60 * 60 * 1000) });
  const archived = task({ id: "arch-3", short_id: "ARCH-3", status: "completed", archived_at: iso(-3600_000) });
  const patched: Array<{ id: string; body: Record<string, unknown> }> = [];
  await withHostedTools(
    registerTaskAutoTools as never,
    {
      "GET /v1/tasks": (req) => {
        if (req.query.get("include_archived") === "true") return { tasks: [archived, old, fresh], total: 3 };
        if (req.query.get("include_archived") === "false" && req.query.get("status") === "completed") return { tasks: [old, fresh], total: 2 };
        // rebalance: pending/in_progress page
        return { tasks: [task({ id: "p1", status: "pending", assigned_to: "ada" }), task({ id: "p2", status: "pending", assigned_to: "ada" })], total: 2 };
      },
      "GET /v1/tasks/:id": (req) => ({ task: task({ id: req.path.split("/").pop()!, archived_at: iso(-3600_000) }) }),
      "PATCH /v1/tasks/:id": (req) => {
        const id = req.path.split("/").pop()!;
        patched.push({ id, body: req.body as Record<string, unknown> });
        return { task: task({ id, ...(req.body as Record<string, unknown>) }) };
      },
      "GET /v1/agents": () => ({ agents: [{ id: "ada", name: "ada", status: "active" }, { id: "grace", name: "grace", status: "active" }], count: 2 }),
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
      expect(ctx.requests.some((r) => r.path === "/v1/tasks" && r.query.get("include_archived") === "true")).toBe(true);

      expect(await ctx.call("rebalance_workload", { max_per_agent: 1 })).toContain("moved 1 task(s)");
      expect(patched.at(-1)!.body).toMatchObject({ assigned_to: "grace" });
      expect(ctx.requests.some((r) => r.method === "GET" && r.path === "/v1/agents")).toBe(true);
    },
  );
});
