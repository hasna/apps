/**
 * conversations-serve — the self_hosted HTTP API surface.
 *
 * PURE REMOTE (Amendment A1): every read and write goes straight to the app's
 * cloud Postgres via the vendored storage kit. There is no SQLite, no cache,
 * and no sync engine in this process. The degraded outbox/cache lives in the
 * CLIENT, out of scope here.
 *
 * Surfaces:
 *   GET  /health   liveness (unauthenticated, trivial)
 *   GET  /ready    readiness — pings Postgres; {status,version,mode}
 *   GET  /version  {status,version,mode}
 *   /v1/*          versioned API, guarded by @hasna/contracts API-key auth
 *
 * The /v1 surface covers the app's core operations: messages, channels,
 * projects, and agent presence — real SQL against the cloud schema, no stubs.
 */

import { randomUUID } from "crypto";
import { createCloudPoolFromEnv } from "../generated/storage-kit/index.js";
import type { TypedQueryClient } from "../generated/storage-kit/query.js";
import { verifyApiKey, ApiKeyStore } from "@hasna/contracts/auth";
import type { ApiKeyVerifier } from "@hasna/contracts/auth";
import { version as pkgVersion } from "../../package.json";
import { openapiSpec } from "./openapi.js";

export const APP = "conversations";
const SCOPE_READ = `${APP}:read`;
const SCOPE_WRITE = `${APP}:write`;

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

function json(data: unknown, status = 200, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...(extra || {}) },
  });
}

function signingSecret(): string {
  const secret =
    process.env.HASNA_CONVERSATIONS_API_SIGNING_KEY ||
    process.env.HASNA_API_SIGNING_KEY ||
    process.env.API_KEY_SIGNING_SECRET;
  if (!secret) {
    throw new Error(
      "Missing API signing secret. Set HASNA_CONVERSATIONS_API_SIGNING_KEY (or HASNA_API_SIGNING_KEY).",
    );
  }
  return secret;
}

export interface ApiServerDeps {
  client: TypedQueryClient;
  keys: ApiKeyStore;
  verifier: ApiKeyVerifier;
}

/** Build the request-handling deps from the environment (cloud Postgres). */
export function buildDeps(): ApiServerDeps {
  const { client } = createCloudPoolFromEnv(APP, { applicationName: "conversations-serve" });
  const keys = new ApiKeyStore(client);
  const verifier = verifyApiKey({
    app: APP,
    signingSecret: signingSecret(),
    isRevoked: keys.isRevoked,
    audit: (e) => {
      if (e.outcome === "deny") {
        console.warn(`[auth] deny ${e.method ?? "?"} ${e.path ?? "?"} reason=${e.reason} kid=${e.kid ?? "-"}`);
      }
    },
  });
  return { client, keys, verifier };
}

// ---- helpers ----------------------------------------------------------------

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text.trim()) return {};
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function clampLimit(raw: string | null, def = 50, max = 500): number {
  let n = parseInt(raw || String(def), 10);
  if (!Number.isFinite(n) || n <= 0) n = def;
  return Math.min(n, max);
}

