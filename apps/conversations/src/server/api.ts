/**
 * conversations-serve — the HTTP API surface.
 *
 * The server reads/writes the app's Postgres via the vendored storage kit,
 * selected by HASNA_CONVERSATIONS_DATABASE_URL (the server backend switch is
 * `sqlite | postgresql`; this process serves the postgresql backend).
 *
 * Surfaces:
 *   GET  /health   liveness (unauthenticated, trivial)
 *   GET  /ready    readiness — pings Postgres; {status,version,app}
 *   GET  /version  {status,version,app,build_sha}
 *   /v1/*          versioned API, guarded by @hasna/contracts API-key auth
 *
 * The /v1 surface covers the app's core operations: messages, channels,
 * projects, and agent presence — real SQL against the schema, no stubs.
 */

import { randomUUID } from "crypto";
import { createServerPoolFromEnv } from "../generated/storage-kit/index.js";
import type { TypedQueryClient, PoolQueryClient } from "../generated/storage-kit/query.js";
import { verifyApiKey, ApiKeyStore } from "@hasna/contracts/auth";
import type { ApiKeyVerifier } from "@hasna/contracts/auth";
import { version as pkgVersion } from "../../package.json";
import { openapiSpec } from "./openapi.js";
import { decayedStatus, SINGLE_TOUCH_TOLERANCE_SECONDS, SINGLE_TOUCH_REAP_WINDOW_SECONDS } from "../lib/presence.js";
import {
  normalizeChannelName,
  unknownChannelMessage,
  archivedChannelMessage,
  reservedHistoricalChannelMessage,
} from "../lib/channel-names.js";
import { newChannelId } from "../lib/channel-id.js";
import { extractTopics } from "../lib/topic-extract.js";
import { assertNoSensitiveContent, assertNoSensitiveValue, redactSensitiveText, redactSensitiveValue } from "../lib/content-safety.js";
import { resolveSelfSenderId } from "../lib/sender-identity.js";
import { normalizeMessageUuid, parseMessageReference } from "../lib/message-reference.js";
import { WORK_STATUS_CHANNEL, WORK_STATUS_DUPLICATE_WINDOW_MS, duplicateWorkStatusTransitionViolation, firstLineOf, parseWorkStatusEvent, workStatusEnvelopeViolation } from "../lib/work-status-envelope.js";
import { normalizeExactIsoTimestamp } from "../lib/since.js";
import { PROJECT_LIST_ORDER, pinnedOrderByClause, simpleOrderByClause } from "../lib/list-order.js";
import { decodeAttachmentUploads } from "../lib/attachments.js";
import { BAKED_BUILD_SHA } from "./build-sha.generated.js";
import {
  PROJECT_MESSAGE_LINKAGE_RECEIPTS_TABLE,
  buildProjectMessageLinkagePlan,
  projectMessageLinkageHashes,
  projectMessageLinkageRevision,
  projectMessageLinkageTargetRevision,
  stableProjectMessageLinkageHash,
  type ProjectMessageLinkageRow,
} from "../lib/project-message-linkage.js";
import { CHANNEL_MERGE_RECEIPTS_TABLE, stableChannelMergeHash } from "../lib/channel-merge.js";
import {
  buildConversationEventEnvelope,
  CONTENT_PREVIEW_CHARS,
  CONVERSATIONS_SOURCE,
  MESSAGE_CREATED_TYPE,
  TASK_CREATED_TYPE,
  TASK_UPDATED_TYPE,
} from "../lib/events-bridge.js";
import type {
  ProjectMessageLinkageHash,
  ProjectMessageLinkageReceipt,
  ProjectMessageLinkageRollbackResult,
} from "../types.js";
import {
  assertProjectChannelRegistrationOperationIntent,
  isProjectChannelCollectionChangedError,
  type ProjectChannelCollectionRequest,
  type ProjectChannelMessageCollectionRequest,
  type ProjectChannelRegistrationLookupRequest,
  type ProjectChannelRegistrationReadRequest,
  type ProjectChannelRegistrationRequest,
} from "../lib/project-channel-registration.js";
import {
  compensateProjectChannelRegistrationPg,
  lookupProjectChannelRegistrationReceiptPg,
  listProjectChannelMessagePagePg,
  listProjectChannelRegistrationPagePg,
  projectChannelRegistrationPgCapability,
  readProjectChannelRegistrationExactPg,
  registerProjectChannelPg,
  verifyProjectChannelRegistrationInversePg,
} from "./project-channel-registration-pg.js";
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
  ExportMessagesOptions,
  IncidentProjectionRequestV1,
  IncidentProjectorContext,
} from "../types.js";
import {
  COLLECTION_PREVIEW_SCAN_CHARS,
  buildMessagePreview as buildCollectionMessagePreview,
  packMessagePreviewPage,
} from "../lib/message-previews.js";
import {
  ANALYTICS_LIMIT_MAX,
  resolveAliasedString,
  resolveAnalyticsLimit,
  resolveCollectionQueryOptions,
  resolveIso8601Date,
  resolvePresentString,
} from "../lib/strict-query-values.js";
import {
  loadMessageExportArtifact,
  resolveMessageExportOptions,
  serializeMessageExport,
  writeMessageExportArtifact,
} from "../lib/message-exports.js";
import {
  buildByteBoundedMessagePreview,
  packChannelNotificationPage,
} from "../lib/channel-notifications.js";
import type { ChannelNotification } from "../types.js";

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

function redactResponse<T>(data: T): T {
  return redactSensitiveValue(data);
}

function assertNoSensitiveOptionalText(value: string | undefined, context: string): void {
  if (value) assertNoSensitiveContent(value, context);
}

function signingSecret(): string {
  const secret =
    process.env.HASNA_CONVERSATIONS_API_SIGNING_KEY?.trim() ||
    process.env.HASNA_API_SIGNING_KEY?.trim() ||
    process.env.API_KEY_SIGNING_SECRET?.trim();
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
  incidentProjector?: IncidentProjectorContext | null;
}

