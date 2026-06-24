import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildServer } from "./index.js";
import { handleMcpRequest, resolveMcpHttpPort, DEFAULT_MCP_HTTP_PORT } from "./http.js";
import { resetDatabase } from "../db/database.js";

function parseToolText(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const content = result.content as Array<{ type: string; text?: string }> | undefined;
  expect(content?.[0]?.type).toBe("text");
  return JSON.parse(content?.[0]?.text ?? "null") as unknown;
}

describe("prompts MCP HTTP transport", () => {
  let httpServer: ReturnType<typeof Bun.serve>;
  let port: number;

  beforeAll(() => {
    httpServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/health" && req.method === "GET") {
          return Response.json({ status: "ok", name: "prompts" });
        }
        if (url.pathname === "/mcp") {
          return handleMcpRequest(req, buildServer);
        }
        return new Response("Not Found", { status: 404 });
      },
    });
    port = httpServer.port!;
  });

  afterAll(() => {
    httpServer.stop();
  });

  test("default port is 8872", () => {
    expect(DEFAULT_MCP_HTTP_PORT).toBe(8872);
    expect(resolveMcpHttpPort([])).toBe(8872);
  });

  test("GET /health returns 200", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", name: "prompts" });
  });

  test("MCP initialize + prompts_stats over Streamable HTTP", async () => {
    const client = new Client({ name: "prompts-http-test", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
    );
    await client.connect(transport);
    const result = await client.callTool({ name: "prompts_stats", arguments: {} });
    expect(result.isError).not.toBe(true);
    const content = result.content as Array<{ type: string }> | undefined;
    expect(content?.[0]?.type).toBe("text");
    await client.close();
  });

  test("prompts_get and prompts_history are compact unless body is requested", async () => {
    const dir = mkdtempSync(join(tmpdir(), "open-prompts-mcp-compact-"));
    const previousDb = process.env.HASNA_PROMPTS_DB_PATH;
    const previousPromptsDb = process.env.PROMPTS_DB_PATH;
    process.env.HASNA_PROMPTS_DB_PATH = join(dir, "prompts.db");
    process.env.PROMPTS_DB_PATH = process.env.HASNA_PROMPTS_DB_PATH;
    resetDatabase();

    const client = new Client({ name: "prompts-http-compact-test", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
    );
    try {
      await client.connect(transport);

      const body = `mcp body ${"x".repeat(220)} MCP_FULL_BODY_TAIL`;
      const saved = parseToolText(await client.callTool({
        name: "prompts_save",
        arguments: { title: "MCP Compact", slug: "mcp-compact", body },
      })) as { id: string; slug: string };
      expect(saved.slug).toBe("mcp-compact");

      const compact = parseToolText(await client.callTool({
        name: "prompts_get",
        arguments: { id: saved.id },
      })) as { body?: string; body_preview?: string; body_chars?: number; _hint?: string };
      expect(compact.body).toBeUndefined();
      expect(compact.body_chars).toBe(body.length);
      expect(compact.body_preview).not.toContain("MCP_FULL_BODY_TAIL");
      expect(compact._hint).toContain("prompts_body");

      const full = parseToolText(await client.callTool({
        name: "prompts_get",
        arguments: { id: saved.id, include_body: true },
      })) as { body?: string };
      expect(full.body).toContain("MCP_FULL_BODY_TAIL");

      const used = parseToolText(await client.callTool({
        name: "prompts_use",
        arguments: { id: saved.id },
      })) as { body?: string; prompt?: { body?: string; body_chars?: number } };
      expect(used.body).toContain("MCP_FULL_BODY_TAIL");
      expect(used.prompt?.body).toBeUndefined();
      expect(used.prompt?.body_chars).toBe(body.length);

      const history = parseToolText(await client.callTool({
        name: "prompts_history",
        arguments: { id: saved.id },
      })) as { versions: Array<{ body?: string; body_preview?: string; body_chars?: number }> };
      expect(history.versions[0]?.body).toBeUndefined();
      expect(history.versions[0]?.body_chars).toBe(body.length);
      expect(history.versions[0]?.body_preview).not.toContain("MCP_FULL_BODY_TAIL");

      const unusedSaved = parseToolText(await client.callTool({
        name: "prompts_save",
        arguments: { title: "MCP Unused", slug: "mcp-unused", body: "unused body long enough" },
      })) as { id: string };
      expect(unusedSaved.id).toBeTruthy();

      const lint = parseToolText(await client.callTool({
        name: "prompts_lint",
        arguments: { limit: 1 },
      })) as { results: Array<{ prompt: { body?: string; body_chars?: number } }>; has_more: boolean; next_offset: number | null };
      expect(lint.results.length).toBe(1);
      expect(lint.results[0]?.prompt.body).toBeUndefined();
      expect(lint.results[0]?.prompt.body_chars).toBeGreaterThan(0);
      expect(lint.has_more).toBe(true);
      expect(lint.next_offset).toBe(1);

      const unused = parseToolText(await client.callTool({
        name: "prompts_unused",
        arguments: { limit: 1 },
      })) as { unused: Array<{ body?: string; slug: string }>; has_more: boolean };
      expect(unused.unused[0]?.body).toBeUndefined();
      expect(unused.unused.some((p) => p.slug === "mcp-unused")).toBe(true);

      const scheduleVars = { topic: `${"v".repeat(220)} SCHEDULE_VAR_TAIL` };
      const schedule = parseToolText(await client.callTool({
        name: "prompts_schedule",
        arguments: { id: saved.id, cron: "0 0 1 1 *", vars: scheduleVars },
      })) as { schedule: { vars?: Record<string, string>; vars_keys?: string[]; vars_chars?: number } };
      expect(schedule.schedule.vars).toBeUndefined();
      expect(schedule.schedule.vars_keys).toContain("topic");
      expect(schedule.schedule.vars_chars).toBeGreaterThan(200);

      const schedules = parseToolText(await client.callTool({
        name: "prompts_list_schedules",
        arguments: {},
      })) as { schedules: Array<{ vars?: Record<string, string>; vars_keys?: string[]; vars_chars?: number; _hint?: string }> };
      expect(schedules.schedules[0]?.vars).toBeUndefined();
      expect(schedules.schedules[0]?.vars_keys).toContain("topic");

      const schedulesWithVars = parseToolText(await client.callTool({
        name: "prompts_list_schedules",
        arguments: { include_vars: true },
      })) as { schedules: Array<{ vars?: Record<string, string> }> };
      expect(schedulesWithVars.schedules[0]?.vars?.topic).toContain("SCHEDULE_VAR_TAIL");
    } finally {
      await client.close();
      resetDatabase();
      if (previousDb) process.env.HASNA_PROMPTS_DB_PATH = previousDb;
      else delete process.env.HASNA_PROMPTS_DB_PATH;
      if (previousPromptsDb) process.env.PROMPTS_DB_PATH = previousPromptsDb;
      else delete process.env.PROMPTS_DB_PATH;
    }
  });
});

describe("prompts buildServer", () => {
  test("registers tools for stdio and HTTP modes", () => {
    expect(buildServer()).toBeDefined();
  });
});
