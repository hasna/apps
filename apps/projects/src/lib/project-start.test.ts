import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { addWorkspaceLocation, createTmuxProfile, createWorkspace, getWorkspaceByPath } from "../db/workspaces.js";
import { runMigrations } from "../db/schema.js";
import { __resetProjectStore } from "../store/project-store.js";
import { silenceHostedApiEnv } from "../testing/spawn-env.js";
import { parseProjectStartAgent, parseProjectStartSessionPolicy, projectStartCommand, startProject } from "./project-start.js";

// Silence every tier of the shared @hasna/contracts credential resolver, so an
// operator's env, login Keychain, or ~/.hasna credentials file cannot route
// these in-process local-registry tests at the real fleet. With all five tiers silent, the local opt-in (HASNA_PROJECTS_LOCAL=1, set by
// silenceHostedApiEnv) selects the on-box SQLite registry — the fail-closed
// ruling leaves no implicit fallback for a silent environment.
silenceHostedApiEnv();

function makeDb(): Database {
  const db = new Database(":memory:");
  db.run("PRAGMA foreign_keys=ON");
  runMigrations(db);
  return db;
}

describe("project start service", () => {
  test("resolves a registered project by slug and plans compact 01/02 tmux windows", async () => {
    const db = makeDb();
    const path = mkdtempSync(join(tmpdir(), "project-start-registered-"));
    const project = createWorkspace({
      name: "Registered Project",
      slug: "registered-project",
      kind: "project",
      primary_path: path,
    }, db);

    const result = await startProject("registered-project", { dryRun: true, db });

    expect(result.project.id).toBe(project.id);
    expect(result.resolution.source).toBe("id-or-slug");
    expect(result.agent_tool).toBe("codewith");
    expect(result.tool_command).toBe("codewith");
    expect(result.rename_report[0]?.status).toBe("manual");
    expect(result.tmux.session_name).toBe("registered-project");
    expect(result.tmux.windows.map((window) => window.target)).toEqual([
      "registered-project:01",
      "registered-project:02",
    ]);
    expect(result.tmux.windows[0]?.status).toBe("planned");
    expect(result.schema_version).toBe(1);
    expect(result.kind).toBe("projects.start");
    expect((result.render.elements as Record<string, { props?: { title?: string } }>).root?.props?.title).toBe("Start Registered Project");

    rmSync(path, { recursive: true, force: true });
    db.close();
  });

  test("plans importing an unregistered path before starting it", async () => {
    const db = makeDb();
    const path = mkdtempSync(join(tmpdir(), "project-start-unregistered-"));

    const result = await startProject(path, {
      agentTool: "claude",
      dryRun: true,
      importTags: ["security"],
      importMetadata: { domain: "family-security" },
      db,
    });

    expect(result.resolution.source).toBe("planned-import");
    expect(result.resolution.registered).toBe(false);
    expect(result.project.primary_path).toBe(path);
    expect(result.project.tags).toEqual(["security"]);
    expect(result.project.metadata.domain).toBe("family-security");
    expect(result.resolution.preview?.metadata.domain).toBe("family-security");
    expect(result.agent_tool).toBe("claude");
    expect(result.tool_command?.startsWith("claude --name ")).toBe(true);
    expect(result.rename_report[0]?.status).toBe("configured");
    expect(result.tmux.windows.map((window) => window.target)).toEqual([
      `${result.project.slug}:01`,
      `${result.project.slug}:02`,
    ]);
    expect(getWorkspaceByPath(path, db)).toBeNull();

    rmSync(path, { recursive: true, force: true });
    db.close();
  });

  test("resolves registered secondary project locations by path", async () => {
    const db = makeDb();
    const path = mkdtempSync(join(tmpdir(), "project-start-location-primary-"));
    const secondary = mkdtempSync(join(tmpdir(), "project-start-location-secondary-"));
    const project = createWorkspace({
      name: "Location Project",
      slug: "location-project",
      kind: "project",
      primary_path: path,
    }, db);
    addWorkspaceLocation({ workspace_id: project.id, path: secondary, label: "secondary" }, db);

    const result = await startProject(secondary, { dryRun: true, db });

    expect(result.project.id).toBe(project.id);
    expect(result.resolution.source).toBe("path");
    expect(result.resolution.registered).toBe(true);
    expect(result.tmux.session_name).toBe("location-project");

    rmSync(path, { recursive: true, force: true });
    rmSync(secondary, { recursive: true, force: true });
    db.close();
  });

  test("resolves project marker files before importing an unknown folder", async () => {
    const db = makeDb();
    const path = mkdtempSync(join(tmpdir(), "project-start-marker-primary-"));
    const marked = mkdtempSync(join(tmpdir(), "project-start-marker-alias-"));
    const project = createWorkspace({
      name: "Marker Project",
      slug: "marker-project",
      kind: "project",
      primary_path: path,
    }, db);
    writeFileSync(join(marked, ".project.json"), JSON.stringify({
      schema_version: 1,
      id: project.id,
      slug: project.slug,
      name: project.name,
    }), "utf-8");

    const result = await startProject(marked, { register: false, dryRun: true, db });

    expect(result.project.id).toBe(project.id);
    expect(result.resolution.source).toBe("marker");
    expect(result.resolution.registered).toBe(true);

    rmSync(path, { recursive: true, force: true });
    rmSync(marked, { recursive: true, force: true });
    db.close();
  });

  test("renders a saved tmux profile while preserving the selected start tool", async () => {
    const db = makeDb();
    const path = mkdtempSync(join(tmpdir(), "project-start-profile-"));
    createWorkspace({
      name: "Profiled Project",
      slug: "profiled-project",
      kind: "project",
      primary_path: path,
    }, db);
    createTmuxProfile({
      name: "Dev",
      slug: "dev",
      session_template: "{slug}-dev",
      windows: [
        {
          window_name_template: "server",
          path_template: "{path}",
          command: "bun run dev",
          detached: true,
        },
      ],
    }, db);

    const result = await startProject("profiled-project", {
      profile: "dev",
      agentTool: "claude",
      dryRun: true,
      db,
    });

    expect(result.tmux_profile?.slug).toBe("dev");
    expect(result.tmux.session_name).toBe("profiled-project-dev");
    expect(result.tmux.windows.map((window) => window.target)).toEqual([
      "profiled-project-dev:01",
      "profiled-project-dev:02",
      "profiled-project-dev:server",
    ]);
    expect(result.tmux.windows[0]?.metadata?.command).toBe("claude --name 'Profiled Project'");
    expect(result.tmux.windows[1]?.metadata?.command).toBeUndefined();
    expect(result.tmux.windows[2]?.metadata?.command).toBe("bun run dev");

    rmSync(path, { recursive: true, force: true });
    db.close();
  });

  test("uses saved project launch defaults when start options are omitted", async () => {
    const db = makeDb();
    const path = mkdtempSync(join(tmpdir(), "project-start-defaults-"));
    createWorkspace({
      name: "Defaulted Project",
      slug: "defaulted-project",
      kind: "project",
      primary_path: path,
      metadata: {
        launch_profile: "dev",
        start_agent: "claude",
        start_command: "claude --resume",
        start_session_policy: "new",
        start_windows: [{ name: "notes", command: "vim NOTES.md" }],
      },
    }, db);
    createTmuxProfile({
      name: "Dev",
      slug: "dev",
      session_template: "{slug}-dev",
      windows: [{ window_name_template: "server", command: "bun run dev" }],
    }, db);

    const result = await startProject("defaulted-project", { dryRun: true, db });

    expect(result.agent_tool).toBe("claude");
    expect(result.tool_command).toBe("claude --name 'Defaulted Project' --resume");
    expect(result.session_policy).toBe("new");
    expect(result.tmux_profile?.slug).toBe("dev");
    expect(result.launch_defaults.used_agent_tool).toBe(true);
    expect(result.launch_defaults.used_tool_command).toBe(true);
    expect(result.launch_defaults.used_tmux_profile).toBe(true);
    expect(result.launch_defaults.used_session_policy).toBe(true);
    expect(result.launch_defaults.session_policy).toBe("new");
    expect(result.launch_defaults.used_windows).toBe(true);
    expect(result.tmux.session_name).toBe("defaulted-project-dev");
    expect(result.tmux.windows.map((window) => window.target)).toEqual([
      "defaulted-project-dev:01",
      "defaulted-project-dev:02",
      "defaulted-project-dev:server",
      "defaulted-project-dev:notes",
    ]);
    expect(result.tmux.windows[0]?.metadata?.command).toBe("claude --name 'Defaulted Project' --resume");
    expect(result.tmux.windows[3]?.metadata?.command).toBe("vim NOTES.md");

    rmSync(path, { recursive: true, force: true });
    db.close();
  });

  test("requested start windows override profile and saved default windows", async () => {
    const db = makeDb();
    const path = mkdtempSync(join(tmpdir(), "project-start-requested-windows-"));
    createWorkspace({
      name: "Requested Windows Project",
      slug: "requested-windows-project",
      kind: "project",
      primary_path: path,
      metadata: {
        launch_profile: "dev",
        start_agent: "claude",
        start_windows: [{ name: "notes", command: "vim NOTES.md" }],
      },
    }, db);
    createTmuxProfile({
      name: "Dev",
      slug: "dev",
      session_template: "{slug}-dev",
      windows: [{ window_name_template: "server", command: "bun run dev" }],
    }, db);

    const result = await startProject("requested-windows-project", {
      requestedWindows: [
        { name: "editor", command: "code ." },
        { name: "logs", command: "tail -f app.log" },
      ],
      dryRun: true,
      db,
    });

    expect(result.tmux.session_name).toBe("requested-windows-project-dev");
    expect(result.launch_defaults.used_windows).toBe(false);
    expect(result.tool_command).toBe("claude");
    expect(result.rename_report[0]?.status).toBe("skipped");
    expect(result.tmux.windows.map((window) => window.target)).toEqual([
      "requested-windows-project-dev:editor",
      "requested-windows-project-dev:logs",
    ]);
    expect(result.tmux.windows.map((window) => window.metadata?.command)).toEqual([
      "code .",
      "tail -f app.log",
    ]);

    rmSync(path, { recursive: true, force: true });
    db.close();
  });

  test("routes hosted-backend start writes through the hosted project store", async () => {
    const db = makeDb();
    const root = mkdtempSync(join(tmpdir(), "project-start-api-write-"));
    const binDir = join(root, "bin");
    const projectPath = join(root, "cloud-project");
    const fakeTmux = join(binDir, "tmux");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(projectPath, { recursive: true });
    writeFileSync(fakeTmux, "#!/bin/sh\nexit 0\n", "utf-8");
    chmodSync(fakeTmux, 0o755);

    const project = {
      id: "cloud-project-id",
      slug: "cloud-project",
      name: "Cloud Project",
      description: null,
      kind: "project" as const,
      status: "active" as const,
      root_id: null,
      recipe_id: null,
      canonical_machine: null,
      primary_path: projectPath,
      git_remote: null,
      s3_bucket: null,
      s3_prefix: null,
      tags: [],
      integrations: {},
      metadata: {},
      last_opened_at: null,
      created_at: "2026-08-08T10:00:00.000Z",
      updated_at: "2026-08-08T10:00:00.000Z",
      synced_at: null,
    };
    const requests: Array<{ method: string; path: string; body: Record<string, unknown> | null }> = [];
    const originalFetch = globalThis.fetch;
    const originalEnv = {
      apiUrl: process.env["HASNA_PROJECTS_API_URL"],
      apiKey: process.env["HASNA_PROJECTS_API_KEY"],
      path: process.env.PATH,
    };

    process.env["HASNA_PROJECTS_API_URL"] = "https://projects.test.invalid";
    process.env["HASNA_PROJECTS_API_KEY"] = "test-key";
    process.env.PATH = `${binDir}${delimiter}${originalEnv.path ?? ""}`;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      const method = (init?.method ?? "GET").toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
      requests.push({ method, path: url.pathname, body });
      if (method === "GET" && url.pathname === "/v1/projects/cloud-project") {
        return Response.json(project);
      }
      if (method === "PATCH" && url.pathname === "/v1/projects/cloud-project-id") {
        return Response.json({ ...project, ...body });
      }
      if (method === "POST" && url.pathname === "/v1/projects/cloud-project-id/events") {
        return Response.json({ event: { id: "cloud-event-id", ...body } });
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    }) as typeof globalThis.fetch;
    __resetProjectStore();

    try {
      const result = await startProject("cloud-project", {
        agentTool: "none",
        ensureChannel: false,
        db,
      });

      expect(result.tmux.success).toBe(true);
      expect(result.project.last_opened_at).not.toBeNull();
      expect(db.query("SELECT COUNT(*) AS count FROM workspaces").get()).toEqual({ count: 0 });
      expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
        "GET /v1/projects/cloud-project",
        "POST /v1/projects/cloud-project-id/events",
        "PATCH /v1/projects/cloud-project-id",
        "POST /v1/projects/cloud-project-id/events",
      ]);
      expect(requests[1]?.body?.event_type).toBe("tmux_applied");
      expect(requests[3]?.body?.event_type).toBe("started");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalEnv.apiUrl === undefined) delete process.env["HASNA_PROJECTS_API_URL"];
      else process.env["HASNA_PROJECTS_API_URL"] = originalEnv.apiUrl;
      if (originalEnv.apiKey === undefined) delete process.env["HASNA_PROJECTS_API_KEY"];
      else process.env["HASNA_PROJECTS_API_KEY"] = originalEnv.apiKey;
      if (originalEnv.path === undefined) delete process.env.PATH;
      else process.env.PATH = originalEnv.path;
      __resetProjectStore();
      rmSync(root, { recursive: true, force: true });
      db.close();
    }
  });

  test("maps supported start agents to their default commands", () => {
    expect(projectStartCommand("codewith")).toBe("codewith");
    expect(projectStartCommand("claude")).toBe("claude");
    expect(projectStartCommand("opencode")).toBe("opencode");
    expect(projectStartCommand("cursor")).toBe("cursor .");
    expect(projectStartCommand("none")).toBeUndefined();
    expect(projectStartCommand("codewith", "custom")).toBe("custom");
    expect(() => parseProjectStartAgent("bad")).toThrow("Invalid start agent");
    expect(parseProjectStartSessionPolicy(undefined)).toBe("reuse");
    expect(parseProjectStartSessionPolicy("new")).toBe("new");
    expect(parseProjectStartSessionPolicy("error-if-running")).toBe("error-if-running");
    expect(() => parseProjectStartSessionPolicy("bad")).toThrow("Invalid start session policy");
  });
});
