import { afterAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { buildServer } from "./server.js";
import { DEFAULT_HTTP_PORT, HTTP_NAME, isHttpMode, resolveHttpPort, startHttpServer } from "./http.js";
import { getMcpHelpText, handleMcpCliArgs } from "./index.js";

let httpServer: ReturnType<typeof startHttpServer> | undefined;
let httpPort = 0;

describe("mcp CLI flags", () => {
  test("prints help and exits when --help is used", () => {
    const out: string[] = [];
    const handled = handleMcpCliArgs(["--help"], (msg) => out.push(msg));

    expect(handled).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(getMcpHelpText());
    expect(out[0]).toContain("Usage: omp-mcp [options]");
    expect(out[0]).toContain("--http");
  });

  test("prints version and exits when --version is used", () => {
    const out: string[] = [];
    const handled = handleMcpCliArgs(["--version"], (msg) => out.push(msg));

    expect(handled).toBe(true);
    expect(out[0]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("does not handle unrelated args", () => {
    const out: string[] = [];
    const handled = handleMcpCliArgs(["--stdio"], (msg) => out.push(msg));

    expect(handled).toBe(false);
    expect(out).toHaveLength(0);
  });
});

describe("MCP HTTP transport", () => {
  test("stdio mode still builds and registers tools", async () => {
    const server = buildServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "stdio-test", version: "0.0.1" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toContain("markdown_validate");
    expect(tools.tools.map((tool) => tool.name)).toContain("list_agents");

    await client.close();
    await server.close();
  });

  test("resolves HTTP mode and default port", () => {
    expect(isHttpMode(["--http"])).toBe(true);
    expect(resolveHttpPort([])).toBe(DEFAULT_HTTP_PORT);
    expect(HTTP_NAME).toBe("markdown");
  });

  test("GET /health returns ok", async () => {
    httpServer = startHttpServer({ port: 0, host: "127.0.0.1" });
    await Bun.sleep(100);
    const address = httpServer.address();
    httpPort = typeof address === "object" && address ? address.port : 0;

    const res = await fetch(`http://127.0.0.1:${httpPort}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", name: "markdown" });
  });

  test("handles MCP initialize and tool call over Streamable HTTP", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${httpPort}/mcp`));
    const client = new Client({ name: "http-test", version: "0.0.1" });
    await client.connect(transport);

    const result = await client.callTool({
      name: "markdown_validate",
      arguments: { content: "# Test\n\n```task id=t1\nDo thing\n```" },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(JSON.parse(text)).toMatchObject({ valid: expect.any(Boolean), cards: expect.any(Number) });

    await client.close();
  });

  test("serves multiple concurrent HTTP clients from one process", async () => {
    const clients = await Promise.all(
      Array.from({ length: 3 }, async (_, index) => {
        const transport = new StreamableHTTPClientTransport(
          new URL(`http://127.0.0.1:${httpPort}/mcp`)
        );
        const client = new Client({ name: `http-test-${index}`, version: "0.0.1" });
        await client.connect(transport);
        return client;
      })
    );

    const results = await Promise.all(
      clients.map((client) => client.callTool({ name: "list_agents", arguments: {} }))
    );

    expect(results).toHaveLength(3);
    await Promise.all(clients.map((client) => client.close()));
  });
});

afterAll(() => {
  httpServer?.close();
});
