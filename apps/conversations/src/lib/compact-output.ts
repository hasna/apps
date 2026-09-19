import type {
  AgentPresence,
  ChannelInfo,
  ChannelMember,
  ChannelNotificationSubscription,
  Message,
  ProjectInfo,
  SearchResult,
  SearchMessagesPage,
  SearchResultTask,
  Session,
  TaskInfo,
} from "../types.js";
import { createHash } from "node:crypto";
import { takeWindow } from "./message-window.js";
import type { SortDescriptor } from "./list-order.js";

export const DEFAULT_COMPACT_LIMIT = 10;
export const DEFAULT_PREVIEW_CHARS = 160;
export const MAX_COMPACT_LIMIT = 100;
export const DEFAULT_SEARCH_MAX_BYTES = 48 * 1024;
export const DEFAULT_COLLECTION_MAX_BYTES = 48 * 1024;

export interface OutputWindow {
  limit: number;
  offset: number;
  requestedLimit?: number;
  requestedOffset?: number;
  limitCapped: boolean;
}

export interface WindowedItems<T> extends OutputWindow {
  items: T[];
  total: number;
  count: number;
  hasMore: boolean;
  nextCursor: number | null;
}

export function parsePositiveInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

export function parseNonNegativeInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

export function resolveOutputWindow(opts: {
  limit?: unknown;
  cursor?: unknown;
  defaultLimit?: number;
  maxLimit?: number;
} = {}): OutputWindow {
  const maxLimit = Math.max(1, Math.floor(opts.maxLimit ?? MAX_COMPACT_LIMIT));
  const defaultLimit = Math.max(1, Math.min(Math.floor(opts.defaultLimit ?? DEFAULT_COMPACT_LIMIT), maxLimit));
  const requestedLimit = parsePositiveInteger(opts.limit);
  const requestedOffset = parseNonNegativeInteger(opts.cursor);
  const rawLimit = requestedLimit ?? defaultLimit;
  const limit = Math.min(rawLimit, maxLimit);
  return {
    limit,
    offset: requestedOffset ?? 0,
    requestedLimit,
    requestedOffset,
    limitCapped: rawLimit > maxLimit,
  };
}

export function windowItems<T>(items: T[], opts: OutputWindow): WindowedItems<T> {
  const total = items.length;
  const start = Math.min(opts.offset, total);
  const end = Math.min(start + opts.limit, total);
  const page = items.slice(start, end);
  const hasMore = end < total;
  return {
    ...opts,
    items: page,
    total,
    count: page.length,
    hasMore,
    nextCursor: hasMore ? end : null,
  };
}

/**
 * Window an over-fetched (`limit + 1`) query result.
 *
 * `newestWindow` says the rows are the newest N+1 in chronological order, so the
 * page asked for is the TAIL — keeping the head would drop the newest row, which
 * is the whole point of a recency read (todos 2c25973b).
 */
export function pageQueriedItems<T>(items: T[], opts: OutputWindow, pageOpts: { newestWindow?: boolean } = {}) {
  const page = takeWindow(items, opts.limit, pageOpts.newestWindow === true);
  const hasMore = items.length > opts.limit;
  return {
    items: page,
    count: page.length,
    limit: opts.limit,
    cursor: opts.offset,
    next_cursor: hasMore ? opts.offset + page.length : null,
    has_more: hasMore,
    limit_capped: opts.limitCapped,
  };
}

export function previewText(value: string | null | undefined, maxChars = DEFAULT_PREVIEW_CHARS): string {
  const max = Math.max(1, Math.floor(maxChars));
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  if (max <= 3) return normalized.slice(0, max);
  return `${normalized.slice(0, max - 3)}...`;
}

export function isPreviewTruncated(value: string | null | undefined, maxChars = DEFAULT_PREVIEW_CHARS): boolean {
  return (value ?? "").replace(/\s+/g, " ").trim().length > Math.max(1, Math.floor(maxChars));
}

