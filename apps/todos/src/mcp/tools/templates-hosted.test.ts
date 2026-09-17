/**
 * Hosted-path proof for the 12 MCP template tools + `upsert_task`.
 *
 * Before this port every one of them reached `db/templates.js` /
 * `db/tasks.js`, so on a hosted station the MCP door wrote a private SQLite
 * island while the CLI `template*` verbs were already remote-only. Each test
 * asserts the exact `/v1` method+path the handler hit; the harness asserts no
 * `*.db*` file appears under the fixture HOME.
 */
import { test, expect, setDefaultTimeout } from "bun:test";
setDefaultTimeout(30_000);

import { registerTemplateTools } from "./templates.js";
import { registerTaskCrudTools } from "./task-crud.js";
import { withHostedTools } from "./hosted-tool-harness.js";

const TEMPLATE = {
  id: "11111111-2222-3333-4444-555555555555",
  name: "release",
  title_pattern: "Ship {version}",
  description: "Ship {version} to prod",
  priority: "high" as const,
  tags: ["release"],
  variables: [{ name: "version", required: true, default: "1.0.0", description: "semver" }],
  project_id: null,
  plan_id: null,
  metadata: {},
  version: 3,
  created_at: "2026-09-11T00:00:00.000Z",
  updated_at: "2026-09-11T00:00:00.000Z",
  tasks: [] as unknown[],
};

const withSteps = {
  ...TEMPLATE,
  tasks: [
    { position: 0, title_pattern: "cut {version}", description: null, priority: "high", tags: [], task_type: null, condition: null, include_template_id: null, depends_on_positions: [], metadata: {} },
    { position: 1, title_pattern: "announce {version}", description: null, priority: "medium", tags: [], task_type: null, condition: null, include_template_id: null, depends_on_positions: [0], metadata: {} },
  ],
};

const task = (id: string, title: string) => ({
  id, short_id: id.slice(0, 4), title, status: "pending", priority: "high",
  project_id: null, task_list_id: null, plan_id: null, parent_id: null,
  agent_id: null, assigned_to: null, tags: [], metadata: {}, version: 1,
  created_at: "2026-09-11T00:00:00.000Z", updated_at: "2026-09-11T00:00:00.000Z",
});

test("template reads (list/get/preview/export/history) go to /v1/templates and never open a store", async () => {
  await withHostedTools(
    registerTemplateTools as never,
    {
      "GET /v1/templates": () => ({ templates: [TEMPLATE], count: 1 }),
      "GET /v1/templates/:id": () => ({ template: withSteps }),
      "GET /v1/templates/:id/history": () => ({
        schema_version: 1,
        template_id: TEMPLATE.id,
        current_version: 3,
        versions: [
          { template_id: TEMPLATE.id, version: 1, created_at: "2026-09-10T00:00:00.000Z", snapshot: JSON.stringify({ name: "release", title_pattern: "Ship v0", tasks: [] }) },
          { template_id: TEMPLATE.id, version: 2, created_at: "2026-09-10T01:00:00.000Z", snapshot: JSON.stringify({ name: "release", title_pattern: "Ship v1", tasks: [] }) },
        ],
        selection: { schema_version: 1, template_id: TEMPLATE.id, requested_versions: [1, 2], missing_versions: [], complete: true },
      }),
    },
    async (ctx) => {
      expect(await ctx.call("list_templates")).toContain("release");

      const preview = await ctx.call("preview_template", { template_id: TEMPLATE.id, variables: { version: "2.0.0" } });
      expect(preview).toContain("cut 2.0.0");
      expect(preview).toContain("announce 2.0.0");

      const exported = await ctx.call("export_template", { template_id: TEMPLATE.id });
      expect(JSON.parse(exported).title_pattern).toBe("Ship {version}");
      expect(JSON.parse(exported)).not.toHaveProperty("id"); // storage-only fields stripped

      const history = await ctx.call("template_history", { template_id: TEMPLATE.id });
      expect(history).toContain("current: v3");
      expect(history).toContain("v2 |");

      expect(ctx.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
        "GET /v1/templates",
        `GET /v1/templates/${TEMPLATE.id}`,
        `GET /v1/templates/${TEMPLATE.id}`,
        `GET /v1/templates/${TEMPLATE.id}`,
        `GET /v1/templates/${TEMPLATE.id}/history`,
      ]);
    },
  );
});

