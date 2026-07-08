/**
 * Cloud storage resolver for @hasna/conversations (Hasna Service Contract v1).
 *
 * When the client-flip contract resolves to `cloud-http` — i.e. mode is
 * cloud/self_hosted AND `HASNA_CONVERSATIONS_API_URL` +
 * `HASNA_CONVERSATIONS_API_KEY` are set — the routed message reads/writes below
 * go to `https://conversations.hasna.xyz/v1` with the bearer key instead of the
 * local SQLite store. Otherwise they fall through to the local implementation in
 * `messages.ts`.
 *
 * The fleet flip (`@hasna/machines`) writes only the two API URL + key vars, so
 * — to make that activate cloud — we imply `self_hosted` when both are present
 * and no explicit mode is set. An explicit `HASNA_CONVERSATIONS_STORAGE_MODE=
 * local` (or `_MODE`) still forces the local store, and unsetting the URL/key
 * reverts to local. Never a DSN on the client.
 *
 * SAFETY: conversations is a coordination store. This wiring is OFF by default
 * (local) and fully reversible; it does not change the fleet default. It never
 * logs or distributes the API key (the key lives only inside the HTTP transport).
 */

import { resolveStorageClient, type HasnaStorageClient } from "@hasna/contracts/client/storage";
import type {
  Message,
  SendMessageOptions,
  ReadMessagesOptions,
  SearchMessagesOptions,
  SearchResult,
} from "../types.js";
import {
  sendMessage as localSendMessage,
  getMessageById as localGetMessageById,
  deleteMessage as localDeleteMessage,
  readMessages as localReadMessages,
  searchMessages as localSearchMessages,
  readDigest as localReadDigest,
  markReadByIds as localMarkReadByIds,
  markRead as localMarkRead,
  markAllRead as localMarkAllRead,
  markChannelRead as localMarkChannelRead,
  markSessionRead as localMarkSessionRead,
  markUnreadByIds as localMarkUnreadByIds,
  listUnreadCounts as localListUnreadCounts,
  editMessage as localEditMessage,
  pinMessage as localPinMessage,
  unpinMessage as localUnpinMessage,
  getPinnedMessages as localGetPinnedMessages,
  recordReadReceiptsBatch as localRecordReadReceiptsBatch,
  getReadReceipts as localGetReadReceipts,
  type ReadReceipt,
  parseMessage,
  compactMessage,
  resolveDigestMaxBytes,
  resolveDigestLimit,
  resolveDigestCursor,
  assembleDigest,
  type DigestNorm,
  type DigestResult,
  type ReadDigestOptions,
  type UnreadCount,
} from "./messages.js";
import { normalizeChannelName } from "./channel-names.js";
import { normalizeSince } from "./since.js";

const APP = "conversations";
const RESOURCE = "messages";

type Env = Record<string, string | undefined>;

/**
 * Duck-typed check for a `HasnaHttpError` with a given status. We avoid
 * `instanceof` because the @hasna/contracts client subpaths are bundled
 * separately, so the error class thrown by the storage client's transport is
 * not identity-equal to the one exported from `@hasna/contracts/client`.
 */
function isHttpStatus(error: unknown, status: number): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as { name?: string }).name === "HasnaHttpError" &&
      (error as { status?: number }).status === status,
  );
}

/**
 * Return an env in which `self_hosted` is implied when the API url + key are
 * present but no explicit storage mode is set. Leaves an explicit mode
 * (including `local`) untouched, so the flip stays reversible.
 */
export function conversationsCloudEnv(env: Env = process.env): Env {
  const url = env.HASNA_CONVERSATIONS_API_URL ?? env.CONVERSATIONS_API_URL;
  const key = env.HASNA_CONVERSATIONS_API_KEY ?? env.CONVERSATIONS_API_KEY;
  const mode = env.HASNA_CONVERSATIONS_STORAGE_MODE ?? env.HASNA_CONVERSATIONS_MODE;
  if (url && key && !mode) {
    return { ...env, HASNA_CONVERSATIONS_STORAGE_MODE: "self_hosted" };
  }
  return env;
}

/** Resolve the cloud HTTP client, or `null` when the app should use local. */
export function resolveConversationsCloud(env: Env = process.env): HasnaStorageClient | null {
  const resolved = resolveStorageClient(APP, conversationsCloudEnv(env));
  return resolved.transport === "cloud-http" ? resolved.client : null;
}

/** True when reads/writes are routed to the cloud API. */
export function isCloudMode(env: Env = process.env): boolean {
  return resolveConversationsCloud(env) !== null;
}

