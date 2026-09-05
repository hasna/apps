import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRoot,
  createWorkspace,
  startAgentRun,
  completeAgentRun,
  ensureCliAgent,
} from "../db/workspaces.js";
import type { JsonObject, Workspace } from "../types/workspace.js";
import { closeDatabase, getDatabase, PROJECTS_DB_PATH_ENV } from "../db/database.js";
import { resolveProjectStore, __resetProjectStore, type ProjectStore } from "../store/project-store.js";
import { PROJECTS_HOME_ENV } from "./project-store-paths.js";
import {
  buildProjectAgentContext,
  buildProjectHandoff,
  explainProjectResolution,
  getProjectAgentRunDetail,
  listProjectAgentRunsView,
  suggestProjectNextActions,
  toAgentText,
} from "./project-agent-assist.js";
import { silenceHostedApiEnv } from "../testing/spawn-env.js";

// The agent-assist surfaces route every registry read through the active
// ProjectStore. These tests drive the LocalProjectStore backed by a fresh
// in-memory sqlite (via HASNA_PROJECTS_DB_PATH=:memory:) so each case is
// isolated and exercises the real store seam — not a bespoke db handle.
beforeEach(() => {
  silenceHostedApiEnv();
  process.env[PROJECTS_DB_PATH_ENV] = ":memory:";
  closeDatabase();
  __resetProjectStore();
});

afterEach(() => {
  closeDatabase();
  __resetProjectStore();
});

function localStore(): ProjectStore {
  return resolveProjectStore({});
}

function makeProject(overrides: {
  root?: boolean;
  status?: "active" | "archived";
  metadata?: JsonObject;
} = {}): Workspace {
  let rootId: string | undefined;
  if (overrides.root) {
    const root = createRoot({ name: "Agent Root", base_path: mkdtempSync(join(tmpdir(), "aa-root-")) });
    rootId = root.id;
  }
  const dir = mkdtempSync(join(tmpdir(), "aa-project-"));
  return createWorkspace({
    name: "Agent Project",
    slug: "agent-project",
    kind: "project",
    primary_path: dir,
    root_id: rootId,
    metadata: overrides.metadata,
    agent_id: ensureCliAgent().id,
  });
}

describe("project-agent-assist: context", () => {
  test("builds a priming bundle for a resolved project by slug", async () => {
    const project = makeProject();
    const ctx = await buildProjectAgentContext(localStore(), { target: project.slug });
    expect(ctx.target.resolved).toBe(true);
    expect(ctx.target.source).toBe("id-or-slug");
    expect(ctx.project?.["slug"]).toBe("agent-project");
    expect(ctx.machine.hostname).toBeTruthy();
    expect(ctx.kind).toBe("projects.agent_context");
  });

  test("exposes normalized finance authority metadata to project agents", async () => {
    const project = makeProject({
      metadata: {
        business_area: "finance",
        jurisdiction: "RO",
        legal_entities: ["Example Alpha SRL"],
        fiscal_cycle: "monthly",
        data_classification: "restricted",
        retention_policy: "knowledge:finance-retention-v1",
        ledger_authority: "@hasna/accounting",
        evidence_store: "@hasna/files",
        approver: "role:finance-controller",
        external_recipient_policy: "@hasna/invoices:approved-recipient-only",
      },
    });
    const ctx = await buildProjectAgentContext(localStore(), { target: project.slug });
    expect(ctx.project?.["finance"]).toEqual({
      schema: "hasna.projects.finance_project_metadata.v1",
      business_area: "finance",
      jurisdiction: "RO",
      legal_entities: ["Example Alpha SRL"],
      fiscal_cycle: "monthly",
      data_classification: "restricted",
      retention_policy: "knowledge:finance-retention-v1",
      ledger_authority: "@hasna/accounting",
      evidence_store: "@hasna/files",
      approver: "role:finance-controller",
      external_recipient_policy: "@hasna/invoices:approved-recipient-only",
    });
  });

  test("keeps generic authority-like metadata readable without inventing finance authority", async () => {
    const project = makeProject({
      metadata: {
        approver: "role:release-manager",
        evidence_store: "shared-project-files",
        jurisdiction: "global",
        retention_policy: "standard-project-retention",
        data_classification: "internal",
      },
    });

    const ctx = await buildProjectAgentContext(localStore(), { target: project.slug });
    expect(ctx.target.resolved).toBe(true);
    expect(ctx.project?.["finance"]).toBeUndefined();
  });

  test("reports the derived channel and labels it, for an unlinked project", async () => {
    // Regression: ensure stopped writing integrations.conversations_channel, so
    // reading that field directly left this bundle blank for ~96% of the
    // registry. The bundle is what tells an agent where to post.
    const project = makeProject();
    const ctx = await buildProjectAgentContext(localStore(), { target: project.slug });
    const integrations = ctx.integrations as Record<string, unknown>;
    expect(integrations["conversations_channel"]).toBe("agent-project");
    expect(integrations["conversations_channel_source"]).toBe("derived");
  });

  test("returns an unresolved bundle when nothing matches", async () => {
    const ctx = await buildProjectAgentContext(localStore(), { target: "/nonexistent/path/xyz" });
    expect(ctx.target.resolved).toBe(false);
    expect(ctx.target.note).toBeTruthy();
    expect(ctx.project).toBeUndefined();
  });

  test("renders agent-friendly text", async () => {
    const project = makeProject();
    const text = toAgentText(await buildProjectAgentContext(localStore(), { target: project.slug }));
    expect(text).toContain("Project context");
    expect(text).toContain(project.slug);
  });
});

