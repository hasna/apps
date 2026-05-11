import { describe, it, expect, beforeEach, afterAll, afterEach, mock } from "bun:test";
import "./setup";

// We need to mock the MCP SDK modules before importing proxy
const mockClose = mock(() => Promise.resolve());
const mockConnect = mock(() => Promise.resolve());
const mockListTools = mock(() =>
  Promise.resolve({
    tools: [
      { name: "echo", description: "Echoes input", inputSchema: { type: "object" } },
      { name: "greet", description: "Greets user", inputSchema: {} },
    ],
  })
);
const mockCallTool = mock((_args: any) =>
  Promise.resolve({
    content: [{ type: "text", text: "result" }],
  })
);

mock.module("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class MockClient {
    close = mockClose;
    connect = mockConnect;
    listTools = mockListTools;
    callTool = mockCallTool;
  },
}));

mock.module("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class MockStdio {
    constructor(public opts: any) {}
  },
}));

mock.module("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: class MockSSE {
    constructor(public url: URL) {}
  },
}));

mock.module("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class MockHTTP {
    constructor(public url: URL) {}
  },
}));

import {
  connectToServer,
  disconnectServer,
  disconnectAll,
  listAllTools,
  callTool,
  refreshTools,
  connectAllEnabled,
} from "../src/lib/proxy";
import { addServer } from "../src/lib/registry";
import { getDb, closeDb } from "../src/lib/db";
import { getCachedTools } from "../src/lib/registry";
import type { McpServerEntry } from "../src/types";

function clearDb() {
  const db = getDb();
  db.exec("DELETE FROM tool_cache");
  db.exec("DELETE FROM servers");
}

