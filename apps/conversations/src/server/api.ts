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
import type { TypedQueryClient, PoolQueryClient } from "../generated/storage-kit/query.js";
import { verifyApiKey, ApiKeyStore } from "@hasna/contracts/auth";
import type { ApiKeyVerifier } from "@hasna/contracts/auth";
import { version as pkgVersion } from "../../package.json";
import { openapiSpec } from "./openapi.js";
import { normalizeChannelName } from "../lib/channel-names.js";
import { extractTopics } from "../lib/topic-extract.js";
import {
  buildByteBoundedMessagePreview as buildChannelNotificationPreview,
  finalizeChannelNotificationPage,
  packChannelNotificationPage,
} from "../lib/channel-notifications.js";
import {
  IncidentProjectionConflictError,
  IncidentProjectionValidationError,
  IncidentProjectorConfigurationError,
  metadataSpoofsIncidentProjection,
  validateIncidentProjectorBinding,
} from "../lib/incident-projection-contract.js";
import {
  appendIncidentProjectionPg,
  CHANNEL_IDENTITY_ADVISORY_LOCK,
  getIncidentProjectionPg,
} from "./incident-projections.js";
import type {
  ChannelNotification,
  ExportMessagesOptions,
  IncidentProjectionRequestV1,
  IncidentProjectorContext,
} from "../types.js";
import {
  COLLECTION_PREVIEW_SCAN_CHARS,
  RESTRICTED_CHANNEL_PREVIEW,
  buildMessagePreview as buildCollectionMessagePreview,
  packMessagePreviewPage,
  redactSensitiveText,
  resolveCollectionLimit,
  resolveCollectionMaxBytes,
  resolveCollectionOffset,
  resolveCollectionPreviewBytes,
  resolveCollectionTimeoutMs,
} from "../lib/message-previews.js";
import {
  loadMessageExportArtifact,
  resolveMessageExportOptions,
  serializeMessageExport,
  writeMessageExportArtifact,
} from "../lib/message-exports.js";

export const APP = "conversations";
const SCOPE_READ = `${APP}:read`;
const SCOPE_WRITE = `${APP}:write`;
export const SCOPE_INCIDENT_PROJECT = `${APP}:incident-project`;

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

class ApiRequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiRequestValidationError";
  }
}

function incidentProjectionUnavailable(): Response {
  return json({
    error: "Incident projection service is temporarily unavailable",
    code: "INCIDENT_PROJECTION_UNAVAILABLE",
  }, 503);
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
  // PoolQueryClient (not just TypedQueryClient) so lock acquisition can run its
  // check-then-write inside a real BEGIN/COMMIT transaction, matching the local
  // store's atomic semantics. Falls back gracefully when a test shim omits it.
  client: PoolQueryClient;
  keys: ApiKeyStore;
  verifier: ApiKeyVerifier;
  /** Stable deployment binding; never derived from an API key or request body. */
  incidentProjector: IncidentProjectorContext | null;
}

function incidentProjectorContextFromEnv(): IncidentProjectorContext | null {
  const tenant_id = process.env.HASNA_CONVERSATIONS_TENANT_ID?.trim();
  const authority_id = process.env.HASNA_CONVERSATIONS_INCIDENT_AUTHORITY_ID?.trim();
  if (!tenant_id && !authority_id) return null;
  if (!tenant_id || !authority_id) {
    throw new IncidentProjectorConfigurationError(
      "Incident projector configuration is incomplete: set both HASNA_CONVERSATIONS_TENANT_ID " +
      "and HASNA_CONVERSATIONS_INCIDENT_AUTHORITY_ID.",
    );
  }
  const binding = validateIncidentProjectorBinding(tenant_id, authority_id);
  return {
    ...binding,
    routing: {
      from: process.env.HASNA_CONVERSATIONS_INCIDENT_FROM,
      to: process.env.HASNA_CONVERSATIONS_INCIDENT_TO,
      channel: process.env.HASNA_CONVERSATIONS_INCIDENT_CHANNEL,
      project_id: process.env.HASNA_CONVERSATIONS_INCIDENT_PROJECT_ID,
      session_id: process.env.HASNA_CONVERSATIONS_INCIDENT_SESSION_ID,
    },
  };
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
  return { client, keys, verifier, incidentProjector: incidentProjectorContextFromEnv() };
}

// ---- helpers ----------------------------------------------------------------

type IncidentBlockerFilter = { ids?: number[]; channel?: string; session?: string; includeAcknowledged?: boolean };

async function projectedMessageIds(client: TypedQueryClient, ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const rows = await client.many<{ message_id: string | number }>(
    "SELECT message_id FROM incident_projections WHERE message_id = ANY($1::bigint[])",
    [ids],
  );
  return new Set(rows.map((row) => Number(row.message_id)));
}

async function visibleIncidentBlockerIds(
  client: TypedQueryClient,
  projector: IncidentProjectorContext | null,
  agent: string,
  filter: IncidentBlockerFilter = {},
): Promise<number[]> {
  if (!projector) return [];
  const params: unknown[] = [projector.tenant_id, projector.authority_id, agent];
  const filters: string[] = [];
  if (filter.ids?.length) {
    params.push(filter.ids);
    filters.push(`m.id = ANY($${params.length}::bigint[])`);
  }
  if (filter.channel) {
    params.push(normalizeChannelName(filter.channel));
    filters.push(`m.channel = $${params.length}`);
  }
  if (filter.session) {
    params.push(filter.session);
    filters.push(`m.session_id = $${params.length}`);
  }
  const extra = filters.length ? `AND ${filters.join(" AND ")}` : "";
  const receiptFilter = filter.includeAcknowledged
    ? ""
    : `AND (
         p.pending_handoff
         OR NOT EXISTS (
           SELECT 1 FROM message_read_receipts receipt
           WHERE receipt.message_id = m.id AND lower(receipt.agent) = lower($3)
         )
       )`;
  const rows = await client.many<{ id: string | number }>(
    `WITH member_channel_scopes(scope) AS (
       SELECT 'channel:' || lower(channel)
       FROM channel_members
       WHERE lower(agent) = lower($3)
       UNION
       SELECT 'channel:' || lower(alias.old_channel)
       FROM channel_rename_aliases alias
       JOIN channel_members member ON lower(member.channel) = lower(alias.current_channel)
       WHERE lower(member.agent) = lower($3)
     ),
     latest AS (
       SELECT p.*
       FROM incident_projections p
       JOIN (
         SELECT tenant_id, authority_id, incident_id, MAX(incident_version) AS incident_version
         FROM incident_projections
         WHERE tenant_id = $1 AND authority_id = $2
         GROUP BY tenant_id, authority_id, incident_id
       ) current
         ON current.tenant_id = p.tenant_id
        AND current.authority_id = p.authority_id
        AND current.incident_id = p.incident_id
        AND current.incident_version = p.incident_version
     ),
     blocker_candidates AS (
       SELECT p.*,
              CASE WHEN p.status = 'superseded'
                         AND p.superseded_by_incident_id IS NOT NULL
                         AND NOT EXISTS (
                           SELECT 1 FROM incident_projections replacement
                           WHERE replacement.tenant_id = p.tenant_id
                             AND replacement.authority_id = p.authority_id
                             AND replacement.incident_id = p.superseded_by_incident_id
                             AND replacement.supersedes_incident_id = p.incident_id
                         )
                   THEN TRUE ELSE FALSE END AS pending_handoff
       FROM latest p
     )
     SELECT DISTINCT m.id
     FROM blocker_candidates p
     JOIN messages m ON m.id = p.message_id
     JOIN incident_projection_scopes scope
       ON scope.projection_id = p.id AND scope.scope_type = 'blocked'
     WHERE (
         (p.status IN ('open','investigating','contained','monitoring') AND p.blocking = TRUE)
         OR p.pending_handoff
       )
       ${receiptFilter}
       AND (
         lower(scope.scope) = 'agent:' || lower($3)
         OR lower(scope.scope) IN (SELECT scope FROM member_channel_scopes)
         OR scope.scope IN (
           SELECT 'project:' || project_id FROM agent_presence
           WHERE lower(agent) = lower($3) AND project_id <> ''
         )
       )
       ${extra}`,
    params,
  );
  return rows.map((row) => Number(row.id));
}

async function upsertReadReceipts(client: TypedQueryClient, ids: number[], agent: string): Promise<number> {
  if (ids.length === 0) return 0;
  const result = await client.query(
    `INSERT INTO message_read_receipts (message_id, agent, read_at)
     SELECT message_id, $2, NOW() FROM unnest($1::bigint[]) AS message_id
     ON CONFLICT (message_id, agent) DO NOTHING`,
    [ids, agent.toLowerCase()],
  );
  return result.rowCount;
}

async function requireIncidentBlockerContext(
  client: TypedQueryClient,
  context: IncidentProjectorContext | null,
): Promise<IncidentProjectorContext | null> {
  const any = await client.get<{ n: string | number }>("SELECT COUNT(*)::bigint AS n FROM incident_projections");
  if (!context) {
    if (Number(any?.n ?? 0) === 0) return null;
    throw new IncidentProjectorConfigurationError(
      "Canonical blocker reads require a configured incident projector tenant and authority",
    );
  }
  const binding = validateIncidentProjectorBinding(context.tenant_id, context.authority_id);
  if (Number(any?.n ?? 0) > 0) {
    const selected = await client.get<{ n: string | number }>(
      "SELECT COUNT(*)::bigint AS n FROM incident_projections WHERE tenant_id = $1 AND authority_id = $2",
      [binding.tenant_id, binding.authority_id],
    );
    if (Number(selected?.n ?? 0) === 0) {
      throw new IncidentProjectorConfigurationError(
        "Configured incident projector tenant/authority does not match stored canonical projections",
      );
    }
  }
  return { ...context, ...binding };
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiRequestValidationError("Request body must contain valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiRequestValidationError("Request body must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function strictIntegerParam(raw: string | null, name: string, allowZero = false): number | undefined {
  if (raw === null) return undefined;
  const normalized = raw.trim();
  const pattern = allowZero ? /^(?:0|[1-9]\d*)$/ : /^[1-9]\d*$/;
  if (!pattern.test(normalized)) {
    throw new ApiRequestValidationError(`${name} must be ${allowZero ? "a non-negative" : "a positive"} integer`);
  }
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed)) throw new ApiRequestValidationError(`${name} is outside the safe integer range`);
  return parsed;
}

function strictBooleanParam(raw: string | null, name: string): boolean {
  if (raw === null) return false;
  const normalized = raw.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  throw new ApiRequestValidationError(`${name} must be true or false`);
}

function strictStringParam(raw: string | null, name: string): string | undefined {
  if (raw === null) return undefined;
  const normalized = raw.trim();
  if (!normalized) throw new ApiRequestValidationError(`${name} must not be empty`);
  return normalized;
}

function strictDateParam(raw: string | null, name: string): string | undefined {
  const normalized = strictStringParam(raw, name);
  if (normalized === undefined) return undefined;
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new ApiRequestValidationError(`${name} must be a valid ISO 8601 date`);
  }
  return normalized;
}

function clampLimit(raw: string | null, def = 50, max = 500): number {
  let n = parseInt(raw || String(def), 10);
  if (!Number.isFinite(n) || n <= 0) n = def;
  return Math.min(n, max);
}

function restrictedMessagePredicatePg(alias = ""): string {
  const c = alias ? `${alias}.` : "";
  return `(lower(COALESCE(${c}channel, '')) LIKE '%incident%' OR lower(COALESCE(${c}channel, '')) LIKE '%security%' OR lower(COALESCE(${c}to_agent, '')) LIKE '%incident%' OR lower(COALESCE(${c}to_agent, '')) LIKE '%security%' OR lower(COALESCE(${c}session_id, '')) LIKE '%incident%' OR lower(COALESCE(${c}session_id, '')) LIKE '%security%')`;
}

function messagePreviewProjectionPg(alias = ""): string {
  const c = alias ? `${alias}.` : "";
  const restricted = restrictedMessagePredicatePg(alias);
  return `${c}id, ${c}uuid, ${c}session_id, ${c}from_agent, ${c}to_agent, ${c}channel, ${c}project_id,
          ${c}priority, ${c}blocking, ${c}reply_to, ${c}working_dir, ${c}repository, ${c}branch,
          ${c}created_at, ${c}read_at, ${c}edited_at, ${c}pinned_at,
          CASE WHEN ${c}metadata IS NULL OR ${c}metadata = '' THEN FALSE ELSE TRUE END AS has_metadata,
          CASE WHEN ${c}attachments IS NULL OR ${c}attachments = '' THEN 0 ELSE jsonb_array_length(${c}attachments::jsonb) END AS attachment_count,
          CASE WHEN ${restricted} THEN '' ELSE left(${c}content, ${COLLECTION_PREVIEW_SCAN_CHARS}) END AS preview_source,
          octet_length(${c}content) AS content_bytes`;
}

function collectionReadOptions(url: URL): {
  limit: number;
  offset: number;
  maxBytes: number;
  previewBytes: number;
  timeoutMs: number;
} {
  try {
    return {
      limit: resolveCollectionLimit(url.searchParams.get("limit")),
      offset: resolveCollectionOffset(url.searchParams.get("offset") ?? url.searchParams.get("cursor")),
      maxBytes: resolveCollectionMaxBytes(url.searchParams.get("max_bytes")),
      previewBytes: resolveCollectionPreviewBytes(url.searchParams.get("preview_bytes")),
      timeoutMs: resolveCollectionTimeoutMs(url.searchParams.get("timeout_ms")),
    };
  } catch (error) {
    throw new ApiRequestValidationError(error instanceof Error ? error.message : String(error));
  }
}

function analyticsReadOptions(url: URL): { limit: number; timeoutMs: number } {
  try {
    return {
      limit: resolveCollectionLimit(url.searchParams.get("limit") ?? 100),
      timeoutMs: resolveCollectionTimeoutMs(url.searchParams.get("timeout_ms")),
    };
  } catch (error) {
    throw new ApiRequestValidationError(error instanceof Error ? error.message : String(error));
  }
}

async function boundedCollectionQuery<T>(
  client: PoolQueryClient,
  timeoutMs: number,
  query: (tx: TypedQueryClient) => Promise<T>,
): Promise<T> {
  return client.transaction(async (tx) => {
    await tx.execute(`SET LOCAL statement_timeout = ${Math.max(1, Math.floor(timeoutMs))}`);
    return query(tx);
  });
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

// ---- shared row parsers (match the local store's parse* shapes) --------------

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const p = JSON.parse(value);
    return p && typeof p === "object" && !Array.isArray(p) ? (p as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseJsonArray(value: unknown): unknown[] | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const p = JSON.parse(value);
    return Array.isArray(p) ? p : null;
  } catch {
    return null;
  }
}

/** Coerce a DB row into the client-facing Message shape (mirrors messages.ts parseMessage). */
function parseServerMessage(row: Record<string, unknown>): Record<string, unknown> {
  const id = row.id == null ? row.id : Number(row.id);
  const replyTo = row.reply_to == null ? null : Number(row.reply_to);
  const replyCount = row.reply_count == null ? undefined : Number(row.reply_count);
  return {
    ...row,
    id,
    metadata: parseJsonObject(row.metadata),
    attachments: parseJsonArray(row.attachments),
    blocking: !!row.blocking,
    reply_to: replyTo || null,
    ...(replyCount === undefined ? {} : { reply_count: replyCount }),
  };
}

/** Coerce a DB row into the client-facing Channel/ChannelInfo shape. */
function parseServerChannel(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: row.name,
    description: (row.description as string) || null,
    topic: (row.topic as string) || null,
    project_id: (row.project_id as string) || null,
    created_by: row.created_by,
    created_at: row.created_at,
    archived_at: (row.archived_at as string) || null,
    metadata: parseJsonObject(row.metadata),
    tags: parseJsonArray(row.tags) ?? [],
  };
  if (row.member_count != null) out.member_count = Number(row.member_count);
  if (row.message_count != null) out.message_count = Number(row.message_count);
  return out;
}

/** Coerce a project DB row into the client-facing Project/ProjectInfo shape. */
function parseServerProject(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: row.id,
    name: row.name,
    description: (row.description as string) || null,
    path: (row.path as string) || null,
    created_by: row.created_by,
    created_at: row.created_at,
    metadata: parseJsonObject(row.metadata),
    tags: parseJsonArray(row.tags) ?? [],
    status: (row.status as string) || "active",
    repository: (row.repository as string) || null,
    settings: parseJsonObject(row.settings),
  };
  if (row.channel_count != null) out.channel_count = Number(row.channel_count);
  return out;
}

/** Extract unique @mentions (lowercase) from message content. */
function parseMentions(content: string): string[] {
  const matches = content.match(/@([a-zA-Z0-9_-]+)/g) ?? [];
  return [...new Set(matches.map((m) => m.slice(1).toLowerCase()))];
}

/** Persist @mention rows and fan out notification DMs (mirrors messages.ts processMentions). */
async function processMentions(
  client: TypedQueryClient,
  messageId: number,
  fromAgent: string,
  channel: string,
  content: string,
): Promise<void> {
  const mentions = parseMentions(content);
  for (const m of mentions) {
    try {
      await client.query(
        `INSERT INTO message_mentions (message_id, mentioned_agent, from_agent, channel) VALUES ($1,$2,$3,$4)`,
        [messageId, m, fromAgent, channel],
      );
      if (m !== fromAgent.toLowerCase()) {
        const sid = `${[fromAgent, m].sort().join("-")}-${randomUUID().slice(0, 8)}`;
        await client.query(
          `INSERT INTO messages (uuid, session_id, from_agent, to_agent, content, priority, metadata)
           VALUES ($1,$2,$3,$4,$5,'normal',$6)`,
          [
            randomUUID().replace(/-/g, ""),
            sid,
            fromAgent,
            m,
            `You were mentioned in #${channel} by ${fromAgent} (message #${messageId})`,
            JSON.stringify({ type: "mention_notification", source_message_id: messageId, channel }),
          ],
        );
      }
    } catch {
      /* ignore duplicate/errors, matching local best-effort behaviour */
    }
  }
}

