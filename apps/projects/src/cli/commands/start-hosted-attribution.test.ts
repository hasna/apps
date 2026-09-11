/**
 * Hosted-path coverage for the start surfaces' attributing-agent resolution
 * (fleet-alignment PORT-TO-API slice A).
 *
 * `projects start`, `projects_start` and `projects_render_start` used to name
 * their actor with `resolveAgentId()` / `ensureCliAgent()`, which read and
 * CREATE rows in the on-box sqlite agent table — unconditionally, including on
 * a hosted station. A hosted `projects start` therefore opened
 * `~/.hasna/projects/projects.db` purely to look up a name.
 *
 * These tests pin the ported behaviour: under a hosted credential an explicitly
 * named actor is resolved through the shared `/v1/agents` registry, an unnamed
 * actor is left to the server (which derives attribution from the bearer key),
 * and NO `*.db*` file is created under the projects home.
 */
import { describe, test, expect } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testSpawnEnv, withoutUnhostedNotice } from "../../testing/spawn-env.js";

const CLI_PATH = join(process.cwd(), "src/cli/index.ts");
const MCP_STDIO_CLIENT = join(process.cwd(), "src/testing/mcp-stdio-client.mjs");
const PROJECT_ID = "wks_start0hosted1";
const AGENT_ID = "agt_hosted_actor_1";

function reserveFreePort(): number {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
  const port = server.port;
  server.stop(true);
  if (!port) throw new Error("Failed to reserve test port");
  return port;
}

/** Every `*.db*` file anywhere under `root` (the no-local-sqlite assertion). */
function databaseFilesUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true, recursive: true }) as Array<{ name: string; parentPath?: string; path?: string }>) {
    if (/\.db(-wal|-shm|-journal)?$/.test(entry.name)) found.push(join(entry.parentPath ?? entry.path ?? root, entry.name));
  }
  return found;
}

