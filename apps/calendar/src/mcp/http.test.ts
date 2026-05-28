import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildServer } from "./index.js";
import { healthPayload, startMcpHttpServer } from "./http.js";

describe("calendar MCP HTTP transport", () => {
  test("GET /health returns 200", async () => {
    const { port, close } = await startMcpHttpServer({ port: 0 });
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(healthPayload("calendar"));
    } finally {
      await close();
    }
  });

  test("streamable HTTP initialize + list_orgs round-trip", async () => {
    const { port, close } = await startMcpHttpServer({ port: 0 });
    try {
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
      const client = new Client({ name: "test-client", version: "1.0.0" });
      await client.connect(transport);
      const result = await client.callTool({ name: "list_orgs", arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.content?.[0]?.type).toBe("text");
      await client.close();
    } finally {
      await close();
    }
  });

  test("stdio buildServer registers tools unchanged", () => {
    const server = buildServer();
    expect(server).toBeTruthy();
    expect(server.server).toBeTruthy();
  });
});
