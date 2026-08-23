import { SqliteAdapter as Database } from "../storage.js";
type SQLQueryBindings = string | number | null | boolean;
import { getDatabase, now, shortUuid } from "./database.js";
import { isApiMode, apiJson, toQuery } from "./api-mode.js";
import { isIP } from "node:net";
import type { WebhookHook, HookType } from "../types/hooks.js";

// ============================================================================
// Helpers
// ============================================================================

function parseRow(row: Record<string, unknown>): WebhookHook {
  return {
    id: row["id"] as string,
    type: row["type"] as HookType,
    handlerUrl: row["handler_url"] as string,
    priority: row["priority"] as number,
    blocking: Boolean(row["blocking"]),
    agentId: (row["agent_id"] as string) || undefined,
    projectId: (row["project_id"] as string) || undefined,
    description: (row["description"] as string) || undefined,
    enabled: Boolean(row["enabled"]),
    createdAt: row["created_at"] as string,
    invocationCount: row["invocation_count"] as number,
    failureCount: row["failure_count"] as number,
  };
}

// ============================================================================
// Webhook handler URL validation — SSRF guard
// ============================================================================
//
// handler_url is caller-supplied and the delivery path POSTs the full hook
// context (including complete Memory objects) to it from the serve/MCP
// process. Without validation, any caller of any surface (MCP tool, REST
// route, CLI) can point it at 169.254.169.254 (cloud metadata), a loopback or
// private-network service, or an external collector. Only public http(s)
// endpoints are accepted.

function isBlockedIpv4(parts: number[]): boolean {
  const a = parts[0]!;
  const b = parts[1]!;
  if (a === 0) return true; // 0.0.0.0/8 — "this network"
  if (a === 127) return true; // 127.0.0.0/8 — loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 — link-local, incl. 169.254.169.254
  if (a === 10) return true; // 10.0.0.0/8 — private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 — private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 — private
  return false;
}

function isBlockedIpv6(bytes: number[]): boolean {
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — apply the IPv4 rules to the tail.
  const mapped =
    bytes.slice(0, 10).every((b) => b === 0) &&
    bytes[10]! === 0xff &&
    bytes[11]! === 0xff;
  if (mapped) return isBlockedIpv4(bytes.slice(12, 16));
  if (bytes.every((b) => b === 0)) return true; // :: — unspecified
  if (bytes.slice(0, 15).every((b) => b === 0) && bytes[15]! === 1) return true; // ::1 — loopback
  if ((bytes[0]! & 0xfe) === 0xfc) return true; // fc00::/7 — unique-local
  if (bytes[0]! === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true; // fe80::/10 — link-local
  return false;
}

/** Expand a dotted-quad IPv4 tail into two 16-bit IPv6 groups (::ffff:1.2.3.4). */
function quadToGroups(quad: string): number[] | null {
  const nums = quad.split(".").map((p) => Number(p));
  const [a, b, c, d] = nums;
  const valid = [a, b, c, d].every(
    (n) => n !== undefined && Number.isInteger(n) && n >= 0 && n <= 255
  );
  if (!valid) return null;
  return [(a! << 8) | b!, (c! << 8) | d!];
}

function parseIpv6Bytes(host: string): number[] | null {
  const groups = host.split("::");
  if (groups.length > 2) return null;
  const headRaw = groups[0] ?? "";
  const tailRaw = groups[1] ?? "";
  const head = headRaw === "" ? [] : headRaw.split(":");
  const tail = tailRaw === "" ? [] : tailRaw.split(":");

  const headNums: number[] = [];
  for (const g of head) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    headNums.push(parseInt(g, 16));
  }
  const tailNums: number[] = [];
  for (const g of tail) {
    if (/^\d+\.\d+\.\d+\.\d+$/.test(g)) {
      const quads = quadToGroups(g);
      if (!quads) return null;
      tailNums.push(...quads);
    } else if (/^[0-9a-f]{1,4}$/i.test(g)) {
      tailNums.push(parseInt(g, 16));
    } else {
      return null;
    }
  }

  const hasCompression = groups.length === 2;
  if (!hasCompression && headNums.length !== 8) return null;
  if (hasCompression && headNums.length + tailNums.length >= 8) return null;

  const zeros = 8 - headNums.length - tailNums.length;
  const all = [...headNums, ...new Array(zeros).fill(0), ...tailNums];
  const bytes: number[] = [];
  for (const n of all) {
    bytes.push((n >> 8) & 0xff, n & 0xff);
  }
  return bytes;
}

