/**
 * Telegram channel bridge for conversations MCP server.
 *
 * Polls a Telegram bot for new messages and pushes them as
 * `notifications/claude/channel` events. Also registers a
 * `telegram_send` tool for replying.
 *
 * Requires: TELEGRAM_BOT_TOKEN env var or connect-telegram profile.
 *
 * Usage: Set TELEGRAM_BOT_TOKEN and the bridge auto-starts.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import { registerMcpTool } from "./tool-compat.js";

const POLL_INTERVAL_MS = 2000;

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name: string; username?: string };
    chat: { id: number; type: string; title?: string; username?: string };
    text?: string;
    date: number;
  };
}

async function telegramRequest(token: string, method: string, params?: Record<string, unknown>): Promise<any> {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: params ? JSON.stringify(params) : undefined,
  });
  const data = await res.json() as { ok: boolean; result: unknown; description?: string };
  if (!data.ok) throw new Error(`Telegram API error: ${data.description}`);
  return data.result;
}

export function registerTelegramChannel(server: McpServer): void {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return; // No token, no bridge

  let lastUpdateId = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let botUsername = "bot";

  // Get bot info on startup
  telegramRequest(token, "getMe").then((me: any) => {
    botUsername = me.username || me.first_name || "bot";
    console.error(`[telegram-channel] connected as @${botUsername}`);
  }).catch(() => {});

  // Register send tool
  registerMcpTool(server, "telegram_send", {
    description: "Send a message to a Telegram chat. Use this to reply to Telegram messages received via the channel bridge.",
    inputSchema: {
      chat_id: z.coerce.number().describe("Telegram chat ID to send to (from the incoming message's chat_id meta)"),
      text: z.string().describe("Message text to send"),
      parse_mode: z.string().optional().describe("Optional: HTML or MarkdownV2"),
      reply_to_message_id: z.coerce.number().optional().describe("Optional: message ID to reply to"),
    },
  }, async (args: Record<string, any>) => {
    const result = await telegramRequest(token, "sendMessage", {
      chat_id: args.chat_id,
      text: args.text,
      parse_mode: args.parse_mode,
      reply_to_message_id: args.reply_to_message_id,
    });
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  function pushNotification(update: TelegramUpdate): void {
    const msg = update.message;
    if (!msg?.text) return;

    const from = msg.from?.username || msg.from?.first_name || "unknown";
    const chatTitle = msg.chat.title || msg.chat.username || String(msg.chat.id);

    const context = [
      `From: ${from}`,
      `Chat: ${chatTitle} (${msg.chat.id})`,
      `Message ID: ${msg.message_id}`,
      msg.chat.type !== "private" ? `Type: ${msg.chat.type}` : null,
    ].filter(Boolean).join(" | ");

    const enrichedContent = `[${context}]\n${msg.text}`;

    server.server.notification({
      method: "notifications/claude/channel",
      params: {
        content: enrichedContent,
        meta: {
          from,
          chat_id: String(msg.chat.id),
          message_id: String(msg.message_id),
          chat_type: msg.chat.type,
          ...(msg.chat.title ? { chat_title: msg.chat.title } : {}),
        },
      },
    }).catch(() => {});
  }

  async function poll(): Promise<void> {
    try {
      const updates: TelegramUpdate[] = await telegramRequest(token!, "getUpdates", {
        offset: lastUpdateId + 1,
        timeout: 1,
        allowed_updates: ["message"],
      });

      for (const update of updates) {
        lastUpdateId = update.update_id;
        pushNotification(update);
      }
    } catch {
      // Silently continue
    }
  }

  // Start polling after connection
  setTimeout(() => {
    pollTimer = setInterval(() => poll(), POLL_INTERVAL_MS);
    console.error("[telegram-channel] polling started");
  }, 2000);
}
