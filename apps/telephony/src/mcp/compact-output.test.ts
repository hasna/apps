import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { closeDatabase } from "../db/database.js";
import { createMessage } from "../db/messages.js";

const roots: string[] = [];
afterEach(() => { closeDatabase(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("telephony MCP compact output", () => {
  test("message lists are bounded and compact by default", async () => {
    const home = mkdtempSync(join(tmpdir(), "telephony-mcp-compact-")); roots.push(home);
    const dbPath = join(home, "telephony.db"); process.env.HASNA_TELEPHONY_DB_PATH = dbPath;
    for (let i = 0; i < 75; i += 1) createMessage({ type: "sms_inbound", from_number: "+10000000000", to_number: "+12222222222", body: "b".repeat(500), status: "received" });
    closeDatabase(); delete process.env.HASNA_TELEPHONY_DB_PATH;
    const transport = new StdioClientTransport({ command: "bun", args: ["run", new URL("./index.ts", import.meta.url).pathname], env: { PATH: process.env.PATH ?? "", HOME: home, HASNA_HOME: join(home, ".hasna"), HASNA_TELEPHONY_LOCAL: "1", HASNA_TELEPHONY_DB_PATH: dbPath }, stderr: "pipe" });
    const client = new Client({ name: "telephony-compact-test", version: "1" });
    try {
      await client.connect(transport);
      const compact = await client.callTool({ name: "telephony_list_messages", arguments: {} });
      const payload = JSON.parse((compact.content[0] as { text: string }).text);
      expect(payload.messages).toHaveLength(20);
      expect(payload.next_cursor).toBe(20);
      expect(payload.messages[0].metadata).toBeUndefined();
      expect(Buffer.byteLength((compact.content[0] as { text: string }).text)).toBeLessThan(12_000);
    } finally { await client.close(); }
  });
});
