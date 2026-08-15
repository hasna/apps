import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { registerWebhookTools } from "./webhooks";
import { _resetConfigCache } from "../../lib/webhooks.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_CONFIG_DIR = join(tmpdir(), `conversations-test-webhook-tools-${Date.now()}`);
const TEST_CONFIG_PATH = join(TEST_CONFIG_DIR, "config.json");

describe("webhook MCP tools", () => {
  let client: Client;

  beforeAll(async () => {
    mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    process.env.CONVERSATIONS_CONFIG_PATH = TEST_CONFIG_PATH;

    const server = new McpServer({ name: "test-webhooks", version: "0.0.1" });
    registerWebhookTools(server);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    delete process.env.CONVERSATIONS_CONFIG_PATH;
    try { rmSync(TEST_CONFIG_DIR, { recursive: true, force: true }); } catch {}
    await client.close();
  });

  beforeEach(() => {
    try { rmSync(TEST_CONFIG_PATH, { force: true }); } catch {}
  });

  function parseResult(result: { content: unknown[] }): unknown {
    const text = (result.content[0] as { type: string; text: string }).text;
    try { return JSON.parse(text); } catch { return text; }
  }

  describe("get_webhooks", () => {
    test("returns no webhooks when none configured", async () => {
      const result = await client.callTool({ name: "get_webhooks", arguments: {} });
      expect(parseResult(result as any)).toBe("No webhooks configured.");
    });

    test("returns configured webhooks", async () => {
      writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
        webhooks: [{ url: "https://example.com/hook", events: ["dm"], agent: "bob" }],
      }));
      _resetConfigCache();
      const result = parseResult(await client.callTool({ name: "get_webhooks", arguments: {} }) as any) as string;
      expect(result).toContain("https://example.com/hook");
    });
  });

  describe("add_webhook", () => {
    test("adds a webhook successfully", async () => {
      const result = parseResult(await client.callTool({
        name: "add_webhook",
        arguments: { url: "https://example.com/hook", events: ["dm"] },
      }) as any) as any;
      expect(result).toContain("Webhook added");
    });

    test("prevents duplicate webhooks", async () => {
      await client.callTool({
        name: "add_webhook",
        arguments: { url: "https://example.com/dup", events: ["dm"] },
      });
      const result = parseResult(await client.callTool({
        name: "add_webhook",
        arguments: { url: "https://example.com/dup", events: ["dm"] },
      }) as any) as any;
      expect(result).toContain("Failed");
      expect(result).toContain("already exists");
    });

    test("rejects invalid event types", async () => {
      const result = await client.callTool({
        name: "add_webhook",
        arguments: { url: "https://example.com/hook", events: ["invalid_event"] },
      });
      // Zod validation error should cause an error response
      expect((result as any).isError).toBe(true);
    });
  });

  describe("remove_webhook", () => {
    test("removes webhook by index", async () => {
      writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
        webhooks: [{ url: "https://example.com/remove-me", events: ["dm"] }],
      }));
      const result = parseResult(await client.callTool({
        name: "remove_webhook",
        arguments: { index: 0 },
      }) as any) as any;
      expect(result).toContain("Removed webhook");
    });

    test("errors on invalid index", async () => {
      writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
        webhooks: [{ url: "https://example.com/hook", events: ["dm"] }],
      }));
      const result = parseResult(await client.callTool({
        name: "remove_webhook",
        arguments: { index: 999 },
      }) as any) as any;
      expect(result).toContain("Failed");
    });

    test("errors when no webhooks configured", async () => {
      writeFileSync(TEST_CONFIG_PATH, JSON.stringify({}));
      _resetConfigCache();
      const result = parseResult(await client.callTool({
        name: "remove_webhook",
        arguments: { index: 0 },
      }) as any) as any;
      expect(result).toContain("Failed");
      expect(result).toContain("No webhooks");
    });

    test("accepts string index via coerce", async () => {
      writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
        webhooks: [{ url: "https://example.com/hook", events: ["dm"] }],
      }));
      const result = parseResult(await client.callTool({
        name: "remove_webhook",
        arguments: { index: "0" },
      }) as any) as any;
      expect(result).toContain("Removed webhook");
    });
  });
});