/** The resolved cloud API base URL when in cloud mode (else null). */
export function cloudApiUrl(env: Env = process.env): string | null {
  if (!isCloudMode(env)) return null;
  return env.HASNA_CONVERSATIONS_API_URL ?? env.CONVERSATIONS_API_URL ?? null;
}

/**
 * Cloud-served status counts, mirroring the local `status` command but sourced
 * from the self_hosted API so operators verifying a flip see cloud state (not
 * the stale local db). Returns null when not in cloud mode so callers fall back
 * to the local store.
 */
export async function cloudStatus(
  env: Env = process.env,
): Promise<{ api_url: string | null; total_messages: number; unread_messages: number } | null> {
  const client = resolveConversationsCloud(env);
  if (!client) return null;
  const [total, unread] = await Promise.all([
    cloudMessageCount(client, {}),
    cloudMessageCount(client, { unread_only: true }),
  ]);
  return { api_url: cloudApiUrl(env), total_messages: total, unread_messages: unread };
}

// ── Routed message CRUD ──────────────────────────────────────────────────────

export async function sendMessage(opts: SendMessageOptions, env: Env = process.env): Promise<Message> {
  const client = resolveConversationsCloud(env);
  if (!client) return localSendMessage(opts);
  const body = await client.create<{ message: Message }>(RESOURCE, {
    from: opts.from,
    to: opts.to,
    content: opts.content,
    channel: opts.channel,
    project_id: opts.project_id,
    session_id: opts.session_id,
    priority: opts.priority,
    blocking: opts.blocking === true,
  });
  return parseMessage(body.message as unknown as Record<string, unknown>);
}

export async function getMessageById(id: number, env: Env = process.env): Promise<Message | null> {
  const client = resolveConversationsCloud(env);
  if (!client) return localGetMessageById(id);
  const body = await client.get<{ message: Message }>(RESOURCE, String(id));
  return body ? parseMessage(body.message as unknown as Record<string, unknown>) : null;
}

export async function deleteMessage(id: number, agent: string, env: Env = process.env): Promise<boolean> {
  const client = resolveConversationsCloud(env);
  if (!client) return localDeleteMessage(id, agent);
  // The server requires `from` to match the sender and returns 404 when the
  // message is absent or not the caller's — surface that as `false`.
  try {
    await client.transport.del(`/${RESOURCE}/${encodeURIComponent(String(id))}`, undefined, {
      query: { from: agent },
    });
    return true;
  } catch (error) {
    if (isHttpStatus(error, 404)) return false;
    throw error;
  }
}

// ── Routed bulk reads ────────────────────────────────────────────────────────
// These mirror the local read paths (messages.ts) but route to the cloud API
// when self_hosted. Each falls through to the local store when not in cloud mode
// so behaviour is identical and fully reversible.

/** JSON query-value map for the storage client. `undefined` entries are dropped. */
type Query = Record<string, string | number | boolean | undefined>;

function pruneQuery(q: Query): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(q)) if (v !== undefined) out[k] = v;
  return out;
}

export async function readMessages(
  opts: ReadMessagesOptions = {},
  env: Env = process.env,
): Promise<Message[]> {
  const client = resolveConversationsCloud(env);
  // Convert relative durations (7d, 24h, 1w…) to an absolute ISO timestamp
  // before forwarding; ISO/absolute values are left untouched.
  const since = normalizeSince(opts.since);
  if (!client) return localReadMessages({ ...opts, since });

  const isLatest = Boolean(opts.latest && opts.latest > 0);
  const limit = isLatest
    ? Math.floor(opts.latest as number)
    : Number.isFinite(opts.limit) && (opts.limit as number) > 0
      ? Math.floor(opts.limit as number)
      : 20;
  const order = isLatest ? "desc" : opts.order?.toLowerCase() === "desc" ? "desc" : "asc";

  const query = pruneQuery({
    limit,
    order,
    offset: opts.offset,
    session: opts.session_id,
    from: opts.from,
    to: opts.to,
    channel: opts.channel ? normalizeChannelName(opts.channel) : undefined,
    project_id: opts.project_id,
    since,
    since_id: opts.since_id,
    unread_only: opts.unread_only ? true : undefined,
    threads_only: opts.threads_only ? true : undefined,
    include_reply_counts: opts.include_reply_counts ? true : undefined,
    mentions_only: opts.mentions_only,
  });

  // The server envelope is `{ messages: [...] }`; read it directly rather than
  // via client.list (whose generic extractor only knows items/data/rows keys).
  const res = await client.transport.get<{ messages?: Record<string, unknown>[] }>("/messages", { query });
  let messages = (res?.messages ?? []).map(parseMessage);

  if (opts.max_content_length && opts.max_content_length > 0) {
    const max = opts.max_content_length;
    messages = messages.map((m) =>
      m.content.length > max ? { ...m, content: m.content.slice(0, max) + "…", truncated: true } : m,
    );
  }
  if (opts.compact) return messages.map(compactMessage) as Message[];
  return messages;
}

