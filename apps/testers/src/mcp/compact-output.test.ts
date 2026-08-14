process.env.TESTERS_DB_PATH = ":memory:";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { closeDatabase, resetDatabase } from "../db/database.js";
import { createResult, updateResult } from "../db/results.js";
import { createRun } from "../db/runs.js";
import { createScenario } from "../db/scenarios.js";
import { startMcpHttpServer } from "./http.js";
import { buildServer } from "./server.js";

let httpServer: Awaited<ReturnType<typeof startMcpHttpServer>> | undefined;

async function callTool(name: string, args: Record<string, unknown>) {
  httpServer = await startMcpHttpServer({
    name: "testers",
    port: 0,
    createMcpServer: buildServer,
  });
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://${httpServer.host}:${httpServer.port}/mcp`),
  );
  const client = new Client({ name: "testers-compact-output-test", version: "1.0.0" }, { capabilities: {} });

  try {
    await client.connect(transport, { timeout: 15_000 });
    const result = await client.callTool(
      { name, arguments: args },
      undefined,
      { timeout: 15_000 },
    );
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    return JSON.parse(text);
  } finally {
    await transport.close();
  }
}

describe("MCP compact output", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(async () => {
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer!.server.close(() => resolve()));
      httpServer = undefined;
    }
    closeDatabase();
  });

  test("list_scenarios reports final offset page as not truncated", async () => {
    for (let index = 0; index < 25; index++) {
      createScenario({ name: `Scenario ${index}`, description: "compact MCP pagination" });
    }

    const payload = await callTool("list_scenarios", { limit: 20, offset: 20 });

    expect(payload.items).toHaveLength(5);
    expect(payload.total).toBe(25);
    expect(payload.returned).toBe(5);
    expect(payload.truncated).toBe(false);
    expect(payload.hint).toContain("Showing 21-25 of 25");
  });

  test("list_scenarios filters flaky scenarios before compact pagination", async () => {
    const flaky = createScenario({
      name: "Old flaky scenario beyond first compact page",
      description: "Should appear even when created before newer scenarios",
    });
    const run = createRun({ url: "https://example.test", model: "model-compact" });
    const result = createResult({
      runId: run.id,
      scenarioId: flaky.id,
      model: "model-compact",
      stepsTotal: 1,
    });
    updateResult(result.id, { status: "failed" });

    for (let index = 0; index < 24; index++) {
      createScenario({ name: `Newer normal scenario ${index}`, description: "No recent results" });
    }

    const payload = await callTool("list_scenarios", { flakyOnly: true, limit: 20 });

    expect(payload.total).toBe(1);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0].id).toBe(flaky.id);
  });
});
