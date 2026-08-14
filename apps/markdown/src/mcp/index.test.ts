import { afterAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer } from "./server.js";
import { DEFAULT_HTTP_PORT, HTTP_NAME, isHttpMode, resolveHttpPort, startHttpServer } from "./http.js";
import { getMcpHelpText, handleMcpCliArgs } from "./index.js";

let httpServer: ReturnType<typeof startHttpServer> | undefined;
let httpPort = 0;
const tempDirs: string[] = [];

function runMcp(args: string[]) {
  return Bun.spawnSync({
    cmd: ["bun", "run", "src/mcp/index.ts", ...args],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });
}

function makeLargeDoc(count: number = 25) {
  const cards = Array.from({ length: count }, (_, index) => `type: custom
id: card-${index}
note: ${index}

Card ${index}.`);
  return `# LargeMcp\n\n---\n\n${cards.join("\n\n---\n\n")}`;
}

function firstText(result: Awaited<ReturnType<Client["callTool"]>>) {
  return (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
}

describe("mcp CLI flags", () => {
  test("prints help and exits when --help is used", () => {
    const out: string[] = [];
    const handled = handleMcpCliArgs(["--help"], (msg) => out.push(msg));

    expect(handled).toBe(true);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(getMcpHelpText());
    expect(out[0]).toContain("Usage: markdown-mcp [options]");
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

  test("exits nonzero when startup args are invalid", () => {
    const result = runMcp(["--port", "123abc"]);
    const stderr = Buffer.from(result.stderr).toString("utf8");

    expect(result.exitCode).not.toBe(0);
    expect(stderr).toContain("Invalid port: 123abc");
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
    expect(tools.tools.map((tool) => tool.name)).toContain("storage_status");

    await client.close();
    await server.close();
  });

  test("send_feedback stores feedback with machine identity in local storage", async () => {
    const originalDir = process.env.HASNA_MARKDOWN_DIR;
    const originalMachine = process.env.HASNA_MARKDOWN_MACHINE_ID;
    const dir = mkdtempSync(join(tmpdir(), "open-markdown-mcp-"));
    tempDirs.push(dir);
    process.env.HASNA_MARKDOWN_DIR = dir;
    process.env.HASNA_MARKDOWN_MACHINE_ID = "mcp-machine-1";

    try {
      const server = buildServer("0.0.0-test");
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "feedback-test", version: "0.0.1" });

      await server.connect(serverTransport);
      await client.connect(clientTransport);

      const feedback = await client.callTool({
        name: "send_feedback",
        arguments: { message: "MCP feedback", category: "bug" },
      });
      const payload = JSON.parse((feedback.content as Array<{ type: string; text: string }>)[0].text) as { machine_id: string };
      expect(payload.machine_id).toBe("mcp-machine-1");

      const status = await client.callTool({ name: "storage_status", arguments: {} });
      const statusPayload = JSON.parse((status.content as Array<{ type: string; text: string }>)[0].text) as { machineId: string; runtimeStorage: string };
      expect(statusPayload.machineId).toBe("mcp-machine-1");
      expect(statusPayload.runtimeStorage).toBe("local-sqlite");

      await client.close();
      await server.close();
    } finally {
      if (originalDir === undefined) delete process.env.HASNA_MARKDOWN_DIR;
      else process.env.HASNA_MARKDOWN_DIR = originalDir;

      if (originalMachine === undefined) delete process.env.HASNA_MARKDOWN_MACHINE_ID;
      else process.env.HASNA_MARKDOWN_MACHINE_ID = originalMachine;
    }
  });

  test("markdown inspect and compile are compact by default with json opt-in", async () => {
    const server = buildServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "compact-test", version: "0.0.1" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const inspect = await client.callTool({
      name: "markdown_inspect",
      arguments: { content: makeLargeDoc(), limit: 3 },
    });
    const inspectText = firstText(inspect);
    expect(inspectText).toContain("Cards: 25");
    expect(inspectText).toContain("... 22 more cards not shown");
    expect(inspectText.trim().startsWith("{")).toBe(false);

    const inspectJson = await client.callTool({
      name: "markdown_inspect",
      arguments: { content: makeLargeDoc(), json: true },
    });
    const inspectPayload = JSON.parse(firstText(inspectJson)) as { cards: unknown[]; executionPlan: { steps: unknown[] } };
    expect(inspectPayload.cards).toHaveLength(25);
    expect(Array.isArray(inspectPayload.executionPlan.steps)).toBe(true);

    const compile = await client.callTool({
      name: "markdown_compile",
      arguments: { content: makeLargeDoc(), limit: 1 },
    });
    const compileText = firstText(compile);
    expect(compileText).toContain("Execution Plan:");
    expect(compileText).toContain("Hint: use --verbose");
    expect(compileText.trim().startsWith("{")).toBe(false);

    await client.close();
    await server.close();
  });

  test("list_agents is compact by default with json opt-in", async () => {
    const server = buildServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "agents-test", version: "0.0.1" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    await client.callTool({ name: "register_agent", arguments: { name: "agent-one" } });
    await client.callTool({ name: "register_agent", arguments: { name: "agent-two" } });

    const compact = await client.callTool({ name: "list_agents", arguments: { limit: 1 } });
    const compactText = firstText(compact);
    expect(compactText).toContain("Agents:");
    expect(compactText).toContain("... 1 more agents not shown");
    expect(compactText.trim().startsWith("[")).toBe(false);

    const json = await client.callTool({ name: "list_agents", arguments: { json: true } });
    const agents = JSON.parse(firstText(json)) as Array<{ name: string }>;
    expect(agents.map((agent) => agent.name)).toContain("agent-one");

    await client.close();
    await server.close();
  });

  test("resolves HTTP mode and default port", () => {
    expect(isHttpMode(["--http"])).toBe(true);
    expect(resolveHttpPort([])).toBe(DEFAULT_HTTP_PORT);
    expect(HTTP_NAME).toBe("markdown");
  });

  test("rejects malformed HTTP port values", () => {
    expect(() => resolveHttpPort(["--port", "123abc"])).toThrow("Invalid port: 123abc");
    expect(() => resolveHttpPort(["--port=3.5"])).toThrow("Invalid port: 3.5");
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

  test("returns 400 for malformed MCP HTTP JSON bodies", async () => {
    const server = startHttpServer({ port: 0, host: "127.0.0.1" });
    await Bun.sleep(100);
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      });

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        jsonrpc: "2.0",
        error: { code: -32700, message: "Parse error: Invalid JSON" },
        id: null,
      });
    } finally {
      server.close();
    }
  });

  test("handles MCP initialize and tool call over Streamable HTTP", async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${httpPort}/mcp`));
    const client = new Client({ name: "http-test", version: "0.0.1" });
    await client.connect(transport);

    const result = await client.callTool({
      name: "markdown_validate",
      arguments: { content: "# Test\n\n```task id=t1\nDo thing\n```", json: true },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text;
    expect(JSON.parse(text)).toMatchObject({ valid: expect.any(Boolean), cards: expect.any(Number) });

    await client.close();
  });

  test("markdown validate defaults to compact text", async () => {
    const server = buildServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "validate-compact-test", version: "0.0.1" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: "markdown_validate",
      arguments: { content: makeLargeDoc(), limit: 1 },
    });
    const text = firstText(result);
    expect(text).toContain("Document is valid");
    expect(text).toContain("25 cards");
    expect(text.trim().startsWith("{")).toBe(false);

    await client.close();
    await server.close();
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
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});
