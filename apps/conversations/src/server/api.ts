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
import { normalizeChannelName } from "../lib/channel-names.js";

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

function fieldError(field: string, value: string, reason: string, hint: string, status = 400): Response {
  return json({
    error: "Validation failed",
    code: `invalid_${field}`,
    field,
    value,
    reason,
    hint,
  }, status);
}

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

function jsonObject(v: unknown): Record<string, unknown> | null {
  if (v == null) return null;
  if (typeof v === "string") {
    if (!v.trim()) return null;
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
  return typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

function jsonStringArray(v: unknown): string[] {
  if (v == null) return [];
  if (typeof v === "string") {
    if (!v.trim()) return [];
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(v) ? v.filter((item): item is string => typeof item === "string") : [];
}

function serializeChannel(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    description: row.description ?? null,
    topic: row.topic ?? null,
    project_id: row.project_id ?? null,
    archived_at: row.archived_at ?? null,
    metadata: jsonObject(row.metadata),
    tags: jsonStringArray(row.tags),
  };
}

function clampLimit(raw: string | null, def = 50, max = 500): number {
  let n = parseInt(raw || String(def), 10);
  if (!Number.isFinite(n) || n <= 0) n = def;
  return Math.min(n, max);
}

const VALID_PRIORITIES = ["low", "normal", "high", "urgent"];

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
    const session = str(url.searchParams.get("session"));
    const limit = clampLimit(url.searchParams.get("limit"));
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (to) { params.push(to); clauses.push(`to_agent = $${params.length}`); }
    if (from) { params.push(from); clauses.push(`from_agent = $${params.length}`); }
    if (channel) { params.push(channel); clauses.push(`channel = $${params.length}`); }
    if (session) { params.push(session); clauses.push(`session_id = $${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    params.push(limit);
    const rows = await client.many(
      `SELECT id, uuid, session_id, from_agent, to_agent, channel, project_id, content, priority, blocking, reply_to, created_at, read_at
       FROM messages ${where} ORDER BY id DESC LIMIT $${params.length}`,
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

  const msgIdMatch = sub.match(/^messages\/(\d+)$/);
  if (msgIdMatch) {
    const id = Number(msgIdMatch[1]);
    if (method === "GET") {
      const row = await client.get(`SELECT * FROM messages WHERE id = $1`, [id]);
      if (!row) return json({ error: "Message not found" }, 404);
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
    const where = includeArchived ? "" : "WHERE c.archived_at IS NULL";
    const rows = await client.many(
      `SELECT
        c.name, c.description, c.topic, c.project_id, c.created_by, c.created_at, c.archived_at, c.metadata, c.tags,
        (SELECT COUNT(*)::int FROM channel_members WHERE channel = c.name) AS member_count,
        (SELECT COUNT(*)::int FROM messages WHERE channel = c.name) AS message_count
       FROM channels c ${where} ORDER BY c.name ASC`,
    );
    return json({ channels: rows.map((row) => serializeChannel(row as Record<string, unknown>)) });
  }

  if (sub === "channels" && method === "POST") {
    const body = await readJson(req);
    const name = str(body.name);
    const createdBy = str(body.created_by) ?? agent ?? undefined;
    if (!name || !createdBy) return json({ error: "name and created_by are required" }, 400);
    const channelName = normalizeChannelName(name);
    if (!channelName) return fieldError("name", name, "Channel name normalizes to an empty value.", "Provide at least one letter or digit in the channel name.");
    const existing = await client.get(`SELECT name FROM channels WHERE name = $1`, [channelName]);
    if (existing) return json({ error: "Channel already exists" }, 409);
    const projectId = str(body.project_id) ?? null;
    if (projectId) {
      const project = await client.get(`SELECT id FROM projects WHERE id = $1`, [projectId]);
      if (!project) {
        return fieldError(
          "project_id",
          projectId,
          "No conversations project exists with that id.",
          "Create or resolve the conversations project first with POST/GET /v1/projects, then retry with the returned project.id. If you only need the Projects canonical channel, create or send to that channel name without --project.",
        );
      }
    }
    const metadata = jsonObject(body.metadata);
    if ("metadata" in body && body.metadata != null && !metadata) {
      return fieldError("metadata", String(body.metadata), "metadata must be a JSON object.", "Pass an object such as {\"channel_schema\":{\"class\":\"loop-lane\"}}.");
    }
    const tags = jsonStringArray(body.tags);
    if ("tags" in body && body.tags != null && (!Array.isArray(body.tags) || tags.length !== body.tags.length)) {
      return fieldError("tags", String(body.tags), "tags must be an array of strings.", "Pass tags as a JSON string array, for example [\"team:harness\"].");
    }
    const row = await client.get(
      `INSERT INTO channels (name, description, topic, project_id, created_by, metadata, tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING name, description, topic, project_id, created_by, created_at, archived_at, metadata, tags`,
      [
        channelName,
        str(body.description) ?? null,
        str(body.topic) ?? null,
        projectId,
        createdBy,
        metadata ? JSON.stringify(metadata) : null,
        tags.length ? JSON.stringify(tags) : null,
      ],
    );
    await client.execute(
      `INSERT INTO channel_members (channel, agent) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [channelName, createdBy],
    );
    return json({ channel: { ...serializeChannel(row as Record<string, unknown>), member_count: 1 } }, 201);
  }

  const chanMatch = sub.match(/^channels\/([^/]+)$/);
  if (chanMatch) {
    const name = normalizeChannelName(decodeURIComponent(chanMatch[1]));
    if (method === "GET") {
      const row = await client.get(
        `SELECT
          c.*,
          (SELECT COUNT(*)::int FROM channel_members WHERE channel = c.name) AS member_count,
          (SELECT COUNT(*)::int FROM messages WHERE channel = c.name) AS message_count
         FROM channels c WHERE c.name = $1`,
        [name],
      );
      if (!row) return json({ error: "Channel not found" }, 404);
      return json({ channel: serializeChannel(row as Record<string, unknown>) });
    }
    if (method === "PATCH") {
      const body = await readJson(req);
      const sets: string[] = [];
      const params: unknown[] = [];
      const projectId = str(body.project_id) ?? null;
      if ("project_id" in body && projectId) {
        const project = await client.get(`SELECT id FROM projects WHERE id = $1`, [projectId]);
        if (!project) {
          return fieldError(
            "project_id",
            projectId,
            "No conversations project exists with that id.",
            "Use GET /v1/projects/{id-or-name} or POST /v1/projects to resolve the conversations project id before linking a channel.",
          );
        }
      }
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
      return json({ channel: serializeChannel(row as Record<string, unknown>) });
    }
  }

  const chanArchive = sub.match(/^channels\/([^/]+)\/archive$/);
  if (chanArchive && method === "POST") {
    const name = normalizeChannelName(decodeURIComponent(chanArchive[1]));
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