export function summarizeMessage(msg: Message, maxChars = DEFAULT_PREVIEW_CHARS) {
  return {
    id: msg.id,
    session_id: msg.session_id,
    from_agent: msg.from_agent,
    to_agent: msg.to_agent,
    channel: msg.channel,
    created_at: msg.created_at,
    priority: msg.priority,
    unread: !msg.read_at,
    blocking: msg.blocking,
    reply_to: msg.reply_to,
    reply_count: msg.reply_count,
    attachment_count: msg.attachments?.length ?? 0,
    preview: previewText(msg.content, maxChars),
    truncated: isPreviewTruncated(msg.content, maxChars),
  };
}

export function summarizeSearchMessage(msg: SearchResult, maxChars = DEFAULT_PREVIEW_CHARS) {
  const preview = previewText(msg.content, maxChars);
  return {
    ...summarizeMessage(msg, maxChars),
    snippet: previewText(msg.snippet || preview, maxChars),
    relevance_score: msg.relevance_score,
  };
}

export interface CompactSearchEnvelope {
  query: string;
  channel: string | null;
  from: string | null;
  to: string | null;
  since: string | null;
  messages: ReturnType<typeof summarizeSearchMessage>[];
  count: number;
  limit: number;
  cursor: number;
  next_cursor: number | null;
  has_more: boolean;
  max_bytes: number;
  byte_length: number;
  compact: true;
  hint: string;
}

function finalizeCompactSearchEnvelope(envelope: CompactSearchEnvelope): CompactSearchEnvelope {
  for (let i = 0; i < 3; i++) {
    envelope.byte_length = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  }
  return envelope;
}

/** Build a preview-only, byte-bounded search page with in-band completeness. */
export function buildCompactSearchEnvelope(opts: {
  page: SearchMessagesPage;
  query: string;
  channel?: string;
  from?: string;
  to?: string;
  since?: string;
  cursor?: number;
  maxBytes?: number;
}): CompactSearchEnvelope {
  const cursor = Math.max(0, Math.floor(opts.cursor ?? 0));
  const maxBytes = Math.max(1024, Math.min(Math.floor(opts.maxBytes ?? DEFAULT_SEARCH_MAX_BYTES), DEFAULT_SEARCH_MAX_BYTES));
  const summaries = opts.page.items.map((message) => summarizeSearchMessage(message));
  const messages = [...summaries];

  const build = (): CompactSearchEnvelope => {
    const byteLimited = messages.length < summaries.length;
    const hasMore = opts.page.has_more || byteLimited;
    return finalizeCompactSearchEnvelope({
      query: opts.query,
      channel: opts.channel ?? null,
      from: opts.from ?? null,
      to: opts.to ?? null,
      since: opts.since ?? null,
      messages: [...messages],
      count: messages.length,
      limit: opts.page.effective_limit,
      cursor,
      next_cursor: hasMore ? cursor + messages.length : null,
      has_more: hasMore,
      max_bytes: maxBytes,
      byte_length: 0,
      compact: true,
      hint: "Use show <id> for one full message; continue with next_cursor when has_more is true.",
    });
  };

  let envelope = build();
  while (envelope.byte_length > maxBytes && messages.length > 0) {
    messages.pop();
    envelope = build();
  }
  if (envelope.byte_length > maxBytes) {
    throw new Error(`Search envelope exceeds max_bytes (${envelope.byte_length} > ${maxBytes}).`);
  }
  return envelope;
}

export function summarizeTask(task: TaskInfo | SearchResultTask, maxChars = DEFAULT_PREVIEW_CHARS) {
  const searchTask = task as SearchResultTask;
  return {
    id: task.id,
    uuid: task.uuid,
    subject: previewText(task.subject, maxChars),
    status: task.status,
    priority: task.priority,
    assignee: task.assignee,
    reporter: task.reporter,
    project_id: task.project_id,
    channel: task.channel,
    due_at: task.due_at,
    subtask_count: task.subtask_count,
    comment_count: task.comment_count,
    dependency_count: task.dependency_count,
    blocker_count: task.blocker_info?.length ?? 0,
    description_preview: task.description ? previewText(task.description, maxChars) : null,
    snippet: searchTask.snippet ? previewText(searchTask.snippet, maxChars) : undefined,
    relevance_score: searchTask.relevance_score,
  };
}