function makeEntry(overrides?: Partial<McpServerEntry>): McpServerEntry {
  return {
    id: "test-server",
    name: "Test Server",
    description: null,
    command: "npx",
    args: ["-y", "test-mcp"],
    env: {},
    transport: "stdio",
    url: null,
    source: "local",
    enabled: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("proxy", () => {
  beforeEach(async () => {
    clearDb();
    // Need a server in DB for cacheTools foreign key
    addServer({ command: "npx", name: "test-server" });
    await disconnectAll();
    mockClose.mockClear();
    mockConnect.mockClear();
    mockListTools.mockClear();
    mockCallTool.mockClear();
  });

  afterAll(async () => {
    await disconnectAll();
    closeDb();
  });

  // ── connectToServer ──

  describe("connectToServer", () => {
    it("refuses to launch stdio servers without explicit local command consent", async () => {
      const entry = makeEntry();
      await expect(connectToServer(entry)).rejects.toThrow(/local stdio command approval is required/i);
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it("connects and returns tools", async () => {
      const entry = makeEntry();
      const conn = await connectToServer(entry, { localCommandConsent: { approved: true, source: "test" } });
      expect(conn.entry).toBe(entry);
      expect(conn.tools).toHaveLength(2);
      expect(conn.tools[0].name).toBe("echo");
      expect(conn.tools[0].server_id).toBe("test-server");
      expect(conn.tools[1].name).toBe("greet");
      expect(mockConnect).toHaveBeenCalledTimes(1);
      expect(mockListTools).toHaveBeenCalledTimes(1);
    });

    it("caches tools in database", async () => {
      const entry = makeEntry();
      await connectToServer(entry, { localCommandConsent: { approved: true, source: "test" } });
      const cached = getCachedTools("test-server");
      expect(cached).toHaveLength(2);
      expect(cached[0].name).toBe("echo");
    });

    it("returns existing connection for same server", async () => {
      const entry = makeEntry();
      const conn1 = await connectToServer(entry, { localCommandConsent: { approved: true, source: "test" } });
      const conn2 = await connectToServer(entry);
      expect(conn1).toBe(conn2);
      expect(mockConnect).toHaveBeenCalledTimes(1); // only called once
    });

    it("uses SSE transport when specified", async () => {
      addServer({ command: "node", name: "sse-server" });
      const entry = makeEntry({
        id: "sse-server",
        transport: "sse",
        url: "http://localhost:3000",
      });
      const conn = await connectToServer(entry);
      expect(conn.tools).toHaveLength(2);
    });

    it("uses StreamableHTTP transport when specified", async () => {
      addServer({ command: "node", name: "http-server" });
      const entry = makeEntry({
        id: "http-server",
        transport: "streamable-http",
        url: "http://localhost:3000",
      });
      const conn = await connectToServer(entry);
      expect(conn.tools).toHaveLength(2);
    });
  });

  // ── disconnectServer ──

  describe("disconnectServer", () => {
    it("disconnects a connected server", async () => {
      const entry = makeEntry();
      await connectToServer(entry, { localCommandConsent: { approved: true, source: "test" } });
      await disconnectServer("test-server");
      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it("is a no-op for non-connected server", async () => {
      await expect(disconnectServer("non-existent")).resolves.toBeUndefined();
    });
  });

  // ── disconnectAll ──

  describe("disconnectAll", () => {
    it("disconnects all connected servers", async () => {
      addServer({ command: "npx", name: "server-a" });
      addServer({ command: "npx", name: "server-b" });

      await connectToServer(makeEntry({ id: "test-server" }), { localCommandConsent: { approved: true, source: "test" } });
      await connectToServer(makeEntry({ id: "server-a", name: "A" }), { localCommandConsent: { approved: true, source: "test" } });
      await connectToServer(makeEntry({ id: "server-b", name: "B" }), { localCommandConsent: { approved: true, source: "test" } });

      await disconnectAll();
      expect(mockClose).toHaveBeenCalledTimes(3);
    });
  });

  // ── listAllTools ──

  describe("listAllTools", () => {
    it("returns empty array when no connections", () => {
      const tools = listAllTools();
      expect(tools).toEqual([]);
    });

    it("returns tools prefixed with server ID", async () => {
      await connectToServer(makeEntry(), { localCommandConsent: { approved: true, source: "test" } });
      const tools = listAllTools();
      expect(tools).toHaveLength(2);
      expect(tools[0].name).toBe("test-server__echo");
      expect(tools[1].name).toBe("test-server__greet");
    });

    it("aggregates tools from multiple servers", async () => {
      addServer({ command: "npx", name: "server-x" });
      await connectToServer(makeEntry(), { localCommandConsent: { approved: true, source: "test" } });
      await connectToServer(makeEntry({ id: "server-x", name: "X" }), { localCommandConsent: { approved: true, source: "test" } });
      const tools = listAllTools();
      expect(tools).toHaveLength(4);
    });
  });

  // ── callTool ──

  describe("callTool", () => {
    it("calls the correct tool on the correct server", async () => {
      await connectToServer(makeEntry(), { localCommandConsent: { approved: true, source: "test" } });
      const result = await callTool("test-server__echo", { msg: "hi" });
      expect(result.content).toHaveLength(1);
      expect(result.content[0].text).toBe("result");
      expect(mockCallTool).toHaveBeenCalledTimes(1);
    });

    it("throws for invalid tool name format (no separator)", async () => {
      await expect(callTool("invalidname", {})).rejects.toThrow(
        'Invalid tool name "invalidname"'
      );
    });

    it("throws for disconnected server", async () => {
      await expect(callTool("ghost__tool", {})).rejects.toThrow(
        'Server "ghost" is not connected'
      );
    });
  });

  // ── refreshTools ──

  describe("refreshTools", () => {
    it("refreshes tools for a connected server", async () => {
      await connectToServer(makeEntry(), { localCommandConsent: { approved: true, source: "test" } });
      mockListTools.mockClear();
      const tools = await refreshTools("test-server");
      expect(tools).toHaveLength(2);
      expect(mockListTools).toHaveBeenCalledTimes(1);
    });

    it("throws for non-connected server", async () => {
      await expect(refreshTools("ghost")).rejects.toThrow(
        'Server "ghost" is not connected'
      );
    });
  });

  // ── connectAllEnabled ──

  describe("connectAllEnabled", () => {
    it("connects to all enabled servers", async () => {
      // test-server is already added and enabled from beforeEach
      const results = await connectAllEnabled({ localCommandConsent: { approved: true, source: "test" } });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("skips disabled servers", async () => {
      clearDb();
      addServer({ command: "npx", name: "enabled-one" });
      addServer({ command: "npx", name: "disabled-one" });
      const { disableServer } = await import("../src/lib/registry");
      disableServer("disabled-one");

      await disconnectAll();
      mockConnect.mockClear();

      const results = await connectAllEnabled({ localCommandConsent: { approved: true, source: "test" } });
      // Only the enabled one should be connected
      expect(results).toHaveLength(1);
    });
  });
});