/** Truthy query-param check: "true", "1", "yes" all count. */
function isTrue(raw: string | null): boolean {
  if (!raw) return false;
  const v = raw.toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

const VALID_PRIORITIES = ["low", "normal", "high", "urgent"];

/** Max messages accepted in a single bulk-ingest request. */
const BULK_MAX = 2000;

/** Authoritative current message count — the API-visible parity signal. */
async function messageTotal(client: TypedQueryClient): Promise<number> {
  const row = await client.get<{ n: string | number }>("SELECT count(*)::bigint AS n FROM messages");
  return Number(row?.n ?? 0);
}

// ---- server -----------------------------------------------------------------

export interface StartApiServerOptions {
  port?: number;
  host?: string;
  deps?: ApiServerDeps;
}

export function startApiServer(options: StartApiServerOptions = {}) {
  const deps = options.deps ?? buildDeps();
  const { client, verifier } = deps;
  const port = options.port ?? Number(process.env.PORT || 8080);
  const host = options.host ?? process.env.HOST ?? "0.0.0.0";

  const server = Bun.serve({
    port,
    hostname: host,
    idleTimeout: 30,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      try {
        // ---- liveness (unauthenticated) ----
        if (path === "/health" && method === "GET") {
          return json({ status: "ok", version: pkgVersion, mode: "cloud", app: APP });
        }

        if (path === "/version" && method === "GET") {
          return json({ status: "ok", version: pkgVersion, mode: "cloud", app: APP });
        }

        if (path === "/v1/openapi.json" && method === "GET") {
          return json(openapiSpec);
        }

        if (path === "/ready" && method === "GET") {
          try {
            await client.get<{ ok: number }>("SELECT 1 AS ok");
            return json({ status: "ok", version: pkgVersion, mode: "cloud", app: APP });
          } catch (e) {
            return json({ status: "unavailable", version: pkgVersion, mode: "cloud", error: (e as Error).message }, 503);
          }
        }

        // ---- versioned API (authenticated) ----
        if (path === "/v1" || path.startsWith("/v1/")) {
          const writing = method !== "GET" && method !== "HEAD";
          const decision = await verifier.authenticate(req.headers, {
            method,
            path,
            requiredScopes: [writing ? SCOPE_WRITE : SCOPE_READ],
          });
          if (!decision.ok) {
            return json({ error: decision.message, reason: decision.reason }, decision.status, {
              "WWW-Authenticate": "Bearer",
            });
          }
          return handleV1(path, method, req, url, deps, decision.principal.agent);
        }

        return json({ error: "Not found" }, 404);
      } catch (e) {
        return json({ error: (e as Error).message }, 400);
      }
    },
  });

  const shutdown = () => { server.stop(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(`conversations-serve listening on http://${host}:${port} (mode=cloud, version=${pkgVersion})`);
  return server;
}

// ---- /v1 router -------------------------------------------------------------

async function handleV1(
  path: string,
  method: string,
  req: Request,
  url: URL,
  deps: ApiServerDeps,
  agent: string | null,
): Promise<Response> {
  const { client } = deps;
  const sub = path.slice("/v1/".length);

  // ---- messages ----
  if (sub === "messages" && method === "GET") {
    const to = str(url.searchParams.get("to"));
    const from = str(url.searchParams.get("from"));
    const channel = str(url.searchParams.get("channel"));
    const session = str(url.searchParams.get("session")) ?? str(url.searchParams.get("session_id"));
    const projectId = str(url.searchParams.get("project_id"));
    const since = str(url.searchParams.get("since"));
    const sinceIdRaw = str(url.searchParams.get("since_id"));
    const q = str(url.searchParams.get("q"));
    const mentionsOnly = str(url.searchParams.get("mentions_only"));
    const unreadOnly = isTrue(url.searchParams.get("unread_only"));
    const threadsOnly = isTrue(url.searchParams.get("threads_only"));
    const includeReplyCounts = isTrue(url.searchParams.get("include_reply_counts"));
    // Default DESC (newest first) preserves the original behaviour; ?order=asc
    // gives chronological order for read_channel-style paging.
    const order = str(url.searchParams.get("order"))?.toLowerCase() === "asc" ? "ASC" : "DESC";
    const limit = clampLimit(url.searchParams.get("limit"));
    const offsetRaw = parseInt(url.searchParams.get("offset") || url.searchParams.get("cursor") || "0", 10);
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (to) { params.push(to); clauses.push(`to_agent = $${params.length}`); }
    if (from) { params.push(from); clauses.push(`from_agent = $${params.length}`); }
    if (channel) { params.push(channel); clauses.push(`channel = $${params.length}`); }
    if (session) { params.push(session); clauses.push(`session_id = $${params.length}`); }
    if (projectId) { params.push(projectId); clauses.push(`project_id = $${params.length}`); }
    if (since) { params.push(since); clauses.push(`created_at > $${params.length}`); }
    if (sinceIdRaw && Number.isFinite(Number(sinceIdRaw))) { params.push(Number(sinceIdRaw)); clauses.push(`id > $${params.length}`); }
    if (q) { params.push(`%${q}%`); clauses.push(`content ILIKE $${params.length}`); }
    if (mentionsOnly) {
      params.push(mentionsOnly.toLowerCase());
      clauses.push(`id IN (SELECT message_id FROM message_mentions WHERE mentioned_agent = $${params.length})`);
    }
    if (unreadOnly) clauses.push(`read_at IS NULL`);
    if (threadsOnly) clauses.push(`reply_to IS NULL`);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    // count=1 → authoritative total (honours the same filters). Lets callers
    // verify backfill parity from the API without paging through every row.
    if (str(url.searchParams.get("count"))) {
      const row = await client.get<{ n: string | number }>(
        `SELECT count(*)::bigint AS n FROM messages ${where}`,
        params,
      );
      return json({ count: Number(row?.n ?? 0) });
    }
    const replyCountSelect = includeReplyCounts
      ? `, (SELECT count(*) FROM messages r WHERE r.reply_to = messages.id)::int AS reply_count`
      : "";
    params.push(limit);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;
    const rows = await client.many(
      `SELECT id, uuid, session_id, from_agent, to_agent, channel, project_id, content, priority,
              blocking, reply_to, working_dir, repository, branch, metadata, edited_at, pinned_at,
              attachments, created_at, read_at${replyCountSelect}
       FROM messages ${where} ORDER BY created_at ${order}, id ${order} LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );
    return json({ messages: rows });
  }

  // ---- mark messages read (per-agent receipts + global read_at) ----
  // Mirrors the local markReadByIds/markAllRead/markChannelRead/markSessionRead
  // semantics so read state routes to the cloud identically.
  if (sub === "messages/read" && method === "POST") {
    const body = await readJson(req);
    const reader = str(body.reader) ?? str(body.agent) ?? agent ?? undefined;
    const ids = Array.isArray(body.ids)
      ? (body.ids as unknown[]).map(Number).filter((n) => Number.isFinite(n))
      : [];
    const all = body.all === true;
    const channel = str(body.channel);
    const session = str(body.session) ?? str(body.session_id);
    let marked = 0;
    if (ids.length) {
      if (reader) {
        const rParams: unknown[] = [];
        const rowsSql: string[] = [];
        const lower = reader.toLowerCase();
        for (const id of ids) {
          rParams.push(id, lower);
          rowsSql.push(`($${rParams.length - 1}, $${rParams.length}, NOW())`);
        }
        await client.query(
          `INSERT INTO message_read_receipts (message_id, agent, read_at) VALUES ${rowsSql.join(", ")}
           ON CONFLICT (message_id, agent) DO UPDATE SET read_at = EXCLUDED.read_at`,
          rParams,
        );
      }
      const res = await client.query(
        `UPDATE messages SET read_at = NOW()::text WHERE id = ANY($1::bigint[]) AND read_at IS NULL`,
        [ids],
      );
      marked = res.rowCount;
    } else if (all && reader) {
      const res = await client.query(
        `UPDATE messages SET read_at = NOW()::text WHERE to_agent = $1 AND read_at IS NULL`,
        [reader],
      );
      marked = res.rowCount;
    } else if (channel && reader) {
      const res = await client.query(
        `UPDATE messages SET read_at = NOW()::text WHERE channel = $1 AND from_agent <> $2 AND read_at IS NULL`,
        [channel, reader],
      );
      marked = res.rowCount;
    } else if (session && reader) {
      const res = await client.query(
        `UPDATE messages SET read_at = NOW()::text WHERE session_id = $1 AND to_agent = $2 AND read_at IS NULL`,
        [session, reader],
      );
      marked = res.rowCount;
    } else {
      return json({ error: "provide ids, or all/channel/session with reader" }, 400);
    }
    return json({ marked });
  }

  // ---- mark messages unread (clear global read_at) ----
  if (sub === "messages/unread" && method === "POST") {
    const body = await readJson(req);
    const ids = Array.isArray(body.ids)
      ? (body.ids as unknown[]).map(Number).filter((n) => Number.isFinite(n))
      : [];
    if (!ids.length) return json({ error: "provide ids" }, 400);
    const res = await client.query(
      `UPDATE messages SET read_at = NULL WHERE id = ANY($1::bigint[]) AND read_at IS NOT NULL`,
      [ids],
    );
    return json({ marked_unread: res.rowCount });
  }

  // ---- unread counts per channel ----
  if (sub === "messages/unread-counts" && method === "GET") {
    const who = str(url.searchParams.get("agent"));
    if (who) {
      const rows = await client.many(
        `SELECT channel,
                COUNT(CASE WHEN read_at IS NULL AND from_agent <> $1 THEN 1 END) AS unread_count,
                MAX(created_at) AS latest_message_at
         FROM messages
         WHERE channel IS NOT NULL AND channel IN (
           SELECT DISTINCT channel FROM channel_members WHERE agent = $1
           UNION
           SELECT DISTINCT channel FROM messages WHERE to_agent = $1 AND channel IS NOT NULL
         )
         GROUP BY channel HAVING COUNT(*) > 0
         ORDER BY unread_count DESC, latest_message_at DESC`,
        [who],
      );
      return json({ counts: rows });
    }
    const rows = await client.many(
      `SELECT channel,
              COUNT(CASE WHEN read_at IS NULL THEN 1 END) AS unread_count,
              MAX(created_at) AS latest_message_at
       FROM messages WHERE channel IS NOT NULL
       GROUP BY channel HAVING COUNT(*) > 0
       ORDER BY unread_count DESC, latest_message_at DESC`,
    );
    return json({ counts: rows });
  }

  // ---- pinned messages ----
  if (sub === "messages/pinned" && method === "GET") {
    const channel = str(url.searchParams.get("channel"));
    const session = str(url.searchParams.get("session")) ?? str(url.searchParams.get("session_id"));
    const limit = clampLimit(url.searchParams.get("limit"));
    const offsetRaw = parseInt(url.searchParams.get("offset") || "0", 10);
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;
    const clauses = ["pinned_at IS NOT NULL"];
    const params: unknown[] = [];
    if (channel) { params.push(channel); clauses.push(`channel = $${params.length}`); }
    if (session) { params.push(session); clauses.push(`session_id = $${params.length}`); }
    params.push(limit);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;
    const rows = await client.many(
      `SELECT id, uuid, session_id, from_agent, to_agent, channel, project_id, content, priority,
              blocking, reply_to, working_dir, repository, branch, metadata, edited_at, pinned_at,
              attachments, created_at, read_at
       FROM messages WHERE ${clauses.join(" AND ")} ORDER BY pinned_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );
    return json({ messages: rows });
  }

  if (sub === "messages" && method === "POST") {
    const body = await readJson(req);
    const from = str(body.from) ?? agent ?? undefined;
    const to = str(body.to);
    const content = str(body.content);
    if (!from || !to || !content) return json({ error: "from, to, and content are required" }, 400);
    const channel = str(body.channel);
    const projectId = str(body.project_id);
    const sessionId = str(body.session_id) ?? `api:${from}`;
    let priority = str(body.priority)?.toLowerCase() ?? "normal";
    if (!VALID_PRIORITIES.includes(priority)) return json({ error: "Invalid priority" }, 400);
    const blocking = body.blocking === true;
    const row = await client.get(
      `INSERT INTO messages (session_id, from_agent, to_agent, channel, project_id, content, priority, blocking)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, uuid, session_id, from_agent, to_agent, channel, project_id, content, priority, blocking, created_at`,
      [sessionId, from, to, channel ?? null, projectId ?? null, content, priority, blocking],
    );
    return json({ message: row }, 201);
  }

  // ---- bulk message ingest (backfill local -> cloud to parity) ----
  // Idempotent: ON CONFLICT (uuid) DO NOTHING, so re-running never duplicates.
  // Preserves the original uuid + created_at (and every scalar field) so the
  // cloud copy is a faithful mirror of the authoritative local store, not a
  // batch of "now"-stamped rows. Requires the conversations:write scope.
  if (sub === "messages/bulk" && method === "POST") {
    const body = await readJson(req);
    const items = body.messages;
    if (!Array.isArray(items)) return json({ error: "'messages' must be an array" }, 400);
    if (items.length === 0) return json({ requested: 0, inserted: 0, skipped: 0, total: await messageTotal(client) });
    if (items.length > BULK_MAX) return json({ error: `batch too large (max ${BULK_MAX} per request)` }, 400);

    // Column order for the multi-row INSERT. created_at is special-cased below
    // so a missing/blank value falls back to NOW() rather than inserting NULL
    // into a NOT NULL column.
    const cols = [
      "uuid", "session_id", "from_agent", "to_agent", "channel", "project_id",
      "content", "priority", "working_dir", "repository", "branch", "metadata",
      "edited_at", "pinned_at", "blocking", "attachments", "reply_to",
      "created_at", "read_at",
    ] as const;
    const createdIdx = cols.indexOf("created_at");

    const params: unknown[] = [];
    const rowsSql: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const raw = items[i];
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return json({ error: `messages[${i}] must be an object` }, 400);
      }
      const m = raw as Record<string, unknown>;
      const uuid = str(m.uuid);
      const from = str(m.from) ?? str(m.from_agent) ?? agent ?? undefined;
      const to = str(m.to) ?? str(m.to_agent);
      const content = typeof m.content === "string" ? m.content : undefined;
      if (!uuid || !from || !to || content === undefined) {
        return json({ error: `messages[${i}] requires uuid, from, to, and content` }, 400);
      }
      let priority = str(m.priority)?.toLowerCase() ?? "normal";
      if (!VALID_PRIORITIES.includes(priority)) priority = "normal";
      const values: unknown[] = [
        uuid,
        str(m.session_id) ?? `api:${from}`,
        from,
        to,
        str(m.channel) ?? null,
        str(m.project_id) ?? null,
        content,
        priority,
        str(m.working_dir) ?? null,
        str(m.repository) ?? null,
        str(m.branch) ?? null,
        str(m.metadata) ?? null,
        str(m.edited_at) ?? null,
        str(m.pinned_at) ?? null,
        m.blocking === true || m.blocking === 1,
        str(m.attachments) ?? null,
        typeof m.reply_to === "number" ? m.reply_to : null,
        str(m.created_at) ?? null,
        str(m.read_at) ?? null,
      ];
      const base = params.length;
      const placeholders = values.map((_, j) =>
        j === createdIdx ? `COALESCE($${base + j + 1}::timestamptz, NOW())` : `$${base + j + 1}`,
      );
      rowsSql.push(`(${placeholders.join(", ")})`);
      params.push(...values);
    }

    const result = await client.query(
      `INSERT INTO messages (${cols.join(", ")}) VALUES ${rowsSql.join(", ")}
       ON CONFLICT (uuid) DO NOTHING`,
      params,
    );
    const inserted = result.rowCount;
    const total = await messageTotal(client);
    return json({ requested: items.length, inserted, skipped: items.length - inserted, total }, 200);
  }

  // ---- read receipts for one message ----
  const receiptMatch = sub.match(/^messages\/(\d+)\/receipts$/);
  if (receiptMatch) {
    const id = Number(receiptMatch[1]);
    if (method === "GET") {
      const rows = await client.many(
        `SELECT message_id, agent, read_at FROM message_read_receipts WHERE message_id = $1 ORDER BY read_at ASC`,
        [id],
      );
      return json({ receipts: rows });
    }
    if (method === "POST") {
      const body = await readJson(req);
      const who = str(body.agent) ?? agent ?? undefined;
      if (!who) return json({ error: "agent is required" }, 400);
      const row = await client.get(
        `INSERT INTO message_read_receipts (message_id, agent, read_at) VALUES ($1, $2, NOW())
         ON CONFLICT (message_id, agent) DO UPDATE SET read_at = EXCLUDED.read_at
         RETURNING message_id, agent, read_at`,
        [id, who.toLowerCase()],
      );
      return json({ receipt: row }, 201);
    }
  }

  // ---- pin / unpin one message ----
  const pinMatch = sub.match(/^messages\/(\d+)\/(pin|unpin)$/);
  if (pinMatch && method === "POST") {
    const id = Number(pinMatch[1]);
    const pinning = pinMatch[2] === "pin";
    const row = await client.get(
      `UPDATE messages SET pinned_at = ${pinning ? "NOW()::text" : "NULL"} WHERE id = $1 RETURNING id, pinned_at`,
      [id],
    );
    if (!row) return json({ error: "Message not found" }, 404);
    return json({ message: row });
  }

  const msgIdMatch = sub.match(/^messages\/(\d+)$/);
  if (msgIdMatch) {
    const id = Number(msgIdMatch[1]);
    if (method === "GET") {
      const row = await client.get(`SELECT * FROM messages WHERE id = $1`, [id]);
      if (!row) return json({ error: "Message not found" }, 404);
      return json({ message: row });
    }
    if (method === "PATCH") {
      // Edit content — only the original sender may edit; stamps edited_at.
      const body = await readJson(req);
      const from = str(body.from) ?? agent ?? undefined;
      const content = typeof body.content === "string" ? body.content : undefined;
      if (!from || content === undefined) return json({ error: "from and content are required" }, 400);
      const row = await client.get(
        `UPDATE messages SET content = $1, edited_at = NOW()::text
         WHERE id = $2 AND from_agent = $3 RETURNING *`,
        [content, id, from],
      );
      if (!row) return json({ error: "Message not found or not yours" }, 404);
      return json({ message: row });
    }
    if (method === "DELETE") {
      const from = str(url.searchParams.get("from")) ?? agent ?? undefined;
      if (!from) return json({ error: "'from' is required to delete a message" }, 400);
      const row = await client.get(`DELETE FROM messages WHERE id = $1 AND from_agent = $2 RETURNING id`, [id, from]);
      if (!row) return json({ error: "Message not found or not yours" }, 404);
      return json({ id, deleted: true });
    }
  }

  // ---- channels ----
  if (sub === "channels" && method === "GET") {
    const includeArchived = url.searchParams.get("include_archived") === "true";
    const where = includeArchived ? "" : "WHERE archived_at IS NULL";
    const rows = await client.many(
      `SELECT name, description, topic, project_id, created_by, created_at, archived_at, tags FROM channels ${where} ORDER BY name ASC`,
    );
    return json({ channels: rows });
  }

  if (sub === "channels" && method === "POST") {
    const body = await readJson(req);
    const name = str(body.name);
    const createdBy = str(body.created_by) ?? agent ?? undefined;
    if (!name || !createdBy) return json({ error: "name and created_by are required" }, 400);
    const existing = await client.get(`SELECT name FROM channels WHERE name = $1`, [name]);
    if (existing) return json({ error: "Channel already exists" }, 409);
    const row = await client.get(
      `INSERT INTO channels (name, description, topic, project_id, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING name, description, topic, project_id, created_by, created_at`,
      [name, str(body.description) ?? null, str(body.topic) ?? null, str(body.project_id) ?? null, createdBy],
    );
    return json({ channel: row }, 201);
  }

  const chanMatch = sub.match(/^channels\/([^/]+)$/);
  if (chanMatch) {
    const name = decodeURIComponent(chanMatch[1]);
    if (method === "GET") {
      const row = await client.get(`SELECT * FROM channels WHERE name = $1`, [name]);
      if (!row) return json({ error: "Channel not found" }, 404);
      return json({ channel: row });
    }
    if (method === "PATCH") {
      const body = await readJson(req);
      const sets: string[] = [];
      const params: unknown[] = [];
      for (const field of ["description", "topic", "project_id"] as const) {
        if (field in body) { params.push(str(body[field]) ?? null); sets.push(`${field} = $${params.length}`); }
      }
      if (!sets.length) return json({ error: "No updatable fields provided" }, 400);
      params.push(name);
      const row = await client.get(
        `UPDATE channels SET ${sets.join(", ")} WHERE name = $${params.length} RETURNING *`,
        params,
      );
      if (!row) return json({ error: "Channel not found" }, 404);
      return json({ channel: row });
    }
  }

  const chanArchive = sub.match(/^channels\/([^/]+)\/archive$/);
  if (chanArchive && method === "POST") {
    const name = decodeURIComponent(chanArchive[1]);
    const row = await client.get(
      `UPDATE channels SET archived_at = NOW()::text WHERE name = $1 RETURNING name, archived_at`,
      [name],
    );
    if (!row) return json({ error: "Channel not found" }, 404);
    return json({ channel: row });
  }

  // ---- projects ----
  if (sub === "projects" && method === "GET") {
    const status = str(url.searchParams.get("status"));
    const where = status ? "WHERE status = $1" : "";
    const rows = await client.many(
      `SELECT id, name, description, path, repository, created_by, created_at, status, tags FROM projects ${where} ORDER BY created_at DESC`,
      status ? [status] : [],
    );
    return json({ projects: rows });
  }

  if (sub === "projects" && method === "POST") {
    const body = await readJson(req);
    const name = str(body.name);
    const createdBy = str(body.created_by) ?? agent ?? undefined;
    if (!name || !createdBy) return json({ error: "name and created_by are required" }, 400);
    const dup = await client.get(`SELECT id FROM projects WHERE name = $1`, [name]);
    if (dup) return json({ error: "Project name already exists" }, 409);
    const id = randomUUID();
    const row = await client.get(
      `INSERT INTO projects (id, name, description, path, repository, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,'active') RETURNING id, name, description, path, repository, created_by, created_at, status`,
      [id, name, str(body.description) ?? null, str(body.path) ?? null, str(body.repository) ?? null, createdBy],
    );
    return json({ project: row }, 201);
  }

  const projMatch = sub.match(/^projects\/([^/]+)$/);
  if (projMatch) {
    const id = decodeURIComponent(projMatch[1]);
    if (method === "GET") {
      const row = await client.get(`SELECT * FROM projects WHERE id = $1 OR name = $1`, [id]);
      if (!row) return json({ error: "Project not found" }, 404);
      return json({ project: row });
    }
    if (method === "PATCH") {
      const body = await readJson(req);
      const sets: string[] = [];
      const params: unknown[] = [];
      for (const field of ["name", "description", "path", "repository", "status"] as const) {
        if (field in body) { params.push(str(body[field]) ?? null); sets.push(`${field} = $${params.length}`); }
      }
      if (!sets.length) return json({ error: "No updatable fields provided" }, 400);
      params.push(id);
      const row = await client.get(
        `UPDATE projects SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      if (!row) return json({ error: "Project not found" }, 404);
      return json({ project: row });
    }
    if (method === "DELETE") {
      const row = await client.get(`DELETE FROM projects WHERE id = $1 RETURNING id`, [id]);
      if (!row) return json({ error: "Project not found" }, 404);
      return json({ id, deleted: true });
    }
  }

  // ---- agents (presence) ----
  if (sub === "agents" && method === "GET") {
    const onlineOnly = url.searchParams.get("online_only") === "true";
    const where = onlineOnly ? "WHERE status = 'online'" : "";
    const rows = await client.many(
      `SELECT agent, session_id, role, project_id, status, last_seen_at FROM agent_presence ${where} ORDER BY last_seen_at DESC LIMIT 500`,
    );
    return json({ agents: rows });
  }

  if (sub === "agents/heartbeat" && method === "POST") {
    const body = await readJson(req);
    const name = str(body.agent) ?? agent ?? undefined;
    if (!name) return json({ error: "agent is required" }, 400);
    const projectId = str(body.project_id) ?? "";
    const row = await client.get(
      `INSERT INTO agent_presence (id, agent, session_id, role, project_id, status, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,'online',NOW())
       ON CONFLICT (agent, project_id) DO UPDATE SET status='online', last_seen_at=NOW(), session_id=EXCLUDED.session_id
       RETURNING agent, project_id, status, last_seen_at`,
      [randomUUID(), name, str(body.session_id) ?? null, str(body.role) ?? "agent", projectId],
    );
    return json({ agent: row });
  }

  return json({ error: "Not found" }, 404);
}
