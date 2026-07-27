import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildServer } from "./index.js";
import { handleMcpRequest, resolveMcpHttpPort, DEFAULT_MCP_HTTP_PORT } from "./http.js";
import { closeDb } from "../lib/db.js";
import { readPersistedIdentity, _resetAutoName } from "../lib/identity.js";
import { mkdtempSync, rmSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-http-test-${Date.now()}.db`);

describe("conversations MCP HTTP transport", () => {
  let httpServer: ReturnType<typeof Bun.serve>;
  let port: number;

  beforeAll(() => {
    process.env.CONVERSATIONS_DB_PATH = TEST_DB;
    closeDb();

    httpServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/health" && req.method === "GET") {
          return Response.json({ status: "ok", name: "conversations" });
        }
        if (url.pathname === "/mcp") {
          return handleMcpRequest(req, () => buildServer(true));
        }
        return new Response("Not Found", { status: 404 });
      },
    });
    port = httpServer.port!;
  });

  afterAll(async () => {
    httpServer.stop();
    closeDb();
    for (const suffix of ["", "-wal", "-shm"]) {
      try {
        unlinkSync(TEST_DB + suffix);
      } catch {
        /* ok */
      }
    }
  });

  test("default port is 8856", () => {
    expect(DEFAULT_MCP_HTTP_PORT).toBe(8856);
    expect(resolveMcpHttpPort([])).toBe(8856);
    expect(resolveMcpHttpPort(["--port", "9003"])).toBe(9003);
  });

  test("GET /health returns 200", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", name: "conversations" });
  });

  test("MCP initialize + list_agents over Streamable HTTP", async () => {
    const client = new Client({ name: "conversations-http-test", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
    );
    await client.connect(transport);
    const result = await client.callTool({ name: "list_agents", arguments: {} });
    expect(result.isError).not.toBe(true);
    const content = result.content as Array<{ type: string }> | undefined;
    expect(content?.[0]?.type).toBe("text");
    await client.close();
  });

  test("serves multiple concurrent clients from one process", async () => {
    const clients = await Promise.all(
      [1, 2, 3].map(async () => {
        const client = new Client({ name: "conversations-http-concurrent", version: "0.0.0" });
        const transport = new StreamableHTTPClientTransport(
          new URL(`http://127.0.0.1:${port}/mcp`),
        );
        await client.connect(transport);
        const result = await client.callTool({ name: "list_agents", arguments: {} });
        await client.close();
        return result;
      }),
    );
    for (const result of clients) {
      expect(result.isError).not.toBe(true);
    }
  });
});

/**
 * The default transport is "one process per MCP, many agents" (see ./index.ts),
 * and it is stateless: ./http.ts builds a fresh server per request with
 * `sessionIdGenerator: undefined`. Anything the daemon remembers about "who is
 * calling" outside a single request is therefore shared by every client on the
 * box. These tests drive the real transport with two independent clients.
 */
describe("conversations MCP HTTP transport — two agents, one daemon", () => {
  const AGENT_DB = join(tmpdir(), `conversations-http-agents-${Date.now()}.db`);
  let httpServer: ReturnType<typeof Bun.serve>;
  let port: number;
  let savedHome: string | undefined;
  let savedUserProfile: string | undefined;
  let savedAgentId: string | undefined;
  let tempHome: string;

  async function connect(name: string): Promise<Client> {
    const client = new Client({ name, version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    return client;
  }

  function parseResult(result: unknown): any {
    const text = ((result as { content: Array<{ text: string }> }).content[0]).text;
    try { return JSON.parse(text); } catch { return text; }
  }

  beforeAll(() => {
    // Isolated HOME: register_agent seeds the machine identity when the box has
    // none, and this suite must never write the developer's real agent-id file.
    savedHome = process.env.HOME;
    savedUserProfile = process.env.USERPROFILE;
    savedAgentId = process.env.CONVERSATIONS_AGENT_ID;
    tempHome = mkdtempSync(join(tmpdir(), "conversations-http-identity-"));
    process.env.HOME = tempHome;
    process.env.USERPROFILE = tempHome;
    delete process.env.CONVERSATIONS_AGENT_ID;
    _resetAutoName();

    process.env.CONVERSATIONS_DB_PATH = AGENT_DB;
    closeDb();

    httpServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/mcp") return handleMcpRequest(req, () => buildServer(true));
        return new Response("Not Found", { status: 404 });
      },
    });
    port = httpServer.port!;
  });

  afterAll(() => {
    httpServer.stop();
    closeDb();
    delete process.env.CONVERSATIONS_DB_PATH;
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(AGENT_DB + suffix); } catch { /* ok */ }
    }
    if (savedHome !== undefined) process.env.HOME = savedHome;
    else delete process.env.HOME;
    if (savedUserProfile !== undefined) process.env.USERPROFILE = savedUserProfile;
    else delete process.env.USERPROFILE;
    if (savedAgentId !== undefined) process.env.CONVERSATIONS_AGENT_ID = savedAgentId;
    try { rmSync(tempHome, { recursive: true, force: true }); } catch { /* ok */ }
    _resetAutoName();
  });

  test("one client's register_agent does not become another client's implicit author", async () => {
    const alpha = await connect("alpha-client");
    const beta = await connect("beta-client");

    try {
      await alpha.callTool({ name: "register_agent", arguments: { name: "alpha-agent" } });
      // This HOME had no identity, so the first agent to register claims it.
      expect(readPersistedIdentity()).toBe("alpha-agent");
      const alphaBefore = parseResult(await alpha.callTool({ name: "get_focus", arguments: {} }));

      await beta.callTool({ name: "register_agent", arguments: { name: "beta-agent" } });
      // Seed-if-absent, not last-writer-wins: beta does not take the box.
      expect(readPersistedIdentity()).toBe("alpha-agent");
      const alphaAfter = parseResult(await alpha.callTool({ name: "get_focus", arguments: {} }));

      // With session state held process-wide, beta's registration silently
      // retargets alpha: alpha's next implicit resolution returns "beta-agent"
      // and alpha's unattributed posts are stored as beta.
      expect(alphaAfter.agent).not.toBe("beta-agent");
      expect(alphaAfter.agent).toBe(alphaBefore.agent);

      await alpha.callTool({ name: "create_channel", arguments: { name: "http-attribution", from: "alpha-agent" } });
      await alpha.callTool({
        name: "send_to_channel",
        arguments: { channel: "http-attribution", content: "alpha reporting an incident" },
      });
      const posted = parseResult(await alpha.callTool({
        name: "read_channel",
        arguments: { channel: "http-attribution", verbose: true },
      }));
      const messages = Array.isArray(posted) ? posted : posted.messages;
      expect(messages).toHaveLength(1);
      expect(messages[0].from_agent).toBe(alphaBefore.agent);
      expect(messages[0].from_agent).not.toBe("beta-agent");
    } finally {
      await alpha.close();
      await beta.close();
    }
  });
});

describe("conversations buildServer", () => {
  test("registers tools for stdio and HTTP modes", () => {
    expect(buildServer()).toBeDefined();
    expect(buildServer(true)).toBeDefined();
  });
});