test("template writes (create/update/delete/import/init) hit the /v1 write routes", async () => {
  await withHostedTools(
    registerTemplateTools as never,
    {
      "POST /v1/templates": (req) => ({ template: { ...TEMPLATE, name: (req.body as { name: string }).name } }),
      "GET /v1/templates/:id": () => ({ template: TEMPLATE }),
      "PATCH /v1/templates/:id": (req) => ({
        template: { ...TEMPLATE, ...(req.body as Record<string, unknown>), expected_version: undefined, version: 4 },
        history_write: { schema_version: 1, template_id: TEMPLATE.id, previous_version: 3, version: 4, recorded: true },
      }),
      "DELETE /v1/templates/:id": () => ({ deleted: true, id: TEMPLATE.id }),
      "POST /v1/templates/initialize": () => ({
        schema_version: 1, created: 1, skipped: 0, names: ["bugfix"],
        records: [{ definition_index: 0, name: "bugfix", ids: ["aaaa"], status: "created" }],
      }),
    },
    async (ctx) => {
      expect(await ctx.call("create_template", { name: "release", title_pattern: "Ship {version}" })).toContain("Template created");
      expect(await ctx.call("update_template", { id: TEMPLATE.id, name: "release-2" })).toContain("Template updated");
      expect(await ctx.call("delete_template", { id: TEMPLATE.id })).toBe("Template deleted.");
      expect(await ctx.call("import_template", { json: JSON.stringify({ name: "imported", title_pattern: "x" }) })).toContain("Template imported");
      expect(await ctx.call("init_templates")).toContain("Created 1 template(s): bugfix");

      expect(ctx.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
        "POST /v1/templates",
        `GET /v1/templates/${TEMPLATE.id}`,
        `PATCH /v1/templates/${TEMPLATE.id}`,
        `GET /v1/templates/${TEMPLATE.id}`,
        `DELETE /v1/templates/${TEMPLATE.id}`,
        "POST /v1/templates",
        "POST /v1/templates/initialize",
      ]);
      // The revision check is what stops a concurrent edit being clobbered.
      expect((ctx.requests[2]!.body as { expected_version: number }).expected_version).toBe(3);
    },
  );
});

test("create_task_from_template applies the remote template through POST /v1/tasks + dependencies", async () => {
  const created: string[] = [];
  await withHostedTools(
    registerTemplateTools as never,
    {
      "GET /v1/templates/:id": () => ({ template: withSteps }),
      "POST /v1/tasks": (req) => {
        const title = (req.body as { title: string }).title;
        const id = `task-${created.length}`;
        created.push(title);
        return { task: task(id, title) };
      },
      // cloudCreateTask reads the row back before any caller may print success.
      "GET /v1/tasks/:id": (req) => ({ task: task(req.path.split("/").pop()!, created[Number(req.path.slice(-1))] ?? "") }),
      "POST /v1/tasks/:id/dependencies": (req) => ({ dependency: { task_id: "task-1", depends_on: (req.body as { depends_on: string }).depends_on } }),
    },
    async (ctx) => {
      const text = await ctx.call("create_task_from_template", { template_id: TEMPLATE.id, variables: { version: "2.0.0" } });
      expect(text).toContain("2 task(s) created from template");
      expect(created).toEqual(["cut 2.0.0", "announce 2.0.0"]);
      expect(ctx.requests.filter((r) => r.path === "/v1/tasks" && r.method === "POST")).toHaveLength(2);
      expect(ctx.requests.some((r) => r.method === "POST" && /^\/v1\/tasks\/task-1\/dependencies$/.test(r.path))).toBe(true);
    },
  );
});

test("the bundled template library tools answer from static data, with no route and no store", async () => {
  await withHostedTools(registerTemplateTools as never, {}, async (ctx) => {
    const listed = JSON.parse(await ctx.call("list_template_library"));
    expect(Array.isArray(listed)).toBe(true);
    expect(listed.length).toBeGreaterThan(0);
    expect(listed[0]).toHaveProperty("task_count");
    const written = JSON.parse(await ctx.call("write_template_library", { directory: `${ctx.home}/library` }));
    expect(Array.isArray(written) ? written.length : Object.keys(written).length).toBeGreaterThan(0);
    expect(ctx.requests).toEqual([]);
  });
});

test("upsert_task posts the fingerprint to /v1/tasks/upsert instead of the local store", async () => {
  await withHostedTools(
    registerTaskCrudTools as never,
    {
      "POST /v1/tasks/upsert": (req) => ({ task: task("upserted", (req.body as { title: string }).title), created: true }),
    },
    async (ctx) => {
      const text = await ctx.call("upsert_task", { fingerprint: "fp-1", title: "ported task" });
      expect(JSON.parse(text).created).toBe(true);
      const request = ctx.requests.find((r) => r.path === "/v1/tasks/upsert");
      expect(request?.method).toBe("POST");
      expect((request?.body as { fingerprint: string }).fingerprint).toBe("fp-1");
    },
  );
});
