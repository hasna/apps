import { describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { testSpawnEnv, withoutUnhostedNotice } from "../../testing/spawn-env.js";

const CLI_PATH = join(process.cwd(), "src/cli/index.ts");
const MCP_STDIO_CLIENT = join(process.cwd(), "src/testing/mcp-stdio-client.mjs");
const PROJECT_ID = "wks_start0hosted1";
const AGENT_ID = "agt_hosted_actor_1";

interface CapturedRequest {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

function localStoreFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true, recursive: true }) as Array<{ name: string; parentPath?: string; path?: string }>) {
    if (/\.(?:db|sqlite|sqlite3)(?:-(?:wal|shm|journal))?$/.test(entry.name)) {
      found.push(join(entry.parentPath ?? entry.path ?? root, entry.name));
    }
  }
  return found;
}

function hostedStartFixture() {
  const root = mkdtempSync(join(tmpdir(), "projects-start-hosted-"));
  const projectPath = join(root, "hosted-project");
  const projectsHome = join(root, "home");
  const binDir = join(root, "bin");
  mkdirSync(projectPath, { recursive: true });
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, "tmux"), "#!/bin/sh\nexit 0\n", "utf-8");
  chmodSync(join(binDir, "tmux"), 0o755);
  writeFileSync(join(binDir, "conversations"), "#!/bin/sh\nexit 0\n", "utf-8");
  chmodSync(join(binDir, "conversations"), 0o755);
  writeFileSync(
    join(projectPath, ".project.json"),
    `${JSON.stringify({ schema_version: 1, id: PROJECT_ID, slug: "hosted-project" }, null, 2)}\n`,
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
    created_at: "2026-09-17T12:00:00.000Z",
    updated_at: "2026-09-17T12:00:00.000Z",
    synced_at: null,
  };
  const agent = {
    id: AGENT_ID,
    slug: "release-bot",
    name: "Release Bot",
    kind: "cli",
    provider: null,
    model: null,
    role: "automation",
    permissions: ["projects:start"],
    metadata: {},
    created_at: "2026-09-17T12:00:00.000Z",
    updated_at: "2026-09-17T12:00:00.000Z",
  };

  const requests: CapturedRequest[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body = req.body ? await req.json() as Record<string, unknown> : null;
      requests.push({ method: req.method, path: url.pathname, body });
      if (req.method === "GET" && url.pathname === `/v1/projects/${PROJECT_ID}`) return Response.json(project);
      if (req.method === "GET" && url.pathname === `/v1/agents/${agent.slug}`) return Response.json(agent);
      if (req.method === "GET" && url.pathname === `/v1/agents/${AGENT_ID}`) return Response.json(agent);
      if (req.method === "GET" && url.pathname === "/v1/agents/malformed") return Response.json({ id: AGENT_ID });
      if (req.method === "GET" && url.pathname === "/v1/agents/mismatch") return Response.json(agent);
      if (req.method === "GET" && url.pathname.startsWith("/v1/agents/")) {
        return Response.json({ error: "Agent not found" }, { status: 404 });
      }
      if (req.method === "PATCH" && url.pathname === `/v1/projects/${PROJECT_ID}`) {
        return Response.json({ ...project, ...body });
      }
      if (req.method === "POST" && url.pathname === `/v1/projects/${PROJECT_ID}/events`) {
        return Response.json({
          event: {
            id: `evt_${requests.length}`,
            workspace_id: PROJECT_ID,
            agent_id: body?.agent_id ?? null,
            event_type: body?.event_type,
            source: body?.source,
            metadata: body?.metadata ?? {},
            created_at: "2026-09-17T12:00:01.000Z",
          },
        }, { status: 201 });
      }
      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });

  const env = testSpawnEnv({
    HASNA_PROJECTS_HOME: projectsHome,
    HASNA_PROJECTS_API_URL: `http://127.0.0.1:${server.port}`,
    HASNA_PROJECTS_API_KEY: "test-key",
    HASNA_PROJECTS_LOCAL: "",
    HASNA_PROJECTS_CHANNEL_ENSURE: "1",
    PROJECTS_AGENT_ONLINE_NOTIFICATIONS: "0",
    HASNA_PROJECTS_MCP_PROFILE: "full",
    PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
  });

  const runCli = async (args: string[]) => {
    const proc = Bun.spawn({
      cmd: ["bun", "run", CLI_PATH, ...args],
      stdout: "pipe",
      stderr: "pipe",
      env,
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, stdout, stderr: withoutUnhostedNotice(stderr) };
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
      env,
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    const responses = stdout.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) as Array<{
      id?: number;
      result?: { content?: Array<{ text: string }> };
    }>;
    return {
      exitCode,
      stderr: withoutUnhostedNotice(stderr),
      text: responses.find((response) => response.id === 2)?.result?.content?.[0]?.text ?? "",
    };
  };

  return {
    projectsHome,
    requests,
    runCli,
    callTool,
    close() {
      server.stop(true);
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function actorMutationBodies(requests: CapturedRequest[]): Array<Record<string, unknown>> {
  return requests
    .filter((request) =>
      (request.method === "POST" && request.path === `/v1/projects/${PROJECT_ID}/events`)
      || (request.method === "PATCH" && request.path === `/v1/projects/${PROJECT_ID}`))
    .map((request) => request.body ?? {});
}

function expectSingleV1Prefix(requests: CapturedRequest[]): void {
  for (const request of requests) {
    expect(request.path.match(/\/v1(?=\/|$)/g)?.length ?? 0).toBe(1);
  }
}

describe("hosted project starts resolve explicit actors through /v1/agents", () => {
  test("CLI non-dry-run sends the resolved immutable agent id on every event and update", async () => {
    const fixture = hostedStartFixture();
    try {
      const result = await fixture.runCli([
        "start", PROJECT_ID, "--actor", "release-bot", "--agent", "none", "--no-attach", "--json",
      ]);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(fixture.requests.filter((request) => request.path === "/v1/agents/release-bot")).toHaveLength(1);
      expect(fixture.requests
        .filter((request) => request.method !== "GET")
        .map((request) => `${request.method} ${request.path}`)).toEqual([
        `POST /v1/projects/${PROJECT_ID}/events`,
        `POST /v1/projects/${PROJECT_ID}/events`,
        `PATCH /v1/projects/${PROJECT_ID}`,
        `POST /v1/projects/${PROJECT_ID}/events`,
      ]);
      const writes = actorMutationBodies(fixture.requests);
      expect(writes).toHaveLength(4);
      expect(writes.map((body) => body.agent_id)).toEqual([AGENT_ID, AGENT_ID, AGENT_ID, AGENT_ID]);
      expect(writes.filter((body) => body.event_type).map((body) => body.event_type)).toEqual([
        "tmux_applied", "channel_ensured", "started",
      ]);
      expectSingleV1Prefix(fixture.requests);
      expect(localStoreFiles(fixture.projectsHome)).toEqual([]);
    } finally {
      fixture.close();
    }
  });

  test("MCP non-dry-run sends the resolved immutable agent id on every event and update", async () => {
    const fixture = hostedStartFixture();
    try {
      const result = await fixture.callTool("projects_start", {
        target: PROJECT_ID,
        agent: "release-bot",
        agent_tool: "none",
        dry_run: false,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.text).not.toContain("Error:");
      expect(fixture.requests.filter((request) => request.path === "/v1/agents/release-bot")).toHaveLength(1);
      expect(actorMutationBodies(fixture.requests).map((body) => body.agent_id)).toEqual([
        AGENT_ID, AGENT_ID, AGENT_ID, AGENT_ID,
      ]);
      expect(localStoreFiles(fixture.projectsHome)).toEqual([]);
    } finally {
      fixture.close();
    }
  });

  test("render start resolves an explicit hosted actor but remains write-free", async () => {
    const fixture = hostedStartFixture();
    try {
      const result = await fixture.callTool("projects_render_start", { target: PROJECT_ID, agent: "release-bot" });
      expect(result.exitCode).toBe(0);
      expect(result.text).not.toContain("Error:");
      expect(fixture.requests.filter((request) => request.path === "/v1/agents/release-bot")).toHaveLength(1);
      expect(actorMutationBodies(fixture.requests)).toEqual([]);
      expect(localStoreFiles(fixture.projectsHome)).toEqual([]);
    } finally {
      fixture.close();
    }
  });

  test("an omitted CLI actor stays unattributed on real writes and never opens the local registry", async () => {
    const fixture = hostedStartFixture();
    try {
      const result = await fixture.runCli(["start", PROJECT_ID, "--agent", "none", "--no-attach", "--json"]);
      expect(result.exitCode).toBe(0);
      expect(fixture.requests.some((request) => request.path.startsWith("/v1/agents/"))).toBe(false);
      const writes = actorMutationBodies(fixture.requests);
      expect(writes).toHaveLength(4);
      expect(writes.every((body) => !Object.hasOwn(body, "agent_id"))).toBe(true);
      expectSingleV1Prefix(fixture.requests);
      expect(localStoreFiles(fixture.projectsHome)).toEqual([]);
    } finally {
      fixture.close();
    }
  });

  test("an omitted MCP actor stays unattributed on real writes and never opens the local registry", async () => {
    const fixture = hostedStartFixture();
    try {
      const result = await fixture.callTool("projects_start", {
        target: PROJECT_ID,
        agent_tool: "none",
        dry_run: false,
      });
      expect(result.exitCode).toBe(0);
      expect(result.text).not.toContain("Error:");
      expect(fixture.requests.some((request) => request.path.startsWith("/v1/agents/"))).toBe(false);
      const writes = actorMutationBodies(fixture.requests);
      expect(writes).toHaveLength(4);
      expect(writes.every((body) => !Object.hasOwn(body, "agent_id"))).toBe(true);
      expectSingleV1Prefix(fixture.requests);
      expect(localStoreFiles(fixture.projectsHome)).toEqual([]);
    } finally {
      fixture.close();
    }
  });

  test("prompt mode refuses hosted execution before opening its machine-local agent ledger", async () => {
    const fixture = hostedStartFixture();
    try {
      const result = await fixture.runCli([
        "--agent", "release-bot", "--no-tmux", "--json", "open hosted-project",
      ]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("REMOTE_COMMAND_UNSUPPORTED: projects prompt mode");
      expect(fixture.requests).toEqual([]);
      expect(localStoreFiles(fixture.projectsHome)).toEqual([]);
    } finally {
      fixture.close();
    }
  });

  test("unknown, malformed, and mismatched agent responses fail closed with no writes", async () => {
    for (const [actor, expected] of [
      ["missing", "Agent not found: missing"],
      ["malformed", "malformed response"],
      ["mismatch", "did not match mismatch"],
    ] as const) {
      const fixture = hostedStartFixture();
      try {
        const result = await fixture.runCli(["start", PROJECT_ID, "--actor", actor, "--agent", "none", "--dry-run", "--json"]);
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain(expected);
        expect(actorMutationBodies(fixture.requests)).toEqual([]);
        expect(localStoreFiles(fixture.projectsHome)).toEqual([]);
      } finally {
        fixture.close();
      }
    }
  });
});
