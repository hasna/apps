import { afterEach, beforeEach, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mcpTestRequestInit, startTestMcpHttpServer } from "../test-support/mcp-http.js";
import { startV1Stub } from "../test-support/v1-stub.js";
import { buildServer } from "./server.js";

const pathSettings = ["EMAILS_DB_PATH", "HASNA_EMAILS_DB_PATH"];
let previous: Record<string, string | undefined>, home: string;
beforeEach(() => {
  previous = Object.fromEntries([...pathSettings, "HASNA_EMAILS_HOME", "EMAILS_HOME"].map(key => [key, process.env[key]]));
  for (const key of pathSettings) delete process.env[key];
  home = mkdtempSync(join(tmpdir(), "emails-mcp-api-only-"));
  process.env.HASNA_EMAILS_HOME = home;
  process.env.EMAILS_HOME = home;
});
afterEach(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(home, { recursive: true, force: true });
});

for (const setting of pathSettings) {
  test(`MCP construction rejects ${setting} before opening a database`, () => {
    const file = join(home, "mail.db");
    process.env[setting] = file;
    expect(() => buildServer()).toThrow("authenticated Emails API");
    expect(existsSync(file)).toBe(false);
    process.env[setting] = ":memory:";
    expect(() => buildServer()).toThrow("authenticated Emails API");
  });
}

test("MCP HTTP sends and reads through the authenticated API without a local database", async () => {
  const api = await startV1Stub();
  api.applyEnv();
  const server = startTestMcpHttpServer();
  const client = new Client({ name: "emails-api-mcp-fixture", version: "1.0.0" }, { capabilities: {} });
  try {
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), mcpTestRequestInit());
    await client.connect(transport, { timeout: 10000 });
    const sent = await client.callTool({ name: "send_email", arguments: {
      from: "sender@example.test", to: ["recipient@example.test"], subject: "API MCP wire fixture", text: "synthetic message",
      idempotency_key: "api-mcp-wire-fixture",
    } }, undefined, { timeout: 10000 });
    expect(sent.isError).not.toBe(true);
    const first = sent.content[0];
    expect(first?.type).toBe("text");
    expect(JSON.parse(first?.type === "text" ? String(first.text) : "{}")).toMatchObject({ success: true });
    const rows = await api.list("messages");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ direction: "outbound", subject: "API MCP wire fixture" });
    const listed = await client.callTool({ name: "list_emails", arguments: { limit: 10 } }, undefined, { timeout: 10000 });
    expect(listed.isError).not.toBe(true);
    expect(JSON.stringify(listed.content)).toContain("API MCP wire fixture");
    expect(existsSync(join(home, "emails.db"))).toBe(false);
  } finally {
    await client.close(); server.stop(true); api.clearEnv(); api.stop();
  }
}, 20000);
