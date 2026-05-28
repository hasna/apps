import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createServer, type Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildServer, MCP_NAME } from "./server.js";
import { handleMcpHttpRoutes, healthPayload, startMcpHttpServer } from "./http.js";

let httpServer: Server;
let port: number;

beforeAll(async () => {
  process.env["REPOS_DB_PATH"] = ":memory:";
  httpServer = startMcpHttpServer({ port: 0 });
  await new Promise<void>((resolve) => {
    httpServer.once("listening", () => resolve());
  });
  const address = httpServer.address();
  port = typeof address === "object" && address ? address.port : 0;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    httpServer.close((err) => (err ? reject(err) : resolve()));
  });
  delete process.env["REPOS_DB_PATH"];
});

describe("MCP HTTP transport", () => {
  it("GET /health returns 200 with service name", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(healthPayload());
  });

  it("performs initialize + tool call over Streamable HTTP", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
    );
    const client = new Client({ name: "repos-http-test", version: "1.0.0" });
    await client.connect(transport);

    const result = await client.callTool({ name: "get_stats", arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.content?.[0]?.type).toBe("text");

    await client.close();
  });

  it("handleMcpHttpRoutes mounts /health for Bun.serve reuse", async () => {
    const res = await handleMcpHttpRoutes(new Request("http://127.0.0.1/health"));
    expect(res?.status).toBe(200);
    expect(await res!.json()).toEqual(healthPayload());
  });

  it("buildServer registers tools for stdio mode", () => {
    const server = buildServer();
    expect(server).toBeDefined();
    expect(MCP_NAME).toBe("repos");
  });
});
