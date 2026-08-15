import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { registerTelegramChannel } from "./telegram-channel";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

describe("telegram channel", () => {
  let originalToken: string | undefined;

  beforeEach(() => {
    originalToken = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
  });

  afterEach(() => {
    if (originalToken !== undefined) {
      process.env.TELEGRAM_BOT_TOKEN = originalToken;
    } else {
      delete process.env.TELEGRAM_BOT_TOKEN;
    }
  });

  test("does not register tools when no token", () => {
    const server = new McpServer({ name: "test-tg-none", version: "0.0.1" });
    registerTelegramChannel(server);
    // No tools should be registered without token
  });

  test("returns early without token (no throw)", () => {
    const server = new McpServer({ name: "test-tg-early", version: "0.0.1" });
    expect(() => registerTelegramChannel(server)).not.toThrow();
  });
});
