import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createLoopsMcpServer, LOOPS_MCP_TOOLS } from "./index.js";

/**
 * Golden wire-contract test: snapshots every registered MCP tool name plus its
 * JSON schema. Any wire-breaking change (renamed tool, removed alias, changed
 * or retyped parameter) fails here until the golden file is deliberately
 * regenerated with:
 *
 *   LOOPS_UPDATE_GOLDEN=1 bun test src/mcp/golden-schema.test.ts
 */
const GOLDEN_PATH = join(import.meta.dir, "tool-schemas.golden.json");

interface WireTool {
  name: string;
  inputSchema: unknown;
}

async function listWireTools(): Promise<WireTool[]> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createLoopsMcpServer();
  const client = new Client({ name: "loops-golden-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const listed = await client.listTools();
    return listed.tools
      .map((tool) => ({ name: tool.name, inputSchema: tool.inputSchema as unknown }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } finally {
    await client.close();
    await server.close();
  }
}

describe("MCP golden tool schemas", () => {
  test("tool names and JSON schemas match the checked-in golden file", async () => {
    const actual = await listWireTools();
    if (process.env.LOOPS_UPDATE_GOLDEN === "1") {
      writeFileSync(GOLDEN_PATH, `${JSON.stringify(actual, null, 2)}\n`);
    }
    const golden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as WireTool[];
    expect(actual.map((tool) => tool.name)).toEqual(golden.map((tool) => tool.name));
    expect(actual).toEqual(golden);
  });

  test("every canonical tool and alias from LOOPS_MCP_TOOLS is registered on the wire", async () => {
    const registered = new Set((await listWireTools()).map((tool) => tool.name));
    for (const tool of LOOPS_MCP_TOOLS) {
      expect(registered.has(tool.name)).toBe(true);
      for (const alias of tool.aliases ?? []) {
        expect(registered.has(alias)).toBe(true);
      }
    }
  });
});
