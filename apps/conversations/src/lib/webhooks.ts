import { readFileSync } from "fs";
import { join } from "path";
import type { Message } from "../types.js";
import { getDataDir } from "./db.js";

export interface WebhookConfig {
  url: string;
  events: ("dm" | "blocker" | "space" | "mention")[];
  agent?: string;
}

interface ConversationsConfig {
  webhooks?: WebhookConfig[];
}

let cachedConfig: ConversationsConfig | null = null;
let configLoadedAt = 0;
const CONFIG_CACHE_MS = 10000;

function getConfigPath(): string {
  return process.env.CONVERSATIONS_CONFIG_PATH || join(getDataDir(), "config.json");
}

function loadConfig(): ConversationsConfig {
  const now = Date.now();
  if (cachedConfig && now - configLoadedAt < CONFIG_CACHE_MS) return cachedConfig;

  try {
    const raw = readFileSync(getConfigPath(), "utf-8");
    cachedConfig = JSON.parse(raw);
    configLoadedAt = now;
    return cachedConfig!;
  } catch {
    cachedConfig = {};
    configLoadedAt = now;
    return cachedConfig;
  }
}

function matchesEvent(webhook: WebhookConfig, msg: Message): boolean {
  for (const event of webhook.events) {
    if (event === "dm" && !msg.space) return true;
    if (event === "blocker" && msg.blocking) return true;
    if (event === "space" && msg.space) return true;
    if (event === "mention" && webhook.agent && msg.content.includes(`@${webhook.agent}`)) return true;
  }
  return false;
}

/**
 * Fire webhooks for a message. Runs async, never blocks sendMessage.
 * Matches webhooks by event type and optionally by agent (to_agent).
 */
export function fireWebhooks(msg: Message): void {
  const config = loadConfig();
  if (!config.webhooks || config.webhooks.length === 0) return;

  for (const webhook of config.webhooks) {
    // If webhook is scoped to an agent, only fire for messages to that agent
    if (webhook.agent && msg.to_agent !== webhook.agent && !msg.space) continue;

    if (!matchesEvent(webhook, msg)) continue;

    // Fire async — don't await, don't block
    fetch(webhook.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: msg.id,
        from: msg.from_agent,
        to: msg.to_agent,
        space: msg.space,
        content: msg.content,
        priority: msg.priority,
        blocking: msg.blocking,
        created_at: msg.created_at,
      }),
    }).catch(() => {
      // Silently ignore webhook failures
    });
  }
}
