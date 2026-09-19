import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "./index.js";
import { handleMcpRequest, resolveMcpHttpPort, DEFAULT_MCP_HTTP_PORT } from "./http.js";
import { closeDatabase } from "../db/database.js";
import { createRoot, createWorkspace } from "../db/workspaces.js";
import { __resetProjectStore } from "../store/project-store.js";
import { HOSTED_API_ENV_KEYS, silenceHostedApiEnv } from "../testing/spawn-env.js";

describe("projects MCP HTTP transport", () => {
  let httpServer: ReturnType<typeof Bun.serve>;
  let port: number;
  let root: string;
  let previousDbPath: string | undefined;
  let previousHasnaHome: string | undefined;
  let previousStation: string | undefined;
  let previousLocalOptIn: string | undefined;
  let previousApiEnv: Record<string, string | undefined>;


  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "projects-mcp-http-"));
    previousDbPath = process.env.HASNA_PROJECTS_DB_PATH;
    previousApiEnv = {};
    for (const key of HOSTED_API_ENV_KEYS) previousApiEnv[key] = process.env[key];
    previousHasnaHome = process.env["HASNA_HOME"];
    previousStation = process.env["HASNA_STATION"];
    previousLocalOptIn = process.env["HASNA_PROJECTS_LOCAL"];
    // Silence all five tiers of the shared @hasna/contracts resolver and set
    // the explicit local opt-in, so this fixture serves the on-box SQLite
    // registry instead of the operator's real fleet credential.
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
    if (previousLocalOptIn === undefined) delete process.env["HASNA_PROJECTS_LOCAL"];
    else process.env["HASNA_PROJECTS_LOCAL"] = previousLocalOptIn;

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
    const payload = JSON.parse(content?.[0]?.text ?? "{}") as {
      projects?: Array<{ slug: string; metadata?: unknown }>;
      count?: number;
      total?: number;
      detail?: string;
      response_bytes?: number;
    };
    expect(payload.projects?.[0]?.slug).toBe("http-compact-project");
    expect(payload.projects?.[0]?.metadata).toBeUndefined();
    expect(payload).toMatchObject({ count: 1, total: 1, detail: "compact" });
    expect(payload.response_bytes).toBe(Buffer.byteLength(content?.[0]?.text ?? ""));

    const full = await client.callTool({ name: "projects_list", arguments: { query: "http-compact-project", full: true, limit: 1 } });
    expect(full.isError).not.toBe(true);
    const fullContent = full.content as Array<{ type: string; text?: string }> | undefined;
    const fullPayload = JSON.parse(fullContent?.[0]?.text ?? "[]") as Array<{ slug: string; metadata?: { notes?: string } }>;
    expect(fullPayload.find((item) => item.slug === "http-compact-project")?.metadata?.notes).toHaveLength(500);
    await client.close();
  });

  test("projects_list and projects_search are compact, bounded, and preserve explicit full output", async () => {
    const client = new Client({ name: "projects-http-search-test", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
    );
    await client.connect(transport);

    for (let index = 0; index < 3; index += 1) {
      const created = await client.callTool({
        name: "projects_create",
        arguments: {
          name: `MCP Search ${index}`,
          path: join(root, "projects-parent", `mcp-search-${index}`),
          metadata: {
            notes: "x".repeat(2_000),
            ...(index === 0 ? { api_key: "must-not-appear-in-mcp-output" } : {}),
          },
        },
      });
      expect(created.isError).not.toBe(true);
    }

    const defaultList = await client.callTool({ name: "projects_list", arguments: { query: "MCP Search", limit: 2 } });
    const defaultListText = (defaultList.content as Array<{ type: string; text?: string }>)[0]?.text ?? "{}";
    expect(JSON.parse(defaultListText)).toMatchObject({ count: 2, total: 3, detail: "compact", has_more: true });
    expect(defaultListText).not.toContain("x".repeat(500));
    expect(defaultListText).not.toContain("\n  ");

    const legacy = await client.callTool({ name: "projects_list", arguments: { query: "mcp-search-0", full: true, limit: 1 } });
    const legacyText = (legacy.content as Array<{ type: string; text?: string }>)[0]?.text ?? "[]";
    expect((JSON.parse(legacyText) as Array<{ metadata?: { notes?: string } }>)[0]?.metadata?.notes).toHaveLength(2_000);

    const first = await client.callTool({
      name: "projects_search",
      arguments: { query: "MCP Search", limit: 2, fields: ["slug", "path"] },
    });
    expect(first.isError).not.toBe(true);
    const firstText = (first.content as Array<{ type: string; text?: string }>)[0]?.text ?? "{}";
    const firstPayload = JSON.parse(firstText) as {
      projects: Array<Record<string, unknown>>;
      count: number;
      total: number;
      offset: number;
      limit: number;
      next_cursor: string;
      next_offset: null;
      has_more: boolean;
      complete: boolean;
      detail: string;
      fields: string[];
      query_scope: string;
      next_arguments: Record<string, unknown>;
      max_bytes: number;
      response_bytes: number;
    };
    expect(firstPayload).toMatchObject({
      count: 2,
      total: 3,
      offset: 0,
      limit: 2,
      next_offset: null,
      has_more: true,
      complete: false,
      detail: "compact",
      fields: ["id", "slug", "path"],
      query_scope: "discovery",
      next_arguments: { query: "MCP Search", query_scope: "discovery", limit: 2 },
      max_bytes: 32768,
    });
    expect(Object.keys(firstPayload.projects[0] ?? {})).toEqual(["id", "slug", "path"]);
    expect(firstPayload.projects[0]?.path).toContain("projects-parent");
    expect(Buffer.byteLength(firstText)).toBeLessThan(2_500);
    expect(firstPayload.response_bytes).toBe(Buffer.byteLength(firstText));
    expect(firstPayload.next_cursor).toBeString();
    expect(firstPayload.next_arguments.cursor).toBe(firstPayload.next_cursor);
    expect(firstPayload.next_arguments.max_bytes).toBe(32768);
    expect(firstText).not.toContain("\n  ");

    const second = await client.callTool({
      name: "projects_search",
      arguments: { query: "MCP Search", limit: 2, cursor: firstPayload.next_cursor, fields: ["slug", "path"] },
    });
    expect(JSON.parse((second.content as Array<{ text?: string }>)[0]?.text ?? "{}")).toMatchObject({
      count: 1,
      total: 3,
      offset: 2,
      next_offset: null,
      has_more: false,
      complete: false,
    });

    const pathOnly = await client.callTool({
      name: "projects_search",
      arguments: { query: "projects-parent", limit: 10 },
    });
    expect(JSON.parse((pathOnly.content as Array<{ text?: string }>)[0]?.text ?? "{}")).toMatchObject({ count: 0, total: 0 });

    const allScope = await client.callTool({
      name: "projects_search",
      arguments: { query: "projects-parent", query_scope: "all", limit: 10 },
    });
    expect(JSON.parse((allScope.content as Array<{ text?: string }>)[0]?.text ?? "{}")).toMatchObject({ count: 3, total: 3 });

    const full = await client.callTool({
      name: "projects_search",
      arguments: { query: "MCP Search 0", detail: "full", limit: 1 },
    });
    const fullText = (full.content as Array<{ text?: string }>)[0]?.text ?? "{}";
    expect((JSON.parse(fullText) as { projects: Array<{ metadata: { api_key: string } }> }).projects[0]?.metadata.api_key)
      .toBe("[REDACTED]");
    expect(fullText).not.toContain("must-not-appear-in-mcp-output");

    await client.close();
  });

  test("opaque MCP cursors reject project and root collection drift", async () => {
    const client = new Client({ name: "projects-http-cursor-test", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
    await client.connect(transport);
    try {
      const duplicateA = createWorkspace({ name: "MCP Cursor Duplicate", slug: "mcp-cursor-duplicate-a", kind: "project", primary_path: join(root, "mcp-cursor-duplicate-a") });
      const duplicateB = createWorkspace({ name: "MCP Cursor Duplicate", slug: "mcp-cursor-duplicate-b", kind: "project", primary_path: join(root, "mcp-cursor-duplicate-b") });
      const first = await client.callTool({
        name: "projects_list",
        arguments: { query: "MCP Cursor Duplicate", query_scope: "identity", limit: 1 },
      });
      const firstPayload = JSON.parse((first.content as Array<{ text?: string }>)[0]?.text ?? "{}") as {
        projects: Array<{ id: string }>;
        next_cursor: string;
      };
      expect(first.isError).not.toBe(true);
      expect(firstPayload.next_cursor).toBeString();
      const second = await client.callTool({
        name: "projects_list",
        arguments: { query: "MCP Cursor Duplicate", query_scope: "identity", limit: 1, cursor: firstPayload.next_cursor },
      });
      const secondPayload = JSON.parse((second.content as Array<{ text?: string }>)[0]?.text ?? "{}") as { projects: Array<{ id: string }> };
      expect(second.isError).not.toBe(true);
      expect(new Set([firstPayload.projects[0]!.id, secondPayload.projects[0]!.id])).toEqual(new Set([duplicateA.id, duplicateB.id]));

      const mutationFirst = await client.callTool({
        name: "projects_list",
        arguments: { query: "MCP Cursor Duplicate", query_scope: "identity", limit: 1 },
      });
      const mutationCursor = (JSON.parse((mutationFirst.content as Array<{ text?: string }>)[0]?.text ?? "{}") as { next_cursor: string }).next_cursor;
      createWorkspace({ name: "MCP Cursor Duplicate", slug: "mcp-cursor-duplicate-c", kind: "project", primary_path: join(root, "mcp-cursor-duplicate-c") });
      const changed = await client.callTool({
        name: "projects_list",
        arguments: { query: "MCP Cursor Duplicate", query_scope: "identity", limit: 1, cursor: mutationCursor },
      });
      expect(changed.isError).toBe(true);
      expect((changed.content as Array<{ text?: string }>)[0]?.text).toContain("invalid or stale");

      createRoot({ name: "MCP Cursor Root A", slug: "mcp-cursor-root-a", base_path: join(root, "root-a") });
      createRoot({ name: "MCP Cursor Root B", slug: "mcp-cursor-root-b", base_path: join(root, "root-b") });
      const rootFirst = await client.callTool({ name: "projects_roots_list", arguments: { limit: 1 } });
      const rootCursor = (JSON.parse((rootFirst.content as Array<{ text?: string }>)[0]?.text ?? "{}") as { next_cursor: string }).next_cursor;
      expect(rootCursor).toBeString();
      createRoot({ name: "MCP Cursor Root C", slug: "mcp-cursor-root-c", base_path: join(root, "root-c") });
      const rootChanged = await client.callTool({ name: "projects_roots_list", arguments: { limit: 1, cursor: rootCursor } });
      expect(rootChanged.isError).toBe(true);
      expect((rootChanged.content as Array<{ text?: string }>)[0]?.text).toContain("invalid or stale");
    } finally {
      await client.close();
    }
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
      (def.content as Array<{ type: string; text?: string }>)?.[0]?.text ?? "{}",
    ) as { projects: Array<{ slug: string }> };
    expect(defPayload.projects.find((item) => item.slug === "fixture-smoke")).toBeUndefined();

    const inc = await client.callTool({
      name: "projects_list",
      arguments: { query: "fixture-smoke", include_fixtures: true, limit: 10 },
    });
    expect(inc.isError).not.toBe(true);
    const incPayload = JSON.parse(
      (inc.content as Array<{ type: string; text?: string }>)?.[0]?.text ?? "{}",
    ) as { projects: Array<{ slug: string }> };
    expect(incPayload.projects.find((item) => item.slug === "fixture-smoke")).toBeDefined();

    await client.close();
  });
});

describe("projects buildServer", () => {
  test("registers tools for stdio and HTTP modes", () => {
    expect(buildServer()).toBeDefined();
  });
});
