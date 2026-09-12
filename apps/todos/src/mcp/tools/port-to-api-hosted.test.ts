/**
 * Hosted-path proof for the PORT-TO-API slice A rewires in
 * `task-adv-tools`, `task-auto-tools`, `task-resources` and `agents`.
 *
 * Every tool named here previously reached `db/*` with no cloud arm, so on a
 * hosted station it answered from this machine's private SQLite island while
 * its CLI twin was already remote-only. Each assertion names the tool and the
 * exact `/v1` method+path it must now hit; the harness fails the test if any
 * `*.db*` file appears under the fixture HOME.
 */
import { test, expect, setDefaultTimeout } from "bun:test";
setDefaultTimeout(30_000);

import { registerTaskAdvTools } from "./task-adv-tools.js";
import { registerTaskAutoTools } from "./task-auto-tools.js";
import { registerTaskResources } from "./task-resources.js";
import { registerAgentTools } from "./agents.js";
import { withHostedTools } from "./hosted-tool-harness.js";

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const task = (over: Record<string, unknown> = {}) => ({
  id: "aaaaaaaa-0000-0000-0000-000000000001",
  short_id: "T-1", title: "hosted task", status: "pending", priority: "high",
  project_id: null, task_list_id: null, plan_id: null, parent_id: null,
  agent_id: null, assigned_to: "ada", tags: [], metadata: {}, version: 2,
  estimated_minutes: 30, due_at: null, completed_at: null, started_at: null,
  locked_at: null, locked_by: null, archived_at: null,
  created_at: iso(-86_400_000), updated_at: iso(-3_600_000),
  ...over,
});

test("task-adv: standup, claim_task, release_task, extend_task, get_comments and list_my_tasks run on /v1", async () => {
  const mine = task();
  const other = task({ id: "aaaaaaaa-0000-0000-0000-000000000002", title: "someone else", assigned_to: "grace" });
  const blocker = task({ id: "bbbbbbbb-0000-0000-0000-000000000001", title: "blocker", status: "pending" });
  await withHostedTools(
    registerTaskAdvTools as never,
    {
      "GET /v1/tasks": () => ({ tasks: [{ ...mine, status: "in_progress" }, other, blocker], total: 3 }),
      "GET /v1/agents": () => ({ agents: [{ id: "ada", name: "ada", last_seen_at: iso(0) }], count: 1 }),
      "GET /v1/dependencies": () => ({ dependencies: [{ task_id: mine.id, depends_on: blocker.id }], count: 1 }),
      "GET /v1/tasks/:id": (req) => ({ task: req.path.includes(blocker.id) ? blocker : mine }),
      "POST /v1/tasks/:id/start": () => ({ task: { ...mine, status: "in_progress", assigned_to: "ada" } }),
      "PATCH /v1/tasks/:id": (req) => ({ task: { ...mine, ...(req.body as Record<string, unknown>) } }),
      "GET /v1/tasks/:id/comments": () => ({ comments: [{ id: "c1", task_id: mine.id, agent_id: "ada", content: "hosted comment", created_at: iso(-60_000) }], count: 1, has_more: false, next_cursor: null, limit: 20 }),
    },
    async (ctx) => {
      const standup = await ctx.call("standup", { agent_id: "ada" });
      expect(standup).toContain("Standup for ada");
      expect(standup).toContain("In Progress (1)");
      expect(ctx.requests.some((r) => r.method === "GET" && r.path === "/v1/dependencies")).toBe(true);

      expect(await ctx.call("claim_task", { task_id: mine.id, agent_id: "ada" })).toContain(mine.id.slice(0, 8));
      expect(ctx.requests.some((r) => r.method === "POST" && r.path === `/v1/tasks/${mine.id}/start`)).toBe(true);

      await ctx.call("release_task", { task_id: mine.id });
      const release = ctx.requests.filter((r) => r.method === "PATCH").at(-1)!;
      expect(release.path).toBe(`/v1/tasks/${mine.id}`);
      expect(release.body).toMatchObject({ status: "pending", assigned_to: null, version: 2 });

      expect(await ctx.call("extend_task", { task_id: mine.id, minutes: 15 })).toContain("30 → 45 min");
      expect((ctx.requests.filter((r) => r.method === "PATCH").at(-1)!.body as { estimated_minutes: number }).estimated_minutes).toBe(45);

      expect(await ctx.call("get_comments", { task_id: mine.id })).toContain("hosted comment");
      expect(ctx.requests.some((r) => r.method === "GET" && r.path === `/v1/tasks/${mine.id}/comments`)).toBe(true);

      const listed = await ctx.call("list_my_tasks", { agent_id: "ada" });
      expect(listed).toContain(mine.id.slice(0, 8));
      expect(ctx.requests.some((r) => r.method === "GET" && r.path === "/v1/tasks" && r.query.get("assigned_to") === "ada")).toBe(true);
    },
  );
});

