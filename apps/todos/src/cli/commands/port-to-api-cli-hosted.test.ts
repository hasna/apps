/**
 * Hosted-path proof for the CLI verbs ported in PORT-TO-API slice A3:
 * `pin`, `steal`, `redistribute`, `import <url>` and `export`.
 *
 * Each of these reached `src/db/*` with no hosted arm, so under a hosted
 * credential they mutated this machine's private store while the rest of the
 * CLI was already remote-only. The assertions name the exact `/v1` method+path
 * each action must hit; the harness fails the test if any `*.db*` file appears
 * under the fixture HOME.
 */
import { test, expect, setDefaultTimeout } from "bun:test";
setDefaultTimeout(30_000);

import { registerQueryCommands } from "./query-commands.js";
import { registerProjectCommands } from "./project-commands.js";
import { withHostedCommands } from "./hosted-command-harness.js";

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

const task = (over: Record<string, unknown> = {}) => ({
  id: "aaaaaaaa-2222-0000-0000-000000000001",
  short_id: "T-9", title: "hosted cli task", status: "pending", priority: "medium",
  project_id: null, task_list_id: null, plan_id: null, parent_id: null,
  agent_id: null, assigned_to: null, tags: [], metadata: {}, version: 7,
  estimated_minutes: null, due_at: null, completed_at: null, started_at: null,
  locked_at: null, locked_by: null, archived_at: null,
  created_at: iso(-86_400_000), updated_at: iso(-3_600_000),
  ...over,
});

test("pin escalates through PATCH /v1/tasks/:id instead of the local store", async () => {
  const target = task();
  await withHostedCommands(
    registerQueryCommands,
    {
      "GET /v1/tasks": () => ({ tasks: [target], total: 1 }),
      "GET /v1/tasks/:id": () => ({ task: target }),
      "PATCH /v1/tasks/:id": (req) => ({ task: { ...target, ...(req.body as Record<string, unknown>) } }),
    },
    async (ctx) => {
      const result = await ctx.run(["pin", target.id, "--json"]);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout).priority).toBe("critical");
      const patch = ctx.requests.find((r) => r.method === "PATCH")!;
      expect(patch.path).toBe(`/v1/tasks/${target.id}`);
      expect(patch.body).toMatchObject({ priority: "critical", version: 7 });
    },
  );
});

test("steal takes the stale task on the shared store: unlock, lock, start", async () => {
  const stale = task({ id: "steal-1", status: "in_progress", locked_by: "grace", assigned_to: "grace", priority: "high", updated_at: iso(-6 * 60 * 60 * 1000) });
  await withHostedCommands(
    registerQueryCommands,
    {
      "GET /v1/tasks": () => ({ tasks: [stale], total: 1 }),
      "POST /v1/tasks/:id/unlock": () => ({ success: true }),
      "POST /v1/tasks/:id/lock": () => ({ result: { success: true, locked_by: "ada", locked_at: iso(0) } }),
      "POST /v1/tasks/:id/start": () => ({ task: { ...stale, status: "in_progress", assigned_to: "ada", locked_by: "ada" } }),
    },
    async (ctx) => {
      const result = await ctx.run(["steal", "ada", "--stale-minutes", "30"]);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Stolen");
      // The lock is attempted BEFORE any release, so an uncontended steal never
      // force-unlocks anything.
      expect(ctx.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
        "GET /v1/tasks",
        "POST /v1/tasks/steal-1/lock",
        "POST /v1/tasks/steal-1/start",
      ]);
      expect((ctx.requests[1]!.body as { agent_id: string }).agent_id).toBe("ada");
    },
  );
});

test("steal will not take a task the requesting agent already holds", async () => {
  const mine = task({ id: "steal-2", status: "in_progress", locked_by: "ada", assigned_to: "ada", updated_at: iso(-6 * 60 * 60 * 1000) });
  await withHostedCommands(
    registerQueryCommands,
    { "GET /v1/tasks": () => ({ tasks: [mine], total: 1 }) },
    async (ctx) => {
      const result = await ctx.run(["steal", "ada"]);
      expect(result.stdout).toContain("No stale tasks available to steal.");
      expect(ctx.requests.every((r) => r.method === "GET")).toBe(true);
    },
  );
});