const BLOCKED_TARGET_MESSAGE =
  "Invalid webhook handler URL — loopback, link-local, and private network targets are not allowed";

/**
 * Validate a webhook handler URL. Throws a descriptive Error when the URL is
 * not a public http(s) endpoint: unparseable, wrong scheme, embedded
 * credentials, or a loopback / link-local / private / metadata target.
 */
export function validateWebhookHandlerUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid webhook handler URL "${url}" — must be a valid http(s) URL`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid webhook handler URL "${url}" — only http and https are allowed`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`Invalid webhook handler URL "${url}" — embedded credentials are not allowed`);
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();

  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new Error(`${BLOCKED_TARGET_MESSAGE}: "${url}"`);
  }

  const version = isIP(host);
  if (version === 4) {
    if (isBlockedIpv4(host.split(".").map((p) => Number(p)))) {
      throw new Error(`${BLOCKED_TARGET_MESSAGE}: "${url}"`);
    }
  } else if (version === 6) {
    // Fail closed on an IPv6 literal our parser cannot classify.
    const bytes = parseIpv6Bytes(host);
    if (!bytes || isBlockedIpv6(bytes)) {
      throw new Error(`${BLOCKED_TARGET_MESSAGE}: "${url}"`);
    }
  } else {
    // Not an IP literal. Numeric-only hostnames are IPv4 shorthands
    // (127.1, 2130706433) or garbage — refuse them rather than resolve them.
    // Zone identifiers only appear on link-local scopes — refuse them outright.
    if (/^[0-9]+(\.[0-9]+)*$/.test(host) || /^0x[0-9a-f]+$/i.test(host) || host.includes("%")) {
      throw new Error(`${BLOCKED_TARGET_MESSAGE}: "${url}"`);
    }
  }
}

// ============================================================================
// Create
// ============================================================================

export interface CreateWebhookHookInput {
  type: HookType;
  handlerUrl: string;
  priority?: number;
  blocking?: boolean;
  agentId?: string;
  projectId?: string;
  description?: string;
}

export function createWebhookHook(
  input: CreateWebhookHookInput,
  db?: Database
): WebhookHook {
  validateWebhookHandlerUrl(input.handlerUrl);
  if (!db && isApiMode()) {
    const { data } = apiJson<WebhookHook>("POST", "/webhooks", {
      type: input.type,
      handler_url: input.handlerUrl,
      priority: input.priority,
      blocking: input.blocking,
      agent_id: input.agentId,
      project_id: input.projectId,
      description: input.description,
    });
    return data;
  }
  const d = db || getDatabase();
  const id = shortUuid();
  const timestamp = now();

  d.run(
    `INSERT INTO webhook_hooks
       (id, type, handler_url, priority, blocking, agent_id, project_id, description, enabled, created_at, invocation_count, failure_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, 0)`,
    [
      id,
      input.type,
      input.handlerUrl,
      input.priority ?? 50,
      input.blocking ? 1 : 0,
      input.agentId ?? null,
      input.projectId ?? null,
      input.description ?? null,
      timestamp,
    ]
  );

  return getWebhookHook(id, d)!;
}

// ============================================================================
// Read
// ============================================================================