export async function searchMessages(
  opts: SearchMessagesOptions,
  env: Env = process.env,
): Promise<SearchResult[]> {
  const client = resolveConversationsCloud(env);
  const since = normalizeSince(opts.since);
  if (!client) return localSearchMessages({ ...opts, since });

  const query = pruneQuery({
    q: opts.query,
    limit: Number.isFinite(opts.limit) && (opts.limit as number) > 0 ? Math.floor(opts.limit as number) : 20,
    offset: Number.isFinite(opts.offset) && (opts.offset as number) > 0 ? Math.floor(opts.offset as number) : undefined,
    order: "desc",
    channel: opts.channel ? normalizeChannelName(opts.channel) : undefined,
    from: opts.from,
    to: opts.to,
    since,
  });

  const res = await client.transport.get<{ messages?: Record<string, unknown>[] }>("/messages", { query });
  // The cloud search is a substring (ILIKE) match; snippet/relevance are the
  // FTS-only enrichments the local store adds, so they default here.
  return (res?.messages ?? []).map((row) => {
    const msg = parseMessage(row);
    return { ...msg, snippet: null, relevance_score: 0 } as SearchResult;
  });
}

async function cloudMessageCount(client: HasnaStorageClient, query: Query): Promise<number> {
  const body = await client.transport.get<{ count?: number }>("/messages", {
    query: { ...pruneQuery(query), count: 1 },
  });
  return Number(body?.count ?? 0);
}

export async function readDigest(
  opts: ReadDigestOptions = {},
  env: Env = process.env,
): Promise<DigestResult> {
  const client = resolveConversationsCloud(env);
  const since = normalizeSince(opts.since);
  if (!client) return localReadDigest({ ...opts, since });

  const maxBytes = resolveDigestMaxBytes(opts.max_bytes);
  const limit = resolveDigestLimit(opts.limit);
  const cursor = resolveDigestCursor(opts.cursor);
  const channel = opts.channel ? normalizeChannelName(opts.channel) : null;

  const baseFilter = pruneQuery({
    channel: channel ?? undefined,
    session: opts.session_id,
    to: opts.to,
    since,
    since_id: cursor,
    project_id: opts.project_id,
  });

  const [totalAvailable, totalUnread] = await Promise.all([
    cloudMessageCount(client, opts.unread_only ? { ...baseFilter, unread_only: true } : baseFilter),
    cloudMessageCount(client, { ...baseFilter, unread_only: true }),
  ]);

  const listRes = await client.transport.get<{ messages?: Record<string, unknown>[] }>("/messages", {
    query: pruneQuery({
      ...baseFilter,
      order: "asc",
      limit,
      unread_only: opts.unread_only ? true : undefined,
    }),
  });
  const messages = (listRes?.messages ?? []).map(parseMessage);

  const norm: DigestNorm = {
    channel,
    session_id: opts.session_id,
    to: opts.to,
    since,
    cursor,
    maxBytes,
    limit,
  };
  const assembly = assembleDigest(
    norm,
    { total_available: totalAvailable, total_unread: totalUnread },
    messages,
    !!opts.mark_read,
  );

  let markedRead = 0;
  if (opts.mark_read && assembly.markableEntries.length > 0) {
    markedRead = await markReadByIds(assembly.markableEntries.map((m) => m.id), opts.reader, env);
  }
  return assembly.rebuild(markedRead);
}

// ── Routed read-state writes ─────────────────────────────────────────────────

async function cloudMarkRead(
  client: HasnaStorageClient,
  body: { ids?: number[]; reader?: string; all?: boolean; channel?: string; session?: string },
): Promise<number> {
  const res = await client.transport.post<{ marked?: number }>("/messages/read", body);
  return Number(res?.marked ?? 0);
}

export async function markReadByIds(ids: number[], agent?: string, env: Env = process.env): Promise<number> {
  if (ids.length === 0) return 0;
  const client = resolveConversationsCloud(env);
  if (!client) return localMarkReadByIds(ids, agent);
  return cloudMarkRead(client, { ids, reader: agent });
}

export async function markRead(ids: number[], reader: string, env: Env = process.env): Promise<number> {
  if (ids.length === 0) return 0;
  const client = resolveConversationsCloud(env);
  if (!client) return localMarkRead(ids, reader);
  return cloudMarkRead(client, { ids, reader });
}

