/**
 * Webhook configuration management tools.
 * get_webhooks, add_webhook, remove_webhook
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { registerMcpTool } from "../tool-compat.js";
import {
  listWebhooks,
  addWebhook,
  removeWebhook,
} from "../../lib/webhooks.js";

export function registerWebhookTools(server: McpServer): void {

  // ---- List Webhooks ----
  registerMcpTool(server, "get_webhooks", {
    description: "List all configured webhooks with their URLs, events, and optional agent scoping.",
    inputSchema: {},
  }, async () => {
    const webhooks = listWebhooks();
    return {
      content: [{
        type: "text",
        text: webhooks.length === 0
          ? "No webhooks configured."
          : `Configured webhooks (${webhooks.length}):\n${webhooks.map((w, i) => `  [${i}] ${w.url}\n      Events: ${w.events.join(", ")}${w.agent ? `\n      Agent: ${w.agent}` : ""}`).join("\n")}`,
      }],
    };
  });

  // ---- Add Webhook ----
  registerMcpTool(server, "add_webhook", {
    description: "Add a new webhook. Validates URL (must be HTTPS, not private IP) and events. Valid events: dm, blocker, channel, mention, task.",
    inputSchema: {
      url: z.string(),
      events: z.array(z.enum(["dm", "blocker", "channel", "mention", "task"])),
      agent: z.string().optional(),
    },
  }, async (args: Record<string, any>) => {
    const result = await addWebhook(args.url, args.events, args.agent);
    return {
      content: [{
        type: "text",
        text: result.success
          ? `Webhook added at index ${result.index}: ${result.webhook?.url}`
          : `Failed to add webhook: ${result.error}`,
      }],
    };
  });

  // ---- Remove Webhook ----
  registerMcpTool(server, "remove_webhook", {
    description: "Remove a webhook by its index (0-based). Use get_webhooks first to find the index.",
    inputSchema: {
      index: z.coerce.number(),
    },
  }, async (args: Record<string, any>) => {
    const result = removeWebhook(args.index);
    return {
      content: [{
        type: "text",
        text: result.success
          ? `Removed webhook: ${result.removed?.url}`
          : `Failed to remove webhook: ${result.error}`,
      }],
    };
  });
}
