import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { Message } from "../types.js";
import { getDataDir } from "./db.js";
import dns from "dns";
import net from "net";

export interface WebhookConfig {
  url: string;
  events: ("dm" | "blocker" | "channel" | "mention" | "task")[];
  agent?: string;
}

interface ConversationsConfig {
  webhooks?: WebhookConfig[];
}

let cachedConfig: ConversationsConfig | null = null;
let configLoadedAt = 0;
const CONFIG_CACHE_MS = 10000;

/** @internal — exposed only for testing. Resets the config cache. */
export function _resetConfigCache(): void {
  cachedConfig = null;
  configLoadedAt = 0;
}

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
    if (event === "dm" && !msg.channel) return true;
    if (event === "blocker" && msg.blocking) return true;
    if (event === "channel" && msg.channel) return true;
    if (event === "mention" && webhook.agent && msg.content.includes(`@${webhook.agent}`)) return true;
  }
  return false;
}

function safeWebhookUrl(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "<invalid-url>";
  }
}

function redactUrls(value: string): string {
  return value.replace(/https?:\/\/[^\s"'<>)]*/g, (candidate) => {
    try {
      const url = new URL(candidate);
      return `${url.origin}${url.pathname}`;
    } catch {
      return candidate;
    }
  });
}

function safeWebhookErrorMessage(error: unknown, webhook: WebhookConfig): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactUrls(message).split(webhook.url).join(safeWebhookUrl(webhook.url));
}

function warnWebhookDelivery(kind: string, webhook: WebhookConfig, message: string): void {
  console.warn(`[conversations:webhook] ${kind} webhook ${safeWebhookUrl(webhook.url)} ${message}`);
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
    if (webhook.agent && msg.to_agent !== webhook.agent && !msg.channel) continue;

    if (!matchesEvent(webhook, msg)) continue;

    // Validate URL to prevent SSRF — skip invalid/dangerous URLs silently
    void validateWebhookUrl(webhook.url).then((valid) => {
      if (!valid) {
        warnWebhookDelivery("message", webhook, "was not delivered: invalid or unsafe URL");
        return;
      }
      fetch(webhook.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: msg.id,
          from: msg.from_agent,
          to: msg.to_agent,
          channel: msg.channel,
          content: msg.content,
          priority: msg.priority,
          blocking: msg.blocking,
          created_at: msg.created_at,
        }),
      }).then((response) => {
        if (!response.ok) {
          warnWebhookDelivery("message", webhook, `POST failed with HTTP ${response.status}`);
        }
      }).catch((error) => {
        warnWebhookDelivery("message", webhook, `POST failed: ${safeWebhookErrorMessage(error, webhook)}`);
      });
    }).catch((error) => {
      warnWebhookDelivery("message", webhook, `URL validation failed: ${safeWebhookErrorMessage(error, webhook)}`);
    });
  }
}

export interface TaskEvent {
  task_id: number;
  task_uuid: string;
  subject: string;
  action: string;
  old_status?: string;
  new_status?: string;
  agent: string;
  detail?: string;
  priority: string;
  assignee: string | null;
  project_id: string | null;
  created_at: string;
}

/**
 * Fire webhooks for task state transitions.
 * Runs async, never blocks the task operation.
 */
export function fireTaskWebhooks(event: TaskEvent): void {
  const config = loadConfig();
  if (!config.webhooks || config.webhooks.length === 0) return;

  const taskWebhooks = config.webhooks.filter(w => w.events.includes("task"));
  if (taskWebhooks.length === 0) return;

  for (const webhook of taskWebhooks) {
    if (webhook.agent && event.agent !== webhook.agent) continue;

    void validateWebhookUrl(webhook.url).then((valid) => {
      if (!valid) {
        warnWebhookDelivery("task", webhook, "was not delivered: invalid or unsafe URL");
        return;
      }
      fetch(webhook.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      }).then((response) => {
        if (!response.ok) {
          warnWebhookDelivery("task", webhook, `POST failed with HTTP ${response.status}`);
        }
      }).catch((error) => {
        warnWebhookDelivery("task", webhook, `POST failed: ${safeWebhookErrorMessage(error, webhook)}`);
      });
    }).catch((error) => {
      warnWebhookDelivery("task", webhook, `URL validation failed: ${safeWebhookErrorMessage(error, webhook)}`);
    });
  }
}

// ── Webhook configuration management ─────────────────────────────────────────

export interface AddWebhookResult {
  success: boolean;
  error?: string;
  webhook?: WebhookConfig;
  index?: number;
}

export interface RemoveWebhookResult {
  success: boolean;
  error?: string;
  removed?: WebhookConfig;
}

/**
 * List all configured webhooks.
 */
export function listWebhooks(): WebhookConfig[] {
  const config = loadConfig();
  return config.webhooks || [];
}

/**
 * Add a webhook to the config.
 * Validates the URL before saving.
 */
export async function addWebhook(url: string, events: string[], agent?: string): Promise<AddWebhookResult> {
  // Validate inputs
  if (!url || !events || events.length === 0) {
    return { success: false, error: "url and events are required" };
  }

  const validEvents = ["dm", "blocker", "channel", "mention", "task"];
  for (const event of events) {
    if (!validEvents.includes(event)) {
      return { success: false, error: `Invalid event "${event}". Valid events: ${validEvents.join(", ")}` };
    }
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    return { success: false, error: `Invalid URL: ${url}` };
  }

  const webhook: WebhookConfig = { url, events: events as WebhookConfig["events"], ...(agent ? { agent } : {}) };

  const configPath = getConfigPath();

  // Ensure directory exists
  const configDir = configPath.substring(0, configPath.lastIndexOf("/"));
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  // Read current config (bypassing cache for write)
  let config: ConversationsConfig = {};
  try {
    const raw = readFileSync(configPath, "utf-8");
    config = JSON.parse(raw);
  } catch {
    // File doesn't exist yet, start fresh
  }

  if (!config.webhooks) config.webhooks = [];

  // Prevent duplicates
  if (config.webhooks.some(w => w.url === url && w.agent === agent && JSON.stringify(w.events.sort()) === JSON.stringify(events.sort()))) {
    return { success: false, error: "Webhook already exists" };
  }

  config.webhooks.push(webhook);
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

  // Reset cache so next fireWebhooks picks up new config
  _resetConfigCache();

  return { success: true, webhook, index: config.webhooks.length - 1 };
}

/**
 * Remove a webhook by index.
 */
export function removeWebhook(index: number): RemoveWebhookResult {
  const configPath = getConfigPath();

  let config: ConversationsConfig = {};
  try {
    const raw = readFileSync(configPath, "utf-8");
    config = JSON.parse(raw);
  } catch {
    return { success: false, error: "No config file found" };
  }

  if (!config.webhooks || config.webhooks.length === 0) {
    return { success: false, error: "No webhooks configured" };
  }

  if (index < 0 || index >= config.webhooks.length) {
    return { success: false, error: `Invalid index: ${index}. Valid range: 0-${config.webhooks.length - 1}` };
  }

  const removed = config.webhooks.splice(index, 1)[0];
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");

  // Reset cache
  _resetConfigCache();

  return { success: true, removed };
}
