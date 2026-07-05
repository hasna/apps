import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildServer } from "./index.js";
import { handleMcpRequest, resolveMcpHttpPort, DEFAULT_MCP_HTTP_PORT } from "./http.js";

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

  test("MCP exposes storage diagnostics without configured values", async () => {
    const originalStorageMode = process.env["HASNA_PROMPTS_STORAGE_MODE"];
    const originalPostgres = process.env["PROMPTS_REGISTRY_POSTGRES_URL"];
    const originalBucket = process.env["PROMPTS_REGISTRY_S3_BUCKET"];
    const originalRegion = process.env["PROMPTS_REGISTRY_AWS_REGION"];
    process.env["HASNA_PROMPTS_STORAGE_MODE"] = "remote";
    process.env["PROMPTS_REGISTRY_POSTGRES_URL"] = "configured-postgres-url";
    process.env["PROMPTS_REGISTRY_S3_BUCKET"] = "configured-bucket";
    process.env["PROMPTS_REGISTRY_AWS_REGION"] = "configured-region";

    const client = new Client({ name: "prompts-storage-test", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`),
    );
    try {
      await client.connect(transport);
      const result = await client.callTool({ name: "prompts_storage_diagnostics", arguments: {} });
      expect(result.isError).not.toBe(true);
      const content = result.content as Array<{ type: string; text: string }> | undefined;
      const text = content?.[0]?.text ?? "";
      const diagnostics = JSON.parse(text) as {
        requested_mode: string;
        active_storage: string;
        registry_state: string;
        sync: { remote_mutation: boolean };
      };

      expect(diagnostics.requested_mode).toBe("remote");
      expect(diagnostics.active_storage).toBe("local-sqlite");
      expect(diagnostics.registry_state).toBe("remote-configured-local-fallback");
      expect(diagnostics.sync.remote_mutation).toBe(false);
      expect(text).not.toContain("configured-postgres-url");
      expect(text).not.toContain("configured-bucket");
      expect(text).not.toContain("configured-region");
    } finally {
      restoreEnv("HASNA_PROMPTS_STORAGE_MODE", originalStorageMode);
      restoreEnv("PROMPTS_REGISTRY_POSTGRES_URL", originalPostgres);
      restoreEnv("PROMPTS_REGISTRY_S3_BUCKET", originalBucket);
      restoreEnv("PROMPTS_REGISTRY_AWS_REGION", originalRegion);
      await client.close();
    }
  });
});

describe("prompts buildServer", () => {
  test("registers tools for stdio and HTTP modes", () => {
    expect(buildServer()).toBeDefined();
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