export function getWebhookHook(id: string, db?: Database): WebhookHook | null {
  if (!db && isApiMode()) {
    const { status, data } = apiJson<WebhookHook>("GET", `/webhooks/${encodeURIComponent(id)}`, undefined, { allow404: true });
    if (status === 404 || !data) return null;
    return data;
  }
  const d = db || getDatabase();
  const row = d
    .query("SELECT * FROM webhook_hooks WHERE id = ?")
    .get(id) as Record<string, unknown> | null;
  return row ? parseRow(row) : null;
}

export function listWebhookHooks(
  filter: { type?: HookType; enabled?: boolean } = {},
  db?: Database
): WebhookHook[] {
  if (!db && isApiMode()) {
    const q = toQuery({ type: filter.type, enabled: filter.enabled });
    const { data } = apiJson<WebhookHook[]>("GET", `/webhooks${q}`);
    return data ?? [];
  }
  const d = db || getDatabase();
  const conditions: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (filter.type) {
    conditions.push("type = ?");
    params.push(filter.type);
  }
  if (filter.enabled !== undefined) {
    conditions.push("enabled = ?");
    params.push(filter.enabled ? 1 : 0);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = d
    .query(`SELECT * FROM webhook_hooks ${where} ORDER BY priority ASC, created_at ASC`)
    .all(...params) as Record<string, unknown>[];

  return rows.map(parseRow);
}

// ============================================================================
// Update
// ============================================================================

export function updateWebhookHook(
  id: string,
  updates: { enabled?: boolean; description?: string; priority?: number },
  db?: Database
): WebhookHook | null {
  if (!db && isApiMode()) {
    const { status, data } = apiJson<WebhookHook>("PATCH", `/webhooks/${encodeURIComponent(id)}`, {
      enabled: updates.enabled,
      priority: updates.priority,
      description: updates.description,
    }, { allow404: true });
    if (status === 404 || !data) return null;
    return data;
  }
  const d = db || getDatabase();
  const existing = getWebhookHook(id, d);
  if (!existing) return null;

  const sets: string[] = [];
  const params: SQLQueryBindings[] = [];

  if (updates.enabled !== undefined) {
    sets.push("enabled = ?");
    params.push(updates.enabled ? 1 : 0);
  }
  if (updates.description !== undefined) {
    sets.push("description = ?");
    params.push(updates.description);
  }
  if (updates.priority !== undefined) {
    sets.push("priority = ?");
    params.push(updates.priority);
  }

  if (sets.length > 0) {
    params.push(id);
    d.run(`UPDATE webhook_hooks SET ${sets.join(", ")} WHERE id = ?`, params);
  }

  return getWebhookHook(id, d);
}

// ============================================================================
// Delete
// ============================================================================

export function deleteWebhookHook(id: string, db?: Database): boolean {
  if (!db && isApiMode()) {
    const { status } = apiJson<null>("DELETE", `/webhooks/${encodeURIComponent(id)}`, undefined, { allow404: true });
    return status === 204 || status === 200;
  }
  const d = db || getDatabase();
  const result = d.run("DELETE FROM webhook_hooks WHERE id = ?", [id]);
  return result.changes > 0;
}

// ============================================================================
// Stats tracking
// ============================================================================

export function recordWebhookInvocation(
  id: string,
  success: boolean,
  db?: Database
): void {
  if (!db && isApiMode()) {
    // Best-effort invocation counter. The cloud server owns webhook stats when
    // hooks fire server-side; there is no client-facing stats endpoint, and a
    // client must never touch a local SQLite island in api mode. Skip silently.
    return;
  }
  const d = db || getDatabase();
  if (success) {
    d.run(
      "UPDATE webhook_hooks SET invocation_count = invocation_count + 1 WHERE id = ?",
      [id]
    );
  } else {
    d.run(
      "UPDATE webhook_hooks SET invocation_count = invocation_count + 1, failure_count = failure_count + 1 WHERE id = ?",
      [id]
    );
  }
}
