import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { closeDatabase } from "../db/database.js";

const TEST_PORT = 18878;

describe("signatures MCP HTTP transport", () => {
  let server: ReturnType<typeof Bun.serve> | undefined;

  afterEach(() => {
    server?.stop(true);
    server = undefined;
    closeDatabase();
    delete process.env.SIGNATURES_DB_PATH;
  });

  test("initializes and lists signature tools over Streamable HTTP", async () => {
    process.env.SIGNATURES_DB_PATH = ":memory:";
    const { buildServer } = await import("./index.js");
    const { startMcpHttpServer } = await import("./http.js");

    server = startMcpHttpServer({
      name: "signatures",
      port: TEST_PORT,
      buildServer,
    });

    const client = new Client({ name: "signatures-http-test", version: "0.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${TEST_PORT}/mcp`),
    );

    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.some((tool) => tool.name === "signatures_document_list")).toBe(true);
    await client.close();
  });
});