describe("project-agent-assist: next", () => {
  test("suggests starting when an active project has no tmux session", async () => {
    const project = makeProject();
    const res = await suggestProjectNextActions(localStore(), { target: project.slug });
    const start = res.actions.find((a) => a.id === "start-session");
    expect(start).toBeDefined();
    expect(start!.command).toContain(`projects start ${project.slug}`);
  });

  test("suggests unarchive for archived projects", async () => {
    const archived = createWorkspace({ name: "Archived One", slug: "archived-one", kind: "project", agent_id: ensureCliAgent().id });
    // mark archived by direct update through the same global db the store reads
    getDatabase().run("UPDATE workspaces SET status = 'archived' WHERE id = ?", [archived.id]);
    const res = await suggestProjectNextActions(localStore(), { target: "archived-one" });
    expect(res.actions.some((a) => a.id === "unarchive")).toBe(true);
  });

  test("orders high priority first", async () => {
    const project = makeProject();
    const res = await suggestProjectNextActions(localStore(), { target: project.slug });
    const priorities = res.actions.map((a) => a.priority);
    const highIdx = priorities.indexOf("high");
    const lowIdx = priorities.indexOf("low");
    if (highIdx >= 0 && lowIdx >= 0) expect(highIdx).toBeLessThan(lowIdx);
  });
});

describe("project-agent-assist: why", () => {
  test("traces a successful id/slug resolution", async () => {
    const project = makeProject();
    const res = await explainProjectResolution(localStore(), project.slug, {});
    expect(res.resolved).toBe(true);
    const idStep = res.steps.find((s) => s.source === "id-or-slug");
    expect(idStep?.matched).toBe(true);
  });

  test("reports ambiguity in steps and suggestions for duplicate names", async () => {
    createWorkspace({ name: "Dup", slug: "dup-a", kind: "project", agent_id: ensureCliAgent().id });
    createWorkspace({ name: "Dup", slug: "dup-b", kind: "project", agent_id: ensureCliAgent().id });
    const res = await explainProjectResolution(localStore(), "Dup", {});
    const nameStep = res.steps.find((s) => s.source === "name");
    expect(nameStep?.detail).toContain("ambiguous");
    expect(res.suggestions.some((s) => s.includes("Disambiguate"))).toBe(true);
  });

  test("suggests registration when nothing matches", async () => {
    const res = await explainProjectResolution(localStore(), "never-heard-of-this", {});
    expect(res.resolved).toBe(false);
    expect(res.suggestions.some((s) => s.includes("projects import") || s.includes("projects create"))).toBe(true);
  });
});

