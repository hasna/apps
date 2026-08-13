import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ActionsClient } from "../index.js";
import { JsonActionsStore } from "../storage.js";
import { createServer } from "./index.js";
import { TOOLS } from "./tools.js";

describe("MCP server registration", () => {
  test("exposes every tool over a live transport", async () => {
    const dir = mkdtempSync(join(tmpdir(), "actions-mcp-server-"));
    try {
      const server = createServer({ deps: { client: new ActionsClient({ store: new JsonActionsStore(dir) }) } });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "test", version: "0.0.0" });
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

      try {
        const listed = await client.listTools();
        expect(listed.tools.map((tool) => tool.name).sort()).toEqual(TOOLS.map((tool) => tool.name).sort());

        const called = await client.callTool({ name: "actions_list_manifests", arguments: {} });
        const content = called.content as Array<{ type: string; text: string }>;
        expect(called.isError).toBeFalsy();
        expect(JSON.parse(content[0]!.text)).toMatchObject({ items: [], page: { total: 0 } });
      } finally {
        await client.close();
        await server.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