test("redistribute releases on the shared store and claims through POST /v1/tasks/next/claim", async () => {
  const stale = task({ id: "redist-1", status: "in_progress", assigned_to: "grace", locked_by: "grace", updated_at: iso(-6 * 60 * 60 * 1000) });
  await withHostedCommands(
    registerQueryCommands,
    {
      "GET /v1/tasks": () => ({ tasks: [stale], total: 1 }),
      "POST /v1/tasks/:id/unlock": () => ({ success: true }),
      "PATCH /v1/tasks/:id": (req) => ({ task: { ...stale, ...(req.body as Record<string, unknown>) } }),
      "POST /v1/tasks/next/claim": () => ({ task: task({ id: "claimed-1", title: "next up", status: "in_progress", assigned_to: "ada" }) }),
    },
    async (ctx) => {
      const result = await ctx.run(["redistribute", "ada", "--max-age", "60", "--json"]);
      expect(result.stderr).toBe("");
      const parsed = JSON.parse(result.stdout);
      expect(parsed.released).toHaveLength(1);
      expect(parsed.claimed.id).toBe("claimed-1");
      expect(ctx.requests.some((r) => r.method === "POST" && r.path === "/v1/tasks/redist-1/unlock")).toBe(true);
      const patch = ctx.requests.find((r) => r.method === "PATCH")!;
      expect(patch.body).toMatchObject({ status: "pending", assigned_to: null, version: 7 });
      expect(ctx.requests.some((r) => r.method === "POST" && r.path === "/v1/tasks/next/claim")).toBe(true);
    },
  );
});

test("export --format json reads GET /v1/tasks; the bundle formats refuse instead of emitting an empty local bundle", async () => {
  const rows = [task({ id: "exp-1", title: "one" }), task({ id: "exp-2", title: "two" })];
  await withHostedCommands(
    registerProjectCommands,
    { "GET /v1/tasks": () => ({ tasks: rows, total: rows.length }) },
    async (ctx) => {
      const json = await ctx.run(["export", "--format", "json"]);
      expect(json.stderr).toBe("");
      expect(JSON.parse(json.stdout).map((t: { id: string }) => t.id)).toEqual(["exp-1", "exp-2"]);
      expect(ctx.requests.some((r) => r.method === "GET" && r.path === "/v1/tasks")).toBe(true);

      const before = ctx.requests.length;
      const md = await ctx.run(["export", "--format", "md"]);
      expect(md.exitCode).toBe(1);
      expect(md.stderr).toContain("does not serve");
      expect(md.stderr).toContain("--format json");
      // The refusal must not have assembled anything from a local store.
      expect(ctx.requests.length).toBe(before);

      const bridge = await ctx.run(["export", "--format", "bridge"]);
      expect(bridge.exitCode).toBe(1);
      expect(bridge.stderr).toContain("does not serve");
    },
  );
});

test("import <github-url> creates the task with POST /v1/tasks, not the local store", async () => {
  // The issue fetch shells out to `gh`; only the WRITE is being ported, so the
  // fetch is stubbed and the assertion is on the route the write took.
  const { mock } = await import("bun:test");
  mock.module("../../lib/github.js", () => ({
    parseGitHubUrl: () => ({ owner: "hasna", repo: "apps", number: 42 }),
    fetchGitHubIssue: () => ({ number: 42, title: "fix the thing", body: "details", labels: ["bug"], url: "https://github.com/hasna/apps/issues/42" }),
    issueToTask: (issue: { number: number; title: string }, opts: Record<string, unknown>) => ({
      title: `#${issue.number} ${issue.title}`,
      description: "https://github.com/hasna/apps/issues/42",
      priority: "high",
      ...opts,
    }),
  }));
  const { registerMcpHooksCommands } = await import("./mcp-hooks-commands.js");
  const created = task({ id: "imported-1", title: "#42 fix the thing", priority: "high" });
  await withHostedCommands(
    registerMcpHooksCommands,
    {
      "POST /v1/tasks": () => ({ task: created }),
      "GET /v1/tasks/:id": () => ({ task: created }),
    },
    async (ctx) => {
      const result = await ctx.run(["import", "https://github.com/hasna/apps/issues/42"]);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Imported GH#42");
      const post = ctx.requests.find((r) => r.method === "POST" && r.path === "/v1/tasks");
      expect(post).toBeDefined();
      expect((post!.body as { title: string }).title).toBe("#42 fix the thing");
    },
  );
});

test("steal falls back to a forced release only when the lock is still held", async () => {
  const held = task({ id: "steal-3", status: "in_progress", locked_by: "grace", assigned_to: "grace", updated_at: iso(-6 * 60 * 60 * 1000) });
  let lockAttempts = 0;
  await withHostedCommands(
    registerQueryCommands,
    {
      "GET /v1/tasks": () => ({ tasks: [held], total: 1 }),
      "POST /v1/tasks/:id/lock": () => {
        lockAttempts += 1;
        return lockAttempts === 1
          ? { result: { success: false, error: "held by grace" } }
          : { result: { success: true, locked_by: "ada", locked_at: iso(0) } };
      },
      "POST /v1/tasks/:id/unlock": () => ({ success: true }),
      "POST /v1/tasks/:id/start": () => ({ task: { ...held, assigned_to: "ada", locked_by: "ada" } }),
    },
    async (ctx) => {
      const result = await ctx.run(["steal", "ada"]);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Stolen");
      expect(ctx.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
        "GET /v1/tasks",
        "POST /v1/tasks/steal-3/lock",
        "POST /v1/tasks/steal-3/unlock",
        "POST /v1/tasks/steal-3/lock",
        "POST /v1/tasks/steal-3/start",
      ]);
    },
  );
});
