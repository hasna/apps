import { readFileSync } from "fs";
import { join } from "path";
import type { Message } from "../types.js";
import { getDataDir } from "./db.js";
import dns from "dns";
import net from "net";

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

/** Check if an IP address is in a private/internal range. */
function isPrivateIP(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split(".").map(Number);
    // 10.0.0.0/8
    if (parts[0] === 10) return true;
    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 127.0.0.0/8 (loopback)
    if (parts[0] === 127) return true;
    // 169.254.0.0/16 (link-local / metadata)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 0.0.0.0
    if (parts[0] === 0) return true;
  } else if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower.startsWith("::ffff:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
  }
  return false;
}

/** Resolve hostname and reject private/internal IPs to prevent SSRF. */
async function validateWebhookUrl(urlStr: string): Promise<boolean> {
  try {
    const url = new URL(urlStr);
    if (url.protocol !== "https:") return false; // Only allow HTTPS
    const hostname = url.hostname;

    // Block obvious localhost / loopback names
    if (hostname === "localhost" || hostname === "0.0.0.0" || hostname === "127.0.0.1" || hostname === "::1") return false;

    // Resolve hostname and check all returned IPs
    const addresses = await dns.promises.lookup(hostname, { all: true });
    if (!Array.isArray(addresses)) return false;
    return !addresses.some((a: { address: string }) => isPrivateIP(a.address));
  } catch {
    return false;
  }
}

/**
 * Fire webhooks for a message. Runs async, never blocks sendMessage.
 * Matches webhooks by event type and optionally by agent (to_agent).
 * Validates webhook URLs to prevent SSRF (private IP rejection).
 */
export function fireWebhooks(msg: Message): void {
  const config = loadConfig();
  if (!config.webhooks || config.webhooks.length === 0) return;

  for (const webhook of config.webhooks) {
    // If webhook is scoped to an agent, only fire for messages to that agent
    if (webhook.agent && msg.to_agent !== webhook.agent && !msg.space) continue;

    if (!matchesEvent(webhook, msg)) continue;

    // Validate URL to prevent SSRF — skip invalid/dangerous URLs silently
    void validateWebhookUrl(webhook.url).then((valid) => {
      if (!valid) return;
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
    });
  }
}