export function summarizeChannel(channel: ChannelInfo, maxChars = DEFAULT_PREVIEW_CHARS) {
  return {
    id: channel.id,
    name: channel.name,
    description_preview: channel.description ? previewText(channel.description, maxChars) : null,
    topic_preview: channel.topic ? previewText(channel.topic, maxChars) : null,
    project_id: channel.project_id,
    archived: Boolean(channel.archived_at),
    member_count: channel.member_count,
    message_count: channel.message_count,
  };
}

export function summarizeProject(project: ProjectInfo, maxChars = DEFAULT_PREVIEW_CHARS) {
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    description_preview: project.description ? previewText(project.description, maxChars) : null,
    path: project.path ? previewText(project.path, 96) : null,
    repository: project.repository ? previewText(project.repository, 96) : null,
    tag_count: project.tags.length,
    channel_count: project.channel_count,
    created_by: project.created_by,
    created_at: project.created_at,
  };
}

export function summarizeAgent(agent: AgentPresence) {
  return {
    agent: previewText(agent.agent, 96),
    session_id: agent.session_id ? previewText(agent.session_id, 96) : null,
    role: previewText(agent.role, 64),
    status: previewText(agent.status, 96),
    online: agent.online,
    project_id: agent.project_id ? previewText(agent.project_id, 96) : null,
    last_seen_at: agent.last_seen_at,
  };
}

export function summarizeChannelMember(member: ChannelMember) {
  return {
    channel: previewText(member.channel, 96),
    agent: previewText(member.agent, 96),
    joined_at: member.joined_at,
  };
}

export function summarizeChannelSubscription(subscription: ChannelNotificationSubscription) {
  return {
    channel: previewText(subscription.channel, 96),
    agent: previewText(subscription.agent, 96),
    created_at: subscription.created_at,
    preview_chars: subscription.preview_chars,
    since_message_id: subscription.since_message_id,
  };
}

export function summarizeSession(session: Session) {
  const participantLimit = 8;
  return {
    session_id: previewText(session.session_id, 96),
    participants: session.participants.slice(0, participantLimit).map((participant) => previewText(participant, 96)),
    participant_count: session.participants.length,
    participants_truncated: session.participants.length > participantLimit,
    last_message_at: session.last_message_at,
    message_count: session.message_count,
    unread_count: session.unread_count,
  };
}



export type CompactCollectionKind = "agents" | "sessions" | "members" | "subscriptions";

export const MAX_COMPACT_COLLECTION_CURSOR_BYTES = 1_024;
const COMPACT_COLLECTION_CURSOR_VERSION = 1;
const COMPACT_COLLECTION_CURSOR_DOMAIN = "hasna.conversations.compact-collection.v1";

interface CompactCollectionCursorPayload {
  v: 1;
  collection: CompactCollectionKind;
  query: string;
  snapshot: string;
  after: string;
  check: string;
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Compact collection fingerprints require finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry ?? null)).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new Error(`Unsupported compact collection fingerprint value: ${typeof value}`);
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("base64url");
}

function cursorCheck(payload: Omit<CompactCollectionCursorPayload, "check">): string {
  return digest({ domain: COMPACT_COLLECTION_CURSOR_DOMAIN, ...payload });
}

function encodeCompactCollectionCursor(payload: Omit<CompactCollectionCursorPayload, "check">): string {
  const complete: CompactCollectionCursorPayload = { ...payload, check: cursorCheck(payload) };
  return Buffer.from(canonicalJson(complete), "utf8").toString("base64url");
}

