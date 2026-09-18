import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { closeDatabase } from "../db/database.js";
import { createMessage } from "../db/messages.js";
import { createCall } from "../db/calls.js";

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

  test("local call tool pages progress across 45 rows without overlap", async () => {
    const home = mkdtempSync(join(tmpdir(), "telephony-mcp-calls-")); roots.push(home);
    const dbPath = join(home, "telephony.db"); process.env.HASNA_TELEPHONY_DB_PATH = dbPath;
    for (let i = 0; i < 45; i += 1) createCall({ direction: "inbound", from_number: `+1000000${String(i).padStart(4, "0")}`, to_number: "+12222222222" });
    closeDatabase(); delete process.env.HASNA_TELEPHONY_DB_PATH;
    const transport = new StdioClientTransport({ command: "bun", args: ["run", new URL("./index.ts", import.meta.url).pathname], env: { PATH: process.env.PATH ?? "", HOME: home, HASNA_HOME: join(home, ".hasna"), HASNA_TELEPHONY_LOCAL: "1", HASNA_TELEPHONY_DB_PATH: dbPath }, stderr: "pipe" });
    const client = new Client({ name: "telephony-call-page-test", version: "1" });
    try {
      await client.connect(transport);
      const read = async (cursor: number) => {
        const result = await client.callTool({ name: "telephony_list_calls", arguments: { limit: 20, cursor } });
        return JSON.parse((result.content[0] as { text: string }).text) as { calls: Array<{ id: string }>; next_cursor: number | null };
      };
      const first = await read(0); const second = await read(20); const third = await read(40);
      expect(first.next_cursor).toBe(20); expect(second.next_cursor).toBe(40); expect(third.next_cursor).toBeNull();
      const ids = [...first.calls, ...second.calls, ...third.calls].map((call) => call.id);
      expect(first.calls).toHaveLength(20); expect(second.calls).toHaveLength(20); expect(third.calls).toHaveLength(5);
      expect(new Set(ids).size).toBe(45);
    } finally { await client.close(); }
  });

});