test("task-auto: workload, deadlines, sla, stale, blocked, blocking and doctor read the shared dataset", async () => {
  const due = task({ id: "cccccccc-0000-0000-0000-000000000001", title: "due soon", due_at: iso(2 * 60 * 60 * 1000) });
  const stale = task({ id: "cccccccc-0000-0000-0000-000000000002", title: "stalled", status: "in_progress", updated_at: iso(-72 * 60 * 60 * 1000) });
  const blocker = task({ id: "dddddddd-0000-0000-0000-000000000001", title: "blocker", status: "pending" });
  const blocked = task({ id: "dddddddd-0000-0000-0000-000000000002", title: "blocked", status: "pending" });
  const all = [due, stale, blocker, blocked];
  await withHostedTools(
    registerTaskAutoTools as never,
    {
      "GET /v1/tasks": (req) => {
        const status = req.query.get("status");
        const rows = status ? all.filter((t) => t.status === status) : all;
        return { tasks: rows, total: rows.length };
      },
      "GET /v1/tasks/:id": (req) => ({ task: all.find((t) => req.path.endsWith(t.id)) ?? null }),
      "GET /v1/dependencies": () => ({ dependencies: [{ task_id: blocked.id, depends_on: blocker.id }], count: 1 }),
      "GET /v1/integrity": () => ({ integrity: { conditions: [], checked_at: iso(0) } }),
    },
    async (ctx) => {
      expect(await ctx.call("get_my_workload", { agent_id: "ada" })).toContain("Agent: ada");
      expect(await ctx.call("notify_upcoming_deadlines", { hours: 24 })).toContain("due soon");
      expect(await ctx.call("get_sla_breaches", {})).toBeString();
      expect(await ctx.call("get_stale_tasks", { hours: 48 })).toContain("stalled");
      expect(await ctx.call("get_blocked_tasks", {})).toContain("blocked by");
      expect(await ctx.call("get_blocking_tasks", {})).toContain("blocking 1 task(s)");
      expect(await ctx.call("run_doctor", {})).toContain('"source": "cloud"');
      expect(ctx.requests.some((r) => r.path === "/v1/integrity")).toBe(true);
      // `--apply` must refuse rather than silently report a no-op repair.
      expect(await ctx.callExpectingError("run_doctor", { apply: true })).toContain("not available on the hosted authority");
      expect(ctx.requests.every((r) => r.path.startsWith("/v1/"))).toBe(true);
    },
  );
});

test("task-resources: commit, git-ref and verification links go to the shared task, not local sqlite", async () => {
  const target = task({ id: "eeeeeeee-0000-0000-0000-000000000001" });
  const commit = { id: "k1", task_id: target.id, sha: "abc1234", message: "fix", author: "ada", files_changed: [], created_at: iso(0) };
  const ref = { id: "r1", task_id: target.id, ref_type: "branch", name: "feat/x", url: null, provider: "git", metadata: {}, created_at: iso(0), updated_at: iso(0) };
  await withHostedTools(
    registerTaskResources as never,
    {
      "GET /v1/tasks/:id": () => ({ task: target }),
      "POST /v1/tasks/:id/commits": () => ({ commit }),
      "GET /v1/tasks/:id/commits": () => ({ commits: [commit], count: 1 }),
      "GET /v1/commits/:sha": () => ({ commit }),
      "POST /v1/tasks/:id/refs": () => ({ ref }),
      "GET /v1/tasks/:id/refs": () => ({ refs: [ref], count: 1 }),
      "GET /v1/refs/:ref": () => ({ refs: [ref], count: 1 }),
      "POST /v1/tasks/:id/verifications": () => ({ verification: { id: "v1", task_id: target.id, command: "bun test", status: "passed", output_summary: null, artifact_path: null, agent_id: "ada", run_at: iso(0), created_at: iso(0) } }),
      // The git-ref helpers negotiate capability from the openapi document first.
      "GET /v1/openapi.json": () => ({
        paths: {
          "/v1/tasks/{id}/refs": { get: {}, post: {} },
          "/v1/refs/{ref}": { get: {} },
        },
      }),
    },
    async (ctx) => {
      expect(await ctx.call("link_task_to_commit", { task_id: target.id, sha: "abc1234", message: "fix" })).toContain("abc1234");
      expect(ctx.requests.some((r) => r.method === "POST" && r.path === `/v1/tasks/${target.id}/commits`)).toBe(true);

      expect(await ctx.call("get_task_commits", { task_id: target.id })).toContain("abc1234");
      expect(ctx.requests.some((r) => r.method === "GET" && r.path === `/v1/tasks/${target.id}/commits`)).toBe(true);

      expect(await ctx.call("find_task_by_commit", { sha: "abc1234" })).toContain(target.id);
      expect(ctx.requests.some((r) => r.method === "GET" && r.path === "/v1/commits/abc1234")).toBe(true);

      expect(await ctx.call("link_task_git_ref", { task_id: target.id, ref_type: "branch", name: "feat/x" })).toContain("feat/x");
      expect(await ctx.call("get_task_git_refs", { task_id: target.id })).toContain("feat/x");
      expect(await ctx.call("find_tasks_by_git_ref", { ref: "feat/x" })).toContain(target.id);
      expect(ctx.requests.some((r) => r.method === "GET" && r.path === "/v1/refs/feat%2Fx")).toBe(true);

      expect(await ctx.call("add_task_verification", { task_id: target.id, command: "bun test", status: "passed" })).toContain("bun test");
      expect(ctx.requests.some((r) => r.method === "POST" && r.path === `/v1/tasks/${target.id}/verifications`)).toBe(true);
    },
  );
});

test("agents: get_agent resolves against the shared roster on GET /v1/agents/:id", async () => {
  await withHostedTools(
    registerAgentTools as never,
    {
      "GET /v1/agents/:id": (req) =>
        req.path.endsWith("ada")
          ? { agent: { id: "ada", name: "ada", description: "hosted agent", metadata: {}, created_at: iso(-1000), last_seen_at: iso(0) } }
          : new Response(JSON.stringify({ error: "agent not found" }), { status: 404, headers: { "content-type": "application/json" } }),
    },
    async (ctx) => {
      expect(await ctx.call("get_agent", { name: "ada" })).toContain("Name: ada");
      expect(ctx.requests.some((r) => r.method === "GET" && r.path === "/v1/agents/ada")).toBe(true);
      expect(await ctx.callExpectingError("get_agent", { name: "nobody" })).toContain("Agent not found");
    },
  );
});
