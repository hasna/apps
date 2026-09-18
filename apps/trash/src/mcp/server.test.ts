import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTrashMcpServer } from "./server.js";
import { TrashApi } from "../client.js";
import { createSandbox, spawnEnv } from "../testing/sandbox.js";
import { existsSync } from "node:fs";

test("MCP exposes bounded metadata and reversible tools without permanent purge", async () => {
  let lastUrl = "";
  const api = new TrashApi({ env: { HASNA_TRASH_API_URL: "https://trash.example.test", HASNA_TRASH_API_KEY: "fixture-token" }, fetchImpl: async (url) => {
    lastUrl = url; return Response.json({ items: [], nextCursor: null });
  } });
  const server = createTrashMcpServer({ api });
  const client = new Client({ name: "proof", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(b); await client.connect(a);
    const tools = await client.listTools(); const names = tools.tools.map((tool) => tool.name);
    expect(names).toContain("trash_put"); expect(names).toContain("trash_backup"); expect(names).toContain("trash_recover");
    expect(names.some((name) => /purge|empty|delete/.test(name))).toBe(false);
    const result = await client.callTool({ name: "trash_list", arguments: { station: "station06" } });
    expect(result.isError).not.toBe(true); expect(JSON.stringify(result)).not.toContain("fixture-token");
    expect(new URL(lastUrl).searchParams.get("limit")).toBe("20");
    expect(new URL(lastUrl).searchParams.get("station")).toBe("station06");
    lastUrl = "";
    const denied = await client.callTool({ name: "trash_list", arguments: { limit: 101 } });
    expect(denied.isError).toBe(true); expect(lastUrl).toBe("");
  } finally { await client.close(); await server.close(); }
});
test("MCP failures redact arbitrary upstream text and expose fixed diagnostics", async () => {
  const api = new TrashApi({ env: { HASNA_TRASH_API_URL: "https://trash.example.test", HASNA_TRASH_API_KEY: "fixture-token" }, fetchImpl: async () => Response.json({ error: { code: "fixture-secret", message: "fixture-secret" } }, { status: 403 }) });
  const server = createTrashMcpServer({ api }); const client = new Client({ name: "proof", version: "1" }); const [a, b] = InMemoryTransport.createLinkedPair();
  try { await server.connect(b); await client.connect(a); const result = await client.callTool({ name: "trash_status", arguments: {} });
    expect(result.isError).toBe(true); expect(JSON.stringify(result)).not.toContain("fixture-secret");
  } finally { await client.close(); await server.close(); }
});
test("stdio accepts fragmented newline JSON-RPC and missing credentials fail closed without local state", async () => {
  const sandbox = createSandbox();
  const child = Bun.spawn({ cmd: [process.execPath, new URL("./index.ts", import.meta.url).pathname, "--stdio"], env: spawnEnv(sandbox, { HASNA_HOME: sandbox.path("hasna"), HASNA_TRASH_LOCAL: undefined }), stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const reader = child.stdout.getReader(); let buffer = "";
  async function receive() {
    while (!buffer.includes("\n")) { const part = await reader.read(); if (part.done) throw new Error("stdio ended"); buffer += new TextDecoder().decode(part.value); }
    const end = buffer.indexOf("\n"); const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); return JSON.parse(line);
  }
  try {
    const init = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fixture", version: "1" } } }) + "\n";
    child.stdin.write(init.slice(0, 19)); await child.stdin.flush(); await new Promise((resolve) => setTimeout(resolve, 15)); child.stdin.write(init.slice(19)); await child.stdin.flush();
    const initialized = await receive(); expect(initialized.id).toBe(1); expect(initialized.result.serverInfo.name).toBe("trash");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n" + JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "trash_status", arguments: {} } }) + "\n"); await child.stdin.flush();
    const failure = await receive(); expect(failure.id).toBe(2); expect(failure.result.isError).toBe(true); expect(existsSync(sandbox.path("hasna"))).toBe(false);
  } finally { child.kill(); await child.exited; reader.releaseLock(); sandbox.cleanup(); }
}, 10_000);