function hostedStartFixture() {
  const root = mkdtempSync(join(tmpdir(), "projects-start-hosted-"));
  const projectPath = join(root, "hosted-project");
  const projectsHome = join(root, "home");
  mkdirSync(projectPath, { recursive: true });
  writeFileSync(
    join(projectPath, ".project.json"),
    JSON.stringify({ schema_version: 1, id: PROJECT_ID, slug: "hosted-project" }, null, 2) + "\n",
  );

  const project = {
    id: PROJECT_ID,
    slug: "hosted-project",
    name: "Hosted Project",
    description: null,
    kind: "generic",
    status: "active",
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
    created_at: "2026-09-11 11:42:01.569",
    updated_at: "2026-09-11 11:42:01.569",
    synced_at: null,
  };
  const agent = {
    id: AGENT_ID,
    slug: "release-bot",
    name: "Release Bot",
    kind: "cli",
    role: "automation",
    permissions: ["tmux:apply"],
    metadata: {},
    created_at: "2026-09-11 11:42:01.569",
    updated_at: "2026-09-11 11:42:01.569",
  };

  const requests: Array<{ method: string; path: string }> = [];
  const port = reserveFreePort();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch(req) {
      const url = new URL(req.url);
      requests.push({ method: req.method, path: url.pathname });
      if (req.method === "GET" && url.pathname === `/v1/projects/${PROJECT_ID}`) return Response.json(project);
      if (req.method === "GET" && url.pathname === `/v1/agents/${agent.slug}`) return Response.json(agent);
      if (req.method === "GET" && url.pathname === `/v1/agents/${AGENT_ID}`) return Response.json(agent);
      if (req.method === "GET" && url.pathname.startsWith("/v1/agents/")) {
        return Response.json({ error: "Agent not found" }, { status: 404 });
      }
      if (req.method === "POST" && url.pathname === `/v1/projects/${PROJECT_ID}/events`) {
        return Response.json({ event: { id: "evt_1", workspace_id: PROJECT_ID } }, { status: 201 });
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });

  const env = {
    // No HASNA_PROJECTS_DB_PATH: the registry home is a fresh temp dir so any
    // sqlite file the hosted path opens shows up in databaseFilesUnder().
    HASNA_PROJECTS_HOME: projectsHome,
    HASNA_PROJECTS_API_URL: `http://127.0.0.1:${port}`,
    HASNA_PROJECTS_API_KEY: "test-key",
    // Blank the on-box opt-in: this fixture's subject is the hosted transport.
    HASNA_PROJECTS_LOCAL: "",
    // Channel ensure / online notifications shell out to the conversations CLI;
    // they are not the subject here.
    HASNA_PROJECTS_CHANNEL_ENSURE: "0",
    PROJECTS_AGENT_ONLINE_NOTIFICATIONS: "0",
  };

  const runCli = async (args: string[]) => {
    const proc = Bun.spawn({
      cmd: ["bun", "run", CLI_PATH, ...args],
      stdout: "pipe",
      stderr: "pipe",
      env: testSpawnEnv(env),
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;
    return { exitCode: proc.exitCode, stdout, stderr: withoutUnhostedNotice(stderr) };
  };

  const callTool = async (name: string, args: Record<string, unknown>) => {
    const messages = [
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "projects-start-hosted-test", version: "0" },
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
      { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } },
    ];
    const proc = Bun.spawn({
      cmd: ["node", MCP_STDIO_CLIENT, JSON.stringify(messages)],
      stdout: "pipe",
      stderr: "pipe",
      env: testSpawnEnv(env),
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    await proc.exited;
    const responses = stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line)) as Array<{ id?: number; result?: { content?: Array<{ text: string }> } }>;
    return {
      exitCode: proc.exitCode,
      stderr: withoutUnhostedNotice(stderr),
      text: responses.find((response) => response.id === 2)?.result?.content?.[0]?.text ?? "",
    };
  };

  return {
    projectsHome,
    projectPath,
    requests,
    runCli,
    callTool,
    close() {
      server.stop(true);
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe("start surfaces resolve their attributing agent over /v1 in the hosted transport", () => {
  test("projects start: an unnamed actor never opens the on-box agent table", async () => {
    const fixture = hostedStartFixture();
    try {
      const result = await fixture.runCli(["start", PROJECT_ID, "--dry-run", "--json"]);

      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout) as { project: { id: string }; tmux: { dry_run: boolean } };
      expect(payload.project.id).toBe(PROJECT_ID);
      expect(payload.tmux.dry_run).toBe(true);
      // The project came from the hosted registry...
      expect(fixture.requests).toContainEqual({ method: "GET", path: `/v1/projects/${PROJECT_ID}` });
      // ...and attribution was left to the server: no agent lookup at all, and
      // above all no on-box agent row created to name the caller.
      expect(fixture.requests.filter((request) => request.path.startsWith("/v1/agents"))).toEqual([]);
      expect(databaseFilesUnder(fixture.projectsHome)).toEqual([]);
    } finally {
      fixture.close();
    }
  });

  test("projects start --actor: the named agent is resolved through GET /v1/agents/{idOrSlug}", async () => {
    const fixture = hostedStartFixture();
    try {
      const result = await fixture.runCli(["start", PROJECT_ID, "--actor", "release-bot", "--dry-run", "--json"]);

      expect(result.exitCode).toBe(0);
      expect(fixture.requests).toContainEqual({ method: "GET", path: "/v1/agents/release-bot" });
      expect(databaseFilesUnder(fixture.projectsHome)).toEqual([]);
    } finally {
      fixture.close();
    }
  });

  test("projects start --actor: an unknown agent fails closed against the hosted registry", async () => {
    const fixture = hostedStartFixture();
    try {
      const result = await fixture.runCli(["start", PROJECT_ID, "--actor", "no-such-agent", "--dry-run", "--json"]);

      expect(result.exitCode).not.toBe(0);
      expect(fixture.requests).toContainEqual({ method: "GET", path: "/v1/agents/no-such-agent" });
      // The failure is the hosted registry's, not a silent on-box fallback.
      expect(databaseFilesUnder(fixture.projectsHome)).toEqual([]);
    } finally {
      fixture.close();
    }
  });

  test("projects_start: an unnamed actor never opens the on-box agent table", async () => {
    const fixture = hostedStartFixture();
    try {
      const result = await fixture.callTool("projects_start", { target: PROJECT_ID, dry_run: true });

      expect(result.text).not.toContain("Error:");
      const payload = JSON.parse(result.text) as { project: { id: string } };
      expect(payload.project.id).toBe(PROJECT_ID);
      expect(fixture.requests).toContainEqual({ method: "GET", path: `/v1/projects/${PROJECT_ID}` });
      expect(fixture.requests.filter((request) => request.path.startsWith("/v1/agents"))).toEqual([]);
      expect(databaseFilesUnder(fixture.projectsHome)).toEqual([]);
    } finally {
      fixture.close();
    }
  });

  test("projects_start with agent: the named agent is resolved through GET /v1/agents/{idOrSlug}", async () => {
    const fixture = hostedStartFixture();
    try {
      const result = await fixture.callTool("projects_start", {
        target: PROJECT_ID,
        dry_run: true,
        agent: "release-bot",
      });

      expect(result.text).not.toContain("Error:");
      expect(fixture.requests).toContainEqual({ method: "GET", path: "/v1/agents/release-bot" });
      expect(databaseFilesUnder(fixture.projectsHome)).toEqual([]);
    } finally {
      fixture.close();
    }
  });

  test("projects_render_start: the render variant resolves its actor over /v1 too", async () => {
    const fixture = hostedStartFixture();
    try {
      const unnamed = await fixture.callTool("projects_render_start", { target: PROJECT_ID });
      expect(unnamed.text).not.toContain("Error:");
      expect(fixture.requests.filter((request) => request.path.startsWith("/v1/agents"))).toEqual([]);

      const named = await fixture.callTool("projects_render_start", { target: PROJECT_ID, agent: "release-bot" });
      expect(named.text).not.toContain("Error:");
      expect(fixture.requests).toContainEqual({ method: "GET", path: "/v1/agents/release-bot" });
      expect(databaseFilesUnder(fixture.projectsHome)).toEqual([]);
    } finally {
      fixture.close();
    }
  });
});
