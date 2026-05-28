import { afterEach, describe, expect, it, mock } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { buildServer } from "./server.js";
import { DEFAULT_MCP_HTTP_PORT, MCP_NAME, startHttpServer } from "./http.js";

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: mock(async () => ({
        content: [{ type: "text", text: "REASONING: Looks good.\nVERDICT: PASS" }],
        usage: { input_tokens: 50, output_tokens: 20 },
      })),
    };
  },
}));

const servers: Array<ReturnType<typeof startHttpServer>> = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
  const { closeDatabase } = await import("../db/store.js");
  closeDatabase();
  delete process.env["EVALS_DB_PATH"];
});

describe("evals-mcp HTTP transport", () => {
  it("exposes health and serves MCP over Streamable HTTP", async () => {
    process.env["EVALS_DB_PATH"] = ":memory:";

    const server = startHttpServer({ port: 0, log: () => {} });
    servers.push(server);

    const baseUrl = `http://127.0.0.1:${server.port}`;
    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok", name: MCP_NAME });

    const client = new Client({ name: "evals-mcp-http-test", version: "1.0.0" }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));

    try {
      await client.connect(transport, { timeout: 10_000 });

      const tools = await client.listTools(undefined, { timeout: 10_000 });
      expect(tools.tools.some((tool) => tool.name === "evals_judge")).toBe(true);

      const judged = await client.callTool(
        {
          name: "evals_judge",
          arguments: {
            input: "What is 2+2?",
            output: "4",
            rubric: "Must answer 4",
          },
        },
        undefined,
        { timeout: 10_000 },
      ) as { content: Array<{ type: string; text?: string }> };
      expect(judged.content[0]?.type).toBe("text");
      const judgedText = judged.content[0]?.type === "text" ? judged.content[0].text : "";
      expect(judgedText).toContain("PASS");
    } finally {
      await client.close();
    }
  });

  it("uses the assigned default port constant", () => {
    expect(DEFAULT_MCP_HTTP_PORT).toBe(8817);
  });
});

describe("evals-mcp buildServer", () => {
  it("registers tools for stdio and HTTP modes", () => {
    const server = buildServer();
    expect(server).toBeTruthy();
  });
});
