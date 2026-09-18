import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("messages MCP compact output", () => {
  test("list schema exposes bounded controls and the default response is compact", async () => {
    const home = mkdtempSync(join(tmpdir(), "messages-mcp-compact-")); roots.push(home);
    const old = { HOME: process.env.HOME, HASNA_HOME: process.env.HASNA_HOME, HASNA_MESSAGES_LOCAL: process.env.HASNA_MESSAGES_LOCAL };
    process.env.HOME = home; process.env.HASNA_HOME = join(home, ".hasna"); process.env.HASNA_MESSAGES_LOCAL = "1";
    const { loadLocalMessagesService } = await import("../local-store-loader.js");
    const service = await loadLocalMessagesService(process.env);
    for (let i = 0; i < 45; i += 1) await service.registerAgent(`mcp-agent-${i}`, "d".repeat(200));
    if (old.HOME === undefined) delete process.env.HOME; else process.env.HOME = old.HOME;
    if (old.HASNA_HOME === undefined) delete process.env.HASNA_HOME; else process.env.HASNA_HOME = old.HASNA_HOME;
    if (old.HASNA_MESSAGES_LOCAL === undefined) delete process.env.HASNA_MESSAGES_LOCAL; else process.env.HASNA_MESSAGES_LOCAL = old.HASNA_MESSAGES_LOCAL;

    const transport = new StdioClientTransport({
      command: "bun",
      args: ["run", new URL("./index.ts", import.meta.url).pathname],
      env: { PATH: process.env.PATH ?? "", HOME: home, HASNA_HOME: join(home, ".hasna"), HASNA_MESSAGES_LOCAL: "1" },
      stderr: "pipe",
    });
    const client = new Client({ name: "messages-compact-test", version: "1" });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      const schema = tools.tools.find((tool) => tool.name === "messages_agents")?.inputSchema as { properties?: Record<string, unknown> };
      expect(schema.properties).toHaveProperty("limit");
      expect(schema.properties).toHaveProperty("cursor");
      expect(schema.properties).toHaveProperty("full");

      const compact = await client.callTool({ name: "messages_agents", arguments: {} }) as { content: Array<{ text: string }> };
      const payload = JSON.parse(compact.content[0]!.text);
      expect(payload.agents).toHaveLength(20);
      expect(payload.total).toBe(45);
      expect(payload.next_cursor).toBe(20);
      expect(Buffer.byteLength(compact.content[0]!.text)).toBeLessThan(8_000);

      const full = await client.callTool({ name: "messages_agents", arguments: { full: true } }) as { content: Array<{ text: string }> };
      expect(JSON.parse(full.content[0]!.text).agents).toHaveLength(45);
    } finally {
      await client.close();
    }
  });
});