/**
 * Rename a channel and rewrite every table that references its name, inside one
 * transaction. Unlike the SQLite path (FKs off), Postgres enforces the
 * channel_members/channel_subscriptions → channels(name) FK, so the new channel
 * row is created first, children are moved, then the old row is dropped.
 */
export async function renameChannelServer(
  client: PoolQueryClient,
  oldName: string,
  newName: string,
): Promise<{ ok: true; name: string } | { ok: false; error: string; status: number }> {
  const from = normalizeChannelName(oldName);
  const to = normalizeChannelName(newName);
  try {
    return await client.transaction(async (tx) => {
      await tx.get(
        "SELECT pg_advisory_xact_lock($1::bigint) AS channel_identity_locked",
        [CHANNEL_IDENTITY_ADVISORY_LOCK],
      );
      const existing = await tx.get(`SELECT name FROM channels WHERE name = $1 FOR UPDATE`, [from]);
      if (!existing) return { ok: false as const, error: `Channel not found: ${from}`, status: 404 };
      if (from === to) return { ok: true as const, name: from };
      const conflict = await tx.get(`SELECT name FROM channels WHERE name = $1 FOR UPDATE`, [to]);
      if (conflict) return { ok: false as const, error: `Channel #${to} already exists.`, status: 409 };
      const targetAlias = await tx.get<{ current_channel: string }>(
        `SELECT current_channel FROM channel_rename_aliases WHERE old_channel = $1 FOR UPDATE`,
        [to],
      );
      if (targetAlias && targetAlias.current_channel !== from) {
        return {
          ok: false as const,
          error: `Channel #${to} is a reserved historical alias for #${targetAlias.current_channel}.`,
          status: 409,
        };
      }

      await tx.get(
        `SELECT set_config('hasna.conversations.channel_scope_rewrite', $1, TRUE) AS configured`,
        [JSON.stringify({
          old_session_id: `channel:${from}`,
          new_session_id: `channel:${to}`,
          old_channel: from,
          new_channel: to,
          old_to_agent: from,
          new_to_agent: to,
        })],
      );
      await tx.query(
        `INSERT INTO channels (name, description, topic, project_id, created_by, created_at, archived_at, metadata, tags)
         SELECT $1, description, topic, project_id, created_by, created_at, archived_at, metadata, tags
         FROM channels WHERE name = $2`,
        [to, from],
      );
      await tx.query(`DELETE FROM channel_rename_aliases WHERE old_channel = $1`, [to]);
      await tx.query(
        `UPDATE channel_rename_aliases
         SET current_channel = $1, renamed_at = NOW()
         WHERE current_channel = $2`,
        [to, from],
      );
      await tx.query(
        `INSERT INTO channel_rename_aliases (old_channel, current_channel)
         VALUES ($1, $2)
         ON CONFLICT (old_channel) DO UPDATE SET
           current_channel = EXCLUDED.current_channel,
           renamed_at = NOW()`,
        [from, to],
      );
      await tx.query(`DELETE FROM channel_rename_aliases WHERE old_channel = current_channel`);
      await tx.query(`UPDATE channel_members SET channel = $1 WHERE channel = $2`, [to, from]);
      await tx.query(`UPDATE channel_subscriptions SET channel = $1 WHERE channel = $2`, [to, from]);
      await tx.query(
        `UPDATE messages
         SET channel = $1,
             session_id = CASE WHEN session_id = $3 THEN $4 ELSE session_id END,
             to_agent = CASE WHEN to_agent = $2 THEN $1 ELSE to_agent END
         WHERE channel = $2`,
        [to, from, `channel:${from}`, `channel:${to}`],
      );
      await tx.query(
        `UPDATE messages SET session_id = $1
         WHERE session_id = $2 AND (channel IS NULL OR channel <> $3)`,
        [`channel:${to}`, `channel:${from}`, to],
      );
      await tx.query(`UPDATE message_mentions SET channel = $1 WHERE channel = $2`, [to, from]);
      await tx.query(`UPDATE tasks SET channel = $1 WHERE channel = $2`, [to, from]);
      await tx.query(`UPDATE graph_edges SET from_id = $1 WHERE from_type = 'channel' AND from_id = $2`, [to, from]);
      await tx.query(`UPDATE graph_edges SET to_id = $1 WHERE to_type = 'channel' AND to_id = $2`, [to, from]);
      await tx.query(`UPDATE resource_locks SET resource_id = $1 WHERE resource_type = 'channel' AND resource_id = $2`, [to, from]);
      await tx.query(`DELETE FROM channels WHERE name = $1`, [from]);
      return { ok: true as const, name: to };
    });
  } catch (error) {
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, error: `Channel #${to} already exists.`, status: 409 };
    }
    throw error;
  }
}

// ---- task helpers ------------------------------------------------------------

const VALID_TASK_STATUSES = ["pending", "in_progress", "completed", "cancelled", "blocked"];

/** Resolve the numeric primary key for a task id-or-uuid path param. */
async function resolveTaskId(client: TypedQueryClient, idParam: string): Promise<number | null> {
  const isId = /^\d+$/.test(idParam);
  const row = await client.get<{ id: number }>(
    `SELECT id FROM tasks WHERE ${isId ? "id" : "uuid"} = $1`,
    [isId ? Number(idParam) : idParam],
  );
  return row ? Number(row.id) : null;
}

async function logTaskActivity(client: TypedQueryClient, taskId: number, agent: string, action: string, detail?: string | null): Promise<void> {
  await client.query(
    `INSERT INTO task_activity (task_id, agent, action, detail) VALUES ($1,$2,$3,$4)`,
    [taskId, agent, action, detail ?? null],
  );
}

function parseTaskRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: Number(row.id),
    uuid: row.uuid,
    subject: row.subject,
    description: (row.description as string) || null,
    status: row.status,
    priority: row.priority,
    assignee: (row.assignee as string) || null,
    reporter: row.reporter,
    project_id: (row.project_id as string) || null,
    channel: (row.channel as string) || null,
    parent_id: row.parent_id == null ? null : Number(row.parent_id),
    depends_on: parseJsonArray(row.depends_on),
    tags: parseJsonArray(row.tags),
    metadata: parseJsonObject(row.metadata),
    created_at: row.created_at,
    started_at: (row.started_at as string) || null,
    completed_at: (row.completed_at as string) || null,
    cancelled_at: (row.cancelled_at as string) || null,
    due_at: (row.due_at as string) || null,
  };
}

/** Attach subtask/comment/dependency counts + blocker_info to base task rows (mirrors enrichTask). */
async function enrichTasks(client: TypedQueryClient, rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => Number(r.id));
  const [subCounts, comCounts, deps] = await Promise.all([
    client.many<{ parent_id: number; c: number }>(
      `SELECT parent_id, COUNT(*)::int AS c FROM tasks WHERE parent_id = ANY($1::bigint[]) GROUP BY parent_id`,
      [ids],
    ),
    client.many<{ task_id: number; c: number }>(
      `SELECT task_id, COUNT(*)::int AS c FROM task_comments WHERE task_id = ANY($1::bigint[]) GROUP BY task_id`,
      [ids],
    ),
    client.many<{ task_id: number; dep_id: number; subject: string; status: string }>(
      `SELECT td.task_id, dt.id AS dep_id, dt.subject, dt.status
       FROM task_dependencies td JOIN tasks dt ON dt.id = td.depends_on_id
       WHERE td.task_id = ANY($1::bigint[]) ORDER BY td.task_id`,
      [ids],
    ),
  ]);
  const subMap = new Map(subCounts.map((r) => [Number(r.parent_id), Number(r.c)]));
  const comMap = new Map(comCounts.map((r) => [Number(r.task_id), Number(r.c)]));
  const blockerMap = new Map<number, Array<{ task_id: number; subject: string; status: string }>>();
  for (const d of deps) {
    const list = blockerMap.get(Number(d.task_id)) ?? [];
    list.push({ task_id: Number(d.dep_id), subject: d.subject, status: d.status });
    blockerMap.set(Number(d.task_id), list);
  }
  return rows.map((row) => {
    const id = Number(row.id);
    const blockers = blockerMap.get(id) ?? [];
    return {
      ...parseTaskRow(row),
      subtask_count: subMap.get(id) ?? 0,
      comment_count: comMap.get(id) ?? 0,
      dependency_count: blockers.length,
      blocker_info: blockers,
    };
  });
}

/** Fetch a single enriched task by numeric id. */
async function getEnrichedTask(client: TypedQueryClient, id: number): Promise<Record<string, unknown> | null> {
  const row = await client.get<Record<string, unknown>>(`SELECT * FROM tasks WHERE id = $1`, [id]);
  if (!row) return null;
  return (await enrichTasks(client, [row]))[0] ?? null;
}

/** After a task completes, flip any fully-satisfied blocked dependents to pending. */
async function unblockDependents(client: TypedQueryClient, completedId: number): Promise<void> {
  const dependents = await client.many<{ task_id: number; status: string }>(
    `SELECT td.task_id, t.status FROM task_dependencies td JOIN tasks t ON t.id = td.task_id WHERE td.depends_on_id = $1`,
    [completedId],
  );
  for (const dep of dependents) {
    if (dep.status !== "blocked") continue;
    const inc = await client.get<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM task_dependencies td JOIN tasks t ON t.id = td.depends_on_id
       WHERE td.task_id = $1 AND t.status <> 'completed'`,
      [dep.task_id],
    );
    if (Number(inc?.c ?? 0) === 0) {
      await client.query(`UPDATE tasks SET status = 'pending' WHERE id = $1`, [dep.task_id]);
      await logTaskActivity(client, Number(dep.task_id), "", "auto_unblocked", `dependency #${completedId} completed`);
    }
  }
}

/** Walk the dependency chain to detect a would-be cycle (mirrors isCircularDependency). */
async function isCircularDependency(client: TypedQueryClient, taskId: number, dependsOnId: number): Promise<boolean> {
  const visited = new Set<number>();
  let current: number | undefined = dependsOnId;
  let depth = 0;
  while (current !== undefined && depth < 20) {
    if (current === taskId) return true;
    if (visited.has(current)) break;
    visited.add(current);
    const cur: number = current;
    const parents = await client.many<{ depends_on_id: number }>(
      `SELECT depends_on_id FROM task_dependencies WHERE task_id = $1`,
      [cur],
    );
    current = parents.length > 0 ? Number(parents[0].depends_on_id) : undefined;
    depth++;
  }
  return false;
}

// ---- presence helper ---------------------------------------------------------