describe("project-agent-assist: handoff", () => {
  test("builds a handoff bundle with instructions and recent runs", async () => {
    const project = makeProject();
    const run = startAgentRun({ workspace_id: project.id, prompt: "do the thing", model: "openai/gpt-4o-mini" });
    completeAgentRun(run.id, { status: "completed", tool_calls: [{ name: "projects_list" }] });
    const h = await buildProjectHandoff(localStore(), { target: project.slug });
    expect(h.kind).toBe("projects.handoff");
    expect(h.project["slug"]).toBe(project.slug);
    expect(h.recent_runs.length).toBeGreaterThanOrEqual(1);
    expect(h.handoff_instructions).toContain(project.slug);
  });

  test("handoff reports the derived channel and labels it", async () => {
    const project = makeProject();
    const h = await buildProjectHandoff(localStore(), { target: project.slug });
    const integrations = h.integrations as Record<string, unknown>;
    expect(integrations["conversations_channel"]).toBe("agent-project");
    expect(integrations["conversations_channel_source"]).toBe("derived");
  });

  test("handoff prefers an explicitly linked channel over the derived one", async () => {
    const project = makeProject();
    const store = localStore();
    await store.mutateProjectResourceLinks({
      project_id: project.id,
      operation_id: "handoff-explicit-channel",
      step_id: "add-channel",
      mode: "add",
      expected_revision: project.updated_at,
      links: [{
        authority: "conversations",
        service_instance: "urn:hasna:conversations:test",
        source_package: "@hasna/conversations",
        target_kind: "channel",
        locator: {
          kind: "conversations_channel_id",
          value: "chn_79fa9c68937a1d020d6031dcaa3dd8d7",
        },
        scope: "resource",
        labels: { channel_name: "internal-legacy-lane" },
      }],
      max_items: 10,
      response_byte_limit: 100_000,
      time_budget_ms: 5_000,
    });
    const h = await buildProjectHandoff(store, { target: project.slug });
    const integrations = h.integrations as Record<string, unknown>;
    expect(integrations["conversations_channel"]).toBe("internal-legacy-lane");
    expect(integrations["conversations_channel_source"]).toBe("integration");
  });

  test("throws when project is not found", async () => {
    await expect(buildProjectHandoff(localStore(), { target: "/no/such/path" })).rejects.toThrow();
  });
});

describe("project-agent-assist: runs", () => {
  test("lists runs scoped to a project", async () => {
    const project = makeProject();
    startAgentRun({ workspace_id: project.id, prompt: "first" });
    startAgentRun({ workspace_id: project.id, prompt: "second" });
    const res = await listProjectAgentRunsView(localStore(), { target: project.slug });
    expect(res.target.resolved).toBe(true);
    expect(res.runs.length).toBe(2);
  });

  test("shows full run detail including tool calls", async () => {
    const project = makeProject();
    const run = startAgentRun({ workspace_id: project.id, prompt: "detailed" });
    completeAgentRun(run.id, { tool_calls: [{ name: "projects_show" }, { name: "projects_list" }] });
    const detail = await getProjectAgentRunDetail(localStore(), { runId: run.id, target: project.slug });
    expect(detail.run.id).toBe(run.id);
    expect(detail.run.tool_calls_json.length).toBe(2);
  });

  test("does not leak run detail when target does not resolve", async () => {
    const project = makeProject();
    const run = startAgentRun({ workspace_id: project.id, prompt: "private prompt" });
    await expect(getProjectAgentRunDetail(localStore(), { runId: run.id, target: "does-not-exist" })).rejects.toThrow(
      "Project not found for run detail",
    );
  });

  test("returns empty list for unresolved target", async () => {
    const res = await listProjectAgentRunsView(localStore(), { target: "/nope" });
    expect(res.target.resolved).toBe(false);
    expect(res.runs).toEqual([]);
  });
});