function decodeCompactCollectionCursor(
  raw: unknown,
  collection: CompactCollectionKind,
  query: string,
): CompactCollectionCursorPayload | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (
    typeof raw !== "string"
    || Buffer.byteLength(raw, "utf8") > MAX_COMPACT_COLLECTION_CURSOR_BYTES
    || !/^[A-Za-z0-9_-]+$/.test(raw)
  ) throw new Error(`Invalid ${collection} continuation cursor`);
  let decoded: Buffer;
  let value: unknown;
  try {
    decoded = Buffer.from(raw, "base64url");
    if (decoded.toString("base64url") !== raw) throw new Error("noncanonical cursor");
    value = JSON.parse(decoded.toString("utf8"));
  } catch {
    throw new Error(`Invalid ${collection} continuation cursor`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${collection} continuation cursor`);
  }
  const payload = value as Partial<CompactCollectionCursorPayload> & Record<string, unknown>;
  if (
    Object.keys(payload).sort().join(",") !== "after,check,collection,query,snapshot,v"
    || payload.v !== COMPACT_COLLECTION_CURSOR_VERSION
    || payload.collection !== collection
    || payload.query !== query
    || typeof payload.snapshot !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(payload.snapshot)
    || typeof payload.after !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(payload.after)
    || typeof payload.check !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(payload.check)
  ) throw new Error(`${collection} continuation cursor does not match this collection or its filters`);
  const withoutCheck = {
    v: 1 as const,
    collection,
    query,
    snapshot: payload.snapshot,
    after: payload.after,
  };
  if (payload.check !== cursorCheck(withoutCheck) || encodeCompactCollectionCursor(withoutCheck) !== raw) {
    throw new Error(`Invalid ${collection} continuation cursor`);
  }
  return payload as CompactCollectionCursorPayload;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Stable total ordering: newest heartbeat first, then immutable presence identity. */
export function compareAgentCollectionRows(left: AgentPresence, right: AgentPresence): number {
  return compareText(right.last_seen_at, left.last_seen_at)
    || compareText(left.agent, right.agent)
    || compareText(left.id, right.id);
}

/** Stable total ordering: newest session first, then unique session id. */
export function compareSessionCollectionRows(left: Session, right: Session): number {
  return compareText(right.last_message_at, left.last_message_at)
    || compareText(left.session_id, right.session_id);
}

/** Stable total ordering: earliest join first, then unique channel member identity. */
export function compareMemberCollectionRows(left: ChannelMember, right: ChannelMember): number {
  return compareText(left.joined_at, right.joined_at)
    || compareText(left.agent, right.agent)
    || compareText(left.channel, right.channel);
}

/** Stable total ordering: earliest subscription first, then channel and agent identity. */
export function compareSubscriptionCollectionRows(left: ChannelNotificationSubscription, right: ChannelNotificationSubscription): number {
  return compareText(left.created_at, right.created_at)
    || compareText(left.channel, right.channel)
    || compareText(left.agent, right.agent);
}

export interface CompactCollectionEnvelope<T> {
  [key: string]: unknown;
  count: number;
  total: number;
  limit: number;
  cursor: string | null;
  next_cursor: string | null;
  has_more: boolean;
  limit_capped: boolean;
  max_bytes: number;
  byte_length: number;
  compact: true;
  sort: SortDescriptor;
  tie_breakers: string[];
  collection_fingerprint: string;
  hint: string;
}

/**
 * Build a minified collection page with an opaque keyset continuation bound to
 * the tool, filters and the exact ordered snapshot. Any insertion, deletion,
 * reordering or projected-field mutation between pages invalidates the cursor
 * and fails closed instead of silently skipping or duplicating rows.
 */
export function buildCompactCollectionEnvelope<T, S>(opts: {
  collection: CompactCollectionKind;
  items: T[];
  summarize: (item: T) => S;
  compare: (left: T, right: T) => number;
  key: (item: T) => unknown;
  filters?: Record<string, unknown>;
  snapshot?: (item: T) => unknown;
  tieBreakers: string[];
  limit?: unknown;
  cursor?: unknown;
  defaultLimit?: number;
  maxLimit?: number;
  maxBytes?: number;
  sort: SortDescriptor;
  hint: string;
}): CompactCollectionEnvelope<S> {
  const window = resolveOutputWindow({
    limit: opts.limit,
    defaultLimit: opts.defaultLimit ?? DEFAULT_COMPACT_LIMIT,
    maxLimit: opts.maxLimit ?? MAX_COMPACT_LIMIT,
  });
  const maxBytes = Math.max(1024, Math.min(
    Math.floor(opts.maxBytes ?? DEFAULT_COLLECTION_MAX_BYTES),
    DEFAULT_COLLECTION_MAX_BYTES,
  ));
  const query = digest({ collection: opts.collection, filters: opts.filters ?? {} });
  const ordered = [...opts.items].sort(opts.compare);
  const keyed = ordered.map((item) => ({
    item,
    key: digest(opts.key(item)),
    snapshot: (opts.snapshot ?? opts.summarize)(item),
  }));
  if (new Set(keyed.map((entry) => entry.key)).size !== keyed.length) {
    throw new Error(`${opts.collection} collection lacks a unique stable identity; safe traversal is impossible`);
  }
  const collectionFingerprint = digest(keyed.map((entry) => ({ key: entry.key, value: entry.snapshot })));
  const decoded = decodeCompactCollectionCursor(opts.cursor, opts.collection, query);
  if (decoded && decoded.snapshot !== collectionFingerprint) {
    throw new Error(`${opts.collection} collection changed during pagination; restart from the first page`);
  }
  let start = 0;
  if (decoded) {
    const afterIndex = keyed.findIndex((entry) => entry.key === decoded.after);
    if (afterIndex < 0) {
      throw new Error(`${opts.collection} continuation no longer names a member; restart from the first page`);
    }
    start = afterIndex + 1;
  }
  const selected = keyed.slice(start, start + window.limit);
  const rows = selected.map((entry) => opts.summarize(entry.item));

  const build = (): CompactCollectionEnvelope<S> => {
    const emitted = rows.length;
    const nextOffset = start + emitted;
    const hasMore = nextOffset < keyed.length;
    const lastKey = emitted > 0 ? selected[emitted - 1]!.key : null;
    const nextCursor = hasMore && lastKey
      ? encodeCompactCollectionCursor({
          v: 1,
          collection: opts.collection,
          query,
          snapshot: collectionFingerprint,
          after: lastKey,
        })
      : null;
    const envelope: CompactCollectionEnvelope<S> = {
      [opts.collection]: [...rows],
      count: emitted,
      total: keyed.length,
      limit: window.limit,
      cursor: typeof opts.cursor === "string" && opts.cursor ? opts.cursor : null,
      next_cursor: nextCursor,
      has_more: hasMore,
      limit_capped: window.limitCapped,
      max_bytes: maxBytes,
      byte_length: 0,
      compact: true,
      sort: opts.sort,
      tie_breakers: [...opts.tieBreakers],
      collection_fingerprint: collectionFingerprint,
      hint: opts.hint,
    };
    for (let index = 0; index < 4; index += 1) {
      const next = Buffer.byteLength(JSON.stringify(envelope), "utf8");
      if (next === envelope.byte_length) break;
      envelope.byte_length = next;
    }
    return envelope;
  };

  let envelope = build();
  while (envelope.byte_length > maxBytes && rows.length > 0) {
    rows.pop();
    envelope = build();
  }
  if (envelope.byte_length > maxBytes || (rows.length === 0 && start < keyed.length)) {
    throw new Error(`Compact ${opts.collection} envelope cannot advance within max_bytes (${maxBytes}).`);
  }
  return envelope;
}

export function compactCollection<T>(items: T[], opts: {
  limit?: unknown;
  cursor?: unknown;
  defaultLimit?: number;
  maxLimit?: number;
}) {
  const window = resolveOutputWindow(opts);
  const page = windowItems(items, window);
  return {
    items: page.items,
    count: page.count,
    total: page.total,
    limit: page.limit,
    cursor: page.offset,
    next_cursor: page.nextCursor,
    has_more: page.hasMore,
    limit_capped: page.limitCapped,
  };
}