/** Coerce an agent_presence row into the client-facing AgentPresence shape. */
function parsePresenceRow(row: Record<string, unknown>): Record<string, unknown> {
  const projectId = typeof row.project_id === "string" && row.project_id.trim() ? row.project_id.trim() : null;
  return {
    id: (row.id as string) || "",
    agent: row.agent,
    session_id: (row.session_id as string | null) ?? null,
    role: (row.role as string) || "agent",
    project_id: projectId,
    status: row.status,
    last_seen_at: row.last_seen_at,
    created_at: row.created_at ?? row.last_seen_at,
    online: row.online === true,
    metadata: parseJsonObject(row.metadata),
  };
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
          const incidentProjectionWrite = path === "/v1/incident-projections" && method === "POST";
          const decision = await verifier.authenticate(req.headers, {
            method,
            path,
            requiredScopes: [incidentProjectionWrite ? SCOPE_INCIDENT_PROJECT : writing ? SCOPE_WRITE : SCOPE_READ],
          });
          if (!decision.ok) {
            return json({ error: decision.message, reason: decision.reason }, decision.status, {
              "WWW-Authenticate": "Bearer",
            });
          }
          return await handleV1(path, method, req, url, deps, decision.principal.agent);
        }

        return json({ error: "Not found" }, 404);
      } catch (e) {
        if (e instanceof ApiRequestValidationError) {
          return json({ error: e.message }, 400);
        }
        if (path === "/v1/incident-projections" || path.startsWith("/v1/incident-projections/")) {
          console.error("[incident-projector] request failed with an unexpected storage/runtime error");
          return incidentProjectionUnavailable();
        }
        console.error(`[api] unexpected ${method} request failure`);
        return json({ error: "Service is temporarily unavailable", code: "SERVICE_UNAVAILABLE" }, 503);
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

  // ---- canonical Todos incident projections ----
  if (sub === "incident-projections" && method === "POST") {
    if (!deps.incidentProjector) return json({ error: "Incident projector authority is not configured" }, 503);
    const body = await readJson(req);
    try {
      const projection = await appendIncidentProjectionPg(
        client,
        body as unknown as IncidentProjectionRequestV1,
        deps.incidentProjector,
      );
      return json({ projection }, projection.replayed ? 200 : 201);
    } catch (error) {
      if (error instanceof IncidentProjectionConflictError) {
        return json({ error: error.message, code: error.code }, 409);
      }
      if (error instanceof IncidentProjectionValidationError) {
        return json({ error: error.message, code: error.code }, 400);
      }
      console.error("[incident-projector] append failed with an unexpected storage/runtime error");
      return incidentProjectionUnavailable();
    }
  }

  const projectionMatch = sub.match(/^incident-projections\/(iev_[0-9a-f]{32})$/);
  if (projectionMatch && method === "GET") {
    if (!deps.incidentProjector) return json({ error: "Incident projector authority is not configured" }, 503);
    const projection = await getIncidentProjectionPg(client, projectionMatch[1], deps.incidentProjector);
    if (!projection) return json({ error: "Incident projection not found" }, 404);
    return json({ projection });
  }

  // ---- messages ----
  if (sub === "messages/blockers" && method === "GET") {
    if (!agent) return json({ error: "authenticated agent is required" }, 401);
    const requestedAgent = str(url.searchParams.get("agent"));
    if (requestedAgent && requestedAgent.toLowerCase() !== agent.toLowerCase()) {
      return json({ error: "blocker agent must match the authenticated agent" }, 403);
    }
    const who = agent;
    const collection = collectionReadOptions(url);
    let projector: IncidentProjectorContext | null;
    try {
      projector = await requireIncidentBlockerContext(client, deps.incidentProjector);
    } catch (error) {
      if (error instanceof IncidentProjectorConfigurationError) {
        return json({ error: error.message, code: error.code }, 503);
      }
      throw error;
    }
    const rows = await boundedCollectionQuery(client, collection.timeoutMs, (tx) => tx.many<Record<string, unknown>>(
      `WITH member_channel_scopes(scope) AS (
         SELECT 'channel:' || lower(channel)
         FROM channel_members
         WHERE lower(agent) = lower($3)
         UNION
         SELECT 'channel:' || lower(alias.old_channel)
         FROM channel_rename_aliases alias
         JOIN channel_members member ON lower(member.channel) = lower(alias.current_channel)
         WHERE lower(member.agent) = lower($3)
       ),
       latest AS (
         SELECT p.*
         FROM incident_projections p
         JOIN (
           SELECT tenant_id, authority_id, incident_id, MAX(incident_version) AS incident_version
           FROM incident_projections
           WHERE $1::text IS NOT NULL AND $2::text IS NOT NULL
             AND tenant_id = $1 AND authority_id = $2
           GROUP BY tenant_id, authority_id, incident_id
         ) current
           ON current.tenant_id = p.tenant_id
          AND current.authority_id = p.authority_id
          AND current.incident_id = p.incident_id
          AND current.incident_version = p.incident_version
       ),
       blocker_candidates AS (
         SELECT p.*,
                CASE WHEN p.status = 'superseded'
                           AND p.superseded_by_incident_id IS NOT NULL
                           AND NOT EXISTS (
                             SELECT 1 FROM incident_projections replacement
                             WHERE replacement.tenant_id = p.tenant_id
                               AND replacement.authority_id = p.authority_id
                               AND replacement.incident_id = p.superseded_by_incident_id
                               AND replacement.supersedes_incident_id = p.incident_id
                           )
                     THEN TRUE ELSE FALSE END AS pending_handoff
         FROM latest p
       ),
       projected_ids AS (
         SELECT DISTINCT m.id
         FROM blocker_candidates p
         JOIN messages m ON m.id = p.message_id
         JOIN incident_projection_scopes scope
           ON scope.projection_id = p.id AND scope.scope_type = 'blocked'
         WHERE (
             (p.status IN ('open','investigating','contained','monitoring') AND p.blocking = TRUE)
             OR p.pending_handoff
           )
           AND (
             p.pending_handoff
             OR NOT EXISTS (
               SELECT 1 FROM message_read_receipts receipt
               WHERE receipt.message_id = m.id AND lower(receipt.agent) = lower($3)
             )
           )
           AND (
             lower(scope.scope) = 'agent:' || lower($3)
             OR lower(scope.scope) IN (SELECT scope FROM member_channel_scopes)
             OR scope.scope IN (
               SELECT 'project:' || project_id FROM agent_presence
               WHERE lower(agent) = lower($3) AND project_id <> ''
             )
           )
       ),
       legacy_ids AS (
         SELECT m.id
         FROM messages m
         LEFT JOIN incident_projections p ON p.message_id = m.id
         WHERE p.id IS NULL AND m.blocking = TRUE AND m.read_at IS NULL
           AND (
             lower(m.to_agent) = lower($3)
             OR m.channel IN (SELECT channel FROM channel_members WHERE lower(agent) = lower($3))
           )
       ),
       eligible_ids AS (
         SELECT id FROM projected_ids UNION SELECT id FROM legacy_ids
       )
       SELECT ${messagePreviewProjectionPg("m")} FROM messages m JOIN eligible_ids eligible ON eligible.id = m.id
       ORDER BY m.created_at ASC, m.id ASC LIMIT $4 OFFSET $5`,
      [projector?.tenant_id ?? null, projector?.authority_id ?? null, who, collection.limit + 1, collection.offset],
    ));
    return json(packMessagePreviewPage(rows.map((row) => buildCollectionMessagePreview(row, collection.previewBytes)), {
      limit: collection.limit,
      cursor: collection.offset,
      max_bytes: collection.maxBytes,
      timeout_ms: collection.timeoutMs,
    }));
  }

  if (sub === "messages" && method === "GET") {
    const to = strictStringParam(url.searchParams.get("to"), "to");
    const from = strictStringParam(url.searchParams.get("from"), "from");
    const channel = strictStringParam(url.searchParams.get("channel"), "channel");
    const session = strictStringParam(url.searchParams.get("session"), "session")
      ?? strictStringParam(url.searchParams.get("session_id"), "session_id");
    const projectId = strictStringParam(url.searchParams.get("project_id"), "project_id");
    const since = strictDateParam(url.searchParams.get("since"), "since");
    const id = strictIntegerParam(url.searchParams.get("id"), "id");
    const replyTo = strictIntegerParam(url.searchParams.get("reply_to"), "reply_to");
    const sinceId = strictIntegerParam(url.searchParams.get("since_id"), "since_id", true);
    const q = strictStringParam(url.searchParams.get("q"), "q");
    const uuid = strictStringParam(url.searchParams.get("uuid"), "uuid");
    const mentionsOnly = strictStringParam(url.searchParams.get("mentions_only"), "mentions_only");
    const unreadOnly = strictBooleanParam(url.searchParams.get("unread_only"), "unread_only");
    const threadsOnly = strictBooleanParam(url.searchParams.get("threads_only"), "threads_only");
    const pinnedOnly = strictBooleanParam(url.searchParams.get("pinned_only"), "pinned_only");
    const includeReplyCounts = strictBooleanParam(url.searchParams.get("include_reply_counts"), "include_reply_counts");
    const blockingOnly = strictBooleanParam(url.searchParams.get("blocking_only"), "blocking_only");
    const countOnly = strictBooleanParam(url.searchParams.get("count"), "count");
    const detail = strictStringParam(url.searchParams.get("detail"), "detail");
    if (detail && detail !== "preview") {
      throw new ApiRequestValidationError("detail must be preview; use GET /v1/messages/{id} for one exact message");
    }
    // Default DESC (newest first) preserves the original behaviour; ?order=asc
    // gives chronological order for read_channel-style paging.
    const requestedOrder = strictStringParam(url.searchParams.get("order"), "order")?.toLowerCase();
    if (requestedOrder && requestedOrder !== "asc" && requestedOrder !== "desc") {
      throw new ApiRequestValidationError("order must be asc or desc");
    }
    const order = requestedOrder === "asc" ? "ASC" : "DESC";
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (id !== undefined) { params.push(id); clauses.push(`id = $${params.length}`); }
    if (to) { params.push(to); clauses.push(`to_agent = $${params.length}`); }
    if (from) { params.push(from); clauses.push(`from_agent = $${params.length}`); }
    if (channel) { params.push(channel); clauses.push(`channel = $${params.length}`); }
    if (session) { params.push(session); clauses.push(`session_id = $${params.length}`); }
    if (projectId) { params.push(projectId); clauses.push(`project_id = $${params.length}`); }
    if (uuid) { params.push(uuid); clauses.push(`uuid = $${params.length}`); }
    if (since) { params.push(since); clauses.push(`created_at > $${params.length}`); }
    if (sinceId !== undefined) { params.push(sinceId); clauses.push(`id > $${params.length}`); }
    if (q) { params.push(`%${q}%`); clauses.push(`content ILIKE $${params.length}`); }
    if (mentionsOnly) {
      params.push(mentionsOnly.toLowerCase());
      clauses.push(`id IN (SELECT message_id FROM message_mentions WHERE mentioned_agent = $${params.length})`);
    }
    if (unreadOnly) clauses.push(`read_at IS NULL`);
    if (threadsOnly) clauses.push(`reply_to IS NULL`);
    if (replyTo !== undefined) { params.push(replyTo); clauses.push(`reply_to = $${params.length}`); }
    if (pinnedOnly) clauses.push(`pinned_at IS NOT NULL`);
    if (blockingOnly) clauses.push(`blocking = true`);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    // count=1 → authoritative total (honours the same filters). Lets callers
    // verify backfill parity from the API without paging through every row.
    if (countOnly) {
      let timeoutMs: number;
      try {
        timeoutMs = resolveCollectionTimeoutMs(url.searchParams.get("timeout_ms"));
      } catch (error) {
        throw new ApiRequestValidationError(error instanceof Error ? error.message : String(error));
      }
      const row = await boundedCollectionQuery(client, timeoutMs, (tx) => tx.get<{ n: string | number }>(
        `SELECT count(*)::bigint AS n FROM messages ${where}`,
        params,
      ));
      return json({ count: Number(row?.n ?? 0) });
    }
    const collection = collectionReadOptions(url);
    const replyCountSelect = includeReplyCounts
      ? `, (SELECT count(*) FROM messages r WHERE r.reply_to = messages.id)::int AS reply_count`
      : "";

    params.push(collection.limit + 1);
    const limitIdx = params.length;
    params.push(collection.offset);
    const offsetIdx = params.length;
    const rows = await boundedCollectionQuery(client, collection.timeoutMs, (tx) => tx.many<Record<string, unknown>>(
      `SELECT ${messagePreviewProjectionPg()}${replyCountSelect}
       FROM messages ${where} ORDER BY created_at ${order}, id ${order} LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    ));
    return json(packMessagePreviewPage(rows.map((row) => buildCollectionMessagePreview(row, collection.previewBytes)), {
      limit: collection.limit,
      cursor: collection.offset,
      max_bytes: collection.maxBytes,
      timeout_ms: collection.timeoutMs,
      query: q,
    }));
  }

  // ---- mark messages read (per-agent receipts + global read_at) ----
  // Mirrors the local markReadByIds/markAllRead/markChannelRead/markSessionRead
  // semantics so read state routes to the cloud identically.
  if (sub === "messages/read" && method === "POST") {
    const body = await readJson(req);
    if (!agent) return json({ error: "authenticated agent is required" }, 401);
    const requestedReader = str(body.reader) ?? str(body.agent);
    if (requestedReader && requestedReader.toLowerCase() !== agent.toLowerCase()) {
      return json({ error: "reader must match the authenticated agent" }, 403);
    }
    const reader = agent;
    const ids = Array.isArray(body.ids)
      ? (body.ids as unknown[]).map(Number).filter((n) => Number.isFinite(n))
      : [];
    const all = body.all === true;
    const channel = str(body.channel);
    const session = str(body.session) ?? str(body.session_id);
    // markMentionsRead: stamp notified_at on the agent's @mentions (optionally
    // scoped to one channel). Routed here because the client posts it to
    // /messages/read with mentions_only=true.
    if (body.mentions_only) {
      const res = channel
        ? await client.query(
            `UPDATE message_mentions SET notified_at = NOW()::text WHERE mentioned_agent = $1 AND channel = $2 AND notified_at IS NULL`,
            [reader, normalizeChannelName(channel)],
          )
        : await client.query(
            `UPDATE message_mentions SET notified_at = NOW()::text WHERE mentioned_agent = $1 AND notified_at IS NULL`,
            [reader],
          );
      return json({ marked: res.rowCount });
    }
    let marked = 0;
    if (ids.length) {
      const projected = await projectedMessageIds(client, ids);
      const visible = new Set(await visibleIncidentBlockerIds(
        client,
        deps.incidentProjector,
        reader,
        { ids, includeAcknowledged: true },
      ));
      if ([...projected].some((id) => !visible.has(id))) {
        return json({ error: "one or more incident blockers are not visible to the authenticated agent" }, 403);
      }
      const acknowledged = await upsertReadReceipts(client, ids, reader);
      const ordinary = ids.filter((id) => !projected.has(id));
      const res = await client.query(
        `UPDATE messages SET read_at = NOW()::text
         WHERE id = ANY($1::bigint[]) AND read_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM incident_projections p WHERE p.message_id = messages.id)`,
        [ordinary],
      );
      marked = acknowledged + res.rowCount;
    } else if (all) {
      const projected = await visibleIncidentBlockerIds(client, deps.incidentProjector, reader);
      const acknowledged = await upsertReadReceipts(client, projected, reader);
      const res = await client.query(
        `UPDATE messages SET read_at = NOW()::text WHERE to_agent = $1 AND read_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM incident_projections p WHERE p.message_id = messages.id)`,
        [reader],
      );
      marked = acknowledged + res.rowCount;
    } else if (channel) {
      const normalizedChannel = normalizeChannelName(channel);
      const projected = await visibleIncidentBlockerIds(client, deps.incidentProjector, reader, { channel: normalizedChannel });
      const acknowledged = await upsertReadReceipts(client, projected, reader);
      const res = await client.query(
        `UPDATE messages SET read_at = NOW()::text WHERE channel = $1 AND from_agent <> $2 AND read_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM incident_projections p WHERE p.message_id = messages.id)`,
        [normalizedChannel, reader],
      );
      marked = acknowledged + res.rowCount;
    } else if (session) {
      const projected = await visibleIncidentBlockerIds(client, deps.incidentProjector, reader, { session });
      const acknowledged = await upsertReadReceipts(client, projected, reader);
      const res = await client.query(
        `UPDATE messages SET read_at = NOW()::text WHERE session_id = $1 AND to_agent = $2 AND read_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM incident_projections p WHERE p.message_id = messages.id)`,
        [session, reader],
      );
      marked = acknowledged + res.rowCount;
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
    if (who && isTrue(url.searchParams.get("with_mentions"))) {
      const rows = await client.many(
        `SELECT channel,
                COUNT(CASE WHEN read_at IS NULL AND from_agent <> $1 THEN 1 END) AS unread_count,
                (SELECT COUNT(*) FROM message_mentions mm WHERE mm.channel = m.channel AND mm.mentioned_agent = $1 AND mm.notified_at IS NULL) AS mention_count,
                MAX(created_at) AS latest_message_at
         FROM messages m
         WHERE channel IS NOT NULL AND channel IN (
           SELECT DISTINCT channel FROM channel_members WHERE agent = $1
           UNION
           SELECT DISTINCT channel FROM messages WHERE to_agent = $1 AND channel IS NOT NULL
         )
         GROUP BY channel HAVING COUNT(*) > 0
         ORDER BY mention_count DESC, unread_count DESC, latest_message_at DESC`,
        [who],
      );
      return json({ counts: rows });
    }
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
    const collection = collectionReadOptions(url);
    const channel = str(url.searchParams.get("channel"));
    const session = str(url.searchParams.get("session")) ?? str(url.searchParams.get("session_id"));
    const clauses = ["pinned_at IS NOT NULL"];
    const params: unknown[] = [];
    if (channel) { params.push(channel); clauses.push(`channel = $${params.length}`); }
    if (session) { params.push(session); clauses.push(`session_id = $${params.length}`); }
    params.push(collection.limit + 1);
    const limitIdx = params.length;
    params.push(collection.offset);
    const offsetIdx = params.length;
    const rows = await boundedCollectionQuery(client, collection.timeoutMs, (tx) => tx.many<Record<string, unknown>>(
      `SELECT ${messagePreviewProjectionPg()}
       FROM messages WHERE ${clauses.join(" AND ")} ORDER BY pinned_at DESC, id DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    ));
    return json(packMessagePreviewPage(rows.map((row) => buildCollectionMessagePreview(row, collection.previewBytes)), {
      limit: collection.limit,
      cursor: collection.offset,
      max_bytes: collection.maxBytes,
      timeout_ms: collection.timeoutMs,
    }));
  }

  const exportArtifactMatch = sub.match(/^messages\/exports\/([0-9a-f-]+)$/i);
  if (exportArtifactMatch && method === "GET") {
    if (!agent) return json({ error: "authenticated agent is required" }, 401);
    const loaded = loadMessageExportArtifact(exportArtifactMatch[1], agent);
    if (!loaded) return json({ error: "Export artifact not found" }, 404);
    const responseBytes = new Uint8Array(loaded.payload).buffer;
    return new Response(responseBytes, {
      status: 200,
      headers: {
        ...SECURITY_HEADERS,
        "Content-Type": loaded.contentType,
        "Content-Length": String(loaded.artifact.byte_length),
        "Content-Disposition": `attachment; filename="${loaded.artifact.filename}"`,
        "X-Content-SHA256": loaded.artifact.sha256,
      },
    });
  }

  // ---- bounded export artifacts (preview by default; full is explicit) ----
  if ((sub === "messages/exports" && method === "POST") || (sub === "messages/export" && method === "GET")) {
    if (!agent) return json({ error: "authenticated agent is required" }, 401);
    const body = method === "POST" ? await readJson(req) : {};
    const queryValue = (name: string): unknown => method === "POST" ? body[name] : url.searchParams.get(name) ?? undefined;
    const optionalString = (name: string): string | undefined => {
      const value = queryValue(name);
      if (value === undefined || value === null) return undefined;
      if (typeof value !== "string" || !value.trim()) throw new ApiRequestValidationError(`${name} must be a non-empty string`);
      return value.trim();
    };
    const optionalNumber = (name: string): number | undefined => {
      const value = queryValue(name);
      if (value === undefined || value === null || value === "") return undefined;
      const parsed = typeof value === "number" ? value : Number(value);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new ApiRequestValidationError(`${name} must be a positive integer`);
      return parsed;
    };
    const authorization = method === "POST" && body.authorization && typeof body.authorization === "object" && !Array.isArray(body.authorization)
      ? body.authorization as Record<string, unknown>
      : undefined;
    if (authorization && authorization.acknowledged !== true) {
      throw new ApiRequestValidationError("authorization.acknowledged must be true");
    }
    const opts: ExportMessagesOptions = {
      channel: optionalString("channel"),
      session_id: optionalString("session_id") ?? optionalString("session"),
      from: optionalString("from"),
      since: optionalString("since"),
      until: optionalString("until"),
      format: optionalString("format") as ExportMessagesOptions["format"],
      detail: (method === "GET" ? "preview" : optionalString("detail")) as ExportMessagesOptions["detail"],
      limit: optionalNumber("limit"),
      max_bytes: optionalNumber("max_bytes"),
      preview_bytes: optionalNumber("preview_bytes"),
      timeout_ms: optionalNumber("timeout_ms"),
      authorization: authorization ? {
        principal: typeof authorization.principal === "string" ? authorization.principal : "",
        reason: typeof authorization.reason === "string" ? authorization.reason : "",
        acknowledged: true,
      } : undefined,
    };
    if (opts.detail === "full" && opts.authorization && opts.authorization.principal.toLowerCase() !== agent.toLowerCase()) {
      return json({ error: "full export authorization principal must match the authenticated agent" }, 403);
    }
    let resolved: ReturnType<typeof resolveMessageExportOptions>;
    try {
      resolved = resolveMessageExportOptions(opts);
    } catch (error) {
      throw new ApiRequestValidationError(error instanceof Error ? error.message : String(error));
    }
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts.channel) { params.push(normalizeChannelName(opts.channel)); clauses.push(`channel = $${params.length}`); }
    if (opts.session_id) { params.push(opts.session_id); clauses.push(`session_id = $${params.length}`); }
    if (opts.from) { params.push(opts.from); clauses.push(`from_agent = $${params.length}`); }
    if (opts.since) { params.push(opts.since); clauses.push(`created_at >= $${params.length}`); }
    if (opts.until) { params.push(opts.until); clauses.push(`created_at <= $${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    params.push(resolved.limit + 1);
    const limitIdx = params.length;
    const projection = resolved.detail === "preview"
      ? messagePreviewProjectionPg()
      : `id, uuid, session_id, from_agent, to_agent, channel, project_id, content, priority,
         blocking, reply_to, working_dir, repository, branch, metadata, edited_at, pinned_at,
         attachments, created_at, read_at`;
    const rows = await boundedCollectionQuery(client, resolved.timeoutMs, (tx) => tx.many<Record<string, unknown>>(
      `SELECT ${projection} FROM messages ${where} ORDER BY created_at ASC, id ASC LIMIT $${limitIdx}`,
      params,
    ));
    const records = rows.slice(0, resolved.limit).map((row) => resolved.detail === "preview"
      ? buildCollectionMessagePreview(row, resolved.previewBytes) as unknown as Record<string, unknown>
      : parseServerMessage(row));
    const serialized = serializeMessageExport(records, {
      format: resolved.format,
      detail: resolved.detail,
      maxBytes: resolved.maxBytes,
      hasMore: rows.length > resolved.limit,
    });
    const artifact = writeMessageExportArtifact(serialized, resolved, agent, "remote");
    return json({ artifact }, 201);
  }

  // ---- messages that @mention an agent ----
  if (sub === "messages/for-agent" && method === "GET") {
    const collection = collectionReadOptions(url);
    const who = str(url.searchParams.get("agent"));
    if (!who) return json({ error: "agent is required" }, 400);
    const clauses = ["mm.mentioned_agent = $1"];
    const params: unknown[] = [who.toLowerCase()];
    const channel = str(url.searchParams.get("channel"));
    if (channel) { params.push(normalizeChannelName(channel)); clauses.push(`m.channel = $${params.length}`); }
    if (isTrue(url.searchParams.get("unread_only"))) clauses.push(`mm.notified_at IS NULL`);
    params.push(collection.limit + 1);
    const limitIdx = params.length;
    params.push(collection.offset);
    const offsetIdx = params.length;
    const rows = await boundedCollectionQuery(client, collection.timeoutMs, (tx) => tx.many<Record<string, unknown>>(
      `SELECT ${messagePreviewProjectionPg("m")}, mm.id AS mention_id FROM messages m
       JOIN message_mentions mm ON mm.message_id = m.id
       WHERE ${clauses.join(" AND ")}
       ORDER BY m.created_at DESC, m.id DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    ));
    return json(packMessagePreviewPage(rows.map((row) => buildCollectionMessagePreview(row, collection.previewBytes)), {
      limit: collection.limit,
      cursor: collection.offset,
      max_bytes: collection.maxBytes,
      timeout_ms: collection.timeoutMs,
    }));
  }

  if (sub === "messages" && method === "POST") {
    const body = await readJson(req);
    const from = str(body.from) ?? agent ?? undefined;
    const content = str(body.content);
    const requestedChannel = body.channel ? normalizeChannelName(String(body.channel)) : null;
    // A channel message addresses the channel itself; a DM needs an explicit `to`.
    const requestedTo = str(body.to);
    const toAgent = requestedChannel ?? requestedTo;
    if (!from || !toAgent || !content) return json({ error: "from, to (or channel), and content are required" }, 400);
    const requestedProject = str(body.project_id);
    const requestedSession = str(body.session_id);
    // Mirror the local sendMessage session derivation so channel history and
    // notifications group identically on the cloud.
    const derivedSession = requestedChannel
      ? `channel:${requestedChannel}`
      : requestedSession ?? `${[from, toAgent].sort().join("-")}-${randomUUID().slice(0, 8)}`;
    let priority = str(body.priority)?.toLowerCase() ?? "normal";
    if (!VALID_PRIORITIES.includes(priority)) return json({ error: "Invalid priority" }, 400);
    const blocking = body.blocking === true;
    if (metadataSpoofsIncidentProjection(body.metadata)) {
      return json({ error: "Canonical incident projection metadata is reserved for the dedicated projector" }, 409);
    }
    const replyToRaw = body.reply_to;
    const replyTo = replyToRaw == null ? null : Number(replyToRaw);
    if (replyTo != null && (!Number.isSafeInteger(replyTo) || replyTo <= 0)) {
      return json({ error: "reply_to must be a positive integer" }, 400);
    }
    const metadata = body.metadata == null
      ? null
      : typeof body.metadata === "string"
        ? body.metadata
        : JSON.stringify(body.metadata);
    const attachments = body.attachments == null
      ? null
      : typeof body.attachments === "string"
        ? body.attachments
        : JSON.stringify(body.attachments);
    const workingDir = str(body.working_dir) ?? null;
    const repository = str(body.repository) ?? null;
    const branch = str(body.branch) ?? null;
    const outcome = await client.transaction(async (tx) => {
      let channelName = requestedChannel;
      let projectId = requestedProject ?? null;
      let sessionId = derivedSession;
      if (replyTo != null) {
        const parent = await tx.get<Record<string, unknown>>(
          `SELECT id, session_id, channel, project_id FROM messages WHERE id = $1 FOR KEY SHARE`,
          [replyTo],
        );
        if (!parent) return { error: "reply parent not found", status: 404 as const, row: null };
        const parentChannel = str(parent.channel) ?? null;
        const parentProject = str(parent.project_id) ?? null;
        if ((requestedSession != null && parent.session_id !== requestedSession)
          || (requestedChannel != null && parentChannel !== requestedChannel)
          || (requestedProject != null && parentProject !== requestedProject)) {
          return { error: "reply parent is outside the message channel/project/session scope", status: 409 as const, row: null };
        }
        sessionId = String(parent.session_id);
        channelName = parentChannel;
        projectId = parentProject;
      }
      const finalToAgent = channelName ?? requestedTo!;
      const row = await tx.get<Record<string, unknown>>(
        `INSERT INTO messages (
           session_id, from_agent, to_agent, channel, project_id, content, priority, blocking,
           reply_to, metadata, working_dir, repository, branch, attachments
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         RETURNING id, uuid, session_id, from_agent, to_agent, channel, project_id, content, priority,
                   blocking, reply_to, metadata, working_dir, repository, branch, attachments, created_at`,
        [
          sessionId, from, finalToAgent, channelName, projectId, content, priority, blocking,
          replyTo, metadata, workingDir, repository, branch, attachments,
        ],
      );
      return { error: null, status: 201 as const, row };
    });
    if (outcome.error) return json({ error: outcome.error }, outcome.status);
    const row = outcome.row;
    // @mentions in channel messages create mention rows + notification DMs, so
    // mentions_only reads and mention counts work in cloud mode too.
    const insertedChannel = row ? str(row.channel) : null;
    if (insertedChannel && row?.id != null) {
      try { await processMentions(client, Number(row.id), from, insertedChannel, content); } catch { /* best-effort */ }
    }
    return json({ message: row ? parseServerMessage(row) : null }, 201);
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
      if (metadataSpoofsIncidentProjection(m.metadata)) {
        return json({ error: `messages[${i}].metadata contains reserved canonical incident projection fields` }, 409);
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
      if (!agent) return json({ error: "authenticated agent is required" }, 401);
      const requestedAgent = str(body.agent);
      if (requestedAgent && requestedAgent.toLowerCase() !== agent.toLowerCase()) {
        return json({ error: "receipt agent must match the authenticated agent" }, 403);
      }
      const who = agent;
      const projected = await projectedMessageIds(client, [id]);
      if (projected.has(id)) {
        const visible = await visibleIncidentBlockerIds(
          client,
          deps.incidentProjector,
          who,
          { ids: [id], includeAcknowledged: true },
        );
        if (!visible.includes(id)) {
          return json({ error: "incident blocker is not visible to the authenticated agent" }, 403);
        }
      }
      const row = await client.get(
        `INSERT INTO message_read_receipts (message_id, agent, read_at) VALUES ($1, $2, NOW())
         ON CONFLICT (message_id, agent) DO UPDATE SET read_at = EXCLUDED.read_at
         RETURNING message_id, agent, read_at`,
        [id, who.toLowerCase()],
      );
      return json({ receipt: row }, 201);
    }
  }

  // ---- reactions on one message ----
  const reactionMatch = sub.match(/^messages\/(\d+)\/reactions$/);
  if (reactionMatch) {
    const id = Number(reactionMatch[1]);
    if (method === "GET") {
      if (isTrue(url.searchParams.get("summary"))) {
        const rows = await client.many<{ emoji: string; agents: string; count: string | number }>(
          `SELECT emoji, string_agg(agent, ',') AS agents, COUNT(*)::int AS count
           FROM reactions WHERE message_id = $1
           GROUP BY emoji ORDER BY count DESC, MIN(created_at) ASC`,
          [id],
        );
        return json({ summary: rows.map((r) => ({ emoji: r.emoji, count: Number(r.count), agents: String(r.agents).split(",") })) });
      }
      const rows = await client.many(
        `SELECT * FROM reactions WHERE message_id = $1 ORDER BY created_at ASC, id ASC`,
        [id],
      );
      return json({ reactions: rows });
    }
    if (method === "POST") {
      const body = await readJson(req);
      const who = str(body.agent) ?? agent ?? undefined;
      const emoji = str(body.emoji);
      if (!who || !emoji) return json({ error: "agent and emoji are required" }, 400);
      const row = await client.get(
        `INSERT INTO reactions (message_id, agent, emoji) VALUES ($1,$2,$3)
         ON CONFLICT (message_id, agent, emoji) DO UPDATE SET agent = EXCLUDED.agent
         RETURNING *`,
        [id, who, emoji],
      );
      return json({ reaction: row }, 201);
    }
    if (method === "DELETE") {
      const who = str(url.searchParams.get("agent")) ?? agent ?? undefined;
      const emoji = str(url.searchParams.get("emoji"));
      if (!who || !emoji) return json({ error: "agent and emoji are required" }, 400);
      const res = await client.query(`DELETE FROM reactions WHERE message_id = $1 AND agent = $2 AND emoji = $3`, [id, who, emoji]);
      if (res.rowCount === 0) return json({ error: "Reaction not found" }, 404);
      return json({ removed: true });
    }
  }

  // ---- thread replies ----
  const replyMatch = sub.match(/^messages\/(\d+)\/replies$/);
  if (replyMatch && method === "GET") {
    const id = Number(replyMatch[1]);
    const collection = collectionReadOptions(url);
    const rows = await boundedCollectionQuery(client, collection.timeoutMs, (tx) => tx.many<Record<string, unknown>>(
      `SELECT ${messagePreviewProjectionPg()} FROM messages WHERE reply_to = $1
       ORDER BY created_at ASC, id ASC LIMIT $2 OFFSET $3`,
      [id, collection.limit + 1, collection.offset],
    ));
    return json(packMessagePreviewPage(rows.map((row) => buildCollectionMessagePreview(row, collection.previewBytes)), {
      limit: collection.limit,
      cursor: collection.offset,
      max_bytes: collection.maxBytes,
      timeout_ms: collection.timeoutMs,
    }));
  }

  // ---- per-message read status (channel members who have/haven't read) ----
  const readStatusMatch = sub.match(/^messages\/(\d+)\/read-status$/);
  if (readStatusMatch && method === "GET") {
    const id = Number(readStatusMatch[1]);
    const channel = str(url.searchParams.get("channel"));
    const receipts = await client.many<{ message_id: number; agent: string; read_at: string }>(
      `SELECT message_id, agent, read_at FROM message_read_receipts WHERE message_id = $1 ORDER BY read_at ASC`,
      [id],
    );
    let unread_by: string[] = [];
    if (channel) {
      const readers = new Set(receipts.map((r) => r.agent));
      const members = await client.many<{ agent: string }>(
        `SELECT agent FROM channel_members WHERE channel = $1`,
        [normalizeChannelName(channel)],
      );
      unread_by = members.map((m) => m.agent).filter((a) => !readers.has(a.toLowerCase()));
    }
    return json({ receipts, unread_by });
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
      const projection = await client.get("SELECT 1 AS present FROM incident_projections WHERE message_id = $1", [id]);
      if (projection) {
        return json({ error: "incident projection messages are append-only", code: "INCIDENT_PROJECTION_CONFLICT" }, 409);
      }
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
      const projection = await client.get("SELECT 1 AS present FROM incident_projections WHERE message_id = $1", [id]);
      if (projection) {
        return json({ error: "incident projection messages are append-only", code: "INCIDENT_PROJECTION_CONFLICT" }, 409);
      }
      const from = str(url.searchParams.get("from")) ?? agent ?? undefined;
      if (!from) return json({ error: "'from' is required to delete a message" }, 400);
      const row = await client.get(`DELETE FROM messages WHERE id = $1 AND from_agent = $2 RETURNING id`, [id, from]);
      if (!row) return json({ error: "Message not found or not yours" }, 404);
      return json({ id, deleted: true });
    }
  }

  // ---- channels ----
  if (sub === "channels" && method === "GET") {
    const clauses: string[] = [];
    const params: unknown[] = [];
    const projectId = str(url.searchParams.get("project_id"));
    const tag = str(url.searchParams.get("tag"));
    if (projectId) { params.push(projectId); clauses.push(`c.project_id = $${params.length}`); }
    if (tag) { params.push(`%"${tag}"%`); clauses.push(`c.tags LIKE $${params.length}`); }
    if (!isTrue(url.searchParams.get("include_archived"))) clauses.push("c.archived_at IS NULL");
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await client.many<Record<string, unknown>>(
      `SELECT c.*,
              (SELECT COUNT(*) FROM channel_members WHERE channel = c.name)::int AS member_count,
              (SELECT COUNT(*) FROM messages WHERE channel = c.name)::int AS message_count
       FROM channels c ${where} ORDER BY c.name ASC`,
      params,
    );
    return json({ channels: rows.map(parseServerChannel) });
  }

  if (sub === "channels" && method === "POST") {
    const body = await readJson(req);
    const rawName = str(body.name);
    const createdBy = str(body.created_by) ?? agent ?? undefined;
    if (!rawName || !createdBy) return json({ error: "name and created_by are required" }, 400);
    const name = normalizeChannelName(rawName);
    const projectId = str(body.project_id);
    const tags = Array.isArray(body.tags) ? JSON.stringify(body.tags) : null;
    const metadata = body.metadata && typeof body.metadata === "object" ? JSON.stringify(body.metadata) : null;
    return await client.transaction(async (tx) => {
      await tx.get(
        "SELECT pg_advisory_xact_lock($1::bigint) AS channel_identity_locked",
        [CHANNEL_IDENTITY_ADVISORY_LOCK],
      );
      if (projectId) {
        const proj = await tx.get(`SELECT id FROM projects WHERE id = $1`, [projectId]);
        if (!proj) return json({ error: `Project not found: ${projectId}` }, 400);
      }
      const existing = await tx.get(`SELECT name FROM channels WHERE name = $1`, [name]);
      if (existing) return json({ error: "Channel already exists" }, 409);
      const historicalAlias = await tx.get<{ current_channel: string }>(
        `SELECT current_channel FROM channel_rename_aliases WHERE old_channel = $1`,
        [name],
      );
      if (historicalAlias) {
        return json({
          error: `Channel #${name} is a reserved historical alias for #${historicalAlias.current_channel}.`,
        }, 409);
      }
      const row = await tx.get<Record<string, unknown>>(
        `INSERT INTO channels (name, description, topic, project_id, created_by, metadata, tags)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [name, str(body.description) ?? null, str(body.topic) ?? null, projectId ?? null, createdBy, metadata, tags],
      );
      // Creator auto-joins the channel, mirroring the local createChannel.
      await tx.query(
        `INSERT INTO channel_members (channel, agent) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [name, createdBy],
      );
      return json({ channel: row ? parseServerChannel(row) : null }, 201);
    });
  }

  if (sub === "channels/mine" && method === "GET") {
    const who = str(url.searchParams.get("agent")) ?? agent ?? undefined;
    if (!who) return json({ error: "agent is required" }, 400);
    const rows = await client.many(
      `SELECT s.name, s.description,
              (SELECT COUNT(*) FROM messages m WHERE m.channel = s.name AND m.read_at IS NULL) AS unread
       FROM channels s
       JOIN channel_members sm ON sm.channel = s.name
       WHERE sm.agent = $1
       ORDER BY s.name`,
      [who],
    );
    return json({ channels: rows });
  }

  // ---- channel membership ----
  const chanMembersMatch = sub.match(/^channels\/([^/]+)\/members$/);
  if (chanMembersMatch) {
    const name = normalizeChannelName(decodeURIComponent(chanMembersMatch[1]));
    if (method === "GET") {
      const rows = await client.many(
        `SELECT channel, agent, joined_at FROM channel_members WHERE channel = $1 ORDER BY joined_at ASC`,
        [name],
      );
      return json({ members: rows });
    }
    if (method === "POST") {
      const body = await readJson(req);
      const who = str(body.agent) ?? agent ?? undefined;
      if (!who) return json({ error: "agent is required" }, 400);
      const exists = await client.get(`SELECT name FROM channels WHERE name = $1`, [name]);
      if (!exists) return json({ joined: false });
      await client.query(`INSERT INTO channel_members (channel, agent) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [name, who]);
      return json({ joined: true });
    }
  }

  const chanMemberMatch = sub.match(/^channels\/([^/]+)\/members\/([^/]+)$/);
  if (chanMemberMatch) {
    const name = normalizeChannelName(decodeURIComponent(chanMemberMatch[1]));
    const who = decodeURIComponent(chanMemberMatch[2]);
    if (method === "GET") {
      const row = await client.get(`SELECT 1 AS ok FROM channel_members WHERE channel = $1 AND agent = $2`, [name, who]);
      return json({ member: !!row });
    }
    if (method === "DELETE") {
      const res = await client.query(`DELETE FROM channel_members WHERE channel = $1 AND agent = $2`, [name, who]);
      if (res.rowCount === 0) return json({ error: "Not a member" }, 404);
      return json({ left: true });
    }
  }

  const chanArchive = sub.match(/^channels\/([^/]+)\/(archive|unarchive)$/);
  if (chanArchive && method === "POST") {
    const name = normalizeChannelName(decodeURIComponent(chanArchive[1]));
    const archiving = chanArchive[2] === "archive";
    const row = await client.get<Record<string, unknown>>(
      `UPDATE channels SET archived_at = ${archiving ? "NOW()::text" : "NULL"} WHERE name = $1 RETURNING *`,
      [name],
    );
    if (!row) return json({ error: "Channel not found" }, 404);
    return json({ channel: parseServerChannel(row) });
  }

  const chanMatch = sub.match(/^channels\/([^/]+)$/);
  if (chanMatch) {
    let name = normalizeChannelName(decodeURIComponent(chanMatch[1]));
    if (method === "GET") {
      const row = await client.get<Record<string, unknown>>(
        `SELECT c.*,
                (SELECT COUNT(*) FROM channel_members WHERE channel = c.name)::int AS member_count,
                (SELECT COUNT(*) FROM messages WHERE channel = c.name)::int AS message_count
         FROM channels c WHERE c.name = $1`,
        [name],
      );
      if (!row) return json({ error: "Channel not found" }, 404);
      return json({ channel: parseServerChannel(row) });
    }
    if (method === "PATCH") {
      const body = await readJson(req);
      // A rename (new name) is applied first, then field updates target the new name.
      if (body.name !== undefined && normalizeChannelName(String(body.name)) !== name) {
        const renamed = await renameChannelServer(client, name, String(body.name));
        if (!renamed.ok) return json({ error: renamed.error }, renamed.status);
        name = renamed.name;
      }
      const existing = await client.get<Record<string, unknown>>(`SELECT * FROM channels WHERE name = $1`, [name]);
      if (!existing) return json({ error: "Channel not found" }, 404);
      if (body.project_id !== undefined && body.project_id !== null) {
        const proj = await client.get(`SELECT id FROM projects WHERE id = $1`, [String(body.project_id)]);
        if (!proj) return json({ error: `Project not found: ${body.project_id}` }, 400);
      }
      const sets: string[] = [];
      const params: unknown[] = [];
      if ("description" in body) { params.push(str(body.description) ?? null); sets.push(`description = $${params.length}`); }
      if ("topic" in body) { params.push(str(body.topic) ?? null); sets.push(`topic = $${params.length}`); }
      if ("project_id" in body) { params.push(str(body.project_id) ?? null); sets.push(`project_id = $${params.length}`); }
      if ("metadata" in body) { params.push(body.metadata ? JSON.stringify(body.metadata) : null); sets.push(`metadata = $${params.length}`); }
      if ("tags" in body) { params.push(Array.isArray(body.tags) ? JSON.stringify(body.tags) : null); sets.push(`tags = $${params.length}`); }
      if (!sets.length) return json({ channel: parseServerChannel(existing) });
      params.push(name);
      const row = await client.get<Record<string, unknown>>(
        `UPDATE channels SET ${sets.join(", ")} WHERE name = $${params.length} RETURNING *`,
        params,
      );
      return json({ channel: row ? parseServerChannel(row) : null });
    }
  }

  // ---- projects ----
  if (sub === "projects" && method === "GET") {
    const clauses: string[] = [];
    const params: unknown[] = [];
    const status = str(url.searchParams.get("status"));
    const name = str(url.searchParams.get("name"));
    const tag = str(url.searchParams.get("tag"));
    if (status) { params.push(status); clauses.push(`status = $${params.length}`); }
    if (name) { params.push(name); clauses.push(`name = $${params.length}`); }
    if (tag) { params.push(`%"${tag}"%`); clauses.push(`tags LIKE $${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limitRaw = str(url.searchParams.get("limit"));
    const limitClause = limitRaw && /^\d+$/.test(limitRaw) ? ` LIMIT ${Math.min(Number(limitRaw), 1000)}` : "";
    const rows = await client.many<Record<string, unknown>>(
      `SELECT p.id, p.name, p.description, p.path, p.repository, p.created_by, p.created_at, p.status, p.tags, p.metadata, p.settings,
              (SELECT COUNT(*) FROM channels WHERE project_id = p.id)::int AS channel_count
       FROM projects p ${where} ORDER BY p.created_at DESC${limitClause}`,
      params,
    );
    return json({ projects: rows.map(parseServerProject) });
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
    return json({ project: row ? parseServerProject(row) : null }, 201);
  }

  const projMatch = sub.match(/^projects\/([^/]+)$/);
  if (projMatch) {
    const id = decodeURIComponent(projMatch[1]);
    if (method === "GET") {
      const row = await client.get<Record<string, unknown>>(
        `SELECT p.*, (SELECT COUNT(*) FROM channels WHERE project_id = p.id)::int AS channel_count
         FROM projects p WHERE p.id = $1 OR p.name = $1`,
        [id],
      );
      if (!row) return json({ error: "Project not found" }, 404);
      return json({ project: parseServerProject(row) });
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
      const row = await client.get<Record<string, unknown>>(
        `UPDATE projects SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
        params,
      );
      if (!row) return json({ error: "Project not found" }, 404);
      return json({ project: parseServerProject(row) });
    }
    if (method === "DELETE") {
      const row = await client.get(`DELETE FROM projects WHERE id = $1 RETURNING id`, [id]);
      if (!row) return json({ error: "Project not found" }, 404);
      return json({ id, deleted: true });
    }
  }

  // ---- agents (presence) ----
  if (sub === "agents" && method === "GET") {
    const onlineOnly = isTrue(url.searchParams.get("online_only"));
    const where = onlineOnly ? "WHERE last_seen_at > NOW() - interval '60 seconds'" : "";
    const rows = await client.many<Record<string, unknown>>(
      `SELECT id, agent, session_id, role, project_id, status, last_seen_at, created_at, metadata,
              (EXTRACT(EPOCH FROM (NOW() - last_seen_at)) < 60) AS online
       FROM agent_presence ${where} ORDER BY last_seen_at DESC LIMIT 500`,
    );
    return json({ agents: rows.map(parsePresenceRow) });
  }

  // ---- register an agent (presence) ----
  if (sub === "agents" && method === "POST") {
    const body = await readJson(req);
    const rawName = str(body.name) ?? agent ?? undefined;
    const sessionId = str(body.session_id);
    if (!rawName) return json({ error: "name is required" }, 400);
    const name = rawName.toLowerCase();
    const role = str(body.role) ?? "agent";
    const projectId = str(body.project_id) ?? "";
    const existing = await client.get<Record<string, unknown>>(
      `SELECT *, (EXTRACT(EPOCH FROM (NOW() - last_seen_at)) < 1800) AS active FROM agent_presence WHERE LOWER(agent) = $1`,
      [name],
    );
    if (existing) {
      const existingSession = (existing.session_id as string | null) ?? null;
      // Active session held by a different session id => conflict (no takeover).
      if (existing.active === true && existingSession && existingSession !== sessionId) {
        return json({
          result: {
            conflict: true,
            error: "agent_conflict",
            message: `Agent "${name}" is already active (last seen: ${String(existing.last_seen_at)}). Wait 30 minutes or use force takeover.`,
            existing_id: existing.id,
            existing_name: name,
            existing_session_id: existingSession,
            last_seen_at: existing.last_seen_at,
            session_hint: existingSession ? existingSession.slice(0, 8) : null,
            working_dir: null,
          },
        });
      }
      const tookOver = existingSession !== sessionId;
      const updated = await client.get<Record<string, unknown>>(
        `UPDATE agent_presence
         SET session_id = $2, role = $3, project_id = $4, status = 'online', last_seen_at = NOW()
         WHERE LOWER(agent) = $1
         RETURNING id, agent, session_id, role, project_id, status, last_seen_at, created_at, metadata,
                   (EXTRACT(EPOCH FROM (NOW() - last_seen_at)) < 60) AS online`,
        [name, sessionId ?? null, role, projectId],
      );
      return json({ result: { agent: updated ? parsePresenceRow(updated) : null, created: false, took_over: tookOver } });
    }
    const created = await client.get<Record<string, unknown>>(
      `INSERT INTO agent_presence (id, agent, session_id, role, project_id, status, last_seen_at, created_at)
       VALUES ($1,$2,$3,$4,$5,'online',NOW(),NOW())
       RETURNING id, agent, session_id, role, project_id, status, last_seen_at, created_at, metadata,
                 (EXTRACT(EPOCH FROM (NOW() - last_seen_at)) < 60) AS online`,
      [randomUUID().slice(0, 8), name, sessionId ?? null, role, projectId],
    );
    return json({ result: { agent: created ? parsePresenceRow(created) : null, created: true, took_over: false } });
  }

  if (sub === "agents/heartbeat" && method === "POST") {
    const body = await readJson(req);
    const name = str(body.agent) ?? agent ?? undefined;
    if (!name) return json({ error: "agent is required" }, 400);
    const projectId = str(body.project_id) ?? "";
    const metadata = body.metadata && typeof body.metadata === "object" ? JSON.stringify(body.metadata) : null;
    const row = await client.get(
      `INSERT INTO agent_presence (id, agent, session_id, role, project_id, status, last_seen_at, metadata)
       VALUES ($1,$2,$3,'agent',$4,$5,NOW(),$6)
       ON CONFLICT (agent, project_id) DO UPDATE SET status=EXCLUDED.status, last_seen_at=NOW(),
         session_id=COALESCE(EXCLUDED.session_id, agent_presence.session_id), metadata=EXCLUDED.metadata
       RETURNING agent, project_id, status, last_seen_at`,
      [randomUUID().slice(0, 8), name.toLowerCase(), str(body.session_id) ?? null, projectId, str(body.status) ?? "online", metadata],
    );
    return json({ agent: row });
  }

  // ---- one agent: presence / rename / project / remove ----
  const agentMatch = sub.match(/^agents\/([^/]+)$/);
  if (agentMatch) {
    const who = decodeURIComponent(agentMatch[1]).toLowerCase();
    if (method === "GET") {
      const row = await client.get<Record<string, unknown>>(
        `SELECT id, agent, session_id, role, project_id, status, last_seen_at, created_at, metadata,
                (EXTRACT(EPOCH FROM (NOW() - last_seen_at)) < 60) AS online
         FROM agent_presence WHERE LOWER(agent) = $1 ORDER BY last_seen_at DESC LIMIT 1`,
        [who],
      );
      return json({ presence: row ? parsePresenceRow(row) : null });
    }
    if (method === "PATCH") {
      const body = await readJson(req);
      if (body.name !== undefined) {
        const newName = String(body.name).toLowerCase();
        const exists = await client.get(`SELECT agent FROM agent_presence WHERE LOWER(agent) = $1`, [who]);
        if (!exists) return json({ renamed: false });
        const conflict = await client.get(`SELECT agent FROM agent_presence WHERE LOWER(agent) = $1`, [newName]);
        if (conflict) return json({ error: `Agent "${newName}" already exists` }, 409);
        await client.query(`UPDATE agent_presence SET agent = $1 WHERE LOWER(agent) = $2`, [newName, who]);
        return json({ renamed: true });
      }
      if (body.project_id !== undefined) {
        const projectId = str(body.project_id) ?? "";
        await client.query(
          `UPDATE agent_presence SET project_id = $1, last_seen_at = NOW() WHERE LOWER(agent) = $2`,
          [projectId, who],
        );
        return json({ updated: true });
      }
      return json({ error: "No updatable fields provided" }, 400);
    }
    if (method === "DELETE") {
      const res = await client.query(`DELETE FROM agent_presence WHERE LOWER(agent) = $1`, [who]);
      if (res.rowCount === 0) return json({ error: "Agent not found" }, 404);
      return json({ removed: true });
    }
  }

  // ---- channel notifications ----
  const notifResp = await handleChannelNotifications(sub, method, req, url, client, agent);
  if (notifResp) return notifResp;

  // ---- tasks ----
  const taskResp = await handleTasks(sub, method, req, url, client, agent);
  if (taskResp) return taskResp;

  // ---- locks ----
  const lockResp = await handleLocks(sub, method, req, url, client);
  if (lockResp) return lockResp;

  // ---- sessions / topics / graph / summary / hot ----
  const analyticsResp = await handleAnalytics(sub, method, req, url, client);
  if (analyticsResp) return analyticsResp;

  return json({ error: "Not found" }, 404);
}

// ---- channel notifications router -------------------------------------------

async function handleChannelNotifications(
  sub: string,
  method: string,
  req: Request,
  url: URL,
  client: PoolQueryClient,
  agent: string | null,
): Promise<Response | null> {
  if (sub !== "channel-notifications" && !sub.startsWith("channel-notifications/")) return null;

  if (sub === "channel-notifications" && method === "POST") {
    const body = await readJson(req);
    const channel = typeof body.channel === "string" ? body.channel.trim() : undefined;
    if (!agent) return json({ error: "authenticated agent is required" }, 401);
    const requestedAgent = body.agent === undefined ? undefined : typeof body.agent === "string" && body.agent.trim()
      ? body.agent.trim()
      : (() => { throw new ApiRequestValidationError("agent must be a non-empty string"); })();
    if (requestedAgent && requestedAgent.toLowerCase() !== agent.toLowerCase()) {
      return json({ error: "notification agent must match the authenticated agent" }, 403);
    }
    const who = agent;
    if (!channel) return json({ error: "channel is required" }, 400);
    const channelName = normalizeChannelName(channel);
    const exists = await client.get(`SELECT name FROM channels WHERE name = $1`, [channelName]);
    if (!exists) return json({ error: `Channel not found: ${channel}` }, 404);
    const previewChars = body.preview_chars === undefined ? 140 : Number(body.preview_chars);
    if (!Number.isSafeInteger(previewChars) || previewChars <= 0 || previewChars > 1024) {
      throw new ApiRequestValidationError("preview_chars must be a positive integer no greater than 1024");
    }
    const maxRow = await client.get<{ max_id: number }>(`SELECT COALESCE(MAX(id), 0)::int AS max_id FROM messages WHERE channel = $1`, [channelName]);
    await client.query(
      `INSERT INTO channel_subscriptions (channel, agent, preview_chars, since_message_id) VALUES ($1,$2,$3,$4)
       ON CONFLICT (channel, agent) DO UPDATE SET preview_chars = EXCLUDED.preview_chars`,
      [channelName, who, previewChars, Number(maxRow?.max_id ?? 0)],
    );
    const row = await client.get(
      `SELECT channel, agent, created_at, preview_chars, since_message_id FROM channel_subscriptions WHERE channel = $1 AND agent = $2`,
      [channelName, who],
    );
    return json({ subscription: row });
  }

  if (sub === "channel-notifications" && method === "GET") {
    if (!agent) return json({ error: "authenticated agent is required" }, 401);
    const requestedAgent = strictStringParam(url.searchParams.get("agent"), "agent");
    if (requestedAgent && requestedAgent.toLowerCase() !== agent.toLowerCase()) {
      return json({ error: "notification agent must match the authenticated agent" }, 403);
    }
    const rows = await client.many(
      `SELECT channel, agent, created_at, preview_chars, since_message_id FROM channel_subscriptions WHERE agent = $1 ORDER BY created_at ASC, channel ASC`,
      [agent],
    );
    return json({ subscriptions: rows });
  }

  if (sub === "channel-notifications/subscribed" && method === "GET") {
    if (!agent) return json({ error: "authenticated agent is required" }, 401);
    const requestedAgent = strictStringParam(url.searchParams.get("agent"), "agent");
    if (requestedAgent && requestedAgent.toLowerCase() !== agent.toLowerCase()) {
      return json({ error: "notification agent must match the authenticated agent" }, 403);
    }
    const who = agent;
    const rows = await client.many<{ channel: string }>(
      `SELECT channel FROM channel_subscriptions WHERE agent = $1 ORDER BY created_at ASC, channel ASC`,
      [who],
    );
    return json({ channels: rows.map((r) => r.channel) });
  }

  if (sub === "channel-notifications/inbox" && method === "GET") {
    if (!agent) return json({ error: "authenticated agent is required" }, 401);
    const requestedAgent = strictStringParam(url.searchParams.get("agent"), "agent");
    if (requestedAgent && requestedAgent.toLowerCase() !== agent.toLowerCase()) {
      return json({ error: "notification agent must match the authenticated agent" }, 403);
    }
    const who = agent;
    const clauses = ["s.agent = $1", "m.channel IS NOT NULL", "m.from_agent <> $1", "m.id > s.since_message_id"];
    const params: unknown[] = [who];
    const channel = strictStringParam(url.searchParams.get("channel"), "channel");
    if (channel) { params.push(normalizeChannelName(channel)); clauses.push(`m.channel = $${params.length}`); }
    const since = strictDateParam(url.searchParams.get("since"), "since");
    if (since) { params.push(since); clauses.push(`m.created_at > $${params.length}`); }
    // Default filters to unread unless explicitly unread_only=false (matches local).
    const unreadOnly = url.searchParams.get("unread_only") === null
      ? true
      : strictBooleanParam(url.searchParams.get("unread_only"), "unread_only");
    if (unreadOnly) clauses.push("snr.message_id IS NULL");
    const collection = collectionReadOptions(url);
    const restricted = restrictedMessagePredicatePg("m");
    params.push(collection.limit + 1);
    const limitIdx = params.length;
    params.push(collection.offset);
    const offsetIdx = params.length;
    const rows = await boundedCollectionQuery(client, collection.timeoutMs, (tx) => tx.many<{
      message_id: number; channel: string; from_agent: string; created_at: string;
      priority: string; preview_source: string; attachment_count: number; preview_chars: number; read_message_id: number | null;
    }>(
      `SELECT m.id AS message_id, m.channel, m.from_agent, m.created_at, m.priority,
              CASE WHEN ${restricted} THEN '${RESTRICTED_CHANNEL_PREVIEW}' ELSE left(m.content, ${COLLECTION_PREVIEW_SCAN_CHARS}) END AS preview_source,
              CASE WHEN m.attachments IS NULL OR m.attachments = '' THEN 0 ELSE jsonb_array_length(m.attachments::jsonb) END AS attachment_count,
              s.preview_chars, snr.message_id AS read_message_id
       FROM messages m
       INNER JOIN channel_subscriptions s ON s.channel = m.channel
       LEFT JOIN channel_notification_reads snr ON snr.message_id = m.id AND snr.agent = s.agent
       WHERE ${clauses.join(" AND ")}
       ORDER BY m.created_at DESC, m.id DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    ));
    const markRequested = strictBooleanParam(url.searchParams.get("mark_read"), "mark_read");
    const candidates = rows.map((r) => ({
      message_id: Number(r.message_id),
      channel: r.channel,
      from_agent: r.from_agent,
      created_at: r.created_at,
      priority: r.priority as ChannelNotification["priority"],
      preview: buildChannelNotificationPreview(r.preview_source, Number(r.preview_chars ?? 140), collection.previewBytes),
      unread: markRequested ? false : r.read_message_id == null,
      has_attachments: Number(r.attachment_count) > 0,
    })) satisfies ChannelNotification[];
    let page = packChannelNotificationPage(candidates, {
      limit: collection.limit,
      cursor: collection.offset,
      max_bytes: collection.maxBytes,
      timeout_ms: collection.timeoutMs,
      marked_read: markRequested ? Math.min(collection.limit, candidates.length) : 0,
    });
    if (markRequested && page.notifications.length > 0) {
      const ids = page.notifications.map((notification) => notification.message_id);
      const marked = await client.query(
        `INSERT INTO channel_notification_reads (agent, message_id)
         SELECT $1, x FROM unnest($2::bigint[]) AS x ON CONFLICT DO NOTHING`,
        [who, ids],
      );
      page = finalizeChannelNotificationPage({ ...page, marked_read: marked.rowCount });
    }
    if (page.byte_length > collection.maxBytes) {
      throw new ApiRequestValidationError(`channel notification envelope exceeds max_bytes (${page.byte_length} > ${collection.maxBytes})`);
    }
    return json(page);
  }

  if (sub === "channel-notifications/read" && method === "POST") {
    const body = await readJson(req);
    if (!agent) return json({ error: "authenticated agent is required" }, 401);
    const requestedAgent = body.agent === undefined ? undefined : typeof body.agent === "string" && body.agent.trim()
      ? body.agent.trim()
      : (() => { throw new ApiRequestValidationError("agent must be a non-empty string"); })();
    if (requestedAgent && requestedAgent.toLowerCase() !== agent.toLowerCase()) {
      return json({ error: "notification agent must match the authenticated agent" }, 403);
    }
    const who = agent;
    if (body.message_ids !== undefined && !Array.isArray(body.message_ids)) {
      throw new ApiRequestValidationError("message_ids must be an array of positive integers");
    }
    const ids = Array.isArray(body.message_ids) ? (body.message_ids as unknown[]).map((value) => {
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new ApiRequestValidationError("message_ids must contain only positive integers");
      }
      return parsed;
    }) : [];
    if (!who || ids.length === 0) return json({ marked: 0 });
    const res = await client.query(
      `INSERT INTO channel_notification_reads (agent, message_id)
       SELECT $1, x FROM unnest($2::bigint[]) AS x ON CONFLICT DO NOTHING`,
      [who, ids],
    );
    return json({ marked: res.rowCount });
  }

  if (sub === "channel-notifications/read-all" && method === "POST") {
    const body = await readJson(req);
    if (!agent) return json({ error: "authenticated agent is required" }, 401);
    const requestedAgent = body.agent === undefined ? undefined : typeof body.agent === "string" && body.agent.trim()
      ? body.agent.trim()
      : (() => { throw new ApiRequestValidationError("agent must be a non-empty string"); })();
    if (requestedAgent && requestedAgent.toLowerCase() !== agent.toLowerCase()) {
      return json({ error: "notification agent must match the authenticated agent" }, 403);
    }
    const who = agent;
    const params: unknown[] = [who];
    let channelClause = "";
    const channel = str(body.channel);
    if (channel) { params.push(normalizeChannelName(channel)); channelClause = `AND m.channel = $${params.length}`; }
    const res = await client.query(
      `INSERT INTO channel_notification_reads (agent, message_id)
       SELECT $1, m.id FROM messages m
       INNER JOIN channel_subscriptions s ON s.channel = m.channel AND s.agent = $1
       LEFT JOIN channel_notification_reads snr ON snr.message_id = m.id AND snr.agent = $1
       WHERE m.channel IS NOT NULL AND m.from_agent <> $1 AND m.id > s.since_message_id AND snr.message_id IS NULL ${channelClause}
       ON CONFLICT DO NOTHING`,
      params,
    );
    return json({ marked: res.rowCount });
  }

  const unsubMatch = sub.match(/^channel-notifications\/([^/]+)\/([^/]+)$/);
  if (unsubMatch && method === "DELETE") {
    if (!agent) return json({ error: "authenticated agent is required" }, 401);
    const channelName = normalizeChannelName(decodeURIComponent(unsubMatch[1]));
    const requestedAgent = decodeURIComponent(unsubMatch[2]);
    if (requestedAgent.toLowerCase() !== agent.toLowerCase()) {
      return json({ error: "notification agent must match the authenticated agent" }, 403);
    }
    const who = agent;
    const res = await client.query(`DELETE FROM channel_subscriptions WHERE channel = $1 AND agent = $2`, [channelName, who]);
    if (res.rowCount === 0) return json({ error: "Subscription not found" }, 404);
    return json({ unsubscribed: true });
  }

  return null;
}

// ---- tasks router ------------------------------------------------------------

async function handleTasks(
  sub: string,
  method: string,
  req: Request,
  url: URL,
  client: TypedQueryClient,
  agent: string | null,
): Promise<Response | null> {
  if (sub !== "tasks" && !sub.startsWith("tasks/")) return null;

  const now = () => new Date().toISOString();

  // ---- create / list ----
  if (sub === "tasks" && method === "POST") {
    const body = await readJson(req);
    const subject = str(body.subject);
    const reporter = str(body.reporter) ?? agent ?? undefined;
    if (!subject || !reporter) return json({ error: "subject and reporter are required" }, 400);
    const uuid = randomUUID().replace(/-/g, "");
    const priority = str(body.priority) ?? "medium";
    const channel = body.channel ? normalizeChannelName(String(body.channel)) : null;
    const parentId = typeof body.parent_id === "number" ? body.parent_id
      : (typeof body.parent_id === "string" && /^\d+$/.test(body.parent_id) ? Number(body.parent_id) : null);
    const tags = Array.isArray(body.tags) ? JSON.stringify(body.tags) : null;
    const metadata = body.metadata && typeof body.metadata === "object" ? JSON.stringify(body.metadata) : null;
    const inserted = await client.get<{ id: number }>(
      `INSERT INTO tasks (uuid, subject, description, reporter, assignee, priority, project_id, channel, parent_id, tags, metadata, due_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [uuid, subject, str(body.description) ?? null, reporter, str(body.assignee) ?? null, priority,
       str(body.project_id) ?? null, channel, parentId, tags, metadata, str(body.due_at) ?? null],
    );
    const taskId = Number(inserted!.id);
    const dependsOn = Array.isArray(body.depends_on) ? (body.depends_on as unknown[]).map(Number).filter((n) => Number.isFinite(n)) : [];
    if (dependsOn.length) {
      const resolved: number[] = [];
      for (const depId of dependsOn) {
        const exists = await client.get(`SELECT id FROM tasks WHERE id = $1`, [depId]);
        if (!exists) return json({ error: `Dependency task #${depId} not found` }, 400);
        await client.query(`INSERT INTO task_dependencies (task_id, depends_on_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [taskId, depId]);
        resolved.push(depId);
      }
      await client.query(`UPDATE tasks SET depends_on = $1 WHERE id = $2`, [JSON.stringify(resolved), taskId]);
      const incomplete = await client.get(
        `SELECT 1 FROM task_dependencies td JOIN tasks t ON t.id = td.depends_on_id WHERE td.task_id = $1 AND t.status <> 'completed' LIMIT 1`,
        [taskId],
      );
      if (incomplete) await client.query(`UPDATE tasks SET status = 'blocked' WHERE id = $1`, [taskId]);
    }
    await logTaskActivity(client, taskId, reporter, "created");
    return json({ task: await getEnrichedTask(client, taskId) }, 201);
  }

  if (sub === "tasks" && method === "GET") {
    const clauses: string[] = [];
    const params: unknown[] = [];
    const add = (col: string, val: string | undefined) => {
      if (val === undefined) return;
      params.push(val);
      clauses.push(`${col} = $${params.length}`);
    };
    add("status", str(url.searchParams.get("status")));
    add("assignee", str(url.searchParams.get("assignee")));
    add("reporter", str(url.searchParams.get("reporter")));
    add("project_id", str(url.searchParams.get("project_id")));
    const channel = str(url.searchParams.get("channel"));
    if (channel) { params.push(normalizeChannelName(channel)); clauses.push(`channel = $${params.length}`); }
    add("priority", str(url.searchParams.get("priority")));
    const tag = str(url.searchParams.get("tag"));
    if (tag) { params.push(`%"${tag}"%`); clauses.push(`tags LIKE $${params.length}`); }
    const parentId = str(url.searchParams.get("parent_id"));
    if (parentId === "null") clauses.push("parent_id IS NULL");
    else if (parentId && /^\d+$/.test(parentId)) { params.push(Number(parentId)); clauses.push(`parent_id = $${params.length}`); }
    if (!isTrue(url.searchParams.get("include_archived"))) clauses.push("status <> 'cancelled'");
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = clampLimit(url.searchParams.get("limit"), 50, 1000);
    const offsetRaw = parseInt(url.searchParams.get("offset") || "0", 10);
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;
    params.push(limit); const limitIdx = params.length;
    params.push(offset); const offsetIdx = params.length;
    const rows = await client.many<Record<string, unknown>>(
      `SELECT * FROM tasks ${where}
       ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );
    return json({ tasks: await enrichTasks(client, rows) });
  }

  // ---- search ----
  if (sub === "tasks/search" && method === "GET") {
    const query = (str(url.searchParams.get("q")) ?? "").trim();
    const terms = query.split(/\s+/).filter(Boolean);
    if (terms.length === 0) return json({ tasks: [] });
    const clauses: string[] = [];
    const params: unknown[] = [];
    for (const term of terms) {
      const like = `%${term.toLowerCase()}%`;
      params.push(like, like, like);
      clauses.push(`(LOWER(subject) LIKE $${params.length - 2} OR LOWER(COALESCE(description,'')) LIKE $${params.length - 1} OR LOWER(COALESCE(tags,'')) LIKE $${params.length})`);
    }
    const eq = (col: string, val: string | undefined, norm = false) => {
      if (!val) return;
      params.push(norm ? normalizeChannelName(val) : val);
      clauses.push(`${col} = $${params.length}`);
    };
    eq("status", str(url.searchParams.get("status")));
    eq("assignee", str(url.searchParams.get("assignee")));
    eq("project_id", str(url.searchParams.get("project_id")));
    eq("channel", str(url.searchParams.get("channel")), true);
    eq("priority", str(url.searchParams.get("priority")));
    if (!isTrue(url.searchParams.get("include_archived"))) clauses.push("status <> 'cancelled'");
    const recent = str(url.searchParams.get("sort")) === "recent";
    const order = recent
      ? "created_at DESC"
      : "CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END, created_at DESC";
    const limit = clampLimit(url.searchParams.get("limit"), 20, 1000);
    const offsetRaw = parseInt(url.searchParams.get("offset") || "0", 10);
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;
    params.push(limit); const limitIdx = params.length;
    params.push(offset); const offsetIdx = params.length;
    const rows = await client.many<Record<string, unknown>>(
      `SELECT * FROM tasks WHERE ${clauses.join(" AND ")} ORDER BY ${order} LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );
    const enriched = await enrichTasks(client, rows);
    const tasks = enriched.map((t, i) => {
      const subject = String((rows[i].subject as string) ?? "").toLowerCase();
      const matchCount = terms.filter((term) => subject.includes(term.toLowerCase())).length;
      return { ...t, snippet: null, relevance_score: Math.round((matchCount / terms.length) * 100) };
    });
    return json({ tasks });
  }

  // ---- due ----
  if (sub === "tasks/due" && method === "GET") {
    const windowHours = Number(str(url.searchParams.get("window_hours")) ?? "24") || 24;
    const nowMs = Date.now();
    const deadline = new Date(nowMs + windowHours * 3_600_000).toISOString();
    const rows = await client.many<Record<string, unknown>>(
      `SELECT * FROM tasks WHERE due_at IS NOT NULL AND due_at <= $1 AND status NOT IN ('completed','cancelled') ORDER BY due_at ASC`,
      [deadline],
    );
    const enriched = await enrichTasks(client, rows);
    const tasks = enriched.map((t) => {
      const hoursUntilDue = (new Date(String(t.due_at)).getTime() - nowMs) / 3_600_000;
      const urgency = hoursUntilDue < 0 ? "overdue" : hoursUntilDue <= 24 ? "due_today" : "due_soon";
      return { task: t, due_in_hours: Math.round(hoursUntilDue * 10) / 10, urgency };
    });
    return json({ tasks });
  }

  // ---- comments ----
  const commentsMatch = sub.match(/^tasks\/([^/]+)\/comments$/);
  if (commentsMatch) {
    const id = await resolveTaskId(client, decodeURIComponent(commentsMatch[1]));
    if (method === "GET") {
      if (id == null) return json({ comments: [] });
      const rows = await client.many(`SELECT * FROM task_comments WHERE task_id = $1 ORDER BY created_at ASC, id ASC`, [id]);
      return json({ comments: rows });
    }
    if (method === "POST") {
      if (id == null) return json({ error: "Task not found" }, 404);
      const body = await readJson(req);
      const who = str(body.agent) ?? agent ?? undefined;
      const content = str(body.content);
      if (!who || !content) return json({ error: "agent and content are required" }, 400);
      const row = await client.get(
        `INSERT INTO task_comments (task_id, agent, content) VALUES ($1,$2,$3) RETURNING *`,
        [id, who, content],
      );
      await logTaskActivity(client, id, who, "comment", content.length > 200 ? content.slice(0, 200) + "…" : content);
      return json({ comment: row }, 201);
    }
  }

  // ---- subtasks ----
  const subtasksMatch = sub.match(/^tasks\/([^/]+)\/subtasks$/);
  if (subtasksMatch && method === "GET") {
    const id = await resolveTaskId(client, decodeURIComponent(subtasksMatch[1]));
    if (id == null) return json({ tasks: [] });
    const rows = await client.many<Record<string, unknown>>(`SELECT * FROM tasks WHERE parent_id = $1 ORDER BY created_at ASC, id ASC`, [id]);
    return json({ tasks: await enrichTasks(client, rows) });
  }

  // ---- tree ----
  const treeMatch = sub.match(/^tasks\/([^/]+)\/tree$/);
  if (treeMatch && method === "GET") {
    const id = await resolveTaskId(client, decodeURIComponent(treeMatch[1]));
    if (id == null) return json({ error: "Task not found" }, 404);
    const maxDepth = Number(str(url.searchParams.get("max_depth")) ?? "5") || 5;
    const build = async (taskId: number, depth: number): Promise<Record<string, unknown>> => {
      const node = await getEnrichedTask(client, taskId);
      if (!node) return {};
      if (depth >= maxDepth) return { ...node, children: [] };
      const childRows = await client.many<Record<string, unknown>>(`SELECT id FROM tasks WHERE parent_id = $1 ORDER BY created_at ASC, id ASC`, [taskId]);
      const children = [];
      for (const c of childRows) children.push(await build(Number(c.id), depth + 1));
      return { ...node, children };
    };
    return json({ tree: await build(id, 0) });
  }

  // ---- dependencies ----
  const depsMatch = sub.match(/^tasks\/([^/]+)\/dependencies$/);
  if (depsMatch) {
    const id = await resolveTaskId(client, decodeURIComponent(depsMatch[1]));
    if (method === "GET") {
      if (id == null) return json({ tasks: [] });
      const rows = await client.many<Record<string, unknown>>(
        `SELECT t.* FROM tasks t INNER JOIN task_dependencies td ON td.depends_on_id = t.id WHERE td.task_id = $1 ORDER BY t.created_at ASC`,
        [id],
      );
      return json({ tasks: rows.map(parseTaskRow) });
    }
    if (method === "POST") {
      if (id == null) return json({ error: "Task not found" }, 404);
      const body = await readJson(req);
      const depId = await resolveTaskId(client, String(body.depends_on));
      if (depId == null) return json({ error: `Dependency task not found: ${body.depends_on}` }, 404);
      if (depId === id) return json({ error: "A task cannot depend on itself" }, 400);
      if (await isCircularDependency(client, id, depId)) return json({ error: `Circular dependency detected: task #${id} -> #${depId}` }, 400);
      await client.query(`INSERT INTO task_dependencies (task_id, depends_on_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, depId]);
      const deps = await client.many<{ depends_on_id: number }>(`SELECT depends_on_id FROM task_dependencies WHERE task_id = $1`, [id]);
      await client.query(`UPDATE tasks SET depends_on = $1 WHERE id = $2`, [JSON.stringify(deps.map((d) => Number(d.depends_on_id))), id]);
      const dep = await client.get<{ status: string }>(`SELECT status FROM tasks WHERE id = $1`, [depId]);
      if (dep && dep.status !== "completed") await client.query(`UPDATE tasks SET status = 'blocked' WHERE id = $1`, [id]);
      await logTaskActivity(client, id, "", "dependency_added", `depends on #${depId}`);
      return json({ added: true });
    }
  }

  const depDelMatch = sub.match(/^tasks\/([^/]+)\/dependencies\/([^/]+)$/);
  if (depDelMatch && method === "DELETE") {
    const id = await resolveTaskId(client, decodeURIComponent(depDelMatch[1]));
    if (id == null) return json({ error: "Task not found" }, 404);
    const depId = Number(decodeURIComponent(depDelMatch[2]));
    await client.query(`DELETE FROM task_dependencies WHERE task_id = $1 AND depends_on_id = $2`, [id, depId]);
    const deps = await client.many<{ depends_on_id: number }>(`SELECT depends_on_id FROM task_dependencies WHERE task_id = $1`, [id]);
    await client.query(`UPDATE tasks SET depends_on = $1 WHERE id = $2`, [JSON.stringify(deps.map((d) => Number(d.depends_on_id))), id]);
    await logTaskActivity(client, id, "", "dependency_removed", `no longer depends on #${depId}`);
    return json({ removed: true });
  }

  // ---- dependents ----
  const dependentsMatch = sub.match(/^tasks\/([^/]+)\/dependents$/);
  if (dependentsMatch && method === "GET") {
    const id = await resolveTaskId(client, decodeURIComponent(dependentsMatch[1]));
    if (id == null) return json({ tasks: [] });
    const rows = await client.many<Record<string, unknown>>(
      `SELECT t.* FROM tasks t INNER JOIN task_dependencies td ON td.task_id = t.id WHERE td.depends_on_id = $1 ORDER BY t.created_at ASC`,
      [id],
    );
    return json({ tasks: rows.map(parseTaskRow) });
  }

  // ---- activity ----
  const activityMatch = sub.match(/^tasks\/([^/]+)\/activity$/);
  if (activityMatch && method === "GET") {
    const id = await resolveTaskId(client, decodeURIComponent(activityMatch[1]));
    if (id == null) return json({ activity: [] });
    const limit = clampLimit(url.searchParams.get("limit"), 50, 1000);
    const rows = await client.many(`SELECT * FROM task_activity WHERE task_id = $1 ORDER BY created_at DESC, id DESC LIMIT ${limit}`, [id]);
    return json({ activity: rows });
  }

  // ---- summary ----
  const summaryMatch = sub.match(/^tasks\/([^/]+)\/summary$/);
  if (summaryMatch && method === "GET") {
    const id = await resolveTaskId(client, decodeURIComponent(summaryMatch[1]));
    if (id == null) return json({ summary: null });
    const task = await getEnrichedTask(client, id);
    const subtasks = await client.many<{ status: string }>(`SELECT status FROM tasks WHERE parent_id = $1`, [id]);
    const deps = await client.many<{ depends_on_id: number; status: string }>(
      `SELECT td.depends_on_id, t.status FROM task_dependencies td JOIN tasks t ON t.id = td.depends_on_id WHERE td.task_id = $1`,
      [id],
    );
    const commentRow = await client.get<{ c: number }>(`SELECT COUNT(*)::int AS c FROM task_comments WHERE task_id = $1`, [id]);
    const totalSubtasks = subtasks.length;
    const completedSubtasks = subtasks.filter((s) => s.status === "completed").length;
    const totalDeps = deps.length;
    const completedDeps = deps.filter((d) => d.status === "completed").length;
    const items = totalSubtasks + totalDeps;
    const completed = completedSubtasks + completedDeps;
    const completionPct = items > 0 ? Math.round((completed / items) * 100) : (task?.status === "completed" ? 100 : 0);
    const activity = await client.many(`SELECT action, agent, detail, created_at FROM task_activity WHERE task_id = $1 ORDER BY id DESC LIMIT 10`, [id]);
    const blockers = await client.many<{ task_id: number; subject: string; status: string }>(
      `SELECT td.depends_on_id AS task_id, t.subject, t.status FROM task_dependencies td JOIN tasks t ON t.id = td.depends_on_id WHERE td.task_id = $1 AND t.status <> 'completed'`,
      [id],
    );
    const dependents = await client.many<{ task_id: number; subject: string; status: string }>(
      `SELECT td.task_id, t.subject, t.status FROM task_dependencies td JOIN tasks t ON t.id = td.task_id WHERE td.depends_on_id = $1`,
      [id],
    );
    return json({
      summary: {
        task,
        progress: {
          total_subtasks: totalSubtasks,
          completed_subtasks: completedSubtasks,
          total_dependencies: totalDeps,
          completed_dependencies: completedDeps,
          comment_count: Number(commentRow?.c ?? 0),
          completion_pct: completionPct,
        },
        recent_activity: activity,
        blockers: blockers.map((b) => ({ task_id: Number(b.task_id), subject: b.subject, status: b.status })),
        dependents: dependents.map((d) => ({ task_id: Number(d.task_id), subject: d.subject, status: d.status })),
      },
    });
  }

  // ---- state transitions ----
  const actionMatch = sub.match(/^tasks\/([^/]+)\/(start|complete|cancel|block|unblock|reopen|assign|priority)$/);
  if (actionMatch && method === "POST") {
    const id = await resolveTaskId(client, decodeURIComponent(actionMatch[1]));
    if (id == null) return json({ task: null });
    const action = actionMatch[2];
    const body = await readJson(req);
    const who = str(body.agent) ?? agent ?? undefined;
    const current = await client.get<{ status: string; priority: string; reporter: string }>(`SELECT status, priority, reporter FROM tasks WHERE id = $1`, [id]);
    const actor = who ?? current?.reporter ?? "";
    switch (action) {
      case "start": {
        const incomplete = await client.many<{ depends_on_id: number; subject: string; status: string }>(
          `SELECT td.depends_on_id, t.subject, t.status FROM task_dependencies td JOIN tasks t ON t.id = td.depends_on_id WHERE td.task_id = $1 AND t.status <> 'completed'`,
          [id],
        );
        if (incomplete.length > 0) {
          return json({ error: `Cannot start: blocked by ${incomplete.length} incomplete task(s): ${incomplete.map((d) => `#${d.depends_on_id} "${d.subject}" (${d.status})`).join(", ")}` }, 400);
        }
        await client.query(`UPDATE tasks SET status = 'in_progress', started_at = $1 WHERE id = $2`, [now(), id]);
        await logTaskActivity(client, id, actor, "started");
        break;
      }
      case "complete":
        await client.query(`UPDATE tasks SET status = 'completed', completed_at = $1 WHERE id = $2`, [now(), id]);
        await logTaskActivity(client, id, actor, "completed", str(body.evidence));
        await unblockDependents(client, id);
        break;
      case "cancel":
        await client.query(`UPDATE tasks SET status = 'cancelled', cancelled_at = $1 WHERE id = $2`, [now(), id]);
        await logTaskActivity(client, id, actor, "cancelled", str(body.reason));
        break;
      case "block":
        await client.query(`UPDATE tasks SET status = 'blocked' WHERE id = $1`, [id]);
        await logTaskActivity(client, id, actor, "blocked", str(body.reason));
        break;
      case "unblock": {
        const incomplete = await client.get(
          `SELECT 1 FROM task_dependencies td JOIN tasks t ON t.id = td.depends_on_id WHERE td.task_id = $1 AND t.status <> 'completed' LIMIT 1`,
          [id],
        );
        await client.query(`UPDATE tasks SET status = $1 WHERE id = $2`, [incomplete ? "blocked" : "pending", id]);
        await logTaskActivity(client, id, actor, "unblocked");
        break;
      }
      case "reopen":
        await client.query(`UPDATE tasks SET status = 'pending', completed_at = NULL, cancelled_at = NULL WHERE id = $1`, [id]);
        await logTaskActivity(client, id, actor, "reopened");
        break;
      case "assign": {
        const assignee = str(body.assignee);
        await client.query(`UPDATE tasks SET assignee = $1 WHERE id = $2`, [assignee ?? null, id]);
        await logTaskActivity(client, id, actor, "assigned", assignee ?? null);
        break;
      }
      case "priority": {
        const priority = str(body.priority);
        if (!priority) return json({ error: "priority is required" }, 400);
        await client.query(`UPDATE tasks SET priority = $1 WHERE id = $2`, [priority, id]);
        await logTaskActivity(client, id, actor, "priority_changed", `${current?.priority} -> ${priority}`);
        break;
      }
    }
    return json({ task: await getEnrichedTask(client, id) });
  }

  // ---- get / delete one task ----
  const idMatch = sub.match(/^tasks\/([^/]+)$/);
  if (idMatch) {
    const idParam = decodeURIComponent(idMatch[1]);
    if (method === "GET") {
      const id = await resolveTaskId(client, idParam);
      if (id == null) return json({ task: null });
      return json({ task: await getEnrichedTask(client, id) });
    }
    if (method === "DELETE") {
      const id = await resolveTaskId(client, idParam);
      if (id == null) return json({ error: "Task not found" }, 404);
      const sub2 = await client.get<{ c: number }>(`SELECT COUNT(*)::int AS c FROM tasks WHERE parent_id = $1`, [id]);
      if (Number(sub2?.c ?? 0) > 0) return json({ error: `Cannot delete: ${sub2!.c} subtask(s) still reference this task` }, 400);
      await logTaskActivity(client, id, str(url.searchParams.get("agent")) ?? agent ?? "", "deleted");
      await client.query(`DELETE FROM tasks WHERE id = $1`, [id]);
      return json({ deleted: true });
    }
  }

  return null;
}

// ---- locks router ------------------------------------------------------------

const DEFAULT_LOCK_EXPIRY_MS = 5 * 60 * 1000;
const STALE_LOCK_SECONDS = 30 * 60;

async function cleanExpiredLocks(client: TypedQueryClient): Promise<number> {
  const res = await client.query(`DELETE FROM resource_locks WHERE expires_at < NOW()`);
  return res.rowCount;
}
async function releaseStaleLocks(client: TypedQueryClient): Promise<number> {
  const res = await client.query(
    `DELETE FROM resource_locks WHERE LOWER(agent_id) IN (
       SELECT LOWER(agent) FROM agent_presence WHERE last_seen_at < NOW() - interval '${STALE_LOCK_SECONDS} seconds')`,
  );
  return res.rowCount;
}

interface LockRow {
  resource_type: string; resource_id: string; agent_id: string;
  lock_type: string; locked_at: string; expires_at: string;
}

async function handleLocks(
  sub: string,
  method: string,
  req: Request,
  url: URL,
  client: PoolQueryClient,
): Promise<Response | null> {
  if (sub !== "locks" && !sub.startsWith("locks/")) return null;

  if (sub === "locks/clean" && method === "POST") {
    return json({ cleaned: await cleanExpiredLocks(client) });
  }
  if (sub === "locks/release-stale" && method === "POST") {
    return json({ released: await releaseStaleLocks(client) });
  }
  if (sub === "locks/release" && method === "POST") {
    const body = await readJson(req);
    const rt = str(body.resource_type); const rid = str(body.resource_id); const aid = str(body.agent_id);
    if (!rt || !rid || !aid) return json({ error: "resource_type, resource_id, agent_id are required" }, 400);
    const res = await client.query(`DELETE FROM resource_locks WHERE resource_type = $1 AND resource_id = $2 AND agent_id = $3`, [rt, rid, aid]);
    return json({ released: res.rowCount > 0 });
  }
  if (sub === "locks/check" && method === "GET") {
    const rt = str(url.searchParams.get("resource_type")); const rid = str(url.searchParams.get("resource_id"));
    if (!rt || !rid) return json({ error: "resource_type and resource_id are required" }, 400);
    await cleanExpiredLocks(client); await releaseStaleLocks(client);
    const row = await client.get<LockRow>(
      `SELECT * FROM resource_locks WHERE resource_type = $1 AND resource_id = $2 ORDER BY locked_at ASC LIMIT 1`,
      [rt, rid],
    );
    return json({ lock: row ?? null });
  }
  if (sub === "locks/bulk" && method === "POST") {
    const body = await readJson(req);
    const resources = Array.isArray(body.resources) ? (body.resources as Array<Record<string, unknown>>) : [];
    const agentId = str(body.agent_id);
    const isTry = body.try === true;
    if (!agentId) return json({ error: "agent_id is required" }, 400);
    let blockedBy: { resource_type: string; resource_id: string; held_by: string } | null = null;
    try {
      const result = await client.transaction(async (tx) => {
        await cleanExpiredLocks(tx); await releaseStaleLocks(tx);
        const acquired: LockRow[] = [];
        for (const r of resources) {
          const rt = String(r.resource_type); const rid = String(r.resource_id);
          const lockType = r.lock_type === "exclusive" ? "exclusive" : "advisory";
          const expiryMs = Number.isFinite(Number(r.expiry_ms)) && Number(r.expiry_ms) > 0 ? Number(r.expiry_ms) : DEFAULT_LOCK_EXPIRY_MS;
          const existing = await tx.many<LockRow>(
            `SELECT * FROM resource_locks WHERE resource_type = $1 AND resource_id = $2 ORDER BY CASE WHEN lock_type = $3 THEN 0 ELSE 1 END, locked_at ASC`,
            [rt, rid, lockType],
          );
          const conflicting = existing.find((l) => l.agent_id !== agentId);
          if (conflicting) {
            blockedBy = { resource_type: rt, resource_id: rid, held_by: conflicting.agent_id };
            throw new Error("__bulk_conflict");
          }
          const expiresAt = new Date(Date.now() + expiryMs).toISOString();
          if (existing.some((l) => l.lock_type === lockType)) {
            await tx.query(
              `UPDATE resource_locks SET expires_at = $4, locked_at = NOW() WHERE resource_type = $1 AND resource_id = $2 AND lock_type = $3`,
              [rt, rid, lockType, expiresAt],
            );
          } else {
            await tx.query(
              `INSERT INTO resource_locks (resource_type, resource_id, agent_id, lock_type, locked_at, expires_at) VALUES ($1,$2,$3,$4,NOW(),$5)`,
              [rt, rid, agentId, lockType, expiresAt],
            );
          }
          const lock = await tx.get<LockRow>(
            `SELECT * FROM resource_locks WHERE resource_type = $1 AND resource_id = $2 AND lock_type = $3`,
            [rt, rid, lockType],
          );
          if (lock) acquired.push(lock);
        }
        return { acquired: true, locks: acquired };
      });
      return json(result);
    } catch (e) {
      if (blockedBy) {
        if (isTry) return json({ acquired: false, locks: [], blocked_by: blockedBy });
        return json({ acquired: false, locks: [], blocked_by: blockedBy }, 409);
      }
      throw e;
    }
  }
  if (sub === "locks" && method === "POST") {
    const body = await readJson(req);
    const rt = str(body.resource_type); const rid = str(body.resource_id); const aid = str(body.agent_id);
    if (!rt || !rid || !aid) return json({ error: "resource_type, resource_id, agent_id are required" }, 400);
    const lockType = body.lock_type === "exclusive" ? "exclusive" : "advisory";
    const expiryMs = Number.isFinite(Number(body.expiry_ms)) && Number(body.expiry_ms) > 0 ? Number(body.expiry_ms) : DEFAULT_LOCK_EXPIRY_MS;
    const result = await client.transaction(async (tx) => {
      await cleanExpiredLocks(tx); await releaseStaleLocks(tx);
      const existing = await tx.many<LockRow>(
        `SELECT * FROM resource_locks WHERE resource_type = $1 AND resource_id = $2 ORDER BY CASE WHEN lock_type = $3 THEN 0 ELSE 1 END, locked_at ASC`,
        [rt, rid, lockType],
      );
      const conflicting = existing.find((l) => l.agent_id !== aid);
      if (conflicting) return { acquired: false, lock: null, held_by: conflicting.agent_id };
      const expiresAt = new Date(Date.now() + expiryMs).toISOString();
      if (existing.some((l) => l.lock_type === lockType)) {
        await tx.query(
          `UPDATE resource_locks SET expires_at = $4, locked_at = NOW() WHERE resource_type = $1 AND resource_id = $2 AND lock_type = $3`,
          [rt, rid, lockType, expiresAt],
        );
      } else {
        await tx.query(
          `INSERT INTO resource_locks (resource_type, resource_id, agent_id, lock_type, locked_at, expires_at) VALUES ($1,$2,$3,$4,NOW(),$5)`,
          [rt, rid, aid, lockType, expiresAt],
        );
      }
      const lock = await tx.get<LockRow>(
        `SELECT * FROM resource_locks WHERE resource_type = $1 AND resource_id = $2 AND lock_type = $3`,
        [rt, rid, lockType],
      );
      return { acquired: true, lock };
    });
    return json(result);
  }
  if (sub === "locks" && method === "GET") {
    await cleanExpiredLocks(client); await releaseStaleLocks(client);
    const clauses: string[] = [];
    const params: unknown[] = [];
    const rt = str(url.searchParams.get("resource_type"));
    const aid = str(url.searchParams.get("agent_id"));
    if (rt) { params.push(rt); clauses.push(`l.resource_type = $${params.length}`); }
    if (aid) { params.push(aid); clauses.push(`l.agent_id = $${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    if (isTrue(url.searchParams.get("enriched"))) {
      const rows = await client.many<Record<string, unknown>>(
        `SELECT l.*,
                EXTRACT(EPOCH FROM (NOW() - l.locked_at))::int AS locked_seconds_ago,
                EXTRACT(EPOCH FROM (l.expires_at - NOW()))::int AS expires_in_seconds,
                p.role AS p_role, p.status AS p_status, p.last_seen_at AS p_last_seen, p.project_id AS p_project,
                (p.last_seen_at IS NOT NULL AND EXTRACT(EPOCH FROM (NOW() - p.last_seen_at)) < 60) AS p_online
         FROM resource_locks l
         LEFT JOIN agent_presence p ON LOWER(p.agent) = LOWER(l.agent_id)
         ${where} ORDER BY l.locked_at ASC`,
        params,
      );
      const locks = rows.map((r) => ({
        resource_type: r.resource_type, resource_id: r.resource_id, agent_id: r.agent_id,
        lock_type: r.lock_type, locked_at: r.locked_at, expires_at: r.expires_at,
        locked_seconds_ago: Number(r.locked_seconds_ago),
        expires_in_seconds: Number(r.expires_in_seconds),
        agent: r.p_last_seen == null && r.p_role == null && r.p_status == null
          ? null
          : { role: r.p_role ?? null, status: r.p_status ?? null, online: r.p_online === true, last_seen_at: r.p_last_seen ?? null, project_id: r.p_project ?? null },
      }));
      return json({ locks });
    }
    const rows = await client.many(`SELECT * FROM resource_locks l ${where} ORDER BY l.locked_at ASC`, params);
    return json({ locks: rows });
  }

  return null;
}

// ---- sessions / topics / graph / summary / hot router ------------------------

async function computeHotness(client: TypedQueryClient, sessionId: string): Promise<Record<string, unknown> | null> {
  const row = await client.get<Record<string, unknown>>(
    `SELECT
       (SELECT string_agg(DISTINCT from_agent, ',') FROM messages WHERE session_id = $1) AS agents,
       (SELECT MAX(channel) FROM messages WHERE session_id = $1) AS channel,
       (SELECT MAX(created_at) FROM messages WHERE session_id = $1) AS last_message_at,
       (SELECT COUNT(*) FROM messages WHERE session_id = $1)::int AS message_count,
       (SELECT COUNT(*) FROM messages WHERE session_id = $1 AND created_at > NOW() - interval '1 hour')::int AS msgs_1h,
       (SELECT COUNT(*) FROM messages WHERE session_id = $1 AND created_at > NOW() - interval '24 hours')::int AS msgs_24h,
       (SELECT COUNT(DISTINCT from_agent) FROM messages WHERE session_id = $1)::int AS unique_agents,
       (SELECT COUNT(*) FROM reactions r JOIN messages m ON r.message_id = m.id WHERE m.session_id = $1)::int AS reaction_count,
       (SELECT COUNT(*) FROM messages WHERE session_id = $1 AND reply_to IS NOT NULL)::int AS reply_count,
       (SELECT COUNT(*) FROM messages WHERE session_id = $1 AND priority IN ('high','urgent'))::int AS high_priority_count,
       (SELECT COUNT(*) FROM messages WHERE session_id = $1 AND blocking = true)::int AS blocker_count`,
    [sessionId],
  );
  if (!row || Number(row.message_count) === 0) return null;
  const lastMs = new Date(String(row.last_message_at)).getTime();
  const hoursSinceLast = Math.max(0, (Date.now() - lastMs) / 3_600_000);
  const m = {
    msgs_1h: Number(row.msgs_1h), msgs_24h: Number(row.msgs_24h), unique_agents: Number(row.unique_agents),
    reaction_count: Number(row.reaction_count), reply_count: Number(row.reply_count),
    high_priority_count: Number(row.high_priority_count), blocker_count: Number(row.blocker_count),
  };
  const hotness_score = Math.round(
    m.msgs_1h * 3 + m.unique_agents * 5 + m.reaction_count * 2 + m.reply_count * 4 +
    m.high_priority_count * 10 + m.blocker_count * 20 - hoursSinceLast * 2,
  );
  return {
    session_id: sessionId,
    participants: String(row.agents ?? "").split(",").filter(Boolean),
    channel: (row.channel as string) ?? null,
    last_message_at: row.last_message_at,
    message_count: Number(row.message_count),
    hotness_score,
    metrics: { ...m, hours_since_last: Math.round(hoursSinceLast * 10) / 10 },
  };
}

async function handleAnalytics(
  sub: string,
  method: string,
  req: Request,
  url: URL,
  client: PoolQueryClient,
): Promise<Response | null> {
  // ---- sessions ----
  if (sub === "sessions" && method === "GET") {
    const who = str(url.searchParams.get("agent"));
    const rows = await client.many<Record<string, unknown>>(
      `SELECT session_id,
              string_agg(DISTINCT from_agent, ',') || ',' || string_agg(DISTINCT to_agent, ',') AS all_agents,
              MAX(created_at) AS last_message_at, COUNT(*)::int AS message_count,
              SUM(CASE WHEN read_at IS NULL${who ? " AND to_agent = $1" : ""} THEN 1 ELSE 0 END)::int AS unread_count
       FROM messages ${who ? "WHERE from_agent = $1 OR to_agent = $1" : ""}
       GROUP BY session_id ORDER BY last_message_at DESC`,
      who ? [who] : [],
    );
    const sessions = rows.map((r) => ({
      session_id: r.session_id,
      participants: [...new Set(String(r.all_agents ?? "").split(","))].filter(Boolean),
      last_message_at: r.last_message_at,
      message_count: Number(r.message_count),
      unread_count: Number(r.unread_count),
    }));
    return json({ sessions });
  }
  const sessActivityMatch = sub.match(/^sessions\/([^/]+)\/activity$/);
  if (sessActivityMatch && method === "GET") {
    const sid = decodeURIComponent(sessActivityMatch[1]);
    const exists = await client.get(`SELECT 1 FROM messages WHERE session_id = $1 LIMIT 1`, [sid]);
    if (!exists) return json({ activity: null });
    const row = await client.get<Record<string, unknown>>(
      `SELECT
         (SELECT COUNT(*) FROM messages WHERE session_id = $1 AND created_at > NOW() - interval '1 hour')::int AS msgs_1h,
         (SELECT COUNT(*) FROM messages WHERE session_id = $1 AND created_at > NOW() - interval '24 hours')::int AS msgs_24h,
         (SELECT COUNT(DISTINCT from_agent) FROM messages WHERE session_id = $1)::int AS unique_agents,
         (SELECT COUNT(*) FROM messages WHERE session_id = $1)::int AS total,
         (SELECT COUNT(*) FROM messages WHERE session_id = $1 AND reply_to IS NOT NULL)::int AS replies,
         (SELECT COUNT(*) FROM reactions r JOIN messages m ON r.message_id = m.id WHERE m.session_id = $1)::int AS reactions,
         (SELECT COUNT(DISTINCT from_agent) FROM messages WHERE session_id = $1 AND created_at > NOW() - interval '1 hour')::int AS agents_1h`,
      [sid],
    );
    const priorityRow = await client.get<{ priority: string }>(
      `SELECT priority FROM messages WHERE session_id = $1 GROUP BY priority ORDER BY COUNT(*) DESC LIMIT 1`,
      [sid],
    );
    const total = Number(row?.total ?? 0);
    const replies = Number(row?.replies ?? 0);
    return json({
      activity: {
        session_id: sid,
        msgs_last_1h: Number(row?.msgs_1h ?? 0),
        msgs_last_24h: Number(row?.msgs_24h ?? 0),
        unique_agents: Number(row?.unique_agents ?? 0),
        reply_ratio: total > 0 ? Math.round((replies / total) * 100) / 100 : 0,
        avg_priority: priorityRow?.priority ?? "normal",
        reaction_count: Number(row?.reactions ?? 0),
        is_trending: Number(row?.msgs_1h ?? 0) >= 5 || Number(row?.agents_1h ?? 0) >= 3,
      },
    });
  }
  const sessMatch = sub.match(/^sessions\/([^/]+)$/);
  if (sessMatch && method === "GET") {
    const sid = decodeURIComponent(sessMatch[1]);
    const row = await client.get<Record<string, unknown>>(
      `SELECT session_id,
              string_agg(DISTINCT from_agent, ',') || ',' || string_agg(DISTINCT to_agent, ',') AS all_agents,
              MAX(created_at) AS last_message_at, COUNT(*)::int AS message_count,
              SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END)::int AS unread_count
       FROM messages WHERE session_id = $1 GROUP BY session_id`,
      [sid],
    );
    if (!row) return json({ session: null });
    return json({
      session: {
        session_id: row.session_id,
        participants: [...new Set(String(row.all_agents ?? "").split(","))].filter(Boolean),
        last_message_at: row.last_message_at,
        message_count: Number(row.message_count),
        unread_count: Number(row.unread_count),
      },
    });
  }

  // ---- topics ----
  const topicChannelMatch = sub.match(/^topics\/channel\/([^/]+)$/);
  if (topicChannelMatch && method === "GET") {
    const channel = normalizeChannelName(decodeURIComponent(topicChannelMatch[1]));
    const collection = analyticsReadOptions(url);
    const since = str(url.searchParams.get("since"));
    const params: unknown[] = [channel];
    let sinceClause = "";
    if (since) { params.push(since); sinceClause = `AND created_at > $${params.length}`; }
    params.push(collection.limit);
    const rows = await boundedCollectionQuery(client, collection.timeoutMs, (tx) => tx.many<{ preview_source: string }>(
      `SELECT CASE WHEN ${restrictedMessagePredicatePg()} THEN '' ELSE left(content, ${COLLECTION_PREVIEW_SCAN_CHARS}) END AS preview_source
       FROM messages WHERE channel = $1 ${sinceClause} ORDER BY created_at DESC LIMIT $${params.length}`,
      params,
    ));
    return json({ topics: extractTopics(rows.map((r) => redactSensitiveText(r.preview_source)).join("\n"), 15) });
  }
  const topicSessionMatch = sub.match(/^topics\/session\/([^/]+)$/);
  if (topicSessionMatch && method === "GET") {
    const sid = decodeURIComponent(topicSessionMatch[1]);
    const collection = analyticsReadOptions(url);
    const rows = await boundedCollectionQuery(client, collection.timeoutMs, (tx) => tx.many<{ preview_source: string }>(
      `SELECT CASE WHEN ${restrictedMessagePredicatePg()} THEN '' ELSE left(content, ${COLLECTION_PREVIEW_SCAN_CHARS}) END AS preview_source
       FROM messages WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [sid, collection.limit],
    ));
    return json({ topics: extractTopics(rows.map((r) => redactSensitiveText(r.preview_source)).join("\n"), 15) });
  }
  if (sub === "topics/trending" && method === "GET") {
    const hours = Number(str(url.searchParams.get("hours")) ?? "24") || 24;
    const topN = Math.min(Math.max(1, Number(str(url.searchParams.get("top_n")) ?? "20") || 20), 100);
    const collection = analyticsReadOptions(url);
    const projectId = str(url.searchParams.get("project_id"));
    const params: unknown[] = [];
    let where = `WHERE created_at > NOW() - interval '${Math.floor(hours)} hours'`;
    if (projectId) { params.push(projectId); where += ` AND project_id = $${params.length}`; }
    params.push(collection.limit);
    const rows = await boundedCollectionQuery(client, collection.timeoutMs, (tx) => tx.many<{ preview_source: string }>(
      `SELECT CASE WHEN ${restrictedMessagePredicatePg()} THEN '' ELSE left(content, ${COLLECTION_PREVIEW_SCAN_CHARS}) END AS preview_source
       FROM messages ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
      params,
    ));
    return json({ topics: extractTopics(rows.map((r) => redactSensitiveText(r.preview_source)).join("\n"), topN) });
  }

  // ---- graph ----
  if (sub === "graph/build" && method === "POST") {
    let created = 0; let updated = 0;
    const runUpsert = async (sql: string) => {
      const row = await client.get<{ created: number; updated: number }>(sql);
      created += Number(row?.created ?? 0); updated += Number(row?.updated ?? 0);
    };
    await runUpsert(
      `WITH src AS (SELECT from_agent AS fid, to_agent AS tid, COUNT(*) AS cnt FROM messages WHERE channel IS NULL AND from_agent <> to_agent GROUP BY from_agent, to_agent),
       ins AS (INSERT INTO graph_edges (from_type, from_id, to_type, to_id, relation, weight, updated_at)
               SELECT 'agent', fid, 'agent', tid, 'communicates_with', cnt, NOW() FROM src
               ON CONFLICT (from_type, from_id, to_type, to_id, relation) DO UPDATE SET weight = EXCLUDED.weight, updated_at = EXCLUDED.updated_at
               RETURNING (xmax = 0) AS inserted)
       SELECT COUNT(*) FILTER (WHERE inserted)::int AS created, COUNT(*) FILTER (WHERE NOT inserted)::int AS updated FROM ins`,
    );
    await runUpsert(
      `WITH src AS (SELECT from_agent AS fid, channel AS ch, COUNT(*) AS cnt FROM messages WHERE channel IS NOT NULL GROUP BY from_agent, channel),
       ins AS (INSERT INTO graph_edges (from_type, from_id, to_type, to_id, relation, weight, updated_at)
               SELECT 'agent', fid, 'channel', ch, 'posts_in', cnt, NOW() FROM src
               ON CONFLICT (from_type, from_id, to_type, to_id, relation) DO UPDATE SET weight = EXCLUDED.weight, updated_at = EXCLUDED.updated_at
               RETURNING (xmax = 0) AS inserted)
       SELECT COUNT(*) FILTER (WHERE inserted)::int AS created, COUNT(*) FILTER (WHERE NOT inserted)::int AS updated FROM ins`,
    );
    await runUpsert(
      `WITH ins AS (INSERT INTO graph_edges (from_type, from_id, to_type, to_id, relation, weight, updated_at)
               SELECT 'agent', agent, 'channel', channel, 'member_of', 1, NOW() FROM channel_members
               ON CONFLICT (from_type, from_id, to_type, to_id, relation) DO UPDATE SET weight = EXCLUDED.weight, updated_at = EXCLUDED.updated_at
               RETURNING (xmax = 0) AS inserted)
       SELECT COUNT(*) FILTER (WHERE inserted)::int AS created, COUNT(*) FILTER (WHERE NOT inserted)::int AS updated FROM ins`,
    );
    await runUpsert(
      `WITH ins AS (INSERT INTO graph_edges (from_type, from_id, to_type, to_id, relation, weight, updated_at)
               SELECT 'channel', name, 'project', project_id, 'belongs_to', 1, NOW() FROM channels WHERE project_id IS NOT NULL
               ON CONFLICT (from_type, from_id, to_type, to_id, relation) DO UPDATE SET weight = EXCLUDED.weight, updated_at = EXCLUDED.updated_at
               RETURNING (xmax = 0) AS inserted)
       SELECT COUNT(*) FILTER (WHERE inserted)::int AS created, COUNT(*) FILTER (WHERE NOT inserted)::int AS updated FROM ins`,
    );
    return json({ edges_created: created, edges_updated: updated });
  }
  if (sub === "graph/related" && method === "GET") {
    const et = str(url.searchParams.get("entity_type")); const eid = str(url.searchParams.get("entity_id"));
    if (!et || !eid) return json({ error: "entity_type and entity_id are required" }, 400);
    const outgoing = await client.many(`SELECT to_type AS type, to_id AS id, relation, weight FROM graph_edges WHERE from_type = $1 AND from_id = $2 ORDER BY weight DESC`, [et, eid]);
    const incoming = await client.many(`SELECT from_type AS type, from_id AS id, relation, weight FROM graph_edges WHERE to_type = $1 AND to_id = $2 ORDER BY weight DESC`, [et, eid]);
    return json({ related: [...outgoing, ...incoming] });
  }
  const netMatch = sub.match(/^graph\/network\/([^/]+)$/);
  if (netMatch && method === "GET") {
    const who = decodeURIComponent(netMatch[1]);
    const comms = await client.many(
      `SELECT to_id AS agent, weight AS message_count,
              (SELECT MAX(created_at) FROM messages WHERE from_agent = $1 AND to_agent = ge.to_id AND channel IS NULL) AS last_at
       FROM graph_edges ge WHERE from_type = 'agent' AND from_id = $1 AND relation = 'communicates_with' ORDER BY weight DESC LIMIT 20`,
      [who],
    );
    const channels = await client.many(
      `SELECT to_id AS channel, weight AS message_count FROM graph_edges WHERE from_type = 'agent' AND from_id = $1 AND relation = 'posts_in' ORDER BY weight DESC LIMIT 20`,
      [who],
    );
    const projects = await client.many<{ to_id: string }>(
      `SELECT DISTINCT g2.to_id FROM graph_edges g1
       JOIN graph_edges g2 ON g1.to_type = 'channel' AND g1.to_id = g2.from_id AND g2.relation = 'belongs_to'
       WHERE g1.from_type = 'agent' AND g1.from_id = $1 AND g1.relation IN ('member_of','posts_in')`,
      [who],
    );
    return json({ network: { agent: who, communicates_with: comms, channels, projects: projects.map((p) => p.to_id) } });
  }
  if (sub === "graph/stats" && method === "GET") {
    const total = await client.get<{ c: number }>(`SELECT COUNT(*)::int AS c FROM graph_edges`);
    const byRel = await client.many<{ relation: string; c: number }>(`SELECT relation, COUNT(*)::int AS c FROM graph_edges GROUP BY relation ORDER BY c DESC`);
    const map: Record<string, number> = {};
    for (const r of byRel) map[r.relation] = Number(r.c);
    return json({ total_edges: Number(total?.c ?? 0), by_relation: map });
  }

  // ---- summary ----
  const summaryMatch = sub.match(/^summary\/([^/]+)$/);
  if (summaryMatch && method === "GET") {
    const key = decodeURIComponent(summaryMatch[1]);
    const collection = collectionReadOptions(url);
    const isChannelRow = key.startsWith("channel:") ? true : Boolean(await client.get(`SELECT 1 FROM channels WHERE name = $1`, [key]));
    const filterCol = isChannelRow ? "channel" : "session_id";
    const rows = await boundedCollectionQuery(client, collection.timeoutMs, (tx) => tx.many<Record<string, unknown>>(
      `SELECT ${messagePreviewProjectionPg()} FROM messages WHERE ${filterCol} = $1
       ORDER BY created_at DESC, id DESC LIMIT $2`,
      [key, collection.limit],
    ));
    if (rows.length === 0) return json({ summary: null });
    const msgs = rows.map((row) => buildCollectionMessagePreview(row, collection.previewBytes));
    const agents = new Set<string>();
    for (const m of msgs) { agents.add(String(m.from_agent)); if (m.to_agent) agents.add(String(m.to_agent)); }
    const dates = msgs.map((m) => String(m.created_at)).sort();
    const topics = extractTopics(msgs.map((m) => m.preview).join("\n"), 10);
    const keyMessages: Array<{ id: number; from: string; content: string; reason: string }> = [];
    for (const m of msgs) {
      const p = String(m.priority);
      if (p === "high" || p === "urgent") keyMessages.push({ id: Number(m.id), from: String(m.from_agent), content: m.preview.slice(0, 200), reason: `${p} priority` });
      if (m.blocking) keyMessages.push({ id: Number(m.id), from: String(m.from_agent), content: m.preview.slice(0, 200), reason: "blocking message" });
    }
    for (const m of msgs) if (m.pinned_at) keyMessages.push({ id: Number(m.id), from: String(m.from_agent), content: m.preview.slice(0, 200), reason: "pinned" });
    const msgIds = msgs.map((m) => Number(m.id));
    if (msgIds.length > 0) {
      const reacted = await client.many<{ message_id: number; c: number }>(
        `SELECT message_id, COUNT(*)::int AS c FROM reactions WHERE message_id = ANY($1::bigint[]) GROUP BY message_id ORDER BY c DESC LIMIT 3`,
        [msgIds],
      );
      for (const r of reacted) {
        const m = msgs.find((x) => Number(x.id) === Number(r.message_id));
        if (m) keyMessages.push({ id: Number(r.message_id), from: String(m.from_agent), content: m.preview.slice(0, 200), reason: `${r.c} reaction(s)` });
      }
    }
    const seen = new Set<number>();
    const uniqueKey = keyMessages.filter((k) => (seen.has(k.id) ? false : (seen.add(k.id), true))).slice(0, 10);
    const blockers = msgs.filter((m) => m.blocking && m.unread).map((m) => ({ id: Number(m.id), from: String(m.from_agent), content: m.preview.slice(0, 200), created_at: m.created_at }));
    const replyCount = msgs.filter((m) => m.reply_to).length;
    let reactionCount = 0;
    if (msgIds.length > 0) {
      const rc = await client.get<{ c: number }>(`SELECT COUNT(*)::int AS c FROM reactions WHERE message_id = ANY($1::bigint[])`, [msgIds]);
      reactionCount = Number(rc?.c ?? 0);
    }
    const priorityCounts: Record<string, number> = {};
    for (const m of msgs) { const p = String(m.priority); priorityCounts[p] = (priorityCounts[p] || 0) + 1; }
    const avgPriority = Object.entries(priorityCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "normal";
    return json({
      summary: {
        session_id: key,
        participants: [...agents].filter((a) => a !== key),
        message_count: msgs.length,
        date_range: { first: dates[0], last: dates[dates.length - 1] },
        topics,
        key_messages: uniqueKey,
        unresolved_blockers: blockers,
        activity: { reply_count: replyCount, reaction_count: reactionCount, avg_priority: avgPriority },
      },
    });
  }

  // ---- hot ----
  if (sub === "hot" && method === "GET") {
    const limit = Number(str(url.searchParams.get("limit")) ?? "20") || 20;
    const minScore = Number(str(url.searchParams.get("min_score")) ?? "0") || 0;
    const channel = str(url.searchParams.get("channel"));
    const projectId = str(url.searchParams.get("project_id"));
    const params: unknown[] = [];
    let where = "";
    if (channel) { params.push(normalizeChannelName(channel)); where = `WHERE channel = $${params.length}`; }
    else if (projectId) { params.push(projectId); where = `WHERE project_id = $${params.length}`; }
    const sessions = await client.many<{ session_id: string }>(
      `SELECT session_id FROM messages ${where} GROUP BY session_id ORDER BY MAX(created_at) DESC LIMIT 100`,
      params,
    );
    const hot: Array<Record<string, unknown>> = [];
    for (const s of sessions) {
      const h = await computeHotness(client, s.session_id);
      if (h && Number(h.hotness_score) >= minScore) hot.push(h);
    }
    hot.sort((a, b) => Number(b.hotness_score) - Number(a.hotness_score));
    return json({ sessions: hot.slice(0, limit) });
  }
  const hotMatch = sub.match(/^hot\/([^/]+)$/);
  if (hotMatch && method === "GET") {
    const sid = decodeURIComponent(hotMatch[1]);
    return json({ session: await computeHotness(client, sid) });
  }

  return null;
}