function incidentProjectorContextFromEnv(): IncidentProjectorContext | null {
  const tenantId = process.env.HASNA_CONVERSATIONS_TENANT_ID?.trim();
  const authorityId = process.env.HASNA_CONVERSATIONS_INCIDENT_AUTHORITY_ID?.trim();
  if (!tenantId && !authorityId) return null;
  if (!tenantId || !authorityId) {
    throw new IncidentProjectorConfigurationError(
      "Incident projector configuration requires both tenant and authority identifiers.",
    );
  }
  const binding = validateIncidentProjectorBinding(tenantId, authorityId);
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
  const { client } = createServerPoolFromEnv(APP, { applicationName: "conversations-serve" });
  const keys = new ApiKeyStore(client);
  const verifier = verifyApiKey({
    app: APP,
    signingSecret: signingSecret(),
    keyStatus: keys.keyStatus,
    audit: (e) => {
      if (e.outcome === "deny") {
        console.warn(`[auth] deny ${e.method ?? "?"} ${e.path ?? "?"} reason=${e.reason} kid=${e.kid ?? "-"}`);
      }
    },
  });
  return { client, keys, verifier, incidentProjector: incidentProjectorContextFromEnv() };
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

function strictQueryString(searchParams: Pick<URLSearchParams, "get">, name: string): string | undefined {
  return resolvePresentString(searchParams.get(name), name);
}

function strictAliasedQueryString(
  searchParams: Pick<URLSearchParams, "get">,
  primary: string,
  alias: string,
): string | undefined {
  return resolveAliasedString(searchParams, primary, alias);
}

function strictIsoDateQuery(searchParams: Pick<URLSearchParams, "get">, name: string): string | undefined {
  return resolveIso8601Date(searchParams.get(name), name);
}

function pgBoundedPreviewSourceSql(alias = ""): string {
  const c = alias ? `${alias}.` : "";
  return `left(${c}content, ${COLLECTION_PREVIEW_SCAN_CHARS}) AS preview_source`;
}

function messagePreviewProjectionPg(alias = ""): string {
  const c = alias ? `${alias}.` : "";
  return `${c}id, ${c}uuid, ${c}session_id, ${c}from_agent, ${c}to_agent, ${c}channel, ${c}project_id,
          ${c}priority, ${c}blocking, ${c}reply_to, ${c}working_dir, ${c}repository, ${c}branch,
          ${c}created_at, ${c}read_at, ${c}edited_at, ${c}pinned_at,
          CASE WHEN ${c}metadata IS NULL OR ${c}metadata = '' THEN FALSE ELSE TRUE END AS has_metadata,
          CASE WHEN ${c}attachments IS NULL OR ${c}attachments = '' THEN 0 ELSE jsonb_array_length(${c}attachments::jsonb) END AS attachment_count,
          ${pgBoundedPreviewSourceSql(alias)},
          octet_length(${c}content) AS content_bytes`;
}

function collectionReadOptions(url: URL) {
  try {
    return resolveCollectionQueryOptions(url.searchParams);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error));
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

async function visibleIncidentProjectionIds(
  client: TypedQueryClient,
  context: IncidentProjectorContext | null | undefined,
  reader: string,
  filters: { ids?: number[]; channel?: string; session?: string } = {},
): Promise<number[]> {
  if (!context) return [];
  const params: unknown[] = [context.tenant_id, context.authority_id, reader];
  const clauses: string[] = [];
  if (filters.ids?.length) {
    params.push(filters.ids);
    clauses.push(`m.id = ANY($${params.length}::bigint[])`);
  }
  if (filters.channel) {
    params.push(filters.channel);
    clauses.push(`m.channel = $${params.length}`);
  }
  if (filters.session) {
    params.push(filters.session);
    clauses.push(`m.session_id = $${params.length}`);
  }
  const extra = clauses.length ? `AND ${clauses.join(" AND ")}` : "";
  const rows = await client.many<{ id: string | number }>(
    `WITH latest AS (
       SELECT p.* FROM incident_projections p
       JOIN (
         SELECT tenant_id, authority_id, incident_id, MAX(incident_version) AS incident_version
         FROM incident_projections WHERE tenant_id = $1 AND authority_id = $2
         GROUP BY tenant_id, authority_id, incident_id
       ) current USING (tenant_id, authority_id, incident_id, incident_version)
     )
     SELECT DISTINCT m.id FROM latest p
     JOIN messages m ON m.id = p.message_id
     JOIN incident_projection_scopes scope ON scope.projection_id = p.id AND scope.scope_type = 'blocked'
     WHERE p.status IN ('open','investigating','contained','monitoring') AND p.blocking = TRUE
       AND (
         lower(scope.scope) = 'agent:' || lower($3)
         OR lower(scope.scope) IN (
           SELECT 'channel:' || lower(channel) FROM channel_members WHERE lower(agent) = lower($3)
         )
         OR scope.scope IN (
           SELECT 'project:' || project_id FROM agent_presence
           WHERE lower(agent) = lower($3) AND project_id <> ''
         )
       ) ${extra}`,
    params,
  );
  return rows.map((row) => Number(row.id));
}

async function insertReadReceipts(client: TypedQueryClient, ids: number[], reader: string): Promise<number> {
  if (!ids.length) return 0;
  const result = await client.query(
    `INSERT INTO message_read_receipts (message_id, agent, read_at)
     SELECT message_id, $2, NOW() FROM unnest($1::bigint[]) AS message_id
     ON CONFLICT (message_id, agent) DO UPDATE SET read_at = EXCLUDED.read_at`,
    [ids, reader.toLowerCase()],
  );
  return result.rowCount;
}

function positiveInteger(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  if (typeof v !== "string" || !v.trim()) return undefined;
  const parsed = Number(v);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function nonNegativeInteger(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
  if (typeof v !== "string" || !v.trim()) return undefined;
  const parsed = Number(v);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function remoteProjectRegistrationTarget(digest: string) {
  return {
    digest,
    withOwnedPath<T>(_consumer: (absolutePath: string) => T): T {
      throw new Error("project registration target paths are not available to the Conversations service.");
    },
  };
}

function projectChannelRegistrationRequest(
  body: Record<string, unknown>,
): ProjectChannelRegistrationRequest {
  const targetDigest = str(body.target_digest);
  if (!targetDigest) throw new Error("target_digest is required.");
  const { target_digest: _targetDigest, target: _target, ...request } = body;
  return {
    ...request,
    target: remoteProjectRegistrationTarget(targetDigest),
  } as unknown as ProjectChannelRegistrationRequest;
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

const PROJECT_LINKAGE_MESSAGE_COLUMNS = [
  "id", "uuid", "session_id", "from_agent", "to_agent", "channel", "project_id",
  "content", "priority", "working_dir", "repository", "branch", "metadata",
  "edited_at", "pinned_at", "blocking", "attachments", "reply_to", "created_at", "read_at",
].join(", ");

type StoredProjectLinkageReceipt = {
  id: string;
  idempotency_key: string;
  operation: "apply" | "rollback";
  channel: string;
  project_id: string;
  source_receipt_id: string | null;
  request_hash: string;
  payload: string;
  created_at: string;
};

async function readProjectLinkageChannel(
  client: TypedQueryClient,
  channel: string,
  expectedProjectId?: string,
  lock: "share" | "update" | null = null,
): Promise<{ channel: string; project_id: string }> {
  const lockSql = lock === "share" ? " FOR SHARE" : lock === "update" ? " FOR UPDATE" : "";
  const row = await client.get<{ name: string; project_id: string | null }>(
    `SELECT name, project_id FROM channels WHERE name = $1${lockSql}`,
    [channel],
  );
  if (!row) throw new Error(`Channel not found: ${channel}`);
  if (!row.project_id) throw new Error(`Channel ${channel} is not linked to a project.`);
  if (expectedProjectId !== undefined && row.project_id !== expectedProjectId) {
    throw new Error(`Project ${expectedProjectId} conflicts with channel project ${row.project_id}.`);
  }
  return { channel, project_id: row.project_id };
}

async function readReservedHistoricalChannelAlias(
  client: TypedQueryClient,
  channel: string,
): Promise<string | null> {
  const row = await client.get<{ current_channel: string }>(
    "SELECT current_channel FROM channel_rename_aliases WHERE old_channel = $1",
    [channel],
  );
  return row?.current_channel ?? null;
}

async function readProjectLinkageRows(
  client: TypedQueryClient,
  channel: string,
  forUpdate = false,
): Promise<ProjectMessageLinkageRow[]> {
  return client.many<ProjectMessageLinkageRow>(
    `SELECT ${PROJECT_LINKAGE_MESSAGE_COLUMNS} FROM messages WHERE channel = $1 ORDER BY id ASC${forUpdate ? " FOR UPDATE" : ""}`,
    [channel],
  );
}

async function readProjectLinkageReceiptByKey(
  client: TypedQueryClient,
  key: string,
): Promise<StoredProjectLinkageReceipt | null> {
  return client.get<StoredProjectLinkageReceipt>(
    `SELECT * FROM ${PROJECT_MESSAGE_LINKAGE_RECEIPTS_TABLE} WHERE idempotency_key = $1`,
    [key],
  );
}

async function readProjectLinkageReceiptById(
  client: TypedQueryClient,
  id: string,
): Promise<StoredProjectLinkageReceipt | null> {
  return client.get<StoredProjectLinkageReceipt>(
    `SELECT * FROM ${PROJECT_MESSAGE_LINKAGE_RECEIPTS_TABLE} WHERE id = $1`,
    [id],
  );
}

function replayProjectLinkageReceipt<T extends { replayed?: boolean }>(
  existing: StoredProjectLinkageReceipt,
  requestHash: string,
): T {
  if (existing.request_hash !== requestHash) {
    throw new Error("Idempotency key was already used with a different request.");
  }
  return { ...(JSON.parse(existing.payload) as T), replayed: true };
}

function assertProjectLinkagePreserved(
  beforeHashes: ProjectMessageLinkageHash[],
  afterRows: ProjectMessageLinkageRow[],
): void {
  const after = new Map(
    projectMessageLinkageHashes(afterRows).map((entry) => [`${entry.id}:${entry.uuid}`, entry]),
  );
  for (const before of beforeHashes) {
    if (after.get(`${before.id}:${before.uuid}`)?.preserved_hash !== before.preserved_hash) {
      throw new Error(`Message ${before.id}/${before.uuid} changed outside project_id during linkage.`);
    }
  }
}

function projectLinkageError(error: unknown): Response {
  const message = (error as Error).message;
  const status = /not found/i.test(message)
    ? 404
    : /stale|conflict|changed|idempotency|verification/i.test(message)
      ? 409
      : 400;
  return json({ error: message }, status);
}

async function readProjectLinkageTargetRows(
  client: TypedQueryClient,
  targets: Array<{ id: number; uuid: string }>,
  forUpdate = false,
): Promise<ProjectMessageLinkageRow[]> {
  const rows: ProjectMessageLinkageRow[] = [];
  for (const target of targets) {
    const row = await client.get<ProjectMessageLinkageRow>(
      `SELECT ${PROJECT_LINKAGE_MESSAGE_COLUMNS} FROM messages WHERE id = $1 AND uuid = $2${forUpdate ? " FOR UPDATE" : ""}`,
      [target.id, target.uuid],
    );
    if (!row) throw new Error(`Message ${target.id}/${target.uuid} from the linkage receipt no longer exists.`);
    rows.push(row);
  }
  return rows.sort((a, b) => Number(a.id) - Number(b.id));
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
  const threadId = row.thread_id == null ? null : Number(row.thread_id);
  const threadStatus = row.thread_status === "open" || row.thread_status === "closed" ? row.thread_status : null;
  const replyCount = row.reply_count == null ? undefined : Number(row.reply_count);
  return {
    ...row,
    id,
    metadata: parseJsonObject(row.metadata),
    attachments: parseJsonArray(row.attachments),
    blocking: !!row.blocking,
    reply_to: replyTo || null,
    thread_id: threadId || null,
    thread_status: threadStatus,
    ...(replyCount === undefined ? {} : { reply_count: replyCount }),
  };
}

/** Coerce a DB row into the client-facing Channel/ChannelInfo shape. */
function parseServerChannel(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: row.id,
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

/** RFC-4180 CSV field escape (mirrors messages.ts escapeCsvField). */
function csv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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
 *
 * When `opts.reparent` is set, the transaction-local scope-rewrite guard is
 * armed so messages whose reply parents exist move atomically with the rename.
 * Without it the reply-parent immutability trigger stays in force and the
 * rename is rejected when reply parents exist.
 */
async function renameChannelServer(
  client: PoolQueryClient,
  oldName: string,
  newName: string,
  opts: { reparent?: boolean } = {},
): Promise<{ ok: true; name: string } | { ok: false; error: string; status: number }> {
  const from = normalizeChannelName(oldName);
  const to = normalizeChannelName(newName);
  return client.transaction(async (tx) => {
    await tx.get(
      "SELECT pg_advisory_xact_lock($1::bigint) AS channel_identity_locked",
      [CHANNEL_IDENTITY_ADVISORY_LOCK],
    );
    const existing = await tx.get(`SELECT name FROM channels WHERE name = $1 FOR UPDATE`, [from]);
    if (!existing) return { ok: false as const, error: `Channel not found: ${from}`, status: 404 };
    if (from === to) return { ok: true as const, name: from };
    const conflict = await tx.get(`SELECT name FROM channels WHERE name = $1 FOR UPDATE`, [to]);
    if (conflict) return { ok: false as const, error: `Channel #${to} already exists.`, status: 409 };
    const reserved = await tx.get<{ current_channel: string }>(
      "SELECT current_channel FROM channel_rename_aliases WHERE old_channel = $1 FOR UPDATE",
      [to],
    );
    if (reserved && reserved.current_channel !== from) {
      return { ok: false as const, error: `Channel #${to} is a reserved historical alias.`, status: 409 };
    }
    // Reply-parent scopes are immutable while replies exist. Only an explicit
    // reparent request arms the transaction-local rewrite guard that lets the
    // message scope move atomically with the rename; a plain rename keeps the
    // guard in force and the server rejects it when reply parents exist.
    if (opts.reparent) {
      await tx.get(
        "SELECT set_config('hasna.conversations.channel_scope_rewrite', $1, TRUE) AS configured",
        [JSON.stringify({
          old_session_id: `channel:${from}`,
          new_session_id: `channel:${to}`,
          old_channel: from,
          new_channel: to,
          old_to_agent: from,
          new_to_agent: to,
        })],
      );
    }
    // The source and replacement rows briefly share the same immutable id.
    // Migration 4 makes this constraint deferrable so uniqueness is checked
    // after the source row is deleted at transaction commit.
    await tx.query(`SET CONSTRAINTS channels_id_unique DEFERRED`);
    await tx.query(
      `INSERT INTO channels (id, name, description, topic, project_id, created_by, created_at, archived_at, metadata, tags)
       SELECT id, $1, description, topic, project_id, created_by, created_at, archived_at, metadata, tags FROM channels WHERE name = $2`,
      [to, from],
    );
    await tx.query(`DELETE FROM channel_rename_aliases WHERE old_channel = $1`, [to]);
    await tx.query(
      "UPDATE channel_rename_aliases SET current_channel = $1, renamed_at = NOW() WHERE current_channel = $2",
      [to, from],
    );
    await tx.query(
      `INSERT INTO channel_rename_aliases (old_channel, current_channel) VALUES ($1,$2)
       ON CONFLICT (old_channel) DO UPDATE SET current_channel = EXCLUDED.current_channel, renamed_at = NOW()`,
      [from, to],
    );
    await tx.query(`UPDATE channel_members SET channel = $1 WHERE channel = $2`, [to, from]);
    await tx.query(`UPDATE channel_subscriptions SET channel = $1 WHERE channel = $2`, [to, from]);
    await tx.query(
      `UPDATE messages SET channel = $1, to_agent = CASE WHEN to_agent = $2 THEN $1 ELSE to_agent END WHERE channel = $2`,
      [to, from],
    );
    await tx.query(`UPDATE messages SET session_id = $1 WHERE session_id = $2`, [`channel:${to}`, `channel:${from}`]);
    await tx.query(`UPDATE message_mentions SET channel = $1 WHERE channel = $2`, [to, from]);
    await tx.query(`UPDATE tasks SET channel = $1 WHERE channel = $2`, [to, from]);
    // graph_edges has no FK to channels, so an interrupted or legacy graph
    // rebuild can leave an orphan edge for the target name. Preserve the
    // source edge as authoritative, remove only an identical target duplicate,
    // then perform the rename without violating the graph's unique key.
    await tx.query(
      `UPDATE graph_edges AS target
       SET weight = source.weight, metadata = source.metadata, updated_at = source.updated_at
       FROM graph_edges AS source
       WHERE source.from_type = 'channel' AND source.from_id = $2
         AND target.from_type = source.from_type AND target.from_id = $1
         AND target.to_type = source.to_type AND target.to_id = source.to_id
         AND target.relation = source.relation`,
      [to, from],
    );
    await tx.query(
      `DELETE FROM graph_edges AS source
       USING graph_edges AS target
       WHERE source.from_type = 'channel' AND source.from_id = $2
         AND target.from_type = source.from_type AND target.from_id = $1
         AND target.to_type = source.to_type AND target.to_id = source.to_id
         AND target.relation = source.relation`,
      [to, from],
    );
    await tx.query(`UPDATE graph_edges SET from_id = $1 WHERE from_type = 'channel' AND from_id = $2`, [to, from]);
    await tx.query(
      `UPDATE graph_edges AS target
       SET weight = source.weight, metadata = source.metadata, updated_at = source.updated_at
       FROM graph_edges AS source
       WHERE source.to_type = 'channel' AND source.to_id = $2
         AND target.to_type = source.to_type AND target.to_id = $1
         AND target.from_type = source.from_type AND target.from_id = source.from_id
         AND target.relation = source.relation`,
      [to, from],
    );
    await tx.query(
      `DELETE FROM graph_edges AS source
       USING graph_edges AS target
       WHERE source.to_type = 'channel' AND source.to_id = $2
         AND target.to_type = source.to_type AND target.to_id = $1
         AND target.from_type = source.from_type AND target.from_id = source.from_id
         AND target.relation = source.relation`,
      [to, from],
    );
    await tx.query(`UPDATE graph_edges SET to_id = $1 WHERE to_type = 'channel' AND to_id = $2`, [to, from]);
    // resource_locks is also keyed by the resource name without a channel FK.
    // Keep an existing target lock and discard only a duplicate source lock.
    await tx.query(
      `DELETE FROM resource_locks AS source
       USING resource_locks AS target
       WHERE source.resource_type = 'channel' AND source.resource_id = $2
         AND target.resource_type = source.resource_type
         AND target.resource_id = $1
         AND target.lock_type = source.lock_type`,
      [to, from],
    );
    await tx.query(`UPDATE resource_locks SET resource_id = $1 WHERE resource_type = 'channel' AND resource_id = $2`, [to, from]);
    await tx.query(`DELETE FROM channels WHERE name = $1`, [from]);
    return { ok: true as const, name: to };
  });
}

// Message columns whose values survive a channel merge untouched; identical
// to the SQLite preserved-column set so plan revisions are comparable.
const MERGE_PRESERVED_COLUMNS = [
  "id", "uuid", "from_agent", "project_id", "content", "priority",
  "working_dir", "repository", "branch", "metadata", "edited_at",
  "pinned_at", "blocking", "attachments", "reply_to", "created_at", "read_at",
] as const;
const MERGE_FULL_COLUMNS = [
  ...MERGE_PRESERVED_COLUMNS,
  "session_id", "to_agent", "channel",
] as const;

interface MergeServerPlan {
  operation: "merge";
  dry_run: boolean;
  source_channel: string;
  destination_channel: string;
  archive_source: boolean;
  revision: string;
  source_message_count: number;
  moved_message_count: number;
  message_ids: number[];
  message_uuids: string[];
  message_id_min: number | null;
  message_id_max: number | null;
}

type MergeServerMessageRow = Record<string, unknown> & { id: number; uuid: string };

async function readMergeServerMessages(
  client: TypedQueryClient,
  channel: string,
): Promise<MergeServerMessageRow[]> {
  return client.many<MergeServerMessageRow>(
    `SELECT ${MERGE_FULL_COLUMNS.join(", ")} FROM messages WHERE channel = $1 ORDER BY id ASC`,
    [channel],
  );
}

function mergeServerPreservedHash(row: MergeServerMessageRow): string {
  return stableChannelMergeHash(
    Object.fromEntries(MERGE_PRESERVED_COLUMNS.map((column) => [column, row[column] ?? null])),
  );
}

function mergeServerFullHash(row: MergeServerMessageRow): string {
  return stableChannelMergeHash(
    Object.fromEntries(MERGE_FULL_COLUMNS.map((column) => [column, row[column] ?? null])),
  );
}

function buildMergeServerPlan(
  source: string,
  destination: string,
  sourceProjectId: string | null,
  destinationProjectId: string | null,
  sourceMessages: MergeServerMessageRow[],
  sourceMembers: string[],
  destinationMembers: string[],
  sourceSubscriptions: string[],
  destinationSubscriptions: string[],
  dryRun: boolean,
  archiveSource: boolean,
): MergeServerPlan {
  const ordered = sourceMessages.slice().sort((a, b) => Number(a.id) - Number(b.id));
  const ids = ordered.map((row) => Number(row.id));
  const revision = stableChannelMergeHash({
    source_channel: source,
    destination_channel: destination,
    source_project_id: sourceProjectId,
    destination_project_id: destinationProjectId,
    source_messages: ordered.map((row) => ({
      id: Number(row.id),
      uuid: String(row.uuid),
      preserved_hash: mergeServerPreservedHash(row),
    })),
    source_members: sourceMembers,
    destination_members: destinationMembers,
    source_subscriptions: sourceSubscriptions,
    destination_subscriptions: destinationSubscriptions,
  });
  return {
    operation: "merge",
    dry_run: dryRun,
    source_channel: source,
    destination_channel: destination,
    archive_source: archiveSource,
    revision,
    source_message_count: ordered.length,
    moved_message_count: ordered.length,
    message_ids: ids,
    message_uuids: ordered.map((row) => String(row.uuid)),
    message_id_min: ids.length > 0 ? Math.min(...ids) : null,
    message_id_max: ids.length > 0 ? Math.max(...ids) : null,
  };
}

function mergeServerPostRevision(
  source: string,
  destination: string,
  sourceProjectId: string | null,
  destinationProjectId: string | null,
  destinationMessages: MergeServerMessageRow[],
  destinationMembers: string[],
  destinationSubscriptions: string[],
): string {
  return stableChannelMergeHash({
    source_channel: source,
    destination_channel: destination,
    source_project_id: sourceProjectId,
    destination_project_id: destinationProjectId,
    source_messages: [],
    destination_messages: destinationMessages.map((row) => ({
      id: Number(row.id),
      uuid: String(row.uuid),
      hash: mergeServerFullHash(row),
    })),
    destination_members: destinationMembers,
    destination_subscriptions: destinationSubscriptions,
  });
}

type StoredServerMergeReceipt = {
  id: string;
  idempotency_key: string;
  operation: "apply" | "rollback";
  source_channel: string;
  destination_channel: string;
  source_receipt_id: string | null;
  request_hash: string;
  payload: string;
};

/**
 * Guarded atomic channel merge over PostgreSQL. Mirrors the SQLite merge
 * contract: both channel rows are locked FOR UPDATE, every collision is
 * refused inside the same transaction, messages move by in-place rewrite
 * (ids and uuids never change), and apply appends an immutable receipt.
 */
async function mergeChannelServer(
  client: PoolQueryClient,
  sourceName: string,
  destinationName: string,
  opts: { dryRun: boolean; archiveSource: boolean; expectedRevision?: string; idempotencyKey?: string },
): Promise<{ ok: true; plan: Record<string, unknown> } | { ok: false; error: string; status: number }> {
  const source = normalizeChannelName(sourceName);
  const destination = normalizeChannelName(destinationName);
  const requestHash = stableChannelMergeHash({
    operation: "apply",
    source_channel: source,
    destination_channel: destination,
    archive_source: opts.archiveSource,
    expected_revision: opts.expectedRevision ?? "",
  });

  return client.transaction(async (tx) => {
    await tx.get(
      "SELECT pg_advisory_xact_lock($1::bigint) AS channel_identity_locked",
      [CHANNEL_IDENTITY_ADVISORY_LOCK],
    );
    if (source === destination) {
      return { ok: false as const, error: `Channel merge refused: source and destination must differ (both normalize to ${source}).`, status: 409 };
    }
    const sourceRow = await tx.get<{ name: string; project_id: string | null }>(
      `SELECT name, project_id FROM channels WHERE name = $1 FOR UPDATE`,
      [source],
    );
    if (!sourceRow) return { ok: false as const, error: `Channel not found: ${source}`, status: 404 };
    const destinationRow = await tx.get<{ name: string; project_id: string | null }>(
      `SELECT name, project_id FROM channels WHERE name = $1 FOR UPDATE`,
      [destination],
    );
    if (!destinationRow) return { ok: false as const, error: `Channel not found: ${destination}`, status: 404 };
    const reserved = await tx.get<{ current_channel: string }>(
      "SELECT current_channel FROM channel_rename_aliases WHERE old_channel = $1 FOR UPDATE",
      [destination],
    );
    if (reserved && reserved.current_channel !== source) {
      return { ok: false as const, error: `Channel merge refused: #${destination} is a reserved historical alias for #${reserved.current_channel}.`, status: 409 };
    }
    const held = await tx.get<{ agent_id: string }>(
      `SELECT agent_id FROM resource_locks
       WHERE resource_type = 'channel' AND resource_id IN ($1, $2)
       ORDER BY locked_at ASC LIMIT 1`,
      [source, destination],
    );
    if (held) {
      return { ok: false as const, error: `Channel merge refused: #${source} or #${destination} is locked by ${held.agent_id}.`, status: 409 };
    }
    const memberOverlap = await tx.many<{ agent: string }>(
      `SELECT agent FROM channel_members
       WHERE channel = $1 AND agent IN (SELECT agent FROM channel_members WHERE channel = $2)
       ORDER BY agent`,
      [source, destination],
    );
    if (memberOverlap.length > 0) {
      return { ok: false as const, error: `Channel merge refused: member overlap with #${destination}: ${memberOverlap.map((row) => row.agent).join(", ")}.`, status: 409 };
    }
    const subscriptionOverlap = await tx.many<{ agent: string }>(
      `SELECT agent FROM channel_subscriptions
       WHERE channel = $1 AND agent IN (SELECT agent FROM channel_subscriptions WHERE channel = $2)
       ORDER BY agent`,
      [source, destination],
    );
    if (subscriptionOverlap.length > 0) {
      return { ok: false as const, error: `Channel merge refused: subscription overlap with #${destination}: ${subscriptionOverlap.map((row) => row.agent).join(", ")}.`, status: 409 };
    }
    if (
      sourceRow.project_id !== null &&
      destinationRow.project_id !== null &&
      sourceRow.project_id !== destinationRow.project_id
    ) {
      return { ok: false as const, error: `Channel merge refused: channels belong to different projects (${sourceRow.project_id} vs ${destinationRow.project_id}).`, status: 409 };
    }
    const stranded = await tx.get<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM messages
       WHERE channel IS NOT NULL AND channel <> $1 AND channel <> $2
         AND reply_to IN (SELECT id FROM messages WHERE channel = $1)`,
      [source, destination],
    );
    const strandedCount = stranded?.n ?? 0;
    if (strandedCount > 0) {
      return { ok: false as const, error: `Channel merge refused: ${strandedCount} message(s) in a third channel reply to a #${source} message.`, status: 409 };
    }

    const sourceMessages = await readMergeServerMessages(tx, source);
    const sourceMembers = (await tx.many<{ agent: string }>(
      "SELECT agent FROM channel_members WHERE channel = $1 ORDER BY agent", [source],
    )).map((row) => row.agent);
    const destinationMembers = (await tx.many<{ agent: string }>(
      "SELECT agent FROM channel_members WHERE channel = $1 ORDER BY agent", [destination],
    )).map((row) => row.agent);
    const sourceSubscriptions = (await tx.many<{ agent: string }>(
      "SELECT agent FROM channel_subscriptions WHERE channel = $1 ORDER BY agent", [source],
    )).map((row) => row.agent);
    const destinationSubscriptions = (await tx.many<{ agent: string }>(
      "SELECT agent FROM channel_subscriptions WHERE channel = $1 ORDER BY agent", [destination],
    )).map((row) => row.agent);

    const plan = buildMergeServerPlan(
      source, destination, sourceRow.project_id, destinationRow.project_id,
      sourceMessages, sourceMembers, destinationMembers,
      sourceSubscriptions, destinationSubscriptions,
      opts.dryRun, opts.archiveSource,
    );
    if (opts.dryRun) return { ok: true as const, plan: plan as MergeServerPlan & Record<string, unknown> };

    const expectedRevision = opts.expectedRevision ?? "";
    const idempotencyKey = opts.idempotencyKey ?? "";
    if (!expectedRevision || !idempotencyKey) {
      return { ok: false as const, error: "expected_revision and idempotency_key are required when apply is true", status: 400 };
    }
    if (plan.revision !== expectedRevision) {
      return { ok: false as const, error: `Stale channel merge revision: expected ${expectedRevision}, current ${plan.revision}.`, status: 409 };
    }
    const existing = await tx.get<StoredServerMergeReceipt>(
      `SELECT * FROM ${CHANNEL_MERGE_RECEIPTS_TABLE} WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    if (existing) {
      if (existing.request_hash !== requestHash) {
        return { ok: false as const, error: "Idempotency key was already used with a different request.", status: 409 };
      }
      return { ok: true as const, plan: { ...(JSON.parse(existing.payload) as Record<string, unknown>), replayed: true } };
    }

    await tx.get(
      "SELECT set_config('hasna.conversations.channel_scope_rewrite', $1, TRUE) AS configured",
      [JSON.stringify({
        old_session_id: `channel:${source}`,
        new_session_id: `channel:${destination}`,
        old_channel: source,
        new_channel: destination,
        old_to_agent: source,
        new_to_agent: destination,
      })],
    );
    await tx.query(
      `UPDATE messages
       SET channel = $1,
           session_id = CASE WHEN session_id = $2 THEN $1 ELSE session_id END,
           to_agent = CASE WHEN to_agent = $3 THEN $1 ELSE to_agent END
       WHERE channel = $3`,
      [destination, `channel:${source}`, source],
    );
    await tx.query(
      `UPDATE messages SET session_id = $1 WHERE session_id = $2 AND (channel IS NULL OR channel <> $3)`,
      [`channel:${destination}`, `channel:${source}`, destination],
    );
    await tx.query(`UPDATE channel_members SET channel = $1 WHERE channel = $2`, [destination, source]);
    await tx.query(`UPDATE channel_subscriptions SET channel = $1 WHERE channel = $2`, [destination, source]);
    await tx.query(`UPDATE message_mentions SET channel = $1 WHERE channel = $2`, [destination, source]);
    await tx.query(`UPDATE tasks SET channel = $1 WHERE channel = $2`, [destination, source]);
    // Graph edges: a duplicate destination edge inherits the source edge's
    // weight/metadata and is removed, then remaining source edges move to the
    // destination (exact renameChannelServer dedupe pattern).
    await tx.query(
      `UPDATE graph_edges AS target
       SET weight = source.weight, metadata = source.metadata, updated_at = source.updated_at
       FROM graph_edges AS source
       WHERE source.from_type = 'channel' AND source.from_id = $2
         AND target.from_type = source.from_type AND target.from_id = $1
         AND target.to_type = source.to_type AND target.to_id = source.to_id
         AND target.relation = source.relation`,
      [destination, source],
    );
    await tx.query(
      `DELETE FROM graph_edges AS source
       USING graph_edges AS target
       WHERE source.from_type = 'channel' AND source.from_id = $2
         AND target.from_type = source.from_type AND target.from_id = $1
         AND target.to_type = source.to_type AND target.to_id = source.to_id
         AND target.relation = source.relation`,
      [destination, source],
    );
    await tx.query(`UPDATE graph_edges SET from_id = $1 WHERE from_type = 'channel' AND from_id = $2`, [destination, source]);
    await tx.query(
      `UPDATE graph_edges AS target
       SET weight = source.weight, metadata = source.metadata, updated_at = source.updated_at
       FROM graph_edges AS source
       WHERE source.to_type = 'channel' AND source.to_id = $2
         AND target.to_type = source.to_type AND target.to_id = $1
         AND target.from_type = source.from_type AND target.from_id = source.from_id
         AND target.relation = source.relation`,
      [destination, source],
    );
    await tx.query(
      `DELETE FROM graph_edges AS source
       USING graph_edges AS target
       WHERE source.to_type = 'channel' AND source.to_id = $2
         AND target.to_type = source.to_type AND target.to_id = $1
         AND target.from_type = source.from_type AND target.from_id = source.from_id
         AND target.relation = source.relation`,
      [destination, source],
    );
    await tx.query(`UPDATE graph_edges SET to_id = $1 WHERE to_type = 'channel' AND to_id = $2`, [destination, source]);

    if (opts.archiveSource) {
      await tx.query(`UPDATE channels SET archived_at = NOW()::text WHERE name = $1`, [source]);
      await tx.query(`DELETE FROM channel_rename_aliases WHERE old_channel = $1`, [destination]);
      await tx.query(
        "UPDATE channel_rename_aliases SET current_channel = $1, renamed_at = NOW() WHERE current_channel = $2",
        [destination, source],
      );
      await tx.query(
        `INSERT INTO channel_rename_aliases (old_channel, current_channel) VALUES ($1,$2)
         ON CONFLICT (old_channel) DO UPDATE SET current_channel = EXCLUDED.current_channel, renamed_at = NOW()`,
        [source, destination],
      );
      await tx.query(`DELETE FROM channel_rename_aliases WHERE old_channel = current_channel`);
    }

    const postMessages = await readMergeServerMessages(tx, destination);
    const movedIds = new Set(plan.message_ids);
    const movedPresent = postMessages.filter((row) => movedIds.has(Number(row.id)));
    if (movedPresent.length !== plan.message_ids.length) {
      throw new Error(
        `Channel merge verification failed: ${plan.message_ids.length - movedPresent.length} moved message(s) missing after commit.`,
      );
    }
    const postMembers = (await tx.many<{ agent: string }>(
      "SELECT agent FROM channel_members WHERE channel = $1 ORDER BY agent", [destination],
    )).map((row) => row.agent);
    const postSubscriptions = (await tx.many<{ agent: string }>(
      "SELECT agent FROM channel_subscriptions WHERE channel = $1 ORDER BY agent", [destination],
    )).map((row) => row.agent);

    const createdAt = new Date().toISOString();
    const receipt: MergeServerPlan & Record<string, unknown> = {
      ...plan,
      dry_run: false,
      receipt_id: randomUUID(),
      idempotency_key: idempotencyKey,
      request_hash: requestHash,
      pre_revision: plan.revision,
      post_revision: mergeServerPostRevision(
        source, destination, sourceRow.project_id, destinationRow.project_id,
        postMessages, postMembers, postSubscriptions,
      ),
      created_at: createdAt,
      replayed: false,
    };
    await tx.query(
      `INSERT INTO ${CHANNEL_MERGE_RECEIPTS_TABLE} (
         id, idempotency_key, operation, source_channel, destination_channel,
         source_receipt_id, request_hash, payload, created_at
       ) VALUES ($1,$2,'apply',$3,$4,NULL,$5,$6,NOW())`,
      [receipt.receipt_id, idempotencyKey, source, destination, requestHash, JSON.stringify(receipt)],
    );
    return { ok: true as const, plan: receipt };
  });
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

/** Task transition detail for the Conversations→Events outbox envelope. */
function transitionDetailFor(
  action: string,
  current: { status: string; priority: string } | null | undefined,
  body: Record<string, unknown>,
  requestedPriority: string | undefined,
): string | null {
  switch (action) {
    case "complete": return str(body.evidence) ?? null;
    case "cancel": return str(body.reason) ?? null;
    case "block": return str(body.reason) ?? null;
    case "assign": return str(body.assignee) ?? null;
    case "priority": return `${current?.priority ?? ""} -> ${requestedPriority ?? ""}`;
    default: return null;
  }
}

/**
 * Maps the hosted HTTP action names to the shared past-tense action vocabulary
 * pinned by events-bridge.test.ts. The local emission path uses past-tense
 * actions ("started","completed",...); the hosted path must emit the SAME
 * vocabulary so the same transition yields the same data.action on both paths.
 */
const TASK_ACTION_TO_PAST_TENSE: Record<string, string> = {
  start: "started",
  complete: "completed",
  cancel: "cancelled",
  block: "blocked",
  unblock: "unblocked",
  reopen: "reopened",
  assign: "assigned",
  priority: "priority_changed",
};

interface TaskOutboxTask {
  id: number;
  uuid: string;
  subject: string;
  status: string;
  priority: string;
  assignee: string | null;
  project_id: string | null;
}

/**
 * Emits exactly one Conversations→Events outbox row inside the caller's PG
 * transaction for a task transition (mirrors the local `emitTaskEvent` path).
 * `action` must already be in the shared past-tense vocabulary. Idempotent by
 * stable event id.
 */
async function emitTaskOutboxRow(
  tx: TypedQueryClient,
  task: TaskOutboxTask,
  action: string,
  oldStatus: string,
  agent: string,
  detail: string | null,
  transitionUuid = randomUUID(),
): Promise<void> {
  const envelope = buildConversationEventEnvelope({
    id: `conversations:task:${task.uuid}:activity:${transitionUuid}`,
    type: TASK_UPDATED_TYPE,
    time: new Date().toISOString(),
    subject: task.subject,
    data: {
      task_id: task.id,
      task_uuid: task.uuid,
      subject: task.subject,
      action,
      old_status: oldStatus,
      new_status: task.status,
      agent,
      detail,
      priority: task.priority,
      assignee: task.assignee,
      project_id: task.project_id,
      transition_uuid: transitionUuid,
    },
    appEvent: { kind: "task.updated", action },
  });
  await tx.query(
    `INSERT INTO conversations_event_outbox (id, source, type, envelope_json, created_at, status, attempts)
     VALUES ($1,$2,$3,$4,$5,'pending',0)
     ON CONFLICT (id) DO NOTHING`,
    [envelope.id, CONVERSATIONS_SOURCE, envelope.type, JSON.stringify(envelope), envelope.time],
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
      // A committed dependent mutation must carry durable event intent (the
      // same outbox row the local path emits for `auto_unblocked`). This runs
      // inside the caller's transaction.
      const task = await client.get<TaskOutboxTask>(
        `SELECT id, uuid, subject, status, priority, assignee, project_id FROM tasks WHERE id = $1`,
        [dep.task_id],
      );
      if (task) {
        await emitTaskOutboxRow(client, task, "auto_unblocked", "blocked", "system", `dependency #${completedId} completed`);
      }
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
  const lastSeenAt = row.last_seen_at as string | null | undefined;
  const lastSeenMs = lastSeenAt ? new Date(lastSeenAt).getTime() : Number.NaN;
  const ageMs = Number.isFinite(lastSeenMs) ? Date.now() - lastSeenMs : Number.POSITIVE_INFINITY;
  const storedStatus = (row.status as string) || "online";
  return {
    id: (row.id as string) || "",
    agent: row.agent,
    session_id: (row.session_id as string | null) ?? null,
    role: (row.role as string) || "agent",
    project_id: projectId,
    status: decayedStatus(storedStatus, ageMs),
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
          return json({ status: "ok", version: pkgVersion, app: APP });
        }

        if (path === "/version" && method === "GET") {
          return json({
            status: "ok",
            version: pkgVersion,
            app: APP,
            build_sha: BAKED_BUILD_SHA,
          });
        }

        if (path === "/v1/openapi.json" && method === "GET") {
          return json(openapiSpec);
        }

        if (path === "/ready" && method === "GET") {
          try {
            await client.get<{ ok: number }>("SELECT 1 AS ok");
            return json({ status: "ok", version: pkgVersion, app: APP });
          } catch (e) {
            return json({ status: "unavailable", version: pkgVersion, error: (e as Error).message }, 503);
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
        if (isProjectChannelCollectionChangedError(e)) {
          return json({
            error: e.message,
            code: e.code,
            details: e.details,
          }, 409);
        }
        return json({ error: (e as Error).message }, 400);
      }
    },
  });

  const shutdown = () => { server.stop(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(`conversations-serve listening on http://${host}:${port} (version=${pkgVersion})`);
  return server;
}

// ---- /v1 router -------------------------------------------------------------

/**
 * Refuse a second lifecycle event for the same task in the same state inside
 * the dedupe window, on the hosted Postgres path. Mirror of the local
 * sendMessage guard (messages.ts): same SQL filter (channel = work-status,
 * reply_to IS NULL, created_at within the window, newest first), same shared
 * decision logic (duplicateWorkStatusTransitionViolation). Runs inside the
 * send transaction, so the refused duplicate never reaches the stream; the
 * thrown error aborts the transaction and surfaces as a 400 with the reason.
 */
async function assertNoDuplicateWorkStatusTransitionPg(
  tx: TypedQueryClient,
  content: string,
  eventCreatedAtMs?: number,
): Promise<void> {
  const event = parseWorkStatusEvent(firstLineOf(content));
  if (event === null) return; // envelope already validated before the transaction
  // Close the check-then-insert race: two concurrent same-task sends could
  // both observe no duplicate and both INSERT. A transaction-scoped advisory
  // lock keyed on the task id serializes same-task writers, so the second
  // writer's recent-events read runs only after the first transaction commits
  // and observes the inserted event. Cross-task writers never contend; a
  // hashtext collision only over-serializes two unrelated tasks.
  await tx.many("SELECT pg_advisory_xact_lock(hashtext($1))", [event.task_id]);
  // The dedupe window is measured from the event's OWN timestamp: a single
  // send writes now, but a bulk backfill preserves the original created_at,
  // and a historical event must be compared against the events around its own
  // time — not against the present. The window is bounded on BOTH sides
  // [T - window, T]: a row dated after the event (clock skew, a
  // future-dated backfill row) must not decide whether this event is a
  // duplicate, and a future same-state row must not mask the real most-recent
  // prior event.
  const eventAtMs = eventCreatedAtMs ?? Date.now();
  const cutoff = new Date(eventAtMs - WORK_STATUS_DUPLICATE_WINDOW_MS).toISOString();
  const eventAt = new Date(eventAtMs).toISOString();
  const rows = await tx.many<{ content: string }>(
    `SELECT content FROM messages
     WHERE channel = $1 AND reply_to IS NULL AND created_at >= $2 AND created_at <= $3
     ORDER BY id DESC`,
    [WORK_STATUS_CHANNEL, cutoff, eventAt],
  );
  const violation = duplicateWorkStatusTransitionViolation(
    rows.map((row) => row.content),
    event,
  );
  if (violation !== null) throw new Error(violation);
}

/**
 * Attach grouped emoji reactions to a set of messages/previews with ONE
 * grouped `message_id = ANY($1::bigint[])` query (the envelope pattern used by
 * read/digest/show). Additive: messages without reactions keep the field
 * absent, so serialization is byte-identical to pre-reaction reads.
 */
async function attachReactionSummariesPg(
  client: TypedQueryClient,
  messages: Array<{ id: number; reactions?: unknown }>,
): Promise<void> {
  if (messages.length === 0) return;
  const ids = messages.map((m) => Number(m.id));
  const rows = await client.many<{ message_id: string | number; emoji: string; agents: string; count: string | number }>(
    `SELECT message_id, emoji, string_agg(agent, ',') AS agents, COUNT(*)::int AS count
     FROM reactions
     WHERE message_id = ANY($1::bigint[])
     GROUP BY message_id, emoji
     ORDER BY message_id, count DESC, MIN(created_at) ASC`,
    [ids],
  );
  const byId = new Map<number, Array<{ emoji: string; count: number; agents: string[] }>>();
  for (const row of rows) {
    const key = Number(row.message_id);
    const list = byId.get(key) ?? [];
    // Redact the emoji here so reactions attached to ANY response (show,
    // read/digest/since collection) are already redacted before the reader sees
    // them — defense in depth for a stored emoji that bypassed the write gate.
    list.push({ emoji: redactSensitiveText(String(row.emoji)), count: Number(row.count), agents: String(row.agents).split(",") });
    byId.set(key, list);
  }
  for (const message of messages) {
    const list = byId.get(Number(message.id));
    if (list) message.reactions = list;
  }
}

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

  // ---- package-owned project channel registration authority ----------------
  if (sub === "project-registration/channels/capability" && method === "GET") {
    return json(await projectChannelRegistrationPgCapability(client));
  }

  if (sub === "project-registration/channels" && method === "GET") {
    const request = {
      project_id: str(url.searchParams.get("project_id")),
      cursor: str(url.searchParams.get("cursor")),
      collection_revision: str(url.searchParams.get("collection_revision")),
      max_items: positiveInteger(url.searchParams.get("max_items")),
      response_byte_limit: positiveInteger(url.searchParams.get("response_byte_limit")),
      time_budget_ms: positiveInteger(url.searchParams.get("time_budget_ms")),
      call_limit: positiveInteger(url.searchParams.get("call_limit")),
    } as unknown as ProjectChannelCollectionRequest;
    return json(await listProjectChannelRegistrationPagePg(client, request));
  }

  if (sub === "project-registration/channels" && method === "POST") {
    const request = projectChannelRegistrationRequest(await readJson(req));
    assertProjectChannelRegistrationOperationIntent(request, "create");
    const receipt = await registerProjectChannelPg(
      client,
      request,
    );
    return json(receipt, receipt.outcome === "accepted" ? 201 : 200);
  }

  if (sub === "project-registration/channels/bind-existing" && method === "POST") {
    const request = projectChannelRegistrationRequest(await readJson(req));
    assertProjectChannelRegistrationOperationIntent(request, "bind_existing");
    const receipt = await registerProjectChannelPg(
      client,
      request,
    );
    return json(receipt, receipt.outcome === "accepted" ? 201 : 200);
  }

  if (sub === "project-registration/channels/adopt-existing" && method === "POST") {
    const request = projectChannelRegistrationRequest(await readJson(req));
    assertProjectChannelRegistrationOperationIntent(request, "adopt_existing");
    const receipt = await registerProjectChannelPg(
      client,
      request,
    );
    return json(receipt, receipt.outcome === "accepted" ? 201 : 200);
  }

  if (sub === "project-registration/channels/receipts/terminal" && method === "GET") {
    const maxItems = positiveInteger(url.searchParams.get("max_items"));
    const responseByteLimit = positiveInteger(url.searchParams.get("response_byte_limit"));
    const timeBudgetMs = positiveInteger(url.searchParams.get("time_budget_ms"));
    const callLimit = positiveInteger(url.searchParams.get("call_limit"));
    const request = {
      operation_id: str(url.searchParams.get("operation_id")),
      step_id: str(url.searchParams.get("step_id")),
      resource_kind: str(url.searchParams.get("resource_kind")),
      direction: str(url.searchParams.get("direction")),
      authority: str(url.searchParams.get("authority")),
      authority_route: str(url.searchParams.get("authority_route")),
      package_version: str(url.searchParams.get("package_version")),
      authority_id: str(url.searchParams.get("authority_id")),
      tenant_id: str(url.searchParams.get("tenant_id")),
      corpus_id: str(url.searchParams.get("corpus_id")),
      target_selector: str(url.searchParams.get("target_selector")),
      idempotency_key: str(url.searchParams.get("idempotency_key")),
      request_digest: str(url.searchParams.get("request_digest")),
      precondition_digest: str(url.searchParams.get("precondition_digest")),
      precondition_kind: str(url.searchParams.get("precondition_kind")),
      target_id: str(url.searchParams.get("target_id")),
      max_items: maxItems,
      response_byte_limit: responseByteLimit,
      time_budget_ms: timeBudgetMs,
      call_limit: callLimit,
    } as unknown as ProjectChannelRegistrationLookupRequest;
    return json(await lookupProjectChannelRegistrationReceiptPg(client, request));
  }

  const projectRegistrationReadMatch = sub.match(/^project-registration\/channels\/(chn_[0-9a-f]{32})$/);
  if (projectRegistrationReadMatch && method === "GET") {
    const targetDigest = str(url.searchParams.get("target_digest"));
    if (!targetDigest) return json({ error: "target_digest is required" }, 400);
    const request = {
      resource_kind: str(url.searchParams.get("resource_kind")),
      target_id: projectRegistrationReadMatch[1],
      target_selector: str(url.searchParams.get("target_selector")),
      target: remoteProjectRegistrationTarget(targetDigest),
      response_byte_limit: positiveInteger(url.searchParams.get("response_byte_limit")),
      time_budget_ms: positiveInteger(url.searchParams.get("time_budget_ms")),
      call_limit: positiveInteger(url.searchParams.get("call_limit")),
    } as unknown as ProjectChannelRegistrationReadRequest;
    return json(await readProjectChannelRegistrationExactPg(client, request));
  }

  const projectRegistrationMessagesMatch = sub.match(
    /^project-registration\/channels\/(chn_[0-9a-f]{32})\/messages$/,
  );
  if (projectRegistrationMessagesMatch && method === "GET") {
    const request = {
      project_id: str(url.searchParams.get("project_id")),
      target_id: projectRegistrationMessagesMatch[1],
      cursor: nonNegativeInteger(url.searchParams.get("cursor")),
      max_items: positiveInteger(url.searchParams.get("max_items")),
      response_byte_limit: positiveInteger(url.searchParams.get("response_byte_limit")),
      time_budget_ms: positiveInteger(url.searchParams.get("time_budget_ms")),
      call_limit: positiveInteger(url.searchParams.get("call_limit")),
    } as unknown as ProjectChannelMessageCollectionRequest;
    return json(await listProjectChannelMessagePagePg(client, request));
  }

  if (sub === "project-registration/channels/inverse" && method === "POST") {
    const receipt = await compensateProjectChannelRegistrationPg(
      client,
      projectChannelRegistrationRequest(await readJson(req)),
    );
    return json(receipt, receipt.outcome === "accepted" ? 201 : 200);
  }

  if (sub === "project-registration/channels/inverse/verify" && method === "POST") {
    return json(await verifyProjectChannelRegistrationInversePg(
      client,
      projectChannelRegistrationRequest(await readJson(req)),
    ));
  }

  // ---- canonical Todos incident projections ----
  if (sub === "incident-projections" && method === "POST") {
    if (!deps.incidentProjector) return json({ error: "Incident projector authority is not configured" }, 503);
    try {
      const projection = await appendIncidentProjectionPg(
        client,
        await readJson(req) as unknown as IncidentProjectionRequestV1,
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
      throw error;
    }
  }

  const projectionMatch = sub.match(/^incident-projections\/(iev_[0-9a-f]{32})$/);
  if (projectionMatch && method === "GET") {
    if (!deps.incidentProjector) return json({ error: "Incident projector authority is not configured" }, 503);
    const projection = await getIncidentProjectionPg(client, projectionMatch[1], deps.incidentProjector);
    return projection ? json({ projection }) : json({ error: "Incident projection not found" }, 404);
  }

  if (sub === "messages/blockers" && method === "GET") {
    if (!agent) return json({ error: "authenticated agent is required" }, 401);
    // The API key is the fleet-level authorization principal; the declared
    // byline is the identity that scopes the read (task 1871c67f). An
    // explicit `agent` query scopes to that agent; an omitted one falls back
    // to the key claim.
    const scopeAgent = str(url.searchParams.get("agent")) ?? agent;
    const collection = collectionReadOptions(url);
    const context = deps.incidentProjector ?? null;
    if (!context) {
      const canonicalCount = await client.get<{ n: string | number }>(
        "SELECT COUNT(*)::bigint AS n FROM incident_projections",
      );
      if (Number(canonicalCount?.n ?? 0) > 0) {
        return json({ error: "Canonical blocker reads require configured incident authority" }, 503);
      }
    }
    const rows = await boundedCollectionQuery(client, collection.timeoutMs, (tx) => tx.many<Record<string, unknown>>(
      `WITH latest AS (
         SELECT p.* FROM incident_projections p
         JOIN (
           SELECT tenant_id, authority_id, incident_id, MAX(incident_version) AS incident_version
           FROM incident_projections
           WHERE $1::text IS NOT NULL AND $2::text IS NOT NULL
             AND tenant_id = $1 AND authority_id = $2
           GROUP BY tenant_id, authority_id, incident_id
         ) current USING (tenant_id, authority_id, incident_id, incident_version)
       ), canonical_ids AS (
         SELECT DISTINCT m.id
         FROM latest p
         JOIN messages m ON m.id = p.message_id
         JOIN incident_projection_scopes scope ON scope.projection_id = p.id AND scope.scope_type = 'blocked'
         WHERE p.status IN ('open','investigating','contained','monitoring') AND p.blocking = TRUE
           AND NOT EXISTS (
             SELECT 1 FROM message_read_receipts receipt
             WHERE receipt.message_id = m.id AND lower(receipt.agent) = lower($3)
           )
           AND (
             lower(scope.scope) = 'agent:' || lower($3)
             OR lower(scope.scope) IN (
               SELECT 'channel:' || lower(channel) FROM channel_members WHERE lower(agent) = lower($3)
             )
             OR scope.scope IN (
               SELECT 'project:' || project_id FROM agent_presence
               WHERE lower(agent) = lower($3) AND project_id <> ''
             )
           )
       ), legacy_ids AS (
         SELECT m.id FROM messages m
         LEFT JOIN incident_projections p ON p.message_id = m.id
         WHERE p.id IS NULL AND m.blocking = TRUE AND m.read_at IS NULL
           AND (lower(m.to_agent) = lower($3) OR m.channel IN (
             SELECT channel FROM channel_members WHERE lower(agent) = lower($3)
           ))
       ), eligible AS (
         SELECT id FROM canonical_ids UNION SELECT id FROM legacy_ids
       )
       SELECT ${messagePreviewProjectionPg("m")}
       FROM messages m JOIN eligible ON eligible.id = m.id
       ORDER BY m.created_at ASC, m.id ASC LIMIT $4 OFFSET $5`,
      [context?.tenant_id ?? null, context?.authority_id ?? null, scopeAgent, collection.limit + 1, collection.offset],
    ));
    return json(packMessagePreviewPage(rows.map((row) => buildCollectionMessagePreview(row, collection.previewBytes)), {
      limit: collection.limit,
      cursor: collection.offset,
      max_bytes: collection.maxBytes,
      timeout_ms: collection.timeoutMs,
    }));
  }

  // ---- messages ----
  if (sub === "messages" && method === "GET") {
    const strictPositiveInteger = (value: string | undefined, name: string): number | undefined => {
      if (value === undefined) return undefined;
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error(`${name} must be a positive integer`);
      }
      return parsed;
    };
    // since_id is a cursor seeded at 0 by clients (poll.ts lastSeenId=0) and its
    // OpenAPI contract is minimum: 0 — `id > 0` is exactly no filter since ids
    // start at 1. It is the only id-shaped query param that admits 0.
    const nonNegativeInteger = (value: string | undefined, name: string): number | undefined => {
      if (value === undefined) return undefined;
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new Error(`${name} must be a non-negative integer`);
      }
      return parsed;
    };

    let to: string | undefined;
    let from: string | undefined;
    let channel: string | undefined;
    let session: string | undefined;
    let projectId: string | undefined;
    let since: string | undefined;
    let until: string | undefined;
    let sinceId: number | undefined;
    let id: number | undefined;
    let replyTo: number | undefined;
    let q: string | undefined;
    let uuid: string | undefined;
    let mentionsOnly: string | undefined;
    let orderParam: string | undefined;
    try {
      to = strictQueryString(url.searchParams, "to");
      from = strictQueryString(url.searchParams, "from");
      channel = strictQueryString(url.searchParams, "channel");
      session = strictAliasedQueryString(url.searchParams, "session", "session_id");
      projectId = strictQueryString(url.searchParams, "project_id");
      since = strictIsoDateQuery(url.searchParams, "since");
      until = strictIsoDateQuery(url.searchParams, "until");
      sinceId = nonNegativeInteger(strictQueryString(url.searchParams, "since_id"), "since_id");
      id = strictPositiveInteger(strictQueryString(url.searchParams, "id"), "id");
      replyTo = strictPositiveInteger(strictQueryString(url.searchParams, "reply_to"), "reply_to");
      q = strictQueryString(url.searchParams, "q");
      uuid = strictQueryString(url.searchParams, "uuid");
      mentionsOnly = strictQueryString(url.searchParams, "mentions_only");
      orderParam = strictQueryString(url.searchParams, "order");
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }

    if (channel) {
      channel = normalizeChannelName(channel);
      const currentChannel = await readReservedHistoricalChannelAlias(client, channel);
      if (currentChannel) {
        return json({ error: reservedHistoricalChannelMessage(channel, currentChannel) }, 409);
      }
    }
    const unreadOnly = isTrue(url.searchParams.get("unread_only"));
    const threadsOnly = isTrue(url.searchParams.get("threads_only"));
    const pinnedOnly = isTrue(url.searchParams.get("pinned_only"));
    const includeReplyCounts = isTrue(url.searchParams.get("include_reply_counts"));
    const idCursor = sinceId !== undefined;
    // A since filter makes this a TIME-window walk: the authoritative sequence is
    // the timestamp, so a since + since_id read pages by created_at ASC, id ASC
    // and resumes at the (created_at, id) tuple position of the cursor message —
    // never at a bare id. When ids are not chronological with timestamps
    // (backfill/import: a higher id can carry an earlier created_at), a bare
    // `id > cursor` walk hands back a newer timestamp first, a timestamp-watermark
    // caller advances its `since` past the gap, and the walk reports has_more:false
    // while newer-timestamp messages remain unreached. Non-cursor and pure id-cursor
    // reads retain their existing ordering.
    const order = idCursor
      ? "ASC"
      : (orderParam?.toLowerCase() === "asc" ? "ASC" : "DESC");
    const bothSinceAndCursor = idCursor && since !== undefined && !q;
    const collection = collectionReadOptions(url);
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (id !== undefined) {
      params.push(id); clauses.push(`id = $${params.length}`);
    }
    if (to) { params.push(to); clauses.push(`to_agent = $${params.length}`); }
    if (from) { params.push(from); clauses.push(`from_agent = $${params.length}`); }
    if (channel) { params.push(channel); clauses.push(`channel = $${params.length}`); }
    if (session) { params.push(session); clauses.push(`session_id = $${params.length}`); }
    if (projectId) { params.push(projectId); clauses.push(`project_id = $${params.length}`); }
    if (uuid) { params.push(uuid); clauses.push(`uuid = $${params.length}`); }
    if (since) {
      let normalizedSince = since;
      if (q) {
        try {
          normalizedSince = normalizeExactIsoTimestamp(since, "search since timestamp");
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : String(error) }, 400);
        }
      }
      params.push(normalizedSince);
      clauses.push(`created_at ${q ? ">=" : ">"} $${params.length}`);
    }
    if (until) { params.push(until); clauses.push(`created_at <= $${params.length}`); }
    if (idCursor) {
      if (bothSinceAndCursor) {
        // Resume at the (created_at, id) tuple position of the cursor message.
        // When the cursor message is gone, drop the id condition and re-read from
        // `since` — duplicates are detectable, loss is not.
        const cursorRow = await client.get<{ created_at: string }>(
          `SELECT created_at FROM messages WHERE id = $1`,
          [sinceId],
        );
        if (cursorRow) {
          params.push(cursorRow.created_at);
          clauses.push(`(created_at > $${params.length} OR (created_at = $${params.length} AND id > $${params.length + 1}))`);
          params.push(sinceId);
        }
      } else {
        params.push(sinceId);
        clauses.push(`id > $${params.length}`);
      }
    }
    if (q) { params.push(`%${q}%`); clauses.push(`content ILIKE $${params.length}`); }
    if (mentionsOnly) {
      params.push(mentionsOnly.toLowerCase());
      clauses.push(`id IN (SELECT message_id FROM message_mentions WHERE mentioned_agent = $${params.length})`);
    }
    if (unreadOnly) clauses.push(`read_at IS NULL`);
    if (threadsOnly) clauses.push(`reply_to IS NULL`);
    if (replyTo !== undefined) {
      params.push(replyTo); clauses.push(`reply_to = $${params.length}`);
    }
    if (pinnedOnly) clauses.push(`pinned_at IS NOT NULL`);
    if (isTrue(url.searchParams.get("blocking_only"))) clauses.push(`blocking = true`);
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
    params.push(collection.limit + 1);
    const limitIdx = params.length;
    params.push(collection.offset);
    const offsetIdx = params.length;
    const orderBy = bothSinceAndCursor ? "created_at ASC, id ASC" : (idCursor ? "id ASC" : `created_at ${order}, id ${order}`);
    const fetched = await boundedCollectionQuery(client, collection.timeoutMs, (tx) => tx.many<Record<string, unknown>>(
      `SELECT ${messagePreviewProjectionPg()}${replyCountSelect}
       FROM messages ${where} ORDER BY ${orderBy} LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    ));
    const previews = fetched.map((row) => buildCollectionMessagePreview(row, collection.previewBytes));
    const page = packMessagePreviewPage(previews, {
      limit: collection.limit,
      cursor: collection.offset,
      max_bytes: collection.maxBytes,
      timeout_ms: collection.timeoutMs,
      query: q,
    });
    await attachReactionSummariesPg(client, page.messages);
    return json(page);
  }

  // ---- mark messages read (per-agent receipts + global read_at) ----
  // Mirrors the local markReadByIds/markAllRead/markChannelRead/markSessionRead
  // semantics so read state routes to the cloud identically.
  if (sub === "messages/read" && method === "POST") {
    const body = await readJson(req);
    if (!agent) return json({ error: "authenticated agent is required" }, 401);
    // The API key is the fleet-level authorization principal; the declared
    // reader is the identity that receipts are stamped under (task
    // 1871c67f). An omitted reader falls back to the key claim.
    const reader = str(body.reader) ?? str(body.agent) ?? agent;
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
      const mentionIds = Array.isArray(body.mention_ids)
        ? (body.mention_ids as unknown[]).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0)
        : [];
      const res = mentionIds.length
        ? await client.query(
            `UPDATE message_mentions SET notified_at = NOW()::text
             WHERE mentioned_agent = $1 AND id = ANY($2::bigint[]) AND notified_at IS NULL`,
            [reader, mentionIds],
          )
        : channel
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
      const projectedRows = await client.many<{ message_id: string | number }>(
        "SELECT message_id FROM incident_projections WHERE message_id = ANY($1::bigint[])",
        [ids],
      );
      const projected = new Set(projectedRows.map((row) => Number(row.message_id)));
      const visible = new Set(await visibleIncidentProjectionIds(client, deps.incidentProjector, reader, { ids }));
      if ([...projected].some((id) => !visible.has(id))) {
        return json({ error: "one or more incident blockers are not visible to the authenticated agent" }, 403);
      }
      await insertReadReceipts(client, ids, reader);
      const ordinaryIds = ids.filter((id) => !projected.has(id));
      const res = await client.query(
        `UPDATE messages SET read_at = NOW()::text WHERE id = ANY($1::bigint[]) AND read_at IS NULL`,
        [ordinaryIds],
      );
      marked = projected.size + res.rowCount;
    } else if (all) {
      const projected = await visibleIncidentProjectionIds(client, deps.incidentProjector, reader);
      const receipts = await insertReadReceipts(client, projected, reader);
      const res = await client.query(
        `UPDATE messages SET read_at = NOW()::text WHERE to_agent = $1 AND read_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM incident_projections p WHERE p.message_id = messages.id)`,
        [reader],
      );
      marked = receipts + res.rowCount;
    } else if (channel) {
      const normalized = normalizeChannelName(channel);
      const projected = await visibleIncidentProjectionIds(client, deps.incidentProjector, reader, { channel: normalized });
      const receipts = await insertReadReceipts(client, projected, reader);
      const res = await client.query(
        `UPDATE messages SET read_at = NOW()::text WHERE channel = $1 AND from_agent <> $2 AND read_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM incident_projections p WHERE p.message_id = messages.id)`,
        [normalized, reader],
      );
      marked = receipts + res.rowCount;
    } else if (session) {
      const projected = await visibleIncidentProjectionIds(client, deps.incidentProjector, reader, { session });
      const receipts = await insertReadReceipts(client, projected, reader);
      const res = await client.query(
        `UPDATE messages SET read_at = NOW()::text WHERE session_id = $1 AND to_agent = $2 AND read_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM incident_projections p WHERE p.message_id = messages.id)`,
        [session, reader],
      );
      marked = receipts + res.rowCount;
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
    let channel: string | undefined;
    let session: string | undefined;
    try {
      channel = strictQueryString(url.searchParams, "channel");
      session = strictAliasedQueryString(url.searchParams, "session", "session_id");
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
    if (channel) {
      channel = normalizeChannelName(channel);
      const currentChannel = await readReservedHistoricalChannelAlias(client, channel);
      if (currentChannel) {
        return json({ error: reservedHistoricalChannelMessage(channel, currentChannel) }, 409);
      }
    }
    const collection = collectionReadOptions(url);
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
       FROM messages WHERE ${clauses.join(" AND ")} ${pinnedOrderByClause()} LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
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
    return new Response(new Uint8Array(loaded.payload).buffer, {
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

  // ---- bounded preview-only export artifacts ----
  if ((sub === "messages/exports" && method === "POST") || (sub === "messages/export" && method === "GET")) {
    if (!agent) return json({ error: "authenticated agent is required" }, 401);
    const body = method === "POST" ? await readJson(req) : {};
    const value = (name: string): unknown => method === "POST" ? body[name] : url.searchParams.get(name) ?? undefined;
    const optionalString = (name: string): string | undefined => resolvePresentString(value(name), name);
    const optionalNumber = (name: string): number | undefined => {
      const raw = value(name);
      if (raw === undefined || raw === null) return undefined;
      const parsed = Number(raw);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
      return parsed;
    };
    const requestedDetail = optionalString("detail");
    if (requestedDetail !== undefined && requestedDetail !== "preview") {
      return json({ error: "detail must be preview; full-body collection exports are not supported" }, 400);
    }
    const opts: ExportMessagesOptions = {
      channel: optionalString("channel"),
      session_id: optionalString("session_id") ?? optionalString("session"),
      from: optionalString("from"),
      since: optionalString("since"),
      until: optionalString("until"),
      format: optionalString("format") as ExportMessagesOptions["format"],
      limit: optionalNumber("limit"),
      max_bytes: optionalNumber("max_bytes"),
      preview_bytes: optionalNumber("preview_bytes"),
      timeout_ms: optionalNumber("timeout_ms"),
    };
    const resolved = resolveMessageExportOptions(opts);
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (opts.channel) { params.push(normalizeChannelName(opts.channel)); clauses.push(`channel = $${params.length}`); }
    if (opts.session_id) { params.push(opts.session_id); clauses.push(`session_id = $${params.length}`); }
    if (opts.from) { params.push(opts.from); clauses.push(`from_agent = $${params.length}`); }
    if (opts.since) { params.push(resolveIso8601Date(opts.since, "since")); clauses.push(`created_at >= $${params.length}`); }
    if (opts.until) { params.push(resolveIso8601Date(opts.until, "until")); clauses.push(`created_at <= $${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    params.push(resolved.limit + 1);
    const rows = await boundedCollectionQuery(client, resolved.timeoutMs, (tx) => tx.many<Record<string, unknown>>(
      `SELECT ${messagePreviewProjectionPg()}
       FROM messages ${where} ORDER BY created_at ASC, id ASC LIMIT $${params.length}`,
      params,
    ));
    const records = rows.slice(0, resolved.limit)
      .map((row) => buildCollectionMessagePreview(row, resolved.previewBytes) as unknown as Record<string, unknown>);
    const serialized = serializeMessageExport(records, {
      format: resolved.format,
      detail: "preview",
      maxBytes: resolved.maxBytes,
      hasMore: rows.length > resolved.limit,
    });
    return json({ artifact: writeMessageExportArtifact(serialized, resolved, agent, "remote") }, 201);
  }

  // ---- messages that @mention an agent ----
  if (sub === "messages/for-agent" && method === "GET") {
    let who: string | undefined;
    let channel: string | undefined;
    try {
      who = strictQueryString(url.searchParams, "agent");
      channel = strictQueryString(url.searchParams, "channel");
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
    if (!who) return json({ error: "agent is required" }, 400);
    if (channel) {
      channel = normalizeChannelName(channel);
      const currentChannel = await readReservedHistoricalChannelAlias(client, channel);
      if (currentChannel) {
        return json({ error: reservedHistoricalChannelMessage(channel, currentChannel) }, 409);
      }
    }
    const clauses = ["mm.mentioned_agent = $1"];
    const params: unknown[] = [who.toLowerCase()];
    if (channel) { params.push(normalizeChannelName(channel)); clauses.push(`m.channel = $${params.length}`); }
    if (isTrue(url.searchParams.get("unread_only"))) clauses.push(`mm.notified_at IS NULL`);
    const collection = collectionReadOptions(url);
    params.push(collection.limit + 1);
    const limitIdx = params.length;
    params.push(collection.offset);
    const offsetIdx = params.length;
    const rows = await boundedCollectionQuery(client, collection.timeoutMs, (tx) => tx.many<Record<string, unknown>>(
      `SELECT ${messagePreviewProjectionPg("m")}, mm.id AS mention_id,
              (mm.notified_at IS NULL) AS unread FROM messages m
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

  const projectLinkageMatch = sub.match(/^channels\/([^/]+)\/project-message-linkage$/);
  if (projectLinkageMatch && method === "POST") {
    const channel = normalizeChannelName(decodeURIComponent(projectLinkageMatch[1]));
    const body = await readJson(req);
    if (body.tenant_id !== undefined) {
      return json({ error: "tenant_id is owned by the authenticated storage context and cannot be supplied." }, 400);
    }
    const projectId = str(body.project_id);
    if (!projectId) return json({ error: "project_id is required" }, 400);
    const apply = body.apply === true;

    if (!apply) {
      try {
        const plan = await client.transaction(async (tx) => {
          const target = await readProjectLinkageChannel(tx, channel, projectId, "share");
          return buildProjectMessageLinkagePlan(
            target.channel,
            target.project_id,
            await readProjectLinkageRows(tx, target.channel),
          );
        });
        return json(plan);
      } catch (error) {
        return projectLinkageError(error);
      }
    }

    const expectedRevision = str(body.expected_revision);
    const idempotencyKey = str(body.idempotency_key);
    if (!expectedRevision) return json({ error: "expected_revision is required" }, 400);
    if (!idempotencyKey) return json({ error: "idempotency_key is required" }, 400);
    const requestHash = stableProjectMessageLinkageHash({
      operation: "apply",
      channel,
      project_id: projectId,
      expected_revision: expectedRevision,
    });

    try {
      const early = await readProjectLinkageReceiptByKey(client, idempotencyKey);
      if (early) return json(replayProjectLinkageReceipt<ProjectMessageLinkageReceipt>(early, requestHash));
      const receipt = await client.transaction(async (tx) => {
        const target = await readProjectLinkageChannel(tx, channel, projectId, "update");
        const existing = await readProjectLinkageReceiptByKey(tx, idempotencyKey);
        if (existing) return replayProjectLinkageReceipt<ProjectMessageLinkageReceipt>(existing, requestHash);
        const beforeRows = await readProjectLinkageRows(tx, target.channel, true);
        const plan = buildProjectMessageLinkagePlan(target.channel, target.project_id, beforeRows);
        if (plan.revision !== expectedRevision) {
          throw new Error(`Stale project-message linkage revision: expected ${expectedRevision}, current ${plan.revision}.`);
        }
        const targets = plan.before_project_ids.filter((entry) => entry.project_id === null);
        for (const targetMessage of targets) {
          const updated = await tx.query(
            `UPDATE messages SET project_id = $1
             WHERE id = $2 AND uuid = $3 AND channel = $4 AND project_id IS NULL
             RETURNING id`,
            [target.project_id, targetMessage.id, targetMessage.uuid, target.channel],
          );
          if (updated.rowCount !== 1) {
            throw new Error(`Message ${targetMessage.id}/${targetMessage.uuid} changed during linkage.`);
          }
        }
        const afterRows = await readProjectLinkageRows(tx, target.channel, true);
        if (afterRows.length !== beforeRows.length) throw new Error("Channel membership changed during linkage.");
        assertProjectLinkagePreserved(plan.before_hashes, afterRows);
        if (afterRows.some((row) => row.project_id !== target.project_id)) {
          throw new Error(`Project-message linkage verification failed for channel ${target.channel}.`);
        }
        const afterByKey = new Map(afterRows.map((row) => [`${row.id}:${row.uuid}`, row]));
        const targetRows = targets.map((entry) => afterByKey.get(`${entry.id}:${entry.uuid}`)!).filter(Boolean);
        const createdAt = new Date().toISOString();
        const result: ProjectMessageLinkageReceipt = {
          ...plan,
          dry_run: false,
          receipt_id: randomUUID(),
          idempotency_key: idempotencyKey,
          request_hash: requestHash,
          pre_revision: plan.revision,
          post_revision: projectMessageLinkageRevision(target.channel, target.project_id, afterRows),
          target_revision: projectMessageLinkageTargetRevision(targetRows),
          target_message_ids: targets.map((entry) => entry.id),
          target_message_uuids: targets.map((entry) => entry.uuid),
          created_at: createdAt,
          replayed: false,
        };
        await tx.get(
          `INSERT INTO ${PROJECT_MESSAGE_LINKAGE_RECEIPTS_TABLE} (
             id, idempotency_key, operation, channel, project_id, source_receipt_id,
             request_hash, payload, created_at
           ) VALUES ($1,$2,'apply',$3,$4,NULL,$5,$6,$7)
           RETURNING id`,
          [result.receipt_id, idempotencyKey, target.channel, target.project_id, requestHash, JSON.stringify(result), createdAt],
        );
        return result;
      });
      return json(receipt, receipt.replayed ? 200 : 201);
    } catch (error) {
      return projectLinkageError(error);
    }
  }

  if (sub === "channels/project-message-linkage/rollback" && method === "POST") {
    const body = await readJson(req);
    if (body.tenant_id !== undefined) {
      return json({ error: "tenant_id is owned by the authenticated storage context and cannot be supplied." }, 400);
    }
    const receiptId = str(body.receipt_id);
    const expectedRevision = str(body.expected_revision);
    const idempotencyKey = str(body.idempotency_key);
    const apply = body.apply === true;
    if (!receiptId) return json({ error: "receipt_id is required" }, 400);
    if (!expectedRevision) return json({ error: "expected_revision is required" }, 400);
    if (!idempotencyKey) return json({ error: "idempotency_key is required" }, 400);

    try {
      const storedSource = await readProjectLinkageReceiptById(client, receiptId);
      if (!storedSource || storedSource.operation !== "apply") {
        throw new Error(`Project-message linkage apply receipt not found: ${receiptId}`);
      }
      const source = JSON.parse(storedSource.payload) as ProjectMessageLinkageReceipt;
      const targets = source.before_project_ids.filter((entry) => source.target_message_ids.includes(entry.id));
      const requestHash = stableProjectMessageLinkageHash({
        operation: "rollback",
        source_receipt_id: source.receipt_id,
        expected_revision: expectedRevision,
      });
      const buildResult = (currentRevision: string): ProjectMessageLinkageRollbackResult => ({
        operation: "rollback",
        dry_run: !apply,
        source_receipt_id: source.receipt_id,
        channel: source.channel,
        project_id: source.project_id,
        expected_revision: expectedRevision,
        current_revision: currentRevision,
        target_count: targets.length,
        target_message_ids: source.target_message_ids,
        target_message_uuids: source.target_message_uuids,
        restored_count: 0,
      });

      if (!apply) {
        const currentRows = await readProjectLinkageTargetRows(client, targets);
        const currentRevision = projectMessageLinkageTargetRevision(currentRows);
        if (expectedRevision !== source.target_revision || currentRevision !== expectedRevision) {
          throw new Error(`Stale project-message linkage rollback revision: expected ${expectedRevision}, current ${currentRevision}.`);
        }
        return json(buildResult(currentRevision));
      }

      const early = await readProjectLinkageReceiptByKey(client, idempotencyKey);
      if (early) return json(replayProjectLinkageReceipt<ProjectMessageLinkageRollbackResult>(early, requestHash));
      const result = await client.transaction(async (tx) => {
        await readProjectLinkageChannel(tx, source.channel, source.project_id, "update");
        const existing = await readProjectLinkageReceiptByKey(tx, idempotencyKey);
        if (existing) return replayProjectLinkageReceipt<ProjectMessageLinkageRollbackResult>(existing, requestHash);
        const currentRows = await readProjectLinkageTargetRows(tx, targets, true);
        const currentRevision = projectMessageLinkageTargetRevision(currentRows);
        if (expectedRevision !== source.target_revision || currentRevision !== expectedRevision) {
          throw new Error(`Stale project-message linkage rollback revision: expected ${expectedRevision}, current ${currentRevision}.`);
        }
        for (const target of targets) {
          const updated = await tx.query(
            `UPDATE messages SET project_id = $1
             WHERE id = $2 AND uuid = $3 AND channel = $4 AND project_id = $5
             RETURNING id`,
            [target.project_id, target.id, target.uuid, source.channel, source.project_id],
          );
          if (updated.rowCount !== 1) throw new Error(`Message ${target.id}/${target.uuid} changed during linkage rollback.`);
        }
        const restoredRows = await readProjectLinkageTargetRows(tx, targets, true);
        const beforeByKey = new Map(source.before_hashes.map((entry) => [`${entry.id}:${entry.uuid}`, entry]));
        assertProjectLinkagePreserved(
          targets.map((target) => beforeByKey.get(`${target.id}:${target.uuid}`)!).filter(Boolean),
          restoredRows,
        );
        for (let index = 0; index < targets.length; index++) {
          if ((restoredRows[index].project_id ?? null) !== targets[index].project_id) {
            throw new Error(`Message ${targets[index].id}/${targets[index].uuid} rollback verification failed.`);
          }
        }
        const createdAt = new Date().toISOString();
        const rollback: ProjectMessageLinkageRollbackResult = {
          ...buildResult(currentRevision),
          dry_run: false,
          restored_count: targets.length,
          receipt_id: randomUUID(),
          idempotency_key: idempotencyKey,
          request_hash: requestHash,
          post_revision: projectMessageLinkageTargetRevision(restoredRows),
          created_at: createdAt,
          replayed: false,
        };
        await tx.get(
          `INSERT INTO ${PROJECT_MESSAGE_LINKAGE_RECEIPTS_TABLE} (
             id, idempotency_key, operation, channel, project_id, source_receipt_id,
             request_hash, payload, created_at
           ) VALUES ($1,$2,'rollback',$3,$4,$5,$6,$7,$8)
           RETURNING id`,
          [rollback.receipt_id, idempotencyKey, source.channel, source.project_id, source.receipt_id, requestHash, JSON.stringify(rollback), createdAt],
        );
        return rollback;
      });
      return json(result, result.replayed ? 200 : 201);
    } catch (error) {
      return projectLinkageError(error);
    }
  }

  if (sub === "messages" && method === "POST") {
    const body = await readJson(req);
    if (body.tenant_id !== undefined) {
      return json({ error: "tenant_id is owned by the authenticated storage context and cannot be supplied." }, 400);
    }
    const from = str(body.from) ?? agent ?? undefined;
    const content = str(body.content);
    const requestedChannel = body.channel ? normalizeChannelName(String(body.channel)) : null;
    if (requestedChannel) {
      const currentChannel = await readReservedHistoricalChannelAlias(client, requestedChannel);
      if (currentChannel) {
        return json({ error: reservedHistoricalChannelMessage(requestedChannel, currentChannel) }, 409);
      }
    }
    const requestedSession = str(body.session_id);
    const workingDir = str(body.working_dir);
    const repository = str(body.repository);
    const branch = str(body.branch);
    const metadataObject = jsonObject(body.metadata);
    if ("metadata" in body && body.metadata != null && !metadataObject) {
      return fieldError(
        "metadata",
        Array.isArray(body.metadata) ? "[array]" : `[${typeof body.metadata}]`,
        "metadata must be a JSON object.",
        "Pass an object such as {\"goal_id\":\"goal-123\"}.",
      );
    }
    if (metadataSpoofsIncidentProjection(metadataObject)) {
      return json({ error: "Canonical incident projection metadata is reserved for the dedicated projector" }, 409);
    }
    const metadata = metadataObject ? JSON.stringify(metadataObject) : null;
    const messageUuid = body.uuid === undefined ? randomUUID() : normalizeMessageUuid(body.uuid);
    if (!messageUuid) return json({ error: "uuid must be a valid message UUID" }, 400);
    let attachmentUploads;
    try {
      attachmentUploads = decodeAttachmentUploads(body.attachments);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }

    const replyIdPresent = body.reply_to !== undefined && body.reply_to !== null;
    const replyUuidPresent = body.reply_to_uuid !== undefined && body.reply_to_uuid !== null;
    if (replyIdPresent && !replyUuidPresent) {
      return json({ error: "reply_to requires reply_to_uuid so the parent identity is immutable" }, 400);
    }

    const replyUuid = replyUuidPresent ? normalizeMessageUuid(body.reply_to_uuid) : null;
    if (replyUuidPresent && !replyUuid) {
      return json({ error: "reply_to_uuid must be a valid message UUID" }, 400);
    }

    let replyParent: {
      id: number;
      uuid: string;
      session_id: string;
      channel: string | null;
      reply_to: number | null;
      thread_id: number | null;
    } | null = null;
    if (replyUuid) {
      replyParent = await client.get(
        "SELECT id, uuid, session_id, channel, reply_to, thread_id FROM messages WHERE uuid = $1",
        [replyUuid],
      );
      if (!replyParent) return json({ error: `reply_to_uuid message ${replyUuid} not found` }, 400);

      if (replyIdPresent) {
        const replyId = Number(body.reply_to);
        if (!Number.isInteger(replyId) || replyId <= 0) {
          return json({ error: "reply_to must be a positive integer message id" }, 400);
        }
        if (replyId !== Number(replyParent.id)) {
          return json({
            error: "reply_to identity mismatch",
            reply_to: replyId,
            reply_to_uuid: replyUuid,
          }, 409);
        }
      }

      const parentChannel = replyParent.channel ? normalizeChannelName(replyParent.channel) : null;
      if (requestedChannel !== null && requestedChannel !== parentChannel) {
        return json({
          error: `reply channel ${requestedChannel} does not match parent channel ${parentChannel ?? "(direct message)"}`,
        }, 409);
      }
      if (requestedSession && requestedSession !== replyParent.session_id) {
        return json({
          error: `reply session ${requestedSession} does not match parent session ${replyParent.session_id}`,
        }, 409);
      }
    }

    const channelName = replyParent?.channel
      ? normalizeChannelName(replyParent.channel)
      : requestedChannel;
    // A channel message addresses the channel itself; a DM needs an explicit `to`.
    const toAgent = channelName ?? str(body.to);
    if (!from || !toAgent || !content) return json({ error: "from, to (or channel), and content are required" }, 400);
    // The single `work-status` channel is an append-only lifecycle event stream
    // (global-work-status-lifecycle): every event's FIRST LINE must be the exact
    // machine-parseable envelope, so the shapes measured on the live stream — a
    // JSON document as the message, an empty event_id, invalid state values,
    // missing fields — cannot reach the stream through the hosted path either.
    // A non-reply send to that channel with a violating first line is refused
    // with the reason. Replies are commentary, not events, and are not
    // envelope-checked. `!replyParent` is the same predicate the local path
    // expresses as `!requestedReplyUuid`; the two must stay in step, because a
    // guard present on only one backend is absent exactly where it matters.
    if (!replyParent && channelName === WORK_STATUS_CHANNEL) {
      const violation = workStatusEnvelopeViolation(firstLineOf(content));
      if (violation !== null) {
        // The violation echoes caller-controlled field values (event_id,
        // scope, session, ...); redact before returning so a sensitive value
        // placed in an envelope field cannot be reflected into the API error,
        // which clients throw and logs transcribe. The content-safety scan
        // below runs after this rejection and cannot cover it.
        return json({ error: redactSensitiveText(`work-status lifecycle event rejected: ${violation}`) }, 400);
      }
    }
    // `messages.channel` is free text with no foreign key to `channels`, so a
    // typo'd name wrote an ORPHAN: readable by digest, invisible to
    // `GET /channels` (which selects FROM channels), and unarchivable (todos
    // 4cc80a4d). Only a NON-REPLY send is checked — replies to messages already
    // sitting in pre-existing orphan channels are legacy data the author did
    // not write, and must still go through. `!replyParent` is the same
    // predicate the SQLite path expresses as `!requestedReplyUuid`; they must
    // stay in step, because a guard present on only one backend is absent
    // exactly where it matters.
    // Archived channels are read-only history: a non-reply send to one is
    // refused with archivedChannelMessage, checked beside the existence guard
    // inside the same transaction (todos 9b502ed8). The reply carve-out is
    // identical to the existence check's — a reply derives its channel from
    // the parent, so it must still go through even when that parent sits in
    // an archived channel.
    assertNoSensitiveContent(content, "Message content");
    const requestedProjectId = str(body.project_id) ?? null;
    // Mirror the local sendMessage session derivation so channel history and
    // notifications group identically on the cloud.
    const sessionId = replyParent?.session_id ?? (
      channelName
        ? `channel:${channelName}`
        : requestedSession ?? `${[from, toAgent].sort().join("-")}-${randomUUID().slice(0, 8)}`
    );
    let priority = str(body.priority)?.toLowerCase() ?? "normal";
    if (!VALID_PRIORITIES.includes(priority)) return json({ error: "Invalid priority" }, 400);
    assertNoSensitiveContent(from, "Message sender");
    assertNoSensitiveContent(toAgent, "Message recipient");
    assertNoSensitiveOptionalText(channelName ?? undefined, "Message channel");
    assertNoSensitiveOptionalText(requestedProjectId ?? undefined, "Message project");
    assertNoSensitiveContent(sessionId, "Message session");
    assertNoSensitiveOptionalText(workingDir, "Message working directory");
    assertNoSensitiveOptionalText(repository, "Message repository");
    assertNoSensitiveOptionalText(branch, "Message branch");
    if (metadataObject) assertNoSensitiveValue(metadataObject, "Message metadata");
    if (metadata) assertNoSensitiveContent(metadata, "Message metadata");
    const blocking = body.blocking === true;
    // Persist the local numeric FK only after an immutable UUID lookup resolved
    // it in this authenticated tenant/store. Numeric-only reply identities are
    // refused above because a wrong id can name a different reachable message.
    const replyTo = replyParent ? Number(replyParent.id) : null;
    // Thread membership (task bf381fad): a reply joins its parent's thread, so
    // thread_id is the chain ROOT — the parent itself when the parent is a
    // root, otherwise the parent's recorded root. Mirrors the local
    // sendMessage computation so both backends agree.
    let threadId: number | null = null;
    let threadRootId: number | null = null;
    if (replyParent) {
      threadId = replyParent.reply_to === null ? Number(replyParent.id) : replyParent.thread_id ?? null;
      threadRootId = threadId;
    }
    const row = await client.transaction(async (tx) => {
      let projectId = requestedProjectId;
      if (channelName) {
        const channelRow = await tx.get<{ name: string; project_id: string | null; archived_at: string | null }>(
          "SELECT name, project_id, archived_at FROM channels WHERE name = $1 FOR SHARE",
          [channelName],
        );
        if (!channelRow) {
          // Replies to legacy orphan-channel rows retain the existing exception;
          // every new non-reply channel send remains fail-closed.
          if (!replyParent) throw new Error(unknownChannelMessage(channelName));
        } else {
          if (channelRow.archived_at !== null && !replyParent) {
            throw new Error(archivedChannelMessage(channelName));
          }
          if (projectId !== null && projectId !== channelRow.project_id) {
            throw new Error(
              `Message project ${projectId} conflicts with channel project ${channelRow.project_id ?? "(unlinked)"}.`,
            );
          }
          projectId = channelRow.project_id;
        }
      }
      // Refuse a second lifecycle event for the same task in the same state
      // inside the dedupe window (see the local sendMessage guard): the
      // measured defect class — 96 consecutive same-state pairs, 24-57s apart,
      // each with a fresh event_id — was written through this hosted path, so
      // the check runs here too, inside the transaction, before the INSERT.
      // Only the task's MOST RECENT event decides, so BLOCKED -> RESUMED ->
      // BLOCKED is a real sequence and is not deduped. The decision logic is
      // shared with the local path (work-status-envelope.ts) so the two cannot
      // drift apart.
      if (channelName === WORK_STATUS_CHANNEL && !replyTo) {
        await assertNoDuplicateWorkStatusTransitionPg(tx, content);
      }
      const inserted = await tx.get<Record<string, unknown>>(
        `INSERT INTO messages (uuid, session_id, from_agent, to_agent, channel, project_id, content, priority, working_dir, repository, branch, metadata, blocking, reply_to, thread_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING id, uuid, session_id, from_agent, to_agent, channel, project_id, content, priority,
                   working_dir, repository, branch, metadata, blocking, reply_to, thread_id, created_at`,
        [
          messageUuid,
          sessionId,
          from,
          toAgent,
          channelName ?? null,
          projectId,
          content,
          priority,
          workingDir ?? null,
          repository ?? null,
          branch ?? null,
          metadata,
          blocking,
          replyTo,
          threadId,
        ],
      );
      if (!inserted) return null;

      // A reply promotes its root into a live thread (same semantics as the
      // local sendMessage): mark it open so close/reopen has a status to toggle.
      if (threadRootId !== null) {
        await tx.query(
          "UPDATE messages SET thread_status = 'open' WHERE id = $1 AND thread_status IS NULL",
          [threadRootId],
        );
      }

      if (attachmentUploads.length > 0) {
        const metadata = attachmentUploads.map((attachment) => ({
          name: attachment.name,
          path: `/v1/messages/${inserted.id}/attachments/${encodeURIComponent(attachment.name)}`,
          size: attachment.size,
          mime_type: attachment.mimeType,
        }));
        const params: unknown[] = [];
        const values: string[] = [];
        for (const attachment of attachmentUploads) {
          params.push(inserted.id, attachment.name, attachment.mimeType, attachment.size, attachment.content);
          const offset = params.length - 4;
          values.push(`($${offset},$${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4})`);
        }
        await tx.query(
          `INSERT INTO message_attachments (message_id, name, mime_type, size, content)
           VALUES ${values.join(", ")}`,
          params,
        );
        await tx.query(
          "UPDATE messages SET attachments = $1 WHERE id = $2",
          [JSON.stringify(metadata), inserted.id],
        );
        inserted.attachments = metadata;
      } else {
        inserted.attachments = null;
      }

      // Atomic event capture in the SAME PG transaction as the message insert
      // (webhook-delivery contract). Hosted emission originates on the server.
      const messageCreatedAt = inserted.created_at instanceof Date
        ? inserted.created_at.toISOString()
        : normalizeExactIsoTimestamp(String(inserted.created_at), "stored message created_at");
      const envelope = buildConversationEventEnvelope({
        id: `conversations:message:${messageUuid}:created`,
        type: MESSAGE_CREATED_TYPE,
        time: messageCreatedAt,
        subject: channelName ?? toAgent ?? undefined,
        data: {
          id: inserted.id,
          uuid: inserted.uuid,
          from: inserted.from_agent,
          to: inserted.to_agent,
          channel: inserted.channel,
          project_id: inserted.project_id,
          session_id: inserted.session_id,
          priority: inserted.priority,
          blocking: inserted.blocking,
          reply_to: inserted.reply_to,
          reply_to_uuid: replyParent?.uuid ?? null,
          created_at: messageCreatedAt,
          content_preview: String(content ?? "").slice(0, CONTENT_PREVIEW_CHARS),
        },
        appEvent: { kind: "message.created" },
      });
      await tx.query(
        `INSERT INTO conversations_event_outbox (id, source, type, envelope_json, created_at, status, attempts)
         VALUES ($1,$2,$3,$4,$5,'pending',0)
         ON CONFLICT (id) DO NOTHING`,
        [envelope.id, CONVERSATIONS_SOURCE, envelope.type, JSON.stringify(envelope), envelope.time],
      );
      return inserted;
    });
    if (!row) return json({ error: "Message insert returned no row" }, 500);
    // Clone before mention fanout: supported query adapters may reuse row
    // objects internally, while fanout performs additional INSERTs.
    const insertedMessage = { ...row };
    // @mentions in channel messages create mention rows + notification DMs, so
    // mentions_only reads and mention counts work through the server API too.
    if (channelName && insertedMessage.id != null) {
      try { await processMentions(client, Number(insertedMessage.id), from, channelName, content); } catch { /* best-effort */ }
    }
    return json({ message: redactResponse(insertedMessage) }, 201);
  }

  const attachmentMatch = sub.match(/^messages\/(\d+)\/attachments\/([^/]+)$/);
  if (attachmentMatch && method === "GET") {
    const messageId = Number(attachmentMatch[1]);
    const name = decodeURIComponent(attachmentMatch[2]);
    const encoding = url.searchParams.get("encoding");
    if (encoding !== null && encoding !== "base64") {
      return json({
        error: `Unsupported attachment encoding: ${encoding}`,
        code: "ATTACHMENT_ENCODING_UNSUPPORTED",
        hint: "Omit encoding for raw bytes or use encoding=base64 for a JSON response.",
      }, 400);
    }
    const message = await client.get<{ id: number }>(
      "SELECT id FROM messages WHERE id = $1",
      [messageId],
    );
    if (!message) {
      return json({
        error: `Message #${messageId} not found`,
        code: "MESSAGE_NOT_FOUND",
        hint: `Check the message id with conversations show ${messageId} --json.`,
      }, 404);
    }
    const row = await client.get<{
      content: Buffer | Uint8Array;
      mime_type: string;
      size: number | string;
    }>(
      "SELECT content, mime_type, size FROM message_attachments WHERE message_id = $1 AND name = $2",
      [messageId, name],
    );
    if (!row) {
      return json({
        error: `Requested attachment not found on message #${messageId}`,
        code: "ATTACHMENT_NOT_FOUND",
        hint: `List available names with conversations show ${messageId} --json.`,
      }, 404);
    }
    const content = row.content instanceof Uint8Array
      ? row.content
      : Buffer.from(row.content);
    if (encoding === "base64") {
      return json({
        name,
        mime_type: row.mime_type,
        size: Number(row.size),
        content_base64: Buffer.from(content).toString("base64"),
      });
    }
    const body = content.buffer.slice(
      content.byteOffset,
      content.byteOffset + content.byteLength,
    ) as ArrayBuffer;
    return new Response(body, {
      status: 200,
      headers: {
        ...SECURITY_HEADERS,
        "Content-Type": row.mime_type,
        "Content-Length": String(Number(row.size)),
        "Content-Disposition": `attachment; filename="${name.replace(/["\\]/g, "_")}"`,
      },
    });
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
    const channelProjectParams: Array<{
      channel: string;
      requestedProjectId: string | null;
      projectParamIndex: number;
    }> = [];
    const replyReferences: Array<{
      itemIndex: number;
      uuid: string;
      replyTo: number;
      channel: string | null;
      sessionId: string;
    }> = [];
    // Work-status items collected during the loop; their duplicate-transition
    // guard runs inside the transaction (see the loop and the INSERT below).
    // `createdAtMs` is the item's effective message timestamp (the preserved
    // original created_at when present, otherwise NOW — the same fallback the
    // INSERT applies); the dedupe window is measured from it, so historical
    // events are not compared against the present.
    const workStatusItems: Array<{ index: number; uuid: string; content: string; createdAtMs: number }> = [];
    // Resolve already-stored uuids BEFORE any per-item guard. The bulk
    // endpoint is an idempotent backfill: ON CONFLICT (uuid) DO NOTHING means
    // a re-run of a stored batch is a no-op, and that contract must hold even
    // when the stored rows are legacy events that the envelope or dedupe
    // guards would refuse today — a malformed envelope stored before the guard
    // existed, or a legacy same-state pair. An item whose uuid is already
    // stored is skipped entirely (no envelope check, no dedupe check, no
    // content-safety scan, no INSERT row): it is the same event re-sent, not a
    // second event. The lookup runs on committed rows only; a concurrent
    // insert of the same uuid between this read and the INSERT is still
    // absorbed by ON CONFLICT.
    const existingUuids = new Set<string>();
    {
      const candidateUuids = items
        .filter((raw): raw is Record<string, unknown> => !!raw && typeof raw === "object" && !Array.isArray(raw))
        .map((raw) => str(raw.uuid))
        .filter((uuid): uuid is string => !!uuid);
      if (candidateUuids.length > 0) {
        const existingRows = await client.many<{ uuid: string }>(
          "SELECT uuid FROM messages WHERE uuid = ANY($1::text[])",
          [[...new Set(candidateUuids)]],
        );
        for (const row of existingRows) existingUuids.add(row.uuid);
      }
    }
    const projectIdx = cols.indexOf("project_id");
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
      // Retry of an already-stored item: no-op per the ON CONFLICT contract.
      // Skipped before every guard (envelope, dedupe, content safety) so a
      // re-run of a stored batch never returns 400 for rows the guards would
      // refuse today. The required-field validation above stays first: a
      // retry re-sends the identical payload, so a payload that fails it was
      // never a stored batch.
      if (existingUuids.has(uuid)) continue;
      let priority = str(m.priority)?.toLowerCase() ?? "normal";
      if (!VALID_PRIORITIES.includes(priority)) priority = "normal";
      const sessionId = str(m.session_id) ?? `api:${from}`;
      // The single-send path normalizes the channel before the work-status
      // check; the bulk path must do the same or an alias such as
      // "#WORK-STATUS" would bypass the guard and land under a noncanonical
      // name. Work-status items are canonicalized for storage as well.
      const channel = str(m.channel);
      const normalizedChannel = channel ? normalizeChannelName(channel) : null;
      const projectId = str(m.project_id);
      const replyTo = typeof m.reply_to === "number" ? m.reply_to : null;
      const isWorkStatusNonReply = !replyTo && normalizedChannel === WORK_STATUS_CHANNEL;
      // Work-status lifecycle events must not reach the stream through the
      // bulk backfill path either: it is a write surface with the same
      // conversations:write scope as the single-send path. Same predicates as
      // the single-send path (non-reply sends only): a malformed envelope is
      // refused here up front, and work-status items are collected so the
      // duplicate-transition guard runs inside the transaction, before the
      // INSERT. The redaction mirrors the single-send rejection so a sensitive
      // caller value cannot be reflected into the API error.
      if (isWorkStatusNonReply) {
        const violation = workStatusEnvelopeViolation(firstLineOf(content));
        if (violation !== null) {
          return json({ error: `messages[${i}]: work-status lifecycle event rejected: ${redactSensitiveText(violation)}` }, 400);
        }
        // Collected here; the in-request dedupe runs once, after the loop, in
        // timestamp order (see below) so it cannot depend on request order.
        const createdAtRaw = str(m.created_at);
        const createdAtMs = createdAtRaw
          ? (Number.isFinite(Date.parse(createdAtRaw)) ? Date.parse(createdAtRaw) : Date.now())
          : Date.now();
        workStatusItems.push({ index: i, uuid, content, createdAtMs });
      }
      // Canonicalize the stored channel for work-status items (see above);
      // every other channel keeps the raw backfill value.
      const storedChannel = isWorkStatusNonReply ? WORK_STATUS_CHANNEL : channel;
      assertNoSensitiveContent(content, "Message content");
      assertNoSensitiveContent(from, "Message sender");
      assertNoSensitiveContent(to, "Message recipient");
      assertNoSensitiveOptionalText(storedChannel, "Message channel");
      assertNoSensitiveOptionalText(projectId, "Message project");
      assertNoSensitiveContent(sessionId, "Message session");
      const values: unknown[] = [
        uuid,
        sessionId,
        from,
        to,
        storedChannel ?? null,
        projectId ?? null,
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
        replyTo,
        str(m.created_at) ?? null,
        str(m.read_at) ?? null,
      ];
      const base = params.length;
      const placeholders = values.map((_, j) =>
        j === createdIdx ? `COALESCE($${base + j + 1}::timestamptz, NOW())` : `$${base + j + 1}`,
      );
      rowsSql.push(`(${placeholders.join(", ")})`);
      params.push(...values);
      if (storedChannel) {
        channelProjectParams.push({
          channel: storedChannel,
          requestedProjectId: projectId ?? null,
          projectParamIndex: base + projectIdx,
        });
      }
      if (replyTo !== null) {
        replyReferences.push({
          itemIndex: i,
          uuid,
          replyTo,
          channel: channel ?? null,
          sessionId,
        });
      }
    }

    // Every item was already stored: the re-run is a complete no-op. Return
    // the same summary shape as the empty-batch guard instead of building an
    // `INSERT ... VALUES` with zero rows.
    if (rowsSql.length === 0) {
      return json({ requested: items.length, inserted: 0, skipped: items.length, total: await messageTotal(client) }, 200);
    }

    // In-request dedupe, run ONCE in timestamp order so it cannot depend on
    // request order: every item in this request is inserted by one multi-row
    // INSERT after the transaction guard, so the guard cannot observe this
    // request's own items as stream rows. Each task's most recent event
    // decides (the same rule as the stream guard): a same-state pair within
    // the dedupe window is refused no matter which of the two appears first
    // in the request, and a pair written more than the window apart is a real
    // historical sequence and is not refused.
    if (workStatusItems.length > 1) {
      const sortedWorkStatus = [...workStatusItems].sort((a, b) => a.createdAtMs - b.createdAtMs);
      const lastEventByTask = new Map<string, { state: string; content: string; atMs: number }>();
      for (const item of sortedWorkStatus) {
        const event = parseWorkStatusEvent(firstLineOf(item.content))!;
        const prior = lastEventByTask.get(event.task_id);
        if (prior !== undefined && prior.state === event.state && item.createdAtMs - prior.atMs <= WORK_STATUS_DUPLICATE_WINDOW_MS) {
          const violation = duplicateWorkStatusTransitionViolation([prior.content], event);
          return json({ error: `messages[${item.index}]: ${redactSensitiveText(violation ?? "work-status duplicate transition")}` }, 400);
        }
        lastEventByTask.set(event.task_id, { state: event.state, content: item.content, atMs: item.createdAtMs });
      }
    }

    const result = await client.transaction(async (tx) => {
      // Serialize every existing-channel insert with guarded project linkage.
      // A SHARE lock makes an in-flight bulk insert finish before linkage takes
      // its UPDATE lock, or wait until linkage commits and then inherit the
      // channel's project. Unknown legacy backfill channels retain the existing
      // free-text behavior because no guarded linkage can target a missing row.
      const channelProjects = new Map<string, string | null>();
      const channels = [...new Set(channelProjectParams.map((entry) => entry.channel))].sort();
      for (const channel of channels) {
        const channelRow = await tx.get<{ name: string; project_id: string | null }>(
          "SELECT name, project_id FROM channels WHERE name = $1 FOR SHARE",
          [channel],
        );
        if (channelRow) channelProjects.set(channel, channelRow.project_id ?? null);
      }
      for (const entry of channelProjectParams) {
        if (!channelProjects.has(entry.channel)) continue;
        const channelProjectId = channelProjects.get(entry.channel) ?? null;
        if (entry.requestedProjectId !== null && entry.requestedProjectId !== channelProjectId) {
          throw new Error(
            `Message project ${entry.requestedProjectId} conflicts with channel project ${channelProjectId ?? "(unlinked)"}.`,
          );
        }
        params[entry.projectParamIndex] = channelProjectId;
      }

      if (replyReferences.length > 0) {
        const existingRows = await tx.many<{ uuid: string }>(
          "SELECT uuid FROM messages WHERE uuid = ANY($1::text[]) FOR SHARE",
          [[...new Set(replyReferences.map((entry) => entry.uuid))]],
        );
        const existingUuids = new Set(existingRows.map((row) => row.uuid));
        const newReplyReferences = replyReferences.filter(
          (reference) => !existingUuids.has(reference.uuid),
        );
        const replyIds = [...new Set(newReplyReferences.map((entry) => entry.replyTo))];
        const parents = await tx.many<{
          id: number;
          channel: string | null;
          session_id: string;
        }>(
          "SELECT id, channel, session_id FROM messages WHERE id = ANY($1::bigint[]) FOR SHARE",
          [replyIds],
        );
        const parentsById = new Map(parents.map((parent) => [Number(parent.id), parent]));
        for (const reference of newReplyReferences) {
          const parent = parentsById.get(reference.replyTo);
          if (!parent) {
            throw new Error(`messages[${reference.itemIndex}].reply_to parent not found.`);
          }
          if ((parent.channel ?? null) !== reference.channel) {
            throw new Error(`messages[${reference.itemIndex}].reply_to does not match parent channel.`);
          }
          if (parent.session_id !== reference.sessionId) {
            throw new Error(`messages[${reference.itemIndex}].reply_to does not match parent session.`);
          }
        }
      }

      // Refuse a second lifecycle event for the same task in the same state
      // inside the dedupe window, per work-status item — the same guard as the
      // single-send path, run inside the transaction so a bulk request is not
      // a bypass. The advisory lock inside the guard serializes concurrent
      // bulk writers for the same task. Items whose uuid is already stored
      // never reach this point: the pre-loop existing-uuid lookup skips them,
      // so a replay is a no-op instead of a duplicate-transition refusal.
      for (const workStatusItem of workStatusItems) {
        await assertNoDuplicateWorkStatusTransitionPg(tx, workStatusItem.content, workStatusItem.createdAtMs);
      }

      return tx.query<{ id: number; from_agent: string; channel: string | null; content: string }>(
        `INSERT INTO messages (${cols.join(", ")}) VALUES ${rowsSql.join(", ")}
         ON CONFLICT (uuid) DO NOTHING
         RETURNING id, from_agent, channel, content`,
        params,
      );
    });
    for (const row of result.rows) {
      if (row.channel && row.id != null) {
        try { await processMentions(client, Number(row.id), row.from_agent, row.channel, row.content); } catch { /* best-effort */ }
      }
    }
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
        // Run the assembled response through the redactor so a stored emoji that
        // somehow survived the write gate cannot reach a reader verbatim.
        return json(redactSensitiveValue({ summary: rows.map((r) => ({ emoji: r.emoji, count: Number(r.count), agents: String(r.agents).split(",") })) }));
      }
      const rows = await client.many(
        `SELECT * FROM reactions WHERE message_id = $1 ORDER BY created_at ASC, id ASC`,
        [id],
      );
      return json(redactSensitiveValue({ reactions: rows }));
    }
    if (method === "POST") {
      const body = await readJson(req);
      const who = str(body.agent) ?? agent ?? undefined;
      const emoji = str(body.emoji);
      if (!who || !emoji) return json({ error: "agent and emoji are required" }, 400);
      // Slack-style toggle: the same actor re-adding the same emoji removes it.
      // The unique (message_id, agent, emoji) key makes ON CONFLICT DO NOTHING
      // return no row on the second add, and the DELETE below becomes the
      // removal. Agent defaults to the authenticated identity.
      const norm = emoji.normalize("NFKC");
      // Content-safety gate at the ROUTE boundary, mirroring the message-content
      // assert: a credential-shaped/token-shaped string must never be stored in
      // the emoji field, where every read path would otherwise serve it verbatim
      // (P1: hosted-redaction bypass). Propagates to the top-level 400 handler.
      assertNoSensitiveContent(norm, "Reaction emoji");
      const row = await client.get(
        `INSERT INTO reactions (message_id, agent, emoji) VALUES ($1,$2,$3)
         ON CONFLICT (message_id, agent, emoji) DO NOTHING
         RETURNING *`,
        [id, who, norm],
      );
      if (row) return json(redactSensitiveValue({ toggled: "added", reaction: row }), 201);
      await client.query(`DELETE FROM reactions WHERE message_id = $1 AND agent = $2 AND emoji = $3`, [id, who, norm]);
      return json(redactSensitiveValue({ toggled: "removed", reaction: null }));
    }
    if (method === "DELETE") {
      const who = str(url.searchParams.get("agent")) ?? agent ?? undefined;
      const emoji = str(url.searchParams.get("emoji"));
      if (!who || !emoji) return json({ error: "agent and emoji are required" }, 400);
      const res = await client.query(`DELETE FROM reactions WHERE message_id = $1 AND agent = $2 AND emoji = $3`, [id, who, emoji.normalize("NFKC")]);
      if (res.rowCount === 0) return json({ error: "Reaction not found" }, 404);
      return json({ removed: true });
    }
  }

  // ---- thread collection (task bf381fad) ----
  // GET /threads?channel=<name>&from=<agent> — thread roots with the full
  // descendant reply count, last activity, lifecycle status, and (with `from`)
  // the reader's per-thread unread count derived from read receipts.
  if (sub === "threads" && method === "GET") {
    const channelParam = strictQueryString(url.searchParams, "channel");
    const reader = strictQueryString(url.searchParams, "from");
    const collection = collectionReadOptions(url);
    const channel = channelParam ? normalizeChannelName(channelParam) : null;
    if (!channel) return json({ error: "channel is required" }, 400);
    const descendant = `(r.thread_id = m.id OR (r.thread_id IS NULL AND r.reply_to = m.id))`;
    const params: unknown[] = [channel];
    let unreadSelect = "";
    if (reader) {
      params.push(reader.toLowerCase(), reader.toLowerCase());
      const readerIdx = params.length - 1;
      unreadSelect = `, (SELECT count(*) FROM messages r WHERE ${descendant} AND lower(r.from_agent) != $${readerIdx}
           AND NOT EXISTS (SELECT 1 FROM message_read_receipts rc WHERE rc.message_id = r.id AND rc.agent = $${params.length}))::int AS unread_count`;
    }
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    params.push(collection.limit + 1, collection.offset);
    const rows = await boundedCollectionQuery(client, collection.timeoutMs, (tx) => tx.many<Record<string, unknown>>(
      `SELECT ${messagePreviewProjectionPg("m")}, m.thread_id, m.thread_status,
              (SELECT count(*) FROM messages r WHERE ${descendant})::int AS reply_count,
              (SELECT max(r.created_at) FROM messages r WHERE ${descendant}) AS last_activity_at
              ${unreadSelect}
       FROM messages m
       WHERE m.channel = $1 AND m.reply_to IS NULL
         AND EXISTS (SELECT 1 FROM messages r WHERE ${descendant})
       ORDER BY last_activity_at DESC, m.id DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    ));
    const threads = rows.map((row) => {
      const summary: Record<string, unknown> = {
        root: buildCollectionMessagePreview(row, collection.previewBytes),
        reply_count: Math.max(0, Number(row.reply_count) || 0),
        last_activity_at: row.last_activity_at ?? row.created_at ?? "",
        thread_status: row.thread_status === "closed" ? "closed" : "open",
      };
      if (reader && row.unread_count != null) summary.unread_count = Math.max(0, Number(row.unread_count) || 0);
      return summary;
    });
    const hasMore = threads.length > collection.limit;
    if (hasMore) threads.pop();
    const total = await client.get<{ n: string | number }>(
      `SELECT count(*) AS n FROM messages m
       WHERE m.channel = $1 AND m.reply_to IS NULL
         AND EXISTS (SELECT 1 FROM messages r WHERE ${descendant})`,
      [channel],
    );
    return json({ channel, threads, count: Number(total?.n ?? threads.length), has_more: hasMore, next_cursor: hasMore ? collection.offset + threads.length : null });
  }

  // POST /threads/<id>/status {"status":"open"|"closed"} — close/reopen a thread.
  const threadStatusMatch = sub.match(/^threads\/(\d+)\/status$/);
  if (threadStatusMatch && method === "POST") {
    const ref = Number(threadStatusMatch[1]);
    const body = await readJson(req);
    const status = body.status;
    if (status !== "open" && status !== "closed") {
      return json({ error: "status must be 'open' or 'closed'" }, 400);
    }
    const resolved = await client.get<{ id: number; reply_to: number | null; thread_id: number | null }>(
      "SELECT id, reply_to, thread_id FROM messages WHERE id = $1",
      [ref],
    );
    if (!resolved) return json({ error: `Message ${ref} not found` }, 404);
    let rootId = resolved.reply_to === null ? resolved.id : resolved.thread_id ?? null;
    if (rootId === null) {
      // Walk the reply chain to the root for legacy rows without thread_id.
      let current: { id: number; reply_to: number | null } | null = resolved;
      const seen = new Set<number>();
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        if (current.reply_to === null) { rootId = current.id; break; }
        current = await client.get<{ id: number; reply_to: number | null }>(
          "SELECT id, reply_to FROM messages WHERE id = $1",
          [current.reply_to],
        );
      }
    }
    if (rootId === null) return json({ error: `Message ${ref} not found` }, 404);
    const updated = await client.get<Record<string, unknown>>(
      "UPDATE messages SET thread_status = $1 WHERE id = $2 RETURNING *",
      [status, rootId],
    );
    if (!updated) return json({ error: `Thread root ${rootId} not found` }, 404);
    return json({ message: parseServerMessage(updated) });
  }

  // GET /threads/<id> — full reply tree for one thread.
  const threadMatch = sub.match(/^threads\/(\d+)$/);
  if (threadMatch && method === "GET") {
    const ref = Number(threadMatch[1]);
    const resolved = await client.get<{ id: number; reply_to: number | null; thread_id: number | null }>(
      "SELECT id, reply_to, thread_id FROM messages WHERE id = $1",
      [ref],
    );
    if (!resolved) return json({ error: `Message ${ref} not found` }, 404);
    let rootId = resolved.reply_to === null ? resolved.id : resolved.thread_id ?? null;
    if (rootId === null) {
      let current: { id: number; reply_to: number | null } | null = resolved;
      const seen = new Set<number>();
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        if (current.reply_to === null) { rootId = current.id; break; }
        current = await client.get<{ id: number; reply_to: number | null }>(
          "SELECT id, reply_to FROM messages WHERE id = $1",
          [current.reply_to],
        );
      }
    }
    if (rootId === null) return json({ error: `Message ${ref} not found` }, 404);
    const rootRow = await client.get<Record<string, unknown>>("SELECT * FROM messages WHERE id = $1", [rootId]);
    if (!rootRow) return json({ error: `Thread root ${rootId} not found` }, 404);
    const replyRows = await client.many<Record<string, unknown>>(
      `SELECT * FROM messages
       WHERE (thread_id = $1 OR (thread_id IS NULL AND reply_to = $1))
       ORDER BY created_at ASC, id ASC`,
      [rootId],
    );
    const depthById = new Map<number, number>();
    const replies = replyRows.map((row) => {
      const message = parseServerMessage(row);
      const mid = Number(message.id);
      if (message.reply_to === rootId || (message.reply_to !== null && !depthById.has(Number(message.reply_to)))) {
        depthById.set(mid, 0);
      } else if (message.reply_to !== null && depthById.has(Number(message.reply_to))) {
        depthById.set(mid, (depthById.get(Number(message.reply_to)) ?? 0) + 1);
      }
      return { message, depth: depthById.get(mid) ?? 0 };
    });
    const root = parseServerMessage(rootRow);
    return json({
      root,
      thread_status: root.thread_status === "closed" ? "closed" : "open",
      reply_count: replies.length,
      replies,
    });
  }

  // GET /threads/<id>/unread?agent=<agent> — per-agent unread count for a thread.
  const threadUnreadMatch = sub.match(/^threads\/(\d+)\/unread$/);
  if (threadUnreadMatch && method === "GET") {
    const ref = Number(threadUnreadMatch[1]);
    const reader = str(url.searchParams.get("agent"));
    if (!reader) return json({ error: "agent is required" }, 400);
    const resolved = await client.get<{ id: number; reply_to: number | null; thread_id: number | null }>(
      "SELECT id, reply_to, thread_id FROM messages WHERE id = $1",
      [ref],
    );
    if (!resolved) return json({ error: `Message ${ref} not found` }, 404);
    let rootId = resolved.reply_to === null ? resolved.id : resolved.thread_id ?? null;
    if (rootId === null) {
      let current: { id: number; reply_to: number | null } | null = resolved;
      const seen = new Set<number>();
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        if (current.reply_to === null) { rootId = current.id; break; }
        current = await client.get<{ id: number; reply_to: number | null }>(
          "SELECT id, reply_to FROM messages WHERE id = $1",
          [current.reply_to],
        );
      }
    }
    if (rootId === null) return json({ error: `Message ${ref} not found` }, 404);
    const count = await client.get<{ n: string | number }>(
      `SELECT count(*) AS n FROM messages r
       WHERE (r.thread_id = $1 OR (r.thread_id IS NULL AND r.reply_to = $1))
         AND lower(r.from_agent) != $2
         AND NOT EXISTS (SELECT 1 FROM message_read_receipts rc WHERE rc.message_id = r.id AND rc.agent = $2)`,
      [rootId, reader.toLowerCase()],
    );
    return json({ thread_id: rootId, unread_count: Number(count?.n ?? 0), agent: reader.toLowerCase() });
  }

  // ---- thread replies ----
  const replyMatch = sub.match(/^messages\/(\d+)\/replies$/);
  if (replyMatch && method === "GET") {
    const id = Number(replyMatch[1]);
    const collection = collectionReadOptions(url);
    const rows = await boundedCollectionQuery(client, collection.timeoutMs, (tx) => tx.many<Record<string, unknown>>(
      `SELECT ${messagePreviewProjectionPg()} FROM messages
       WHERE reply_to = $1 ORDER BY created_at ASC, id ASC LIMIT $2 OFFSET $3`,
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

  const msgUuidMatch = sub.match(/^messages\/by-uuid\/([^/]+)$/);
  if (msgUuidMatch && method === "GET") {
    const uuid = normalizeMessageUuid(decodeURIComponent(msgUuidMatch[1]));
    if (!uuid) return json({ error: "Message UUID is invalid" }, 400);
    const row = await client.get(`SELECT * FROM messages WHERE uuid = $1`, [uuid]);
    if (!row) return json({ error: "Message not found" }, 404);
    return json({ message: redactResponse(row) });
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

  const msgRefMatch = sub.match(/^messages\/([^/]+)$/);
  if (msgRefMatch) {
    const ref = parseMessageReference(decodeURIComponent(msgRefMatch[1]));
    if (!ref) return json({ error: "Message reference must be a positive numeric id or UUID" }, 400);
    if (method === "GET") {
      const row = ref.kind === "id"
        ? await client.get(`SELECT * FROM messages WHERE id = $1`, [ref.id])
        : await client.get(`SELECT * FROM messages WHERE uuid = $1`, [ref.uuid]);
      if (!row) return json({ error: "Message not found" }, 404);
      // Attach reactions BEFORE redaction so a stored emoji that somehow
      // survived the write gate is redacted by redactResponse along with the
      // message content (P1: reactions must not bypass the hosted redactor).
      await attachReactionSummariesPg(client, [row as { id: number; reactions?: unknown }]);
      return json({ message: redactResponse(row) });
    }
    if (ref.kind !== "id") {
      return json({ error: "Editing and deleting messages still require a numeric id" }, 400);
    }
    const id = ref.id;
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
    if (!name) return fieldError("name", rawName, "Channel name normalizes to an empty value.", "Provide at least one letter or digit in the channel name.");
    const projectId = str(body.project_id);
    const metadataObj = jsonObject(body.metadata);
    const tagsArr = jsonStringArray(body.tags);
    const tags = tagsArr.length ? JSON.stringify(tagsArr) : null;
    const metadata = metadataObj ? JSON.stringify(metadataObj) : null;
    const result = await client.transaction(async (tx) => {
      await tx.get(
        "SELECT pg_advisory_xact_lock($1::bigint) AS channel_identity_locked",
        [CHANNEL_IDENTITY_ADVISORY_LOCK],
      );
      if (projectId) {
        const project = await tx.get(`SELECT id FROM projects WHERE id = $1 FOR SHARE`, [projectId]);
        if (!project) {
          return fieldError(
            "project_id",
            projectId,
            "No conversations project exists with that id.",
            "Create or resolve the conversations project first with POST/GET /v1/projects, then retry with the returned project.id. If you only need the Projects canonical channel, create or send to that channel name without --project.",
          );
        }
      }
      const reserved = await tx.get<{ current_channel: string }>(
        "SELECT current_channel FROM channel_rename_aliases WHERE old_channel = $1 FOR UPDATE",
        [name],
      );
      if (reserved) {
        return json({ error: reservedHistoricalChannelMessage(name, reserved.current_channel) }, 409);
      }
      const existing = await tx.get(`SELECT name FROM channels WHERE name = $1`, [name]);
      if (existing) return json({ error: "Channel already exists" }, 409);
      if ("metadata" in body && body.metadata != null && !metadataObj) {
        return fieldError("metadata", String(body.metadata), "metadata must be a JSON object.", "Pass an object such as {\"channel_schema\":{\"class\":\"loop-lane\"}}.");
      }
      if ("tags" in body && body.tags != null && (!Array.isArray(body.tags) || tagsArr.length !== body.tags.length)) {
        return fieldError("tags", String(body.tags), "tags must be an array of strings.", "Pass tags as a JSON string array, for example [\"team:harness\"].");
      }
      const row = await tx.get<Record<string, unknown>>(
        `INSERT INTO channels (id, name, description, topic, project_id, created_by, metadata, tags)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [newChannelId(), name, str(body.description) ?? null, str(body.topic) ?? null, projectId ?? null, createdBy, metadata, tags],
      );
      // The channel and creator membership are one operation: neither may
      // survive if the other write fails.
      await tx.query(
        `INSERT INTO channel_members (channel, agent) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [name, createdBy],
      );
      return row;
    });
    if (result instanceof Response) return result;
    return json({ channel: result ? { ...parseServerChannel(result), member_count: 1 } : null }, 201);
  }

  if (sub === "channels/mine" && method === "GET") {
    const who = str(url.searchParams.get("agent")) ?? agent ?? undefined;
    if (!who) return json({ error: "agent is required" }, 400);
    const rows = await client.many(
      `SELECT s.id, s.name, s.description,
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
      const exists = await client.get(`SELECT name FROM channels WHERE name = $1`, [name]);
      if (!exists) return json({ error: `Channel not found: ${name}` }, 404);
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

  const chanMerge = sub.match(/^channels\/([^/]+)\/merge$/);
  if (chanMerge && method === "POST") {
    const destination = normalizeChannelName(decodeURIComponent(chanMerge[1]));
    const body = await readJson(req);
    if (body.tenant_id !== undefined) {
      return json({ error: "tenant_id is owned by the authenticated storage context and cannot be supplied." }, 400);
    }
    const sourceChannel = str(body.source_channel);
    if (!sourceChannel) return json({ error: "source_channel is required" }, 400);
    const dryRun = body.dry_run === true;
    const archiveSource = body.archive_source === true;
    const expectedRevision = str(body.expected_revision);
    const idempotencyKey = str(body.idempotency_key);
    if (!dryRun && (expectedRevision === undefined || idempotencyKey === undefined)) {
      return json({ error: "expected_revision and idempotency_key are required when apply is true" }, 400);
    }
    try {
      const result = await mergeChannelServer(client, sourceChannel, destination, {
        dryRun,
        archiveSource,
        expectedRevision,
        idempotencyKey,
      });
      if (!result.ok) return json({ error: result.error }, result.status);
      return json(result.plan, result.plan.replayed ? 200 : dryRun ? 200 : 201);
    } catch (error) {
      const message = (error as Error).message;
      const status = /not found/i.test(message)
        ? 404
        : /stale|conflict|refused|idempotency|verification|missing|locked/i.test(message)
          ? 409
          : 400;
      return json({ error: message }, status);
    }
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
        const renamed = await renameChannelServer(client, name, String(body.name), {
          reparent: body.reparent === true,
        });
        if (!renamed.ok) return json({ error: renamed.error }, renamed.status);
        name = renamed.name;
      }
      const existing = await client.get<Record<string, unknown>>(`SELECT * FROM channels WHERE name = $1`, [name]);
      if (!existing) return json({ error: "Channel not found" }, 404);
      if (body.project_id !== undefined && body.project_id !== null) {
        const projectId = String(body.project_id);
        const proj = await client.get(`SELECT id FROM projects WHERE id = $1`, [projectId]);
        if (!proj) {
          return fieldError(
            "project_id",
            projectId,
            "No conversations project exists with that id.",
            "Use GET /v1/projects/{id-or-name} or POST /v1/projects to resolve the conversations project id before linking a channel.",
          );
        }
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
    const limitRaw = url.searchParams.get("limit");
    const cursorRaw = url.searchParams.get("cursor");
    const offsetRaw = url.searchParams.get("offset");
    if (limitRaw !== null && !/^[1-9]\d*$/.test(limitRaw)) {
      return fieldError("limit", limitRaw, "limit must be a positive integer.", "Pass limit=1 or greater.");
    }
    for (const [field, raw] of [["cursor", cursorRaw], ["offset", offsetRaw]] as const) {
      if (raw !== null && !/^\d+$/.test(raw)) {
        return fieldError(field, raw, `${field} must be a non-negative integer.`, `Pass ${field}=0 or greater.`);
      }
    }

    const limit = limitRaw === null ? undefined : Math.min(Number(limitRaw), 1000);
    const offset = Number(cursorRaw ?? offsetRaw ?? "0");
    let paginationClause = "";
    if (limit !== undefined) {
      params.push(limit + 1);
      paginationClause += ` LIMIT $${params.length}`;
    }
    if (offset > 0) {
      params.push(offset);
      paginationClause += ` OFFSET $${params.length}`;
    }

    const fetched = await client.many<Record<string, unknown>>(
      `SELECT p.id, p.name, p.description, p.path, p.repository, p.created_by, p.created_at, p.status, p.tags, p.metadata, p.settings,
              (SELECT COUNT(*) FROM channels WHERE project_id = p.id)::int AS channel_count
       FROM projects p ${where} ${simpleOrderByClause(PROJECT_LIST_ORDER, "p.")}${paginationClause}`,
      params,
    );
    const hasMore = limit !== undefined && fetched.length > limit;
    const page = hasMore ? fetched.slice(0, limit) : fetched;
    return json({
      projects: page.map(parseServerProject),
      count: page.length,
      cursor: offset,
      limit: limit ?? null,
      has_more: hasMore,
      next_cursor: hasMore ? offset + page.length : null,
    });
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
    const force = body.force === true;
    const existing = await client.get<Record<string, unknown>>(
      `SELECT *, (EXTRACT(EPOCH FROM (NOW() - last_seen_at)) < 1800) AS active FROM agent_presence WHERE LOWER(agent) = $1`,
      [name],
    );
    if (existing) {
      const existingSession = (existing.session_id as string | null) ?? null;
      // Active session held by a different session id => conflict unless takeover is forced.
      if (!force && existing.active === true && existingSession && existingSession !== sessionId) {
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
    const replaceProjectId = "project_id" in body;
    const replaceMetadata = "metadata" in body;
    const projectId = str(body.project_id) ?? "";
    const metadata = body.metadata && typeof body.metadata === "object" ? JSON.stringify(body.metadata) : null;
    const row = await client.get(
      `INSERT INTO agent_presence (id, agent, session_id, role, project_id, status, last_seen_at, metadata)
       VALUES ($1,$2,$3,'agent',$4,$5,NOW(),$6)
       ON CONFLICT (agent) DO UPDATE SET
         project_id=CASE WHEN $7 THEN EXCLUDED.project_id ELSE agent_presence.project_id END,
         status=EXCLUDED.status,
         last_seen_at=NOW(),
         session_id=COALESCE(EXCLUDED.session_id, agent_presence.session_id),
         metadata=CASE WHEN $8 THEN EXCLUDED.metadata ELSE agent_presence.metadata END
       RETURNING agent, project_id, status, last_seen_at`,
      [
        randomUUID().slice(0, 8),
        name.toLowerCase(),
        str(body.session_id) ?? null,
        projectId,
        str(body.status) ?? "online",
        metadata,
        replaceProjectId,
        replaceMetadata,
      ],
    );
    return json({ agent: row });
  }

  // Flag — and only on explicit `apply`, remove — registrations created once
  // and never seen again whose last heartbeat is older than the retention
  // window. Report-first by default; the delete is a bulk mutation on the
  // production roster and needs the explicit gate. Placed before the
  // per-agent route so "reap-stale" is not swallowed as an agent name.
  if (sub === "agents/reap-stale" && method === "POST") {
    const body = await readJson(req);
    const apply = body?.apply === true;
    const requested = Number(body?.older_than_seconds);
    const retentionSeconds = Number.isFinite(requested) && requested > 0
      ? Math.round(requested)
      : SINGLE_TOUCH_REAP_WINDOW_SECONDS;
    const rows = await client.many<{ id: string; agent: string }>(
      `SELECT id, agent FROM agent_presence
       WHERE created_at IS NOT NULL
         AND EXTRACT(EPOCH FROM (last_seen_at - created_at)) < ${SINGLE_TOUCH_TOLERANCE_SECONDS}
         AND last_seen_at < NOW() - interval '${retentionSeconds} seconds'
       ORDER BY last_seen_at ASC`,
    );
    let reaped = 0;
    if (apply && rows.length > 0) {
      // Delete and preserve in one atomic statement: the DELETE re-checks
      // heartbeat recency (a heartbeat between the candidate SELECT and this
      // delete must keep the registration), and RETURNING feeds the
      // append-only archive, so nothing is removed without a preserved
      // original and a rollback path.
      const res = await client.query(
        `WITH doomed AS (
           DELETE FROM agent_presence
           WHERE id = ANY($1::text[])
             AND last_seen_at < NOW() - interval '${retentionSeconds} seconds'
           RETURNING id, agent, session_id, role, project_id, status, last_seen_at, created_at, metadata
         )
         INSERT INTO agent_presence_reap_archive
           (reaped_at, id, agent, session_id, role, project_id, status, last_seen_at, created_at, metadata)
         SELECT NOW(), id, agent, session_id, role, project_id, status, last_seen_at, created_at, metadata
         FROM doomed`,
        [rows.map((row) => row.id)],
      );
      reaped = res.rowCount;
    }
    return json({
      candidates: rows.length,
      reaped,
      archived: reaped,
      archiveTable: "agent_presence_reap_archive",
      agents: rows.map((row) => row.agent),
    });
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
  client: TypedQueryClient,
  agent: string | null,
): Promise<Response | null> {
  if (sub !== "channel-notifications" && !sub.startsWith("channel-notifications/")) return null;

  if (sub === "channel-notifications" && method === "POST") {
    const body = await readJson(req);
    const channel = str(body.channel);
    const who = str(body.agent) ?? agent ?? undefined;
    if (!channel || !who) return json({ error: "channel and agent are required" }, 400);
    const channelName = normalizeChannelName(channel);
    const exists = await client.get(`SELECT name FROM channels WHERE name = $1`, [channelName]);
    if (!exists) return json({ error: `Channel not found: ${channel}` }, 404);
    const previewChars = Number.isFinite(Number(body.preview_chars)) && Number(body.preview_chars) > 0 ? Math.floor(Number(body.preview_chars)) : 140;
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
    const who = str(url.searchParams.get("agent"));
    const rows = who
      ? await client.many(
          `SELECT channel, agent, created_at, preview_chars, since_message_id FROM channel_subscriptions WHERE agent = $1 ORDER BY created_at ASC, channel ASC`,
          [who],
        )
      : await client.many(
          `SELECT channel, agent, created_at, preview_chars, since_message_id FROM channel_subscriptions ORDER BY agent ASC, channel ASC`,
        );
    return json({ subscriptions: rows });
  }

  if (sub === "channel-notifications/subscribed" && method === "GET") {
    const who = str(url.searchParams.get("agent"));
    if (!who) return json({ error: "agent is required" }, 400);
    const rows = await client.many<{ channel: string }>(
      `SELECT channel FROM channel_subscriptions WHERE agent = $1 ORDER BY created_at ASC, channel ASC`,
      [who],
    );
    return json({ channels: rows.map((r) => r.channel) });
  }

  if (sub === "channel-notifications/inbox" && method === "GET") {
    let who: string | undefined;
    let channel: string | undefined;
    let since: string | undefined;
    try {
      who = strictQueryString(url.searchParams, "agent");
      channel = strictQueryString(url.searchParams, "channel");
      since = strictIsoDateQuery(url.searchParams, "since");
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
    if (!who) return json({ error: "agent is required" }, 400);
    // The API key is the fleet-level authorization principal; the queried
    // `agent` is the identity the inbox is scoped to (task 1871c67f). The
    // key claim never 403s a named seat's own inbox.
    const collection = collectionReadOptions(url);
    const presence = await client.get<{ id: string }>(
      `SELECT id FROM agent_presence WHERE LOWER(agent) = LOWER($1) ORDER BY last_seen_at DESC LIMIT 1`,
      [who],
    );
    const selfSenderId = resolveSelfSenderId(who, presence);
    const clauses = ["s.agent = $1", "m.channel IS NOT NULL", "m.from_agent <> $2", "m.id > s.since_message_id"];
    const params: unknown[] = [who, selfSenderId];
    if (channel) { params.push(normalizeChannelName(channel)); clauses.push(`m.channel = $${params.length}`); }
    if (since) { params.push(since); clauses.push(`m.created_at > $${params.length}`); }
    // Default filters to unread unless explicitly unread_only=false (matches local).
    if (url.searchParams.get("unread_only") !== "false") clauses.push("snr.message_id IS NULL");
    params.push(collection.limit + 1);
    const limitIdx = params.length;
    params.push(collection.offset);
    const offsetIdx = params.length;
    const rows = await client.many<{
      message_id: number; channel: string; from_agent: string; created_at: string;
      priority: string; preview_source: string; attachment_count: number; preview_chars: number; read_message_id: number | null;
    }>(
      `SELECT m.id AS message_id, m.channel, m.from_agent, m.created_at, m.priority,
              left(m.content, ${COLLECTION_PREVIEW_SCAN_CHARS}) AS preview_source,
              CASE WHEN m.attachments IS NULL OR m.attachments = '' THEN 0
                   ELSE jsonb_array_length(m.attachments::jsonb) END AS attachment_count,
              s.preview_chars, snr.message_id AS read_message_id
       FROM messages m
       INNER JOIN channel_subscriptions s ON s.channel = m.channel
       LEFT JOIN channel_notification_reads snr ON snr.message_id = m.id AND snr.agent = s.agent
       WHERE ${clauses.join(" AND ")}
       ORDER BY m.created_at DESC, m.id DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );
    const candidates = rows.map((r) => ({
      message_id: Number(r.message_id),
      channel: r.channel,
      from_agent: r.from_agent,
      created_at: r.created_at,
      priority: r.priority as ChannelNotification["priority"],
      preview: buildByteBoundedMessagePreview(r.preview_source, Number(r.preview_chars ?? 140), collection.previewBytes),
      unread: r.read_message_id == null,
      has_attachments: Number(r.attachment_count) > 0,
    })) satisfies ChannelNotification[];
    let page = packChannelNotificationPage(candidates, {
      limit: collection.limit,
      cursor: collection.offset,
      max_bytes: collection.maxBytes,
      timeout_ms: collection.timeoutMs,
    });
    if (isTrue(url.searchParams.get("mark_read")) && page.notifications.length) {
      const ids = page.notifications.map((notification) => notification.message_id);
      const marked = await client.query(
        `INSERT INTO channel_notification_reads (agent, message_id)
         SELECT $1, x FROM unnest($2::bigint[]) AS x ON CONFLICT DO NOTHING`,
        [who, ids],
      );
      page = packChannelNotificationPage(candidates, {
        limit: collection.limit,
        cursor: collection.offset,
        max_bytes: collection.maxBytes,
        timeout_ms: collection.timeoutMs,
        marked_read: marked.rowCount,
      });
    }
    return json(page);
  }

  if (sub === "channel-notifications/read" && method === "POST") {
    const body = await readJson(req);
    const who = str(body.agent) ?? agent ?? undefined;
    const ids = Array.isArray(body.message_ids) ? (body.message_ids as unknown[]).map(Number).filter((n) => Number.isFinite(n)) : [];
    if (!who || ids.length === 0) return json({ marked: 0 });
    const res = await client.query(
      `INSERT INTO channel_notification_reads (agent, message_id)
       SELECT $1, x FROM unnest($2::bigint[]) AS x ON CONFLICT DO NOTHING`,
      [who, ids],
    );
    return json({ marked: res.rowCount });
  }

  if (sub === "channel-notifications/baseline" && method === "POST") {
    const body = await readJson(req);
    const who = str(body.agent) ?? agent ?? undefined;
    if (!who) return json({ error: "agent is required" }, 400);
    const presence = await client.get<{ id: string }>(
      `SELECT id FROM agent_presence WHERE LOWER(agent) = LOWER($1) ORDER BY last_seen_at DESC LIMIT 1`,
      [who],
    );
    const selfSenderId = resolveSelfSenderId(who, presence);
    const res = await client.query(
      `INSERT INTO channel_notification_reads (agent, message_id)
       SELECT $1, m.id
       FROM messages m
       INNER JOIN channel_subscriptions s ON s.channel = m.channel
       WHERE s.agent = $1
         AND m.channel IS NOT NULL
         AND m.from_agent <> $2
         AND m.id > s.since_message_id
       ON CONFLICT DO NOTHING`,
      [who, selfSenderId],
    );
    return json({ marked: res.rowCount });
  }

  if (sub === "channel-notifications/read-all" && method === "POST") {
    const body = await readJson(req);
    const who = str(body.agent) ?? agent ?? undefined;
    if (!who) return json({ error: "agent is required" }, 400);
    const presence = await client.get<{ id: string }>(
      `SELECT id FROM agent_presence WHERE LOWER(agent) = LOWER($1) ORDER BY last_seen_at DESC LIMIT 1`,
      [who],
    );
    const selfSenderId = resolveSelfSenderId(who, presence);
    const params: unknown[] = [who, selfSenderId];
    let channelClause = "";
    const channel = str(body.channel);
    if (channel) { params.push(normalizeChannelName(channel)); channelClause = `AND m.channel = $${params.length}`; }
    const res = await client.query(
      `INSERT INTO channel_notification_reads (agent, message_id)
       SELECT $1, m.id FROM messages m
       INNER JOIN channel_subscriptions s ON s.channel = m.channel AND s.agent = $1
       LEFT JOIN channel_notification_reads snr ON snr.message_id = m.id AND snr.agent = $1
       WHERE m.channel IS NOT NULL AND m.from_agent <> $2 AND m.id > s.since_message_id AND snr.message_id IS NULL ${channelClause}
       ON CONFLICT DO NOTHING`,
      params,
    );
    return json({ marked: res.rowCount });
  }

  const unsubMatch = sub.match(/^channel-notifications\/([^/]+)\/([^/]+)$/);
  if (unsubMatch && method === "DELETE") {
    const channelName = normalizeChannelName(decodeURIComponent(unsubMatch[1]));
    const who = decodeURIComponent(unsubMatch[2]);
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
  client: PoolQueryClient,
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
    const dependsOn = Array.isArray(body.depends_on) ? (body.depends_on as unknown[]).map(Number).filter((n) => Number.isFinite(n)) : [];
    if (dependsOn.length) {
      for (const depId of dependsOn) {
        const exists = await client.get(`SELECT id FROM tasks WHERE id = $1`, [depId]);
        if (!exists) return json({ error: `Dependency task #${depId} not found` }, 400);
      }
    }
    const taskId = await client.transaction(async (tx) => {
      const inserted = await tx.get<{ id: number }>(
        `INSERT INTO tasks (uuid, subject, description, reporter, assignee, priority, project_id, channel, parent_id, tags, metadata, due_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [uuid, subject, str(body.description) ?? null, reporter, str(body.assignee) ?? null, priority,
         str(body.project_id) ?? null, channel, parentId, tags, metadata, str(body.due_at) ?? null],
      );
      const createdId = Number(inserted!.id);
      if (dependsOn.length) {
        const resolved: number[] = [];
        for (const depId of dependsOn) {
          await tx.query(`INSERT INTO task_dependencies (task_id, depends_on_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [createdId, depId]);
          resolved.push(depId);
        }
        await tx.query(`UPDATE tasks SET depends_on = $1 WHERE id = $2`, [JSON.stringify(resolved), createdId]);
        const incomplete = await tx.get(
          `SELECT 1 FROM task_dependencies td JOIN tasks t ON t.id = td.depends_on_id WHERE td.task_id = $1 AND t.status <> 'completed' LIMIT 1`,
          [createdId],
        );
        if (incomplete) await tx.query(`UPDATE tasks SET status = 'blocked' WHERE id = $1`, [createdId]);
      }
      await logTaskActivity(tx, createdId, reporter, "created");

      // Atomic event capture in the SAME PG transaction as the task INSERT.
      const created = await tx.get<{
        id: number; uuid: string; subject: string; status: string; priority: string;
        assignee: string | null; reporter: string; project_id: string | null; created_at: string;
      }>(
        `SELECT id, uuid, subject, status, priority, assignee, reporter, project_id, created_at
         FROM tasks WHERE id = $1`,
        [createdId],
      );
      if (created) {
        const transitionUuid = randomUUID();
        const envelope = buildConversationEventEnvelope({
          id: `conversations:task:${created.uuid}:activity:${transitionUuid}`,
          type: TASK_CREATED_TYPE,
          // Same normalization as the message-create emit: PG returns timestamptz
          // as a JS Date, and String(date) produces the JS toString format PG
          // cannot parse (BUG 041b4e3a).
          time: new Date(created.created_at).toISOString(),
          subject: created.subject,
          data: {
            task_id: created.id,
            task_uuid: created.uuid,
            subject: created.subject,
            action: "created",
            status: created.status,
            priority: created.priority,
            assignee: created.assignee,
            reporter: created.reporter,
            project_id: created.project_id,
            created_at: created.created_at,
            transition_uuid: transitionUuid,
          },
          appEvent: { kind: "task.created" },
        });
        await tx.query(
          `INSERT INTO conversations_event_outbox (id, source, type, envelope_json, created_at, status, attempts)
           VALUES ($1,$2,$3,$4,$5,'pending',0)
           ON CONFLICT (id) DO NOTHING`,
          [envelope.id, CONVERSATIONS_SOURCE, envelope.type, JSON.stringify(envelope), envelope.time],
        );
      }
      return createdId;
    });
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
    const requestedPriority = str(body.priority);
    if (action === "priority" && !requestedPriority) return json({ error: "priority is required" }, 400);
    if (action === "start") {
      const incomplete = await client.many<{ depends_on_id: number; subject: string; status: string }>(
        `SELECT td.depends_on_id, t.subject, t.status FROM task_dependencies td JOIN tasks t ON t.id = td.depends_on_id WHERE td.task_id = $1 AND t.status <> 'completed'`,
        [id],
      );
      if (incomplete.length > 0) {
        return json({ error: `Cannot start: blocked by ${incomplete.length} incomplete task(s): ${incomplete.map((d) => `#${d.depends_on_id} "${d.subject}" (${d.status})`).join(", ")}` }, 400);
      }
    }
    const transitionUuid = randomUUID();
    await client.transaction(async (tx) => {
      switch (action) {
        case "start":
          await tx.query(`UPDATE tasks SET status = 'in_progress', started_at = $1 WHERE id = $2`, [now(), id]);
          await logTaskActivity(tx, id, actor, "started");
          break;
        case "complete":
          await tx.query(`UPDATE tasks SET status = 'completed', completed_at = $1 WHERE id = $2`, [now(), id]);
          await logTaskActivity(tx, id, actor, "completed", str(body.evidence));
          await unblockDependents(tx, id);
          break;
        case "cancel":
          await tx.query(`UPDATE tasks SET status = 'cancelled', cancelled_at = $1 WHERE id = $2`, [now(), id]);
          await logTaskActivity(tx, id, actor, "cancelled", str(body.reason));
          break;
        case "block":
          await tx.query(`UPDATE tasks SET status = 'blocked' WHERE id = $1`, [id]);
          await logTaskActivity(tx, id, actor, "blocked", str(body.reason));
          break;
        case "unblock": {
          const incomplete = await tx.get(
            `SELECT 1 FROM task_dependencies td JOIN tasks t ON t.id = td.depends_on_id WHERE td.task_id = $1 AND t.status <> 'completed' LIMIT 1`,
            [id],
          );
          await tx.query(`UPDATE tasks SET status = $1 WHERE id = $2`, [incomplete ? "blocked" : "pending", id]);
          await logTaskActivity(tx, id, actor, "unblocked");
          break;
        }
        case "reopen":
          await tx.query(`UPDATE tasks SET status = 'pending', completed_at = NULL, cancelled_at = NULL WHERE id = $1`, [id]);
          await logTaskActivity(tx, id, actor, "reopened");
          break;
        case "assign": {
          const assignee = str(body.assignee);
          await tx.query(`UPDATE tasks SET assignee = $1 WHERE id = $2`, [assignee ?? null, id]);
          await logTaskActivity(tx, id, actor, "assigned", assignee ?? null);
          break;
        }
        case "priority": {
          await tx.query(`UPDATE tasks SET priority = $1 WHERE id = $2`, [requestedPriority, id]);
          await logTaskActivity(tx, id, actor, "priority_changed", `${current?.priority} -> ${requestedPriority}`);
          break;
        }
      }

      // Atomic event capture in the SAME PG transaction as the transition. The
      // action uses the shared past-tense vocabulary (events-bridge pins it),
      // never the raw HTTP verb, so hosted and local emissions agree.
      const updated = await tx.get<TaskOutboxTask>(
        `SELECT id, uuid, subject, status, priority, assignee, project_id FROM tasks WHERE id = $1`,
        [id],
      );
      if (updated) {
        const eventAction = TASK_ACTION_TO_PAST_TENSE[action] ?? action;
        await emitTaskOutboxRow(tx, updated, eventAction, current?.status ?? "", actor, transitionDetailFor(action, current, body, requestedPriority), transitionUuid);
      }
    });
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
    `DELETE FROM resource_locks
     WHERE locked_at < NOW() - interval '${STALE_LOCK_SECONDS} seconds'
       AND LOWER(agent_id) IN (
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
    const res = await client.query(`DELETE FROM resource_locks WHERE resource_type = $1 AND resource_id = $2 AND LOWER(agent_id) = LOWER($3)`, [rt, rid, aid]);
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
          const conflicting = existing.find((l) => l.agent_id.toLowerCase() !== agentId.toLowerCase());
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
      const conflicting = existing.find((l) => l.agent_id.toLowerCase() !== aid.toLowerCase());
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
    if (aid) { params.push(aid); clauses.push(`LOWER(l.agent_id) = LOWER($${params.length})`); }
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
  client: TypedQueryClient,
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
    let limit: number;
    let since: string | undefined;
    try {
      limit = resolveAnalyticsLimit(url.searchParams.get("limit"), "limit", 100, ANALYTICS_LIMIT_MAX);
      since = strictIsoDateQuery(url.searchParams, "since");
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
    const params: unknown[] = [channel];
    let sinceClause = "";
    if (since) { params.push(since); sinceClause = `AND created_at > $${params.length}`; }
    const rows = await client.many<{ preview_source: string }>(
      `SELECT ${pgBoundedPreviewSourceSql()} FROM messages
       WHERE channel = $1 ${sinceClause} ORDER BY created_at DESC LIMIT ${limit}`,
      params,
    );
    return json({ topics: extractTopics(rows.map((r) => redactSensitiveText(r.preview_source ?? "")).join("\n"), 15) });
  }
  const topicSessionMatch = sub.match(/^topics\/session\/([^/]+)$/);
  if (topicSessionMatch && method === "GET") {
    const sid = decodeURIComponent(topicSessionMatch[1]);
    let limit: number;
    try {
      limit = resolveAnalyticsLimit(url.searchParams.get("limit"), "limit", 100, ANALYTICS_LIMIT_MAX);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
    const rows = await client.many<{ preview_source: string }>(
      `SELECT ${pgBoundedPreviewSourceSql()} FROM messages
       WHERE session_id = $1 ORDER BY created_at DESC LIMIT ${limit}`,
      [sid],
    );
    return json({ topics: extractTopics(rows.map((r) => redactSensitiveText(r.preview_source ?? "")).join("\n"), 15) });
  }
  if (sub === "topics/trending" && method === "GET") {
    const hours = Number(str(url.searchParams.get("hours")) ?? "24") || 24;
    let topN: number;
    let projectId: string | undefined;
    try {
      topN = resolveAnalyticsLimit(url.searchParams.get("top_n"), "top_n", 20, ANALYTICS_LIMIT_MAX);
      projectId = strictQueryString(url.searchParams, "project_id");
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
    const params: unknown[] = [];
    let where = `WHERE created_at > NOW() - interval '${Math.floor(hours)} hours'`;
    if (projectId) { params.push(projectId); where += ` AND project_id = $${params.length}`; }
    const rows = await client.many<{ preview_source: string }>(
      `SELECT ${pgBoundedPreviewSourceSql()} FROM messages ${where} ORDER BY created_at DESC LIMIT 500`,
      params,
    );
    return json({ topics: extractTopics(rows.map((r) => redactSensitiveText(r.preview_source ?? "")).join("\n"), topN) });
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
    let limit: number;
    try {
      limit = resolveAnalyticsLimit(url.searchParams.get("limit"), "limit", 50, ANALYTICS_LIMIT_MAX);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
    const isChannelRow = key.startsWith("channel:") ? true : Boolean(await client.get(`SELECT 1 FROM channels WHERE name = $1`, [key]));
    const filterCol = isChannelRow ? "channel" : "session_id";
    const rows = await client.many<Record<string, unknown>>(
      `SELECT ${messagePreviewProjectionPg()} FROM messages
       WHERE ${filterCol} = $1 ORDER BY created_at DESC LIMIT ${limit}`,
      [key],
    );
    if (rows.length === 0) return json({ summary: null });
    const msgs = rows.map((row) => buildCollectionMessagePreview(row, COLLECTION_PREVIEW_SCAN_CHARS));
    const agents = new Set<string>();
    for (const m of msgs) { agents.add(String(m.from_agent)); if (m.to_agent) agents.add(String(m.to_agent)); }
    const dates = msgs.map((m) => String(m.created_at)).sort();
    const topics = extractTopics(msgs.map((m) => redactSensitiveText(m.preview)).join("\n"), 10);
    const keyMessages: Array<{ id: number; from: string; content: string; reason: string }> = [];
    for (const m of msgs) {
      const p = String(m.priority);
      if (p === "high" || p === "urgent") keyMessages.push({ id: Number(m.id), from: String(m.from_agent), content: String(m.preview).slice(0, 200), reason: `${p} priority` });
      if (m.blocking) keyMessages.push({ id: Number(m.id), from: String(m.from_agent), content: String(m.preview).slice(0, 200), reason: "blocking message" });
    }
    for (const m of msgs) if (m.pinned_at) keyMessages.push({ id: Number(m.id), from: String(m.from_agent), content: String(m.preview).slice(0, 200), reason: "pinned" });
    const msgIds = msgs.map((m) => Number(m.id));
    if (msgIds.length > 0) {
      const reacted = await client.many<{ message_id: number; c: number }>(
        `SELECT message_id, COUNT(*)::int AS c FROM reactions WHERE message_id = ANY($1::bigint[]) GROUP BY message_id ORDER BY c DESC LIMIT 3`,
        [msgIds],
      );
      for (const r of reacted) {
        const m = msgs.find((x) => Number(x.id) === Number(r.message_id));
        if (m) keyMessages.push({ id: Number(r.message_id), from: String(m.from_agent), content: String(m.preview).slice(0, 200), reason: `${r.c} reaction(s)` });
      }
    }
    const seen = new Set<number>();
    const uniqueKey = keyMessages.filter((k) => (seen.has(k.id) ? false : (seen.add(k.id), true))).slice(0, 10);
    const blockers = msgs.filter((m) => m.blocking && m.unread).map((m) => ({ id: Number(m.id), from: String(m.from_agent), content: String(m.preview).slice(0, 200), created_at: m.created_at }));
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
    let channel: string | undefined;
    let projectId: string | undefined;
    try {
      channel = strictQueryString(url.searchParams, "channel");
      projectId = strictQueryString(url.searchParams, "project_id");
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
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