export async function markAllRead(agent: string, env: Env = process.env): Promise<number> {
  const client = resolveConversationsCloud(env);
  if (!client) return localMarkAllRead(agent);
  return cloudMarkRead(client, { all: true, reader: agent });
}

export async function markChannelRead(channelName: string, reader: string, env: Env = process.env): Promise<number> {
  const client = resolveConversationsCloud(env);
  if (!client) return localMarkChannelRead(channelName, reader);
  return cloudMarkRead(client, { channel: normalizeChannelName(channelName), reader });
}

export async function markSessionRead(sessionId: string, reader: string, env: Env = process.env): Promise<number> {
  const client = resolveConversationsCloud(env);
  if (!client) return localMarkSessionRead(sessionId, reader);
  return cloudMarkRead(client, { session: sessionId, reader });
}

export async function markUnreadByIds(ids: number[], env: Env = process.env): Promise<number> {
  if (ids.length === 0) return 0;
  const client = resolveConversationsCloud(env);
  if (!client) return localMarkUnreadByIds(ids);
  const res = await client.transport.post<{ marked_unread?: number }>("/messages/unread", { ids });
  return Number(res?.marked_unread ?? 0);
}

export async function listUnreadCounts(agent?: string, env: Env = process.env): Promise<UnreadCount[]> {
  const client = resolveConversationsCloud(env);
  if (!client) return localListUnreadCounts(agent);
  const res = await client.transport.get<{ counts?: Array<Record<string, unknown>> }>("/messages/unread-counts", {
    query: pruneQuery({ agent }),
  });
  return (res?.counts ?? []).map((r) => ({
    channel: String(r.channel),
    unread_count: Number(r.unread_count ?? 0),
    latest_message_at: (r.latest_message_at as string) ?? null,
  }));
}

// ── Routed message mutations ─────────────────────────────────────────────────

export async function editMessage(
  id: number,
  agent: string,
  newContent: string,
  env: Env = process.env,
): Promise<Message | null> {
  const client = resolveConversationsCloud(env);
  if (!client) return localEditMessage(id, agent, newContent);
  try {
    const body = await client.update<{ message: Message }>(RESOURCE, String(id), { from: agent, content: newContent });
    return body ? parseMessage(body.message as unknown as Record<string, unknown>) : null;
  } catch (error) {
    if (isHttpStatus(error, 404)) return null;
    throw error;
  }
}

export async function pinMessage(id: number, env: Env = process.env): Promise<Message | null> {
  const client = resolveConversationsCloud(env);
  if (!client) return localPinMessage(id);
  try {
    const body = await client.transport.post<{ message: Message }>(`/messages/${encodeURIComponent(String(id))}/pin`);
    return body ? (body.message as Message) : null;
  } catch (error) {
    if (isHttpStatus(error, 404)) return null;
    throw error;
  }
}

export async function unpinMessage(id: number, env: Env = process.env): Promise<Message | null> {
  const client = resolveConversationsCloud(env);
  if (!client) return localUnpinMessage(id);
  try {
    const body = await client.transport.post<{ message: Message }>(`/messages/${encodeURIComponent(String(id))}/unpin`);
    return body ? (body.message as Message) : null;
  } catch (error) {
    if (isHttpStatus(error, 404)) return null;
    throw error;
  }
}

export async function getPinnedMessages(
  opts: { channel?: string; session_id?: string; limit?: number; offset?: number } = {},
  env: Env = process.env,
): Promise<Message[]> {
  const client = resolveConversationsCloud(env);
  if (!client) return localGetPinnedMessages(opts);
  const res = await client.transport.get<{ messages?: Record<string, unknown>[] }>("/messages/pinned", {
    query: pruneQuery({
      channel: opts.channel ? normalizeChannelName(opts.channel) : undefined,
      session: opts.session_id,
      limit: opts.limit,
      offset: opts.offset,
    }),
  });
  return (res?.messages ?? []).map(parseMessage);
}

export async function recordReadReceiptsBatch(
  messageIds: number[],
  agent: string,
  env: Env = process.env,
): Promise<void> {
  if (!messageIds.length || !agent) return;
  const client = resolveConversationsCloud(env);
  if (!client) return localRecordReadReceiptsBatch(messageIds, agent);
  await cloudMarkRead(client, { ids: messageIds, reader: agent });
}

export async function getReadReceipts(messageId: number, env: Env = process.env): Promise<ReadReceipt[]> {
  const client = resolveConversationsCloud(env);
  if (!client) return localGetReadReceipts(messageId);
  const res = await client.transport.get<{ receipts?: ReadReceipt[] }>(
    `/messages/${encodeURIComponent(String(messageId))}/receipts`,
  );
  return res?.receipts ?? [];
}
