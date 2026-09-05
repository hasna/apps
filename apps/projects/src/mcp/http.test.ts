import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "./index.js";
import { handleMcpRequest, resolveMcpHttpPort, DEFAULT_MCP_HTTP_PORT } from "./http.js";
import { closeDatabase } from "../db/database.js";
import { createWorkspace } from "../db/workspaces.js";
import { __resetProjectStore } from "../store/project-store.js";
import { HOSTED_API_ENV_KEYS, silenceHostedApiEnv } from "../testing/spawn-env.js";

describe("projects MCP HTTP transport", () => {
  let httpServer: ReturnType<typeof Bun.serve>;
  let port: number;
  let root: string;
  let previousDbPath: string | undefined;
  let previousHasnaHome: string | undefined;
  let previousStation: string | undefined;
  let previousApiEnv: Record<string, string | undefined>;


  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "projects-mcp-http-"));
    previousDbPath = process.env.HASNA_PROJECTS_DB_PATH;
    previousApiEnv = {};
    for (const key of HOSTED_API_ENV_KEYS) previousApiEnv[key] = process.env[key];
    previousHasnaHome = process.env["HASNA_HOME"];
    previousStation = process.env["HASNA_STATION"];
    // Silence all five tiers of the shared @hasna/contracts resolver, so this
    // fixture takes the unhosted OSS path onto the on-box SQLite registry
    // instead of the operator's real fleet credential.
    silenceHostedApiEnv();
    process.env.HASNA_PROJECTS_DB_PATH = join(root, "projects.db");
    __resetProjectStore();
    closeDatabase();

    httpServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/health" && req.method === "GET") {
          return Response.json({ status: "ok", name: "projects" });
        }
        if (url.pathname === "/mcp") {
          return handleMcpRequest(req, buildServer, { port: httpServer.port });
        }
        return new Response("Not Found", { status: 404 });
      },
    });
    port = httpServer.port!;
  });

  afterAll(() => {
    httpServer.stop();
    closeDatabase();
    __resetProjectStore();
    if (previousDbPath === undefined) {
      delete process.env.HASNA_PROJECTS_DB_PATH;
    } else {
      process.env.HASNA_PROJECTS_DB_PATH = previousDbPath;
    }
    for (const key of HOSTED_API_ENV_KEYS) {
      const value = previousApiEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (previousHasnaHome === undefined) delete process.env["HASNA_HOME"];
    else process.env["HASNA_HOME"] = previousHasnaHome;
    if (previousStation === undefined) delete process.env["HASNA_STATION"];
    else process.env["HASNA_STATION"] = previousStation;

    __resetProjectStore();
    rmSync(root, { recursive: true, force: true });
  });

  test("default port is 8871", () => {
    expect(DEFAULT_MCP_HTTP_PORT).toBe(8871);
    expect(resolveMcpHttpPort([])).toBe(8871);
    expect(resolveMcpHttpPort(["--port", "9001"])).toBe(9001);
  });

  test("GET /health returns 200", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", name: "projects" });
  });

  test("MCP initialize + projects_list over Streamable HTTP", async () => {
    const client = new Client({ name: "projects-http-test", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
    );
    await client.connect(transport);
    const created = await client.callTool({
      name: "projects_create",
      arguments: {
        name: "HTTP Compact Project",
        path: join(root, "http-compact-project"),
        metadata: { notes: "x".repeat(500) },
      },
    });
    expect(created.isError).not.toBe(true);

    const result = await client.callTool({ name: "projects_list", arguments: { query: "http-compact-project", limit: 1 } });
    expect(result.isError).not.toBe(true);
    const content = result.content as Array<{ type: string; text?: string }> | undefined;
    expect(content?.[0]?.type).toBe("text");
    const payload = JSON.parse(content?.[0]?.text ?? "[]") as Array<{ slug: string; metadata?: { notes?: string } }>;
    expect(payload.find((item) => item.slug === "http-compact-project")?.metadata?.notes).toHaveLength(500);

    const compact = await client.callTool({ name: "projects_list", arguments: { query: "http-compact-project", compact: true, limit: 1 } });
    expect(compact.isError).not.toBe(true);
    const compactContent = compact.content as Array<{ type: string; text?: string }> | undefined;
    const compactPayload = JSON.parse(compactContent?.[0]?.text ?? "{}") as {
      projects?: Array<{ slug: string; metadata?: unknown }>;
      count?: number;
      next_steps?: string;
    };
    expect(compactPayload.projects?.[0]?.slug).toBe("http-compact-project");
    expect(compactPayload.projects?.[0]?.metadata).toBeUndefined();
    expect(compactPayload.count).toBe(1);
    expect(compactPayload.next_steps).toContain("full records");
    await client.close();
  });

  test("projects_list excludes registry-fixture rows by default; include_fixtures=true includes them", async () => {
    createWorkspace({
      name: "Fixture Smoke",
      slug: "fixture-smoke",
      kind: "generic",
      tags: ["registry-fixture"],
    });

    const client = new Client({ name: "projects-http-test", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
    );
    await client.connect(transport);

    const def = await client.callTool({
      name: "projects_list",
      arguments: { query: "fixture-smoke", limit: 10 },
    });
    expect(def.isError).not.toBe(true);
    const defPayload = JSON.parse(
      (def.content as Array<{ type: string; text?: string }>)?.[0]?.text ?? "[]",
    ) as Array<{ slug: string }>;
    expect(defPayload.find((item) => item.slug === "fixture-smoke")).toBeUndefined();

    const inc = await client.callTool({
      name: "projects_list",
      arguments: { query: "fixture-smoke", include_fixtures: true, limit: 10 },
    });
    expect(inc.isError).not.toBe(true);
    const incPayload = JSON.parse(
      (inc.content as Array<{ type: string; text?: string }>)?.[0]?.text ?? "[]",
    ) as Array<{ slug: string }>;
    expect(incPayload.find((item) => item.slug === "fixture-smoke")).toBeDefined();

    await client.close();
  });
});

describe("projects buildServer", () => {
  test("registers tools for stdio and HTTP modes", () => {
    expect(buildServer()).toBeDefined();
  });
});
