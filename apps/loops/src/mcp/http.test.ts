import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createLoopsMcpServer } from "./index.js";
import {
  DEFAULT_MCP_HTTP_PORT,
  isHttpMode,
  isStdioMode,
  resolveMcpHttpPort,
  startMcpHttpServer,
  type McpHttpServerHandle,
} from "./http.js";

describe("mcp http transport config", () => {
  test("defaults port to 8890 and honours overrides", () => {
    expect(DEFAULT_MCP_HTTP_PORT).toBe(8890);
    expect(resolveMcpHttpPort(["node"], {})).toBe(8890);
    expect(resolveMcpHttpPort(["node", "--port", "9101"], {})).toBe(9101);
    expect(resolveMcpHttpPort(["node"], { MCP_HTTP_PORT: "9102" })).toBe(9102);
  });

  test("mode detection reads flags and env", () => {
    expect(isHttpMode(["node"], {})).toBe(false);
    expect(isHttpMode(["node", "--http"], {})).toBe(true);
    expect(isHttpMode(["node"], { MCP_HTTP: "1" })).toBe(true);
    expect(isStdioMode(["node"], {})).toBe(false);
    expect(isStdioMode(["node", "--stdio"], {})).toBe(true);
    expect(isStdioMode(["node"], { MCP_STDIO: "1" })).toBe(true);
  });
});

describe("mcp streamable http server", () => {
  let handle: McpHttpServerHandle;

  beforeAll(async () => {
    // Port 0 => OS-assigned free port, so the test never collides with a
    // running loops daemon or the fixed fleet port.
    handle = await startMcpHttpServer(() => createLoopsMcpServer(), { port: 0 });
  });

  afterAll(async () => {
    await handle?.close();
  });

  test("GET /health reports the loops service", async () => {
    const res = await fetch(`http://${handle.host}:${handle.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", name: "loops" });
  });

  test("serves loops tools over Streamable HTTP", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://${handle.host}:${handle.port}/mcp`),
    );
    const client = new Client({ name: "loops-http-test", version: "0.0.0" });
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "loops_list")).toBe(true);
    await client.close();
  });
});