// Regression for the review's split-brain READ finding: on a machine flipped
// to the hosted backend, `projects context` / `projects next` MUST resolve and read the
// SHARED hosted dataset through the Store's HTTP transport — never the stale
// local sqlite island. We seed a LOCAL project with the same slug but a
// different id, drive the api store through a stub fetch, and assert the
// hosted-backend context returns the hosted ID (proving no local read leaked in).
describe("project-agent-assist: the hosted backend routes through the Store (no split-brain)", () => {
  const CLOUD_ENV = {
    HASNA_PROJECTS_API_URL: "https://projects.hasna.xyz",
    HASNA_PROJECTS_API_KEY: "secret-key",
  };

  function apiStore(handler: (method: string, path: string) => unknown): { store: ProjectStore; calls: string[] } {
    const calls: string[] = [];
    const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
      const method = (init?.method ?? "GET").toUpperCase();
      const url = new URL(input);
      calls.push(`${method} ${url.pathname}${url.search}`);
      return new Response(JSON.stringify(handler(method, `${url.pathname}${url.search}`) ?? {}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    __resetProjectStore();
    return { store: resolveProjectStore(CLOUD_ENV, fetchImpl), calls };
  }

  const cloudProject = {
    id: "cloud-1",
    slug: "agent-project",
    name: "Cloud Project",
    kind: "project",
    status: "active",
    primary_path: null,
    root_id: null,
    recipe_id: null,
    tags: [],
    integrations: {},
    metadata: {},
    last_opened_at: null,
    updated_at: "2026-01-01T00:00:00Z",
  };

  test("context resolves the hosted project over HTTP, not the local sqlite row", async () => {
    // A stale local island row with the SAME slug but a different id.
    makeProject();
    const { store, calls } = apiStore((method, path) => {
      if (method === "GET" && path === "/v1/projects/agent-project") return cloudProject;
      if (method === "GET" && path.startsWith("/v1/projects/cloud-1/events")) return { events: [] };
      return {};
    });
    const ctx = await buildProjectAgentContext(store, { target: "agent-project" });
    expect(ctx.target.resolved).toBe(true);
    expect(ctx.project?.["id"]).toBe("cloud-1"); // hosted row, not the local one
    expect(calls.some((c) => c.includes("GET /v1/projects/agent-project"))).toBe(true);
  });

  test("context resolves an existing canonical workspace path through its verified hosted id", async () => {
    const root = mkdtempSync(join(tmpdir(), "projects-agent-context-path-"));
    const previousHome = process.env[PROJECTS_HOME_ENV];
    process.env[PROJECTS_HOME_ENV] = root;
    const projectId = "wks_agentcontextpath";
    const projectPath = join(root, "workspaces", projectId);
    mkdirSync(projectPath, { recursive: true });
    try {
      const { store, calls } = apiStore((method, path) => {
        if (method === "GET" && path === `/v1/projects/${projectId}`) {
          return {
            ...cloudProject,
            id: projectId,
            slug: "agent-context-path",
            primary_path: projectPath,
          };
        }
        if (method === "GET" && path.startsWith(`/v1/projects/${projectId}/events`)) return { events: [] };
        return {};
      });
      const ctx = await buildProjectAgentContext(store, { target: projectPath });
      expect(ctx.target).toMatchObject({ input: projectPath, resolved: true, source: "path" });
      expect(ctx.project).toMatchObject({
        id: projectId,
        slug: "agent-context-path",
        primary_path: projectPath,
      });
      expect(calls.some((call) => call === `GET /v1/projects/${projectId}`)).toBe(true);
    } finally {
      if (previousHome === undefined) delete process.env[PROJECTS_HOME_ENV];
      else process.env[PROJECTS_HOME_ENV] = previousHome;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("next reads events over HTTP and skips machine-local doctor in the hosted backend", async () => {
    makeProject();
    const { store, calls } = apiStore((method, path) => {
      if (method === "GET" && path === "/v1/projects/agent-project") return cloudProject;
      if (method === "GET" && path.startsWith("/v1/projects/cloud-1/events")) return { events: [] };
      return {};
    });
    const res = await suggestProjectNextActions(store, { target: "agent-project" });
    expect(res.target.resolved).toBe(true);
    // doctor findings are machine-local and must not appear for a hosted project.
    expect(res.actions.some((a) => a.id === "doctor-fix")).toBe(false);
    expect(calls.some((c) => c.includes("/v1/projects/cloud-1/events"))).toBe(true);
  });
});

describe("project-agent-assist: toAgentText", () => {
  test("handles primitives and arrays", () => {
    expect(toAgentText("hi")).toBe("hi");
    expect(toAgentText(42)).toBe("42");
    expect(toAgentText(["a", "b"])).toBe("a\nb");
  });

  test("renders a next result as readable text", async () => {
    const project = makeProject();
    const text = toAgentText(await suggestProjectNextActions(localStore(), { target: project.slug }));
    expect(text).toContain("Suggested next actions");
  });
});
