import { getDb, getDataDir, type Database } from "./db.js";
import type {
  Message,
  Attachment,
  SendMessageOptions,
  ReadMessagesOptions,
  ReadMessagePreviewsOptions,
  ReadMentionPreviewsOptions,
  SearchMessagesOptions,
  SearchMessagePreviewsOptions,
  SearchResult,
  SearchMessagesPage,
  MessagePreview,
  MessagePreviewPage,
  ExportMessagesOptions,
  MessageExportArtifact,
  ListThreadsOptions,
  ThreadExpandResult,
  ThreadStatus,
  ThreadSummary,
} from "../types.js";
import { normalizeExactIsoTimestamp } from "./since.js";
import { createHash, randomUUID } from "crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { fireWebhooks } from "./webhooks.js";
import {
  CONTENT_PREVIEW_CHARS,
  emitConversationEvent,
  MESSAGE_CREATED_TYPE,
} from "./events-bridge.js";
import {
  normalizeChannelName,
  unknownChannelMessage,
  archivedChannelMessage,
  reservedHistoricalChannelMessage,
} from "./channel-names.js";
import { markChannelNotificationsRead } from "./channel-notifications.js";
import {
  WORK_STATUS_CHANNEL,
  WORK_STATUS_DUPLICATE_WINDOW_MS,
  duplicateWorkStatusTransitionViolation,
  firstLineOf,
  parseWorkStatusEvent,
  workStatusEnvelopeViolation,
} from "./work-status-envelope.js";
import { assertNoSensitiveContent, assertNoSensitiveValue, redactSensitiveText, redactSensitiveValue } from "./content-safety.js";
import { resolveReadLimit, resolveReadWindow } from "./message-window.js";
import {
  COLLECTION_MAX_MAX_BYTES,
  COLLECTION_PREVIEW_SCAN_CHARS,
  buildMessagePreview,
  packMessagePreviewPage,
  previewAsCompatibilityMessage,
  resolveCollectionLimit,
  resolveCollectionOffset,
  resolveCollectionPreviewBytes,
  resolveCollectionTimeoutMs,
} from "./message-previews.js";
import {
  IncidentProjectorConfigurationError,
  metadataSpoofsIncidentProjection,
  validateIncidentProjectorBinding,
} from "./incident-projection-contract.js";
import {
  resolveMessageExportOptions,
  serializeMessageExport,
  writeMessageExportArtifact,
} from "./message-exports.js";
import { normalizeMessageUuid } from "./message-reference.js";
import {
  prepareAttachmentSources,
  type PreparedAttachmentSource,
} from "./attachments.js";
import {
  AttachmentRetrievalError,
  attachmentContentMissingError,
  attachmentIntegrityError,
  attachmentNotFoundError,
  attachmentPermissionError,
  isPermissionError,
  messageNotFoundError,
  type RetrievedAttachment,
} from "./attachment-retrieval.js";
import {
  BLOCKERS_LIST_ORDER,
  SEARCH_RECENT_ORDER,
  SEARCH_RELEVANCE_ORDER,
  pinnedOrderByClause,
  simpleOrderByClause,
  type SortDescriptor,
} from "./list-order.js";

/** Strip null/undefined fields from a message for compact output. */
export function compactMessage(msg: Message): Partial<Message> {
  const result: Partial<Message> = {};
  for (const key of Object.keys(msg) as (keyof Message)[]) {
    const val = msg[key];
    if (val !== null && val !== undefined) {
      (result as Record<string, unknown>)[key] = val;
    }
  }
  return result;
}

export function parseMessage(row: Record<string, unknown>): Message {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata as string);
    } catch {
      metadata = null;
    }
  }

  let attachments: Attachment[] | null = null;
  if (row.attachments) {
    if (Array.isArray(row.attachments)) {
      attachments = row.attachments as Attachment[];
    } else {
      try {
        attachments = JSON.parse(row.attachments as string);
      } catch {
        attachments = null;
      }
    }
  }

  // Coerce integer id columns to numbers: SQLite already yields numbers, but the
  // cloud API serializes Postgres bigint as a string ("23"), which would break
  // numeric id comparisons/paging downstream. Number() is a no-op for numbers.
  const id = row.id === undefined || row.id === null ? row.id : Number(row.id);
  const rawUuid = typeof row.uuid === "string" ? row.uuid.trim() : "";
  const uuid = normalizeMessageUuid(rawUuid) ?? rawUuid;
  const replyToRaw = row.reply_to === undefined || row.reply_to === null ? null : Number(row.reply_to);
  const threadIdRaw = row.thread_id === undefined || row.thread_id === null ? null : Number(row.thread_id);
  const replyCount = row.reply_count === undefined || row.reply_count === null ? undefined : Number(row.reply_count);
  const threadStatus =
    row.thread_status === "open" || row.thread_status === "closed" ? row.thread_status : null;

  return redactMessage({
    ...row,
    id,
    uuid,
    metadata,
    attachments,
    blocking: !!row.blocking,
    reply_to: replyToRaw || null,
    thread_id: threadIdRaw || null,
    thread_status: threadStatus,
    ...(replyCount === undefined ? {} : { reply_count: replyCount }),
  } as Message);
}

function redactMessage<T extends Message>(message: T): T {
  return redactSensitiveValue(message);
}

function buildSearchSnippet(message: Message): string | null {
  if (!message.content) return null;
  const normalized = message.content.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.length > 320 ? `${normalized.slice(0, 317)}...` : normalized;
}

function getAttachmentsDir(): string {
  if (process.env.CONVERSATIONS_ATTACHMENTS_DIR) return process.env.CONVERSATIONS_ATTACHMENTS_DIR;
  return join(getDataDir(), "attachments");
}

function stageAttachments(prepared: PreparedAttachmentSource[]): string | null {
  if (prepared.length === 0) return null;
  const root = getAttachmentsDir();
  mkdirSync(root, { recursive: true });
  const stagingDir = mkdtempSync(join(root, ".staging-"));
  try {
    const stagedSources: Array<{ name: string; source_path: string }> = [];
    for (const attachment of prepared) {
      const stagedPath = join(stagingDir, attachment.safeName);
      copyFileSync(attachment.safeSource, stagedPath);
      if (statSync(stagedPath).size !== attachment.size) {
        throw new Error(`Attachment changed while being copied: ${attachment.safeName}`);
      }
      stagedSources.push({ name: attachment.safeName, source_path: stagedPath });
    }
    // Re-run validation against the staged copies, which are the exact bytes
    // committed with the message. This closes a same-size source-file race
    // between the initial preflight and copy.
    const staged = prepareAttachmentSources(stagedSources);
    for (let index = 0; index < staged.length; index++) {
      if (staged[index].size !== prepared[index].size) {
        throw new Error(`Attachment changed while being copied: ${prepared[index].safeName}`);
      }
    }
    return stagingDir;
  } catch (error) {
    rmSync(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

/** Maximum allowed message content size in bytes (64 KB). */
export const MAX_MESSAGE_BYTES = 65536;

function assertMessageSize(content: string): void {
  if (Buffer.byteLength(content, "utf8") > MAX_MESSAGE_BYTES) {
    throw new Error(`Message content exceeds maximum size of ${MAX_MESSAGE_BYTES} bytes (64 KB).`);
  }
}

/** Per-agent rate limit: max messages per window. */
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

const _rateLimitCounters = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(agentId: string): void {
  // Skip in test environments (in-memory or test DB paths)
  const dbPath = process.env.CONVERSATIONS_DB_PATH ?? process.env.HASNA_CONVERSATIONS_DB_PATH ?? "";
  if (dbPath === ":memory:" || dbPath.includes("test") || dbPath.includes("tmp")) return;

  const now = Date.now();
  const entry = _rateLimitCounters.get(agentId);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    _rateLimitCounters.set(agentId, { count: 1, windowStart: now });
    return;
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    throw new Error(`Rate limit exceeded: ${agentId} may send at most ${RATE_LIMIT_MAX} messages per minute.`);
  }
}

/**
 * The single `work-status` channel is an append-only lifecycle event stream
 * (global-work-status-lifecycle): every event's first line MUST be the exact
 * machine-parseable envelope. A non-reply send to that channel with a first
 * line that violates the envelope is refused with the reason, so the shapes
 * measured on the live stream — a JSON document as the message, an empty
 * event_id, invalid state values, missing fields — cannot reach the stream.
 * Replies are commentary, not events, and are not envelope-checked.
 */
function assertWorkStatusEnvelope(channelName: string | null, requestedReplyUuid: string | null, content: string): void {
  if (requestedReplyUuid !== null || channelName !== WORK_STATUS_CHANNEL) return;
  const violation = workStatusEnvelopeViolation(firstLineOf(content));
  if (violation !== null) {
    // The violation echoes caller-controlled field values (event_id, scope,
    // session, ...); redact before throwing so a sensitive value placed in an
    // envelope field cannot be reflected into the error the CLI prints and
    // sessions transcribe.
    throw new Error(redactSensitiveText(`work-status lifecycle event rejected: ${violation}`));
  }
}

/**
 * Refuse a second lifecycle event for the same task in the same state inside
 * the dedupe window: it is a producer double-fire (measured 96 consecutive
 * same-state pairs on the live stream), not a real transition, and any
 * consumer deriving task state from the stream would double-count it. Only the
 * task's MOST RECENT event decides, so BLOCKED -> RESUMED -> BLOCKED is a real
 * sequence and is not deduped: the measured defect is consecutive same-state
 * pairs, and a same-state row that an intervening different state broke is a
 * genuine re-entry, not a re-post. Runs inside the send transaction, so the
 * refused duplicate never reaches the stream.
 */
function assertNoDuplicateWorkStatusTransition(db: Database, content: string): void {
  const event = parseWorkStatusEvent(firstLineOf(content));
  if (event === null) return; // envelope already validated on the send path

  const cutoff = new Date(Date.now() - WORK_STATUS_DUPLICATE_WINDOW_MS).toISOString().replace("Z", "");
  const recent = db.prepare(
    `SELECT content FROM messages
     WHERE channel = ? AND reply_to IS NULL AND created_at >= ?
     ORDER BY id DESC`,
  ).all(WORK_STATUS_CHANNEL, cutoff) as Array<{ content: string }>;

  const violation = duplicateWorkStatusTransitionViolation(
    recent.map((row) => row.content),
    event,
  );
  if (violation !== null) throw new Error(violation);
}

function assertNoSensitiveSendFields(opts: SendMessageOptions, serializedMetadata: string | null): void {
  assertNoSensitiveContent(opts.content, "Message content");

  const persistedStrings: Array<[string, string | undefined]> = [
    ["Message sender", opts.from],
    ["Message recipient", opts.to],
    ["Message session", opts.session_id],
    ["Message channel", opts.channel],
    ["Message project", opts.project_id],
    ["Message working directory", opts.working_dir],
    ["Message repository", opts.repository],
    ["Message branch", opts.branch],
  ];

  for (const [context, value] of persistedStrings) {
    if (value) assertNoSensitiveContent(value, context);
  }

  if (opts.metadata) assertNoSensitiveValue(opts.metadata, "Message metadata");
  if (serializedMetadata) assertNoSensitiveContent(serializedMetadata, "Message metadata");

  for (const attachment of opts.attachments ?? []) {
    assertNoSensitiveContent(attachment.name, "Message attachment name");
    assertNoSensitiveContent(attachment.source_path, "Message attachment path");
  }
}

function assertNotReservedHistoricalAlias(db: Database, channelName: string): void {
  const historicalAlias = db.prepare(
    "SELECT current_channel FROM channel_rename_aliases WHERE old_channel = ?",
  ).get(channelName) as { current_channel: string } | null;
  if (historicalAlias) {
    throw new Error(reservedHistoricalChannelMessage(channelName, historicalAlias.current_channel));
  }
}

export function sendMessage(opts: SendMessageOptions): Message {
  if (opts.tenant_id !== undefined) {
    throw new Error("tenant_id is owned by the active storage context and cannot be supplied on a message write.");
  }
  assertMessageSize(opts.content);
  if (metadataSpoofsIncidentProjection(opts.metadata)) {
    throw new Error("Canonical incident projection metadata is reserved for the dedicated projector");
  }
  const metadata = opts.metadata ? JSON.stringify(opts.metadata) ?? null : null;
  assertNoSensitiveSendFields(opts, metadata);

  checkRateLimit(opts.from);

  const db = getDb();
  const requestedChannel = opts.channel ? normalizeChannelName(opts.channel) : null;
  if (requestedChannel) assertNotReservedHistoricalAlias(db, requestedChannel);

  const preparedAttachments = prepareAttachmentSources(opts.attachments);
  let stagingDir = stageAttachments(preparedAttachments);
  let committedAttachmentDir: string | null = null;
  // `messages.channel` is free text with no foreign key to `channels`, so before
  // this check a typo'd name wrote an ORPHAN: readable by `digest`, invisible to
  // `channel list` (which selects FROM channels), and unarchivable — the archive
  // verb 404s because there is no row to archive. A message that exists and
  // belongs nowhere cannot be found, subscribed to, or cleaned up (todos
  // 4cc80a4d).
  //
  // Only a NON-REPLY send is checked. Replies to messages already sitting in
  // orphan channels — legacy data the author did not write — must still go
  // through, and `conversations reply` derives the parent's channel and passes
  // it EXPLICITLY (src/cli/commands/messaging.ts:509), so testing
  // `requestedChannel` alone would refuse every one of them. The reply branch
  // below already rejects a channel that disagrees with the parent, so nothing
  // is weakened by skipping the existence check here.
  //
  // Archived channels are read-only history: a non-reply send to one is
  // refused with archivedChannelMessage, checked beside the existence guard
  // inside the same transaction (todos 9b502ed8 — #strategy accepted posts
  // after archival). The reply carve-out is identical to the existence
  // check's: a reply derives its channel from the parent, so it must still
  // go through even when that parent sits in an archived channel.
  const explicitSession = opts.session_id && opts.session_id.trim().length > 0 ? opts.session_id.trim() : undefined;
  const requestedReplyId = opts.reply_to ?? null;
  const requestedReplyUuid = normalizeMessageUuid(opts.reply_to_uuid);
  if (requestedReplyId !== null && !requestedReplyUuid) {
    throw new Error("reply_to requires reply_to_uuid so the parent identity is immutable.");
  }
  if (opts.reply_to_uuid && !requestedReplyUuid) {
    throw new Error("reply_to_uuid must be a valid message UUID.");
  }
  assertWorkStatusEnvelope(requestedChannel, requestedReplyUuid, opts.content);
  const normalizedPriority = (opts.priority === "low" || opts.priority === "normal" || opts.priority === "high" || opts.priority === "urgent")
    ? opts.priority
    : "normal";

  const blocking = opts.blocking ? 1 : 0;

  const msgUuid = opts.uuid === undefined
    ? randomUUID().replace(/-/g, "")
    : normalizeMessageUuid(opts.uuid);
  if (!msgUuid) {
    throw new Error("Message uuid must be a valid UUID.");
  }

  let message: Message;
  try {
    message = db.transaction(() => {
      let replyTo: number | null = null;
      let channelName = requestedChannel;
      let sessionId: string;
      let threadId: number | null = null;
      let threadRootId: number | null = null;
      if (requestedReplyUuid) {
        const parent = db.prepare(
          "SELECT id, uuid, session_id, channel, reply_to, thread_id FROM messages WHERE uuid = ?"
        ).get(requestedReplyUuid) as {
          id: number;
          uuid: string;
          session_id: string;
          channel: string | null;
          reply_to: number | null;
          thread_id: number | null;
        } | null;
        if (!parent) {
          throw new Error(`reply_to_uuid message ${requestedReplyUuid} not found.`);
        }
        if (requestedReplyId !== null && requestedReplyId !== parent.id) {
          throw new Error(
            `reply_to identity mismatch: id ${requestedReplyId} belongs to a different message than UUID ${requestedReplyUuid}.`
          );
        }
        const parentChannel = parent.channel ? normalizeChannelName(parent.channel) : null;
        if (requestedChannel !== null && requestedChannel !== parentChannel) {
          throw new Error(
            `reply channel ${requestedChannel} does not match parent channel ${parentChannel ?? "(direct message)"}.`
          );
        }
        if (explicitSession && explicitSession !== parent.session_id) {
          throw new Error(
            `reply session ${explicitSession} does not match parent session ${parent.session_id}.`
          );
        }
        replyTo = parent.id;
        channelName = parentChannel;
        sessionId = parent.session_id;
        // The parent's own reply_to tells us whether IT is the root. A reply
        // joins the parent's thread: the root is the parent when the parent is
        // a root, otherwise the parent's recorded thread root (task bf381fad).
        threadId = parent.reply_to === null ? parent.id : parent.thread_id ?? resolveThreadRootIdFor(parent.id, db);
        threadRootId = threadId;
      } else {
        sessionId = channelName
          ? `channel:${channelName}`
          : explicitSession ?? `${[opts.from, opts.to].sort().join("-")}-${randomUUID().slice(0, 8)}`;
      }

      let projectId = opts.project_id || null;
      if (channelName) {
        const channel = db.prepare("SELECT name, project_id, archived_at FROM channels WHERE name = ?").get(channelName) as {
          name: string;
          project_id: string | null;
          archived_at: string | null;
        } | null;
        if (!channel) {
          if (!requestedReplyUuid) throw new Error(unknownChannelMessage(channelName));
        } else {
          if (channel.archived_at !== null && !requestedReplyUuid) {
            throw new Error(archivedChannelMessage(channelName));
          }
          if (projectId !== null && projectId !== channel.project_id) {
            throw new Error(`Message project ${projectId} conflicts with channel project ${channel.project_id ?? "(unlinked)"}.`);
          }
          projectId = channel.project_id;
        }
      }

      const toAgent = channelName ?? opts.to;

      if (channelName === WORK_STATUS_CHANNEL && !replyTo) {
        assertNoDuplicateWorkStatusTransition(db, opts.content);
      }

      const row = db.prepare(`
        INSERT INTO messages (uuid, session_id, from_agent, to_agent, channel, project_id, content, priority, working_dir, repository, branch, metadata, blocking, reply_to, thread_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING *
      `).get(
        msgUuid,
        sessionId,
        opts.from,
        toAgent,
        channelName,
        projectId,
        opts.content,
        normalizedPriority,
        opts.working_dir || null,
        opts.repository || null,
        opts.branch || null,
        metadata,
        blocking,
        replyTo,
        threadId,
      ) as Record<string, unknown>;
      const stored = parseMessage(row);

      // A reply promotes its root into a live thread: mark it open so the
      // thread lifecycle (close/reopen) has a status to toggle.
      if (threadRootId !== null) {
        db.prepare(
          "UPDATE messages SET thread_status = 'open' WHERE id = ? AND thread_status IS NULL",
        ).run(threadRootId);
      }

      if (stagingDir) {
        const attachmentsDir = join(getAttachmentsDir(), String(stored.id));
        if (existsSync(attachmentsDir)) {
          throw new Error(`Attachment destination already exists for message ${stored.id}.`);
        }
        renameSync(stagingDir, attachmentsDir);
        stagingDir = null;
        committedAttachmentDir = attachmentsDir;

        const attachmentInfos: Attachment[] = preparedAttachments.map((attachment) => ({
          name: attachment.safeName,
          path: join(attachmentsDir, attachment.safeName),
          size: attachment.size,
          mime_type: attachment.mimeType,
        }));
        db.prepare("UPDATE messages SET attachments = ? WHERE id = ?")
          .run(JSON.stringify(attachmentInfos), stored.id);
        stored.attachments = attachmentInfos;
      }

      // Atomic event capture: the outbox row commits in the SAME transaction
      // as the message, so a committed message can never lack durable event
      // intent (webhook-delivery contract, closes silent source/event
      // divergence). Non-blocking — only a row write inside this transaction.
      emitConversationEvent(db, {
        id: `conversations:message:${msgUuid}:created`,
        type: MESSAGE_CREATED_TYPE,
        time: stored.created_at,
        subject: channelName ?? toAgent ?? undefined,
        data: {
          id: stored.id,
          uuid: stored.uuid,
          from: stored.from_agent,
          to: stored.to_agent,
          channel: stored.channel,
          project_id: stored.project_id,
          session_id: stored.session_id,
          priority: stored.priority,
          blocking: stored.blocking,
          reply_to: stored.reply_to,
          reply_to_uuid: requestedReplyUuid ?? null,
          created_at: stored.created_at,
          content_preview: stored.content.slice(0, CONTENT_PREVIEW_CHARS),
        },
        appEvent: { kind: "message.created" },
      });

      return stored;
    });
  } catch (error) {
    if (stagingDir) rmSync(stagingDir, { recursive: true, force: true });
    if (committedAttachmentDir) rmSync(committedAttachmentDir, { recursive: true, force: true });
    throw error;
  }

  // Parse @mentions and create notification DMs (non-blocking)
  if (message.channel) {
    const mentions = parseMentions(opts.content);
    if (mentions.length > 0) {
      void processMentions(message.id, opts.from, message.channel, mentions, db);
    }
  }

  // Fire webhooks async (never blocks)
  fireWebhooks(message);

  return message;
}

/**
 * Walk a message's reply_to chain up to its root. Used only as a fallback for
 * rows whose thread_id was not populated (legacy rows pre-backfill); normal
 * writes and the backfill set thread_id directly.
 */
function resolveThreadRootIdFor(messageId: number, db: Database): number {
  let current = messageId;
  const seen = new Set<number>();
  while (!seen.has(current)) {
    seen.add(current);
    const row = db.prepare("SELECT reply_to, thread_id FROM messages WHERE id = ?").get(current) as
      | { reply_to: number | null; thread_id: number | null }
      | undefined;
    if (!row) break;
    if (row.thread_id !== null) return row.thread_id;
    if (row.reply_to === null) return current;
    current = row.reply_to;
  }
  return current;
}

function previewProjectionColumns(alias = ""): string {
  const c = alias ? `${alias}.` : "";
  return `${c}id, ${c}uuid, ${c}session_id, ${c}from_agent, ${c}to_agent, ${c}channel, ${c}project_id,
          ${c}priority, ${c}blocking, ${c}reply_to, ${c}working_dir, ${c}repository, ${c}branch,
          ${c}created_at, ${c}read_at, ${c}edited_at, ${c}pinned_at,
          CASE WHEN ${c}metadata IS NULL OR ${c}metadata = '' THEN 0 ELSE 1 END AS has_metadata,
          CASE WHEN json_valid(${c}attachments) THEN json_array_length(${c}attachments) ELSE 0 END AS attachment_count,
          substr(${c}content, 1, ${COLLECTION_PREVIEW_SCAN_CHARS}) AS preview_source,
          length(CAST(${c}content AS BLOB)) AS content_bytes`;
}

function assertCollectionDeadline(startedAt: number, timeoutMs: number): void {
  if (performance.now() - startedAt > timeoutMs) {
    throw new Error(`message collection exceeded timeout_ms (${timeoutMs})`);
  }
}

function assertOptionalPositiveId(name: string, value: unknown, allowZero = false): void {
  if (value === undefined || value === null) return;
  if (!Number.isSafeInteger(value) || (allowZero ? Number(value) < 0 : Number(value) <= 0)) {
    throw new Error(`${name} must be ${allowZero ? "a non-negative" : "a positive"} integer`);
  }
}

function assertOptionalFilter(name: string, value: unknown): void {
  if (value !== undefined && value !== null && (typeof value !== "string" || !value.trim())) {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function assertOptionalDate(name: string, value: unknown): void {
  assertOptionalFilter(name, value);
  if (typeof value === "string" && !Number.isFinite(Date.parse(value))) {
    throw new Error(`${name} must be a valid ISO 8601 date`);
  }
}

function validateReadPreviewFilters(opts: ReadMessagePreviewsOptions): void {
  assertOptionalPositiveId("id", opts.id);
  assertOptionalPositiveId("reply_to", opts.reply_to);
  assertOptionalPositiveId("since_id", opts.since_id, true);
  for (const [name, value] of [
    ["session_id", opts.session_id], ["from", opts.from], ["to", opts.to], ["channel", opts.channel],
    ["project_id", opts.project_id], ["mentions_only", opts.mentions_only],
  ] as const) assertOptionalFilter(name, value);
  assertOptionalDate("since", opts.since);
  if (opts.order !== undefined && opts.order !== "asc" && opts.order !== "desc") {
    throw new Error("order must be asc or desc");
  }
}

/** Bounded collection read. Full bodies remain available only by exact id. */
export function readMessagePreviews(opts: ReadMessagePreviewsOptions = {}): MessagePreviewPage {
  validateReadPreviewFilters(opts);
  const startedAt = performance.now();
  const timeoutMs = resolveCollectionTimeoutMs(opts.timeout_ms);
  const limit = resolveCollectionLimit(opts.latest ?? opts.limit);
  const offset = resolveCollectionOffset(opts.offset);
  const previewBytes = resolveCollectionPreviewBytes(opts.preview_bytes ?? opts.max_content_length);
  const db = getDb();
  if (opts.channel) assertNotReservedHistoricalAlias(db, normalizeChannelName(opts.channel));
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (opts.id !== undefined) { conditions.push("id = ?"); params.push(opts.id); }
  if (opts.session_id) {
    conditions.push("session_id = ?");
    params.push(opts.session_id);
  }
  if (opts.from) {
    conditions.push("from_agent = ?");
    params.push(opts.from);
  }
  if (opts.to) {
    conditions.push("to_agent = ?");
    params.push(opts.to);
  }
  if (opts.channel) {
    conditions.push("channel = ?");
    params.push(normalizeChannelName(opts.channel));
  }
  if (opts.project_id) {
    conditions.push("project_id = ?");
    params.push(opts.project_id);
  }
  if (opts.since) {
    conditions.push("created_at > ?");
    params.push(opts.since);
  }
  if (opts.since_id !== undefined) {
    conditions.push("id > ?");
    params.push(opts.since_id);
  }
  if (opts.unread_only) {
    conditions.push("read_at IS NULL");
  }
  if (opts.threads_only) {
    conditions.push("reply_to IS NULL");
  }
  if (opts.reply_to !== undefined) { conditions.push("reply_to = ?"); params.push(opts.reply_to); }
  if (opts.pinned_only) conditions.push("pinned_at IS NOT NULL");
  if (opts.mentions_only) {
    conditions.push(`id IN (SELECT message_id FROM message_mentions WHERE mentioned_agent = ?)`);
    params.push(opts.mentions_only.toLowerCase());
  }

  // latest: N — return the N most recent messages (newest first), overrides limit + order
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const resolvedLimit = Math.min(resolveReadLimit(opts), limit);
  // A bare `limit` — and a bare `--since`, which falls back to the same default
  // cap — is a recency window: SELECT the newest N and hand them back
  // chronologically. Selecting ascending returned the OLDEST N (todos 2c25973b).
  const window = resolveReadWindow(opts);
  const idCursor = opts.since_id !== undefined;
  const order = idCursor ? "ASC" : (window.select === "desc" ? "DESC" : "ASC");
  const orderBy = idCursor ? "id ASC" : `created_at ${order}, id ${order}`;

  // SQLite LIMIT/OFFSET require literal integers — validated and bounded here
  const resolvedOffset = Number.isFinite(opts.offset) ? Math.floor(opts.offset as number) : 0;
  const safeLimit = Math.max(1, resolvedLimit);
  const safeOffset = Math.max(offset, Math.max(0, Math.floor(resolvedOffset)));
  const replyCountSelect = opts.include_reply_counts
    ? ", (SELECT COUNT(*) FROM messages replies WHERE replies.reply_to = messages.id) AS reply_count"
    : "";
  const rows = db.prepare(
    `SELECT ${previewProjectionColumns()}${replyCountSelect} FROM messages ${where} ORDER BY ${orderBy} LIMIT ${safeLimit + 1} OFFSET ${safeOffset}`
  ).all(...params) as Record<string, unknown>[];
  assertCollectionDeadline(startedAt, timeoutMs);
  const selected = rows.slice(0, safeLimit);
  if (window.reverse) selected.reverse();
  const candidates = selected.map((row) => buildMessagePreview(row, previewBytes));
  if (rows.length > safeLimit) candidates.push(buildMessagePreview(rows[safeLimit], previewBytes));
  const page = packMessagePreviewPage(candidates, {
    limit: safeLimit,
    cursor: safeOffset,
    max_bytes: opts.max_bytes,
    timeout_ms: timeoutMs,
  });
  assertCollectionDeadline(startedAt, timeoutMs);
  return page;
}

/** Legacy collection compatibility: bounded/redacted preview in content. */
export function readMessages(opts: ReadMessagesOptions = {}): Message[] {
  const messages = readMessagePreviews({
    ...opts,
    preview_bytes: opts.max_content_length,
    max_bytes: COLLECTION_MAX_MAX_BYTES,
  }).messages.map(previewAsCompatibilityMessage);
  return opts.compact ? messages.map(compactMessage) as Message[] : messages;
}

export interface CountMessagesOptions {
  session_id?: string;
  from?: string;
  to?: string;
  channel?: string;
  project_id?: string;
  since?: string;
  since_id?: number;
  unread_only?: boolean;
  blocking_only?: boolean;
}

/**
 * Authoritative COUNT of messages matching the given filters. Mirrors the filter
 * surface of {@link readMessages} and the server `/messages?count=1` endpoint so
 * both Store transports (LocalStore, ApiStore) return identical totals. Used by
 * aggregation callers (e.g. the project panel) that need a total without paging
 * every row through memory.
 */
export function countMessages(opts: CountMessagesOptions = {}): number {
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (opts.session_id) {
    conditions.push("session_id = ?");
    params.push(opts.session_id);
  }
  if (opts.from) {
    conditions.push("from_agent = ?");
    params.push(opts.from);
  }
  if (opts.to) {
    conditions.push("to_agent = ?");
    params.push(opts.to);
  }
  if (opts.channel) {
    conditions.push("channel = ?");
    params.push(normalizeChannelName(opts.channel));
  }
  if (opts.project_id) {
    conditions.push("project_id = ?");
    params.push(opts.project_id);
  }
  if (opts.since) {
    conditions.push("created_at > ?");
    params.push(opts.since);
  }
  if (opts.since_id !== undefined) {
    conditions.push("id > ?");
    params.push(opts.since_id);
  }
  if (opts.unread_only) {
    conditions.push("read_at IS NULL");
  }
  if (opts.blocking_only) {
    conditions.push("blocking = 1");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const row = db.prepare(`SELECT COUNT(*) AS n FROM messages ${where}`).get(...params) as { n: number } | undefined;
  return row?.n ?? 0;
}

function visibleProjectionMessageIds(agent: string): Message[] {
  const db = getDb();
  const isProjection = db.prepare("SELECT 1 AS present FROM incident_projections WHERE message_id = ?");
  return getUnreadBlockers(agent).filter((message) => Boolean(isProjection.get(message.id)));
}

function insertProjectionReceipts(ids: number[], reader: string): number {
  if (ids.length === 0) return 0;
  const db = getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO message_read_receipts (message_id, agent, read_at)
     VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%f', 'now'))`,
  );
  const normalized = reader.toLowerCase();
  let inserted = 0;
  for (const id of new Set(ids)) inserted += insert.run(id, normalized).changes;
  return inserted;
}

function markExplicitRead(ids: number[], reader: string, requireRecipient: boolean): number {
  const db = getDb();
  const uniqueIds = [...new Set(ids.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (uniqueIds.length === 0) return 0;
  return db.transaction(() => {
    const visibleProjected = new Set(visibleProjectionMessageIds(reader).map((message) => message.id));
    const messageLookup = db.prepare(`
      SELECT m.to_agent,
             EXISTS (SELECT 1 FROM incident_projections p WHERE p.message_id = m.id) AS projected
      FROM messages m WHERE m.id = ?
    `);
    const receipt = db.prepare(
      `INSERT OR IGNORE INTO message_read_receipts (message_id, agent, read_at)
       VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%f', 'now'))`,
    );
    const markLegacy = db.prepare(
      `UPDATE messages SET read_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
       WHERE id = ? AND read_at IS NULL`,
    );
    const normalized = reader.toLowerCase();
    let marked = 0;
    for (const id of uniqueIds) {
      const row = messageLookup.get(id) as { to_agent: string; projected: number } | undefined;
      if (!row) continue;
      const projected = Boolean(row.projected);
      if (projected && !visibleProjected.has(id)) continue;
      if (!projected && requireRecipient && row.to_agent.toLowerCase() !== normalized) continue;
      const receiptChanged = projected ? receipt.run(id, normalized).changes > 0 : false;
      const globalChanged = projected ? false : markLegacy.run(id).changes > 0;
      if (receiptChanged || globalChanged) marked += 1;
    }
    return marked;
  });
}

export function markRead(ids: number[], reader: string): number {
  return markExplicitRead(ids, reader, true);
}

export function markSessionRead(sessionId: string, reader: string): number {
  const db = getDb();
  return db.transaction(() => {
    const projected = visibleProjectionMessageIds(reader).filter((message) => message.session_id === sessionId);
    const acknowledged = insertProjectionReceipts(projected.map((message) => message.id), reader);
    const result = db.prepare(
      `UPDATE messages SET read_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
       WHERE session_id = ? AND to_agent = ? AND read_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM incident_projections p WHERE p.message_id = messages.id)`,
    ).run(sessionId, reader);
    return acknowledged + result.changes;
  });
}

export function markChannelRead(channelName: string, reader: string): number {
  const db = getDb();
  const normalized = normalizeChannelName(channelName);
  return db.transaction(() => {
    const projected = visibleProjectionMessageIds(reader).filter((message) => message.channel === normalized);
    const acknowledged = insertProjectionReceipts(projected.map((message) => message.id), reader);
    const result = db.prepare(
      `UPDATE messages SET read_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
       WHERE channel = ? AND from_agent != ? AND read_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM incident_projections p WHERE p.message_id = messages.id)`,
    ).run(normalized, reader);
    return acknowledged + result.changes;
  });
}

export function getMessageById(id: number): Message | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as Record<string, unknown> | null;
  return row ? parseMessage(row) : null;
}

export function getMessageAttachment(
  messageId: number,
  name: string,
): RetrievedAttachment {
  const message = getMessageById(messageId);
  if (!message) throw messageNotFoundError(messageId);

  const attachment = message.attachments?.find((candidate) => candidate.name === name);
  if (!attachment) throw attachmentNotFoundError(messageId, name);

  const messageDir = resolve(getAttachmentsDir(), String(messageId));
  const recordedPath = resolve(attachment.path);
  if (dirname(recordedPath) !== messageDir) {
    throw attachmentIntegrityError(messageId, name);
  }

  try {
    const realMessageDir = realpathSync(messageDir);
    const realAttachmentPath = realpathSync(recordedPath);
    if (dirname(realAttachmentPath) !== realMessageDir) {
      throw attachmentIntegrityError(messageId, name);
    }
    if (!statSync(realAttachmentPath).isFile()) {
      throw attachmentIntegrityError(messageId, name);
    }
    const content = readFileSync(realAttachmentPath);
    if (content.length !== attachment.size) {
      throw attachmentIntegrityError(messageId, name);
    }
    return {
      message_id: messageId,
      name: attachment.name,
      mime_type: attachment.mime_type,
      size: attachment.size,
      content,
    };
  } catch (error) {
    if (error instanceof AttachmentRetrievalError) throw error;
    if (isPermissionError(error)) throw attachmentPermissionError(messageId, name);
    if ((error as { code?: unknown } | null)?.code === "ENOENT") {
      throw attachmentContentMissingError(messageId, name);
    }
    throw error;
  }
}

export function getMessageByUuid(uuid: string): Message | null {
  const normalized = normalizeMessageUuid(uuid);
  if (!normalized) return null;
  const db = getDb();
  const row = db.prepare("SELECT * FROM messages WHERE uuid = ?").get(normalized) as Record<string, unknown> | null;
  return row ? parseMessage(row) : null;
}

export function markReadByIds(ids: number[], agent?: string): number {
  const db = getDb();
  if (ids.length === 0) return 0;

  if (agent) return markExplicitRead(ids, agent, false);

  // Legacy: no agent — update global read_at only
  const placeholders = ids.map(() => "?").join(", ");
  const stmt = db.prepare(
    `UPDATE messages SET read_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE id IN (${placeholders}) AND read_at IS NULL`
  );
  const result = stmt.run(...ids);
  return result.changes;
}

export function markAllRead(agent: string): number {
  const db = getDb();
  return db.transaction(() => {
    const projected = visibleProjectionMessageIds(agent);
    const acknowledged = insertProjectionReceipts(projected.map((message) => message.id), agent);
    const result = db.prepare(
      `UPDATE messages SET read_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
       WHERE to_agent = ? AND read_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM incident_projections p WHERE p.message_id = messages.id)`,
    ).run(agent);
    return acknowledged + result.changes;
  });
}

export interface DigestMessage {
  id: number;
  from: string;
  created_at: string;
  snippet: string;
  snippet_bytes: number;
  truncated: boolean;
  priority: string;
  has_attachments: boolean;
  attachment_count: number;
  channel?: string | null;
  to?: string | null;
  reply_to?: number | null;
  unread: boolean;
}

export interface DigestResult {
  digest_id: string;
  messages: DigestMessage[];
  message_ids: number[];
  channel: string | null;
  session_id: string | null;
  to: string | null;
  since: string | null;
  cursor: number | null;
  /**
   * The highest message id this page has ACCOUNTED FOR, or `null` when the read
   * is exhausted.
   *
   * When non-null, every matching message with `id <= next_cursor` was either
   * delivered on this page (counted in `shown`) or cannot be delivered at this
   * `max_bytes` on a page of its own (counted in `skipped_count`). Following it
   * is therefore lossless: nothing that could have been returned is stepped over.
   *
   * `null` means this page accounted for nothing and there is no further page —
   * so **cursor-presence is a safe loop condition**, matching every other paged
   * surface in this package (`searchMessagesPage`, the compact list envelopes,
   * the REST `/v1` endpoints, which `openapi.ts` already declares nullable).
   * Both drain idioms terminate:
   *
   *     while (cursor !== null) { page = digest({ cursor }); cursor = page.next_cursor; }
   *     do { page = digest({ cursor }); cursor = page.next_cursor; } while (page.has_more);
   *
   * A caller that keeps a durable watermark across polls of a live stream reads
   * `next_cursor ?? cursor` — the input cursor is still reported in `cursor`, so
   * an exhausted page costs it no state.
   */
  next_cursor: number | null;
  /**
   * How `next_cursor` must be consumed, stated in the envelope so a caller never
   * has to infer it. `"exclusive"` means the next page is requested with
   * `cursor = next_cursor` and returns messages with `id > next_cursor`.
   */
  cursor_semantics: "exclusive";
  max_bytes: number;
  byte_length: number;
  limit: number;
  count: number;
  total_available: number;
  total_unread: number;
  shown: number;
  skipped_count: number;
  has_more: boolean;
  truncated: boolean;
  marked_read: number;
  compact: true;
  hint: string;
}

export interface ReadDigestOptions {
  channel?: string;
  session_id?: string;
  to?: string;
  since?: string;
  cursor?: number;
  limit?: number;
  max_bytes?: number;
  unread_only?: boolean;
  mark_read?: boolean;
  reader?: string;
  project_id?: string;
}

export const DEFAULT_DIGEST_MAX_BYTES = 8192;
export const MIN_DIGEST_MAX_BYTES = 512;
export const MAX_DIGEST_MAX_BYTES = 65536;
export const DEFAULT_DIGEST_LIMIT = 200;
export const MAX_DIGEST_LIMIT = 1000;
export const DEFAULT_DIGEST_SNIPPET_BYTES = 320;

const DIGEST_ID_PLACEHOLDER = "0000000000000000";

export function resolveDigestMaxBytes(value: unknown): number {
  if (value === undefined || value === null || value === "") return DEFAULT_DIGEST_MAX_BYTES;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_DIGEST_MAX_BYTES;
  const bytes = Math.floor(parsed);
  if (bytes < MIN_DIGEST_MAX_BYTES) {
    throw new Error(`Digest max_bytes must be at least ${MIN_DIGEST_MAX_BYTES} bytes.`);
  }
  return Math.min(bytes, MAX_DIGEST_MAX_BYTES);
}

export function resolveDigestLimit(value: unknown): number {
  if (value === undefined || value === null || value === "") return DEFAULT_DIGEST_LIMIT;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_DIGEST_LIMIT;
  return Math.min(Math.floor(parsed), MAX_DIGEST_LIMIT);
}

export function resolveDigestCursor(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

function normalizeSnippetText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateUtf8(value: string, maxBytes: number): { text: string; truncated: boolean } {
  const safeMax = Math.max(0, Math.floor(maxBytes));
  if (Buffer.byteLength(value, "utf8") <= safeMax) return { text: value, truncated: false };
  if (safeMax <= 0) return { text: "", truncated: value.length > 0 };

  const suffix = safeMax >= 3 ? "..." : "";
  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  const budget = Math.max(0, safeMax - suffixBytes);
  let used = 0;
  let text = "";
  for (const char of value) {
    const bytes = Buffer.byteLength(char, "utf8");
    if (used + bytes > budget) break;
    text += char;
    used += bytes;
  }
  return { text: `${text}${suffix}`, truncated: true };
}

function makeDigestMessage(message: Message, snippetBytes: number): DigestMessage {
  const normalized = normalizeSnippetText(message.content);
  const snippet = truncateUtf8(normalized, snippetBytes);
  const attachmentCount = message.attachments?.length ?? 0;
  return {
    id: message.id,
    from: message.from_agent,
    created_at: message.created_at,
    snippet: snippet.text,
    snippet_bytes: Buffer.byteLength(snippet.text, "utf8"),
    truncated: snippet.truncated,
    priority: message.priority,
    has_attachments: attachmentCount > 0,
    attachment_count: attachmentCount,
    channel: message.channel,
    to: message.to_agent,
    reply_to: message.reply_to,
    unread: !message.read_at,
  };
}

// `cursor_semantics` is a constant describing the protocol, not page content, so
// it stays out of the identity hash and existing digest_ids do not shift.
function digestHash(input: Omit<DigestResult, "digest_id" | "byte_length" | "hint" | "cursor_semantics">): string {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex")
    .slice(0, 16);
}

function finalizeDigestResult(result: DigestResult): DigestResult {
  const hashInput = {
    messages: result.messages,
    message_ids: result.message_ids,
    channel: result.channel,
    session_id: result.session_id,
    to: result.to,
    since: result.since,
    cursor: result.cursor,
    next_cursor: result.next_cursor,
    max_bytes: result.max_bytes,
    limit: result.limit,
    count: result.count,
    total_available: result.total_available,
    total_unread: result.total_unread,
    shown: result.shown,
    skipped_count: result.skipped_count,
    has_more: result.has_more,
    truncated: result.truncated,
    marked_read: result.marked_read,
    compact: result.compact,
  };
  const finalized = { ...result, digest_id: digestHash(hashInput) };
  for (let i = 0; i < 3; i++) {
    finalized.byte_length = Buffer.byteLength(JSON.stringify(finalized), "utf8");
  }
  return finalized;
}

function countDigestMessages(opts: {
  channel?: string;
  session_id?: string;
  to?: string;
  since?: string;
  cursor?: number;
  project_id?: string;
  unread_only?: boolean;
}): { total_available: number; total_unread: number } {
  const db = getDb();
  const baseConditions: string[] = [];
  const baseParams: (string | number)[] = [];

  if (opts.channel) { baseConditions.push("channel = ?"); baseParams.push(normalizeChannelName(opts.channel)); }
  if (opts.session_id) { baseConditions.push("session_id = ?"); baseParams.push(opts.session_id); }
  if (opts.to) { baseConditions.push("to_agent = ?"); baseParams.push(opts.to); }
  if (opts.since) { baseConditions.push("created_at > ?"); baseParams.push(opts.since); }
  if (opts.cursor !== undefined) { baseConditions.push("id > ?"); baseParams.push(opts.cursor); }
  if (opts.project_id) { baseConditions.push("project_id = ?"); baseParams.push(opts.project_id); }

  const availableConditions = opts.unread_only ? [...baseConditions, "read_at IS NULL"] : baseConditions;
  const availableWhere = availableConditions.length > 0 ? `WHERE ${availableConditions.join(" AND ")}` : "";
  const unreadWhere = `WHERE ${[...baseConditions, "read_at IS NULL"].join(" AND ")}`;
  const totalAvailable = (db.prepare(`SELECT COUNT(*) as n FROM messages ${availableWhere}`).get(...baseParams) as { n: number }).n;
  const totalUnread = (db.prepare(`SELECT COUNT(*) as n FROM messages ${unreadWhere}`).get(...baseParams) as { n: number }).n;
  return { total_available: totalAvailable, total_unread: totalUnread };
}

function queryDigestMessages(opts: {
  channel?: string;
  session_id?: string;
  to?: string;
  since?: string;
  cursor?: number;
  project_id?: string;
  unread_only?: boolean;
  limit: number;
}): Message[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (opts.channel) { conditions.push("channel = ?"); params.push(normalizeChannelName(opts.channel)); }
  if (opts.session_id) { conditions.push("session_id = ?"); params.push(opts.session_id); }
  if (opts.to) { conditions.push("to_agent = ?"); params.push(opts.to); }
  if (opts.since) { conditions.push("created_at > ?"); params.push(opts.since); }
  if (opts.cursor !== undefined) { conditions.push("id > ?"); params.push(opts.cursor); }
  if (opts.project_id) { conditions.push("project_id = ?"); params.push(opts.project_id); }
  if (opts.unread_only) conditions.push("read_at IS NULL");

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const safeLimit = Math.max(1, Math.min(Math.floor(opts.limit), MAX_DIGEST_LIMIT));
  const rows = db.prepare(
    `SELECT * FROM messages ${where} ORDER BY id ASC LIMIT ${safeLimit}`
  ).all(...params) as Record<string, unknown>[];
  return rows.map(parseMessage);
}

function buildDigestResult(opts: {
  channel: string | null;
  session_id: string | null;
  to: string | null;
  since: string | null;
  cursor: number | null;
  max_bytes: number;
  limit: number;
  total_available: number;
  total_unread: number;
  entries: DigestMessage[];
  skipped_count?: number;
  advance_cursor?: number | null;
  marked_read?: number;
}): DigestResult {
  const messageIds = opts.entries.map((message) => message.id);
  // Three cases, and the third is the one that used to spin.
  //
  //   advance_cursor   a message could not be packed even alone; the cursor MUST
  //                    step past it or the drain strands on it forever.
  //   last delivered   the ordinary page.
  //   null             this page accounted for NOTHING — no entry delivered and
  //                    nothing skipped.
  //
  // That third branch is reachable only when the underlying query returned zero
  // rows: a non-empty row set either packs a first entry or takes the
  // `advance_cursor` path, so "no entries and no skip" is exactly "nothing
  // matches `id > cursor`", i.e. the stream is EXHAUSTED. It used to echo
  // `opts.cursor` straight back, so `while (next_cursor) fetch(next_cursor)` —
  // the idiom every other paged surface in this package supports — never ended.
  //
  // Nothing is lost by returning null: the envelope still reports the input
  // cursor in its own `cursor` field, so a caller holding a durable watermark
  // recovers it as `next_cursor ?? cursor` from this same response.
  const nextCursor = opts.advance_cursor ?? (messageIds.length > 0 ? messageIds[messageIds.length - 1] : null);
  const skippedCount = opts.skipped_count ?? 0;
  const consumedCount = opts.entries.length + skippedCount;
  const hasMore = opts.total_available > consumedCount;
  return finalizeDigestResult({
    digest_id: DIGEST_ID_PLACEHOLDER,
    messages: opts.entries,
    message_ids: messageIds,
    channel: opts.channel,
    session_id: opts.session_id,
    to: opts.to,
    since: opts.since,
    cursor: opts.cursor,
    next_cursor: nextCursor ?? null,
    cursor_semantics: "exclusive",
    max_bytes: opts.max_bytes,
    byte_length: 0,
    limit: opts.limit,
    count: opts.entries.length,
    total_available: opts.total_available,
    total_unread: opts.total_unread,
    shown: opts.entries.length,
    skipped_count: skippedCount,
    has_more: hasMore,
    truncated: hasMore || skippedCount > 0,
    marked_read: opts.marked_read ?? 0,
    compact: true,
    hint: "Use show <id>; continue with next_cursor.",
  });
}

function assertDigestFits(result: DigestResult): void {
  if (result.byte_length > result.max_bytes) {
    throw new Error(`Digest envelope exceeds max_bytes (${result.byte_length} > ${result.max_bytes}); increase --max-bytes or narrow the filters.`);
  }
}

function markDigestEntriesRead(entries: DigestMessage[], reader?: string): number {
  if (entries.length === 0) return 0;
  const ids = entries.map((entry) => entry.id);
  const markedRead = markReadByIds(ids, reader);
  if (reader) markChannelNotificationsRead(reader, ids);
  return markedRead;
}

/** Normalized digest inputs shared by the local and cloud digest paths. */
export interface DigestNorm {
  channel: string | null;
  session_id?: string;
  to?: string;
  since?: string;
  cursor?: number;
  maxBytes: number;
  limit: number;
}

/** Counts a digest reports (total matching + total unread). */
export interface DigestCounts {
  total_available: number;
  total_unread: number;
}

/**
 * Result of assembling a digest page: the entries that would be marked read
 * (empty when nothing shown) and a `rebuild(markedRead)` closure that produces
 * the final DigestResult for a given marked-read count. The heavy byte-budget
 * packing is done ONCE here, storage-agnostic — the caller supplies the counts
 * and pre-fetched rows (from SQLite locally, or the cloud API), then marks the
 * entries and calls `rebuild`. This keeps the packing algorithm a single source
 * of truth across the local and HTTP digest paths.
 */
export interface DigestAssembly {
  rebuild: (markedRead: number) => DigestResult;
  markableEntries: DigestMessage[];
}

/**
 * Pure digest packer: given the normalized filters, the counts, the candidate
 * rows (id ASC), and whether mark_read was requested (so the byte budget can
 * reserve room for the marked_read counter), pack as many messages as fit under
 * `maxBytes` and return the terminal shape as a rebuild closure.
 */
export function assembleDigest(
  norm: DigestNorm,
  counts: DigestCounts,
  messages: Message[],
  markReadRequested: boolean,
): DigestAssembly {
  const build = (entries: DigestMessage[], extra: Partial<Parameters<typeof buildDigestResult>[0]> = {}): DigestResult =>
    buildDigestResult({
      channel: norm.channel,
      session_id: norm.session_id ?? null,
      to: norm.to ?? null,
      since: norm.since ?? null,
      cursor: norm.cursor ?? null,
      max_bytes: norm.maxBytes,
      limit: norm.limit,
      total_available: counts.total_available,
      total_unread: counts.total_unread,
      entries,
      ...extra,
    });

  let entries: DigestMessage[] = [];
  for (const message of messages) {
    let low = 0;
    let high = DEFAULT_DIGEST_SNIPPET_BYTES;
    let best: DigestMessage | null = null;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidateMessage = makeDigestMessage(message, mid);
      const candidate = build([...entries, candidateMessage], {
        marked_read: markReadRequested ? entries.length + 1 : 0,
      });
      if (candidate.byte_length <= norm.maxBytes) {
        best = candidateMessage;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (!best) {
      // This message does not fit alongside what is already packed.
      if (entries.length > 0) {
        // That is a PAGE BOUNDARY, not a property of the message: on a page of
        // its own it may well fit. End the page here and let `next_cursor`
        // default to the last DELIVERED id, so the caller re-reads this message
        // at the top of the next page with the whole byte budget available.
        //
        // Skipping it here is what used to lose it: `next_cursor` named the
        // skipped message while `--cursor` means `id > cursor`, so following the
        // documented protocol stepped straight past it — exactly one message
        // lost per byte-truncated page.
        //
        // Which message that was is determined by POSITION, not size: the victim
        // is whichever message lands where the REMAINING budget runs out, and
        // that remainder ranges from the full cap down to nearly zero. A short
        // message arriving at a nearly-full page is lost just as readily as a
        // long one.
        const captured = entries;
        return {
          markableEntries: captured,
          rebuild: (markedRead: number) => {
            const page = build(captured, { marked_read: markedRead });
            assertDigestFits(page);
            return page;
          },
        };
      }

      // Nothing is packed yet, so this message cannot be delivered at this
      // `max_bytes` even on a page of its own. Advancing past it is the only way
      // to make forward progress; it is reported in `skipped_count` and it is
      // the ONLY case in which `next_cursor` exceeds the last delivered id.
      const capturedAdvance = message.id;
      return {
        markableEntries: [],
        rebuild: (markedRead: number) => {
          const s = build([], {
            skipped_count: 1,
            advance_cursor: capturedAdvance,
            marked_read: markedRead,
          });
          assertDigestFits(s);
          return s;
        },
      };
    }
    entries = [...entries, best];
  }

  const captured = entries;
  return {
    markableEntries: captured,
    rebuild: (markedRead: number) => {
      const result = build(captured, { marked_read: markedRead });
      assertDigestFits(result);
      return result;
    },
  };
}

export function readDigest(opts: ReadDigestOptions = {}): DigestResult {
  const maxBytes = resolveDigestMaxBytes(opts.max_bytes);
  const limit = resolveDigestLimit(opts.limit);
  const cursor = resolveDigestCursor(opts.cursor);
  const channel = opts.channel ? normalizeChannelName(opts.channel) : null;
  if (channel) assertNotReservedHistoricalAlias(getDb(), channel);
  const counts = countDigestMessages({
    channel: channel ?? undefined,
    session_id: opts.session_id,
    to: opts.to,
    since: opts.since,
    cursor,
    project_id: opts.project_id,
    unread_only: opts.unread_only,
  });

  const messages = queryDigestMessages({
    channel: channel ?? undefined,
    session_id: opts.session_id,
    to: opts.to,
    since: opts.since,
    cursor,
    project_id: opts.project_id,
    unread_only: opts.unread_only ?? false,
    limit,
  });

  const norm: DigestNorm = { channel, session_id: opts.session_id, to: opts.to, since: opts.since, cursor, maxBytes, limit };
  const assembly = assembleDigest(norm, counts, messages, !!opts.mark_read);

  let markedRead = 0;
  if (opts.mark_read && assembly.markableEntries.length > 0) {
    markedRead = markDigestEntriesRead(assembly.markableEntries, opts.reader);
  }
  return assembly.rebuild(markedRead);
}

export function createMessageExport(opts: ExportMessagesOptions = {}): MessageExportArtifact {
  const resolved = resolveMessageExportOptions(opts);
  const startedAt = performance.now();
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (opts?.channel) {
    conditions.push("channel = ?");
    params.push(normalizeChannelName(opts.channel));
  }
  if (opts?.session_id) {
    conditions.push("session_id = ?");
    params.push(opts.session_id);
  }
  if (opts?.from) {
    conditions.push("from_agent = ?");
    params.push(opts.from);
  }
  if (opts?.since) {
    conditions.push("created_at >= ?");
    params.push(opts.since);
  }
  if (opts?.until) {
    conditions.push("created_at <= ?");
    params.push(opts.until);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db.prepare(
    `SELECT ${previewProjectionColumns()} FROM messages ${where}
     ORDER BY created_at ASC, id ASC LIMIT ${resolved.limit + 1}`,
  ).all(...params) as Record<string, unknown>[];
  assertCollectionDeadline(startedAt, resolved.timeoutMs);
  const records = rows.slice(0, resolved.limit)
    .map((row) => buildMessagePreview(row, resolved.previewBytes) as unknown as Record<string, unknown>);
  const serialized = serializeMessageExport(records, {
    format: resolved.format,
    detail: "preview",
    maxBytes: resolved.maxBytes,
    hasMore: rows.length > resolved.limit,
  });
  assertCollectionDeadline(startedAt, resolved.timeoutMs);
  return writeMessageExportArtifact(serialized, resolved, "local", "local");
}

/** Legacy direct export text, now preview-only and bounded. */
export function exportMessages(opts: ExportMessagesOptions = {}): string {
  const resolved = resolveMessageExportOptions(opts);
  const startedAt = performance.now();
  const db = getDb();
  if (opts.channel) assertNotReservedHistoricalAlias(db, normalizeChannelName(opts.channel));
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (opts.channel) { conditions.push("channel = ?"); params.push(normalizeChannelName(opts.channel)); }
  if (opts.session_id) { conditions.push("session_id = ?"); params.push(opts.session_id); }
  if (opts.from) { conditions.push("from_agent = ?"); params.push(opts.from); }
  if (opts.since) { conditions.push("created_at >= ?"); params.push(opts.since); }
  if (opts.until) { conditions.push("created_at <= ?"); params.push(opts.until); }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db.prepare(
    `SELECT ${previewProjectionColumns()} FROM messages ${where}
     ORDER BY created_at ASC, id ASC LIMIT ${resolved.limit + 1}`,
  ).all(...params) as Record<string, unknown>[];
  assertCollectionDeadline(startedAt, resolved.timeoutMs);
  return serializeMessageExport(
    rows.slice(0, resolved.limit).map((row) => buildMessagePreview(row, resolved.previewBytes) as unknown as Record<string, unknown>),
    {
      format: resolved.format,
      detail: "preview",
      maxBytes: resolved.maxBytes,
      hasMore: rows.length > resolved.limit,
    },
  ).payload;
}

export function deleteMessage(id: number, agent: string): boolean {
  const db = getDb();
  const stmt = db.prepare("DELETE FROM messages WHERE id = ? AND from_agent = ?");
  const result = stmt.run(id, agent);
  return result.changes > 0;
}

export function editMessage(id: number, agent: string, newContent: string): Message | null {
  assertMessageSize(newContent);
  assertNoSensitiveContent(newContent, "Message content");

  const db = getDb();
  const stmt = db.prepare(
    `UPDATE messages SET content = ?, edited_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE id = ? AND from_agent = ? RETURNING *`
  );
  const row = stmt.get(newContent, id, agent) as Record<string, unknown> | null;
  return row ? parseMessage(row) : null;
}

export function pinMessage(id: number): Message | null {
  const db = getDb();
  const stmt = db.prepare(
    `UPDATE messages SET pinned_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE id = ? RETURNING *`
  );
  const row = stmt.get(id) as Record<string, unknown> | null;
  return row ? parseMessage(row) : null;
}

export function unpinMessage(id: number): Message | null {
  const db = getDb();
  const stmt = db.prepare(
    `UPDATE messages SET pinned_at = NULL WHERE id = ? RETURNING *`
  );
  const row = stmt.get(id) as Record<string, unknown> | null;
  return row ? parseMessage(row) : null;
}

export function readPinnedMessagePreviews(opts?: {
  channel?: string;
  session_id?: string;
  limit?: number;
  offset?: number;
  max_bytes?: number;
  preview_bytes?: number;
  timeout_ms?: number;
  max_content_length?: number;
}): MessagePreviewPage {
  assertOptionalFilter("channel", opts?.channel);
  assertOptionalFilter("session_id", opts?.session_id);
  const startedAt = performance.now();
  const timeoutMs = resolveCollectionTimeoutMs(opts?.timeout_ms);
  const previewBytes = resolveCollectionPreviewBytes(opts?.preview_bytes ?? opts?.max_content_length);
  const db = getDb();
  const conditions: string[] = ["pinned_at IS NOT NULL"];
  const params: (string | number)[] = [];

  if (opts?.channel) {
    conditions.push("channel = ?");
    params.push(normalizeChannelName(opts.channel));
  }
  if (opts?.session_id) {
    conditions.push("session_id = ?");
    params.push(opts.session_id);
  }

  const safeLimit = resolveCollectionLimit(opts?.limit);
  const safeOffset = resolveCollectionOffset(opts?.offset);
  const rows = db.prepare(
    `SELECT ${previewProjectionColumns()} FROM messages WHERE ${conditions.join(" AND ")}
     ${pinnedOrderByClause()} LIMIT ${safeLimit + 1} OFFSET ${safeOffset}`
  ).all(...params) as Record<string, unknown>[];
  assertCollectionDeadline(startedAt, timeoutMs);
  const page = packMessagePreviewPage(rows.map((row) => buildMessagePreview(row, previewBytes)), {
    limit: safeLimit,
    cursor: safeOffset,
    max_bytes: opts?.max_bytes ?? COLLECTION_MAX_MAX_BYTES,
    timeout_ms: timeoutMs,
  });
  assertCollectionDeadline(startedAt, timeoutMs);
  return page;
}

export function getPinnedMessages(opts?: { channel?: string; session_id?: string; limit?: number; offset?: number }): Message[] {
  return readPinnedMessagePreviews(opts).messages.map(previewAsCompatibilityMessage);
}

function queryUnreadBlockerRows(agent: string, opts: { limit: number; offset: number }): Record<string, unknown>[] {
  const db = getDb();
  const tenantId = process.env.HASNA_CONVERSATIONS_TENANT_ID?.trim();
  const authorityId = process.env.HASNA_CONVERSATIONS_INCIDENT_AUTHORITY_ID?.trim();
  const anyProjection = db.prepare("SELECT 1 AS present FROM incident_projections LIMIT 1").get();
  if ((!tenantId || !authorityId) && (anyProjection || tenantId || authorityId)) {
    throw new IncidentProjectorConfigurationError(
      "Canonical blocker reads require HASNA_CONVERSATIONS_TENANT_ID and HASNA_CONVERSATIONS_INCIDENT_AUTHORITY_ID",
    );
  }
  const binding = tenantId && authorityId ? validateIncidentProjectorBinding(tenantId, authorityId) : null;
  const selectedProjection = binding
    ? db.prepare("SELECT 1 AS present FROM incident_projections WHERE tenant_id = ? AND authority_id = ? LIMIT 1")
        .get(binding.tenant_id, binding.authority_id)
    : null;
  if (anyProjection && binding && !selectedProjection) {
    throw new IncidentProjectorConfigurationError(
      "Configured incident projector tenant/authority does not match stored canonical projections",
    );
  }

  return db.prepare(`
    WITH member_channel_scopes(scope) AS (
      SELECT 'channel:' || lower(channel) FROM channel_members WHERE lower(agent) = lower(?)
      UNION
      SELECT 'channel:' || lower(alias.old_channel)
      FROM channel_rename_aliases alias
      JOIN channel_members member ON lower(member.channel) = lower(alias.current_channel)
      WHERE lower(member.agent) = lower(?)
    ),
    latest AS (
      SELECT projection.*
      FROM incident_projections projection
      JOIN (
        SELECT tenant_id, authority_id, incident_id, MAX(incident_version) AS incident_version
        FROM incident_projections
        WHERE tenant_id = ? AND authority_id = ?
        GROUP BY tenant_id, authority_id, incident_id
      ) current
        ON current.tenant_id = projection.tenant_id
       AND current.authority_id = projection.authority_id
       AND current.incident_id = projection.incident_id
       AND current.incident_version = projection.incident_version
    ),
    blocker_candidates AS (
      SELECT projection.*,
             CASE WHEN projection.status = 'superseded'
                        AND projection.superseded_by_incident_id IS NOT NULL
                        AND NOT EXISTS (
                          SELECT 1 FROM incident_projections replacement
                          WHERE replacement.tenant_id = projection.tenant_id
                            AND replacement.authority_id = projection.authority_id
                            AND replacement.incident_id = projection.superseded_by_incident_id
                            AND replacement.supersedes_incident_id = projection.incident_id
                        )
                  THEN 1 ELSE 0 END AS pending_handoff
      FROM latest projection
    ),
    projected_ids AS (
      SELECT DISTINCT message.id
      FROM blocker_candidates projection
      JOIN messages message ON message.id = projection.message_id
      JOIN incident_projection_scopes scope
        ON scope.projection_id = projection.id AND scope.scope_type = 'blocked'
      WHERE ((projection.status IN ('open','investigating','contained','monitoring') AND projection.blocking = 1)
             OR projection.pending_handoff = 1)
        AND (projection.pending_handoff = 1 OR NOT EXISTS (
          SELECT 1 FROM message_read_receipts receipt
          WHERE receipt.message_id = message.id AND lower(receipt.agent) = lower(?)
        ))
        AND (lower(scope.scope) = 'agent:' || lower(?)
             OR lower(scope.scope) IN (SELECT scope FROM member_channel_scopes)
             OR scope.scope IN (
               SELECT 'project:' || project_id FROM agent_presence
               WHERE lower(agent) = lower(?) AND project_id <> ''
             ))
    ),
    legacy_ids AS (
      SELECT message.id
      FROM messages message
      LEFT JOIN incident_projections projection ON projection.message_id = message.id
      WHERE projection.id IS NULL AND message.blocking = 1 AND message.read_at IS NULL
        AND (lower(message.to_agent) = lower(?) OR message.channel IN (
          SELECT channel FROM channel_members WHERE lower(agent) = lower(?)
        ))
    ),
    eligible_ids AS (
      SELECT id FROM projected_ids
      UNION
      SELECT id FROM legacy_ids
    )
    SELECT ${previewProjectionColumns("message")}
    FROM messages message JOIN eligible_ids eligible ON eligible.id = message.id
    ${simpleOrderByClause(BLOCKERS_LIST_ORDER, "message.")}, message.id ASC
    LIMIT ${opts.limit} OFFSET ${opts.offset}
  `).all(
    agent,
    agent,
    binding?.tenant_id ?? null,
    binding?.authority_id ?? null,
    agent,
    agent,
    agent,
    agent,
    agent,
  ) as Record<string, unknown>[];
}

export function getUnreadBlockerPreviews(
  agent: string,
  opts: { limit?: number; offset?: number; max_bytes?: number; preview_bytes?: number; timeout_ms?: number } = {},
): MessagePreviewPage {
  assertOptionalFilter("agent", agent);
  const startedAt = performance.now();
  const timeoutMs = resolveCollectionTimeoutMs(opts.timeout_ms);
  const limit = resolveCollectionLimit(opts.limit);
  const offset = resolveCollectionOffset(opts.offset);
  const previewBytes = resolveCollectionPreviewBytes(opts.preview_bytes);
  const rows = queryUnreadBlockerRows(agent, { limit: limit + 1, offset });
  assertCollectionDeadline(startedAt, timeoutMs);
  const page = packMessagePreviewPage(rows.map((row) => buildMessagePreview(row, previewBytes)), {
    limit,
    cursor: offset,
    max_bytes: opts.max_bytes,
    timeout_ms: timeoutMs,
  });
  assertCollectionDeadline(startedAt, timeoutMs);
  return page;
}

export function getUnreadBlockers(agent: string, opts?: { limit?: number; offset?: number }): Message[] {
  return getUnreadBlockerPreviews(agent, { ...opts, max_bytes: COLLECTION_MAX_MAX_BYTES })
    .messages.map(previewAsCompatibilityMessage);
}

export function getThreadReplies(messageId: number): Message[] {
  return readMessagePreviews({
    reply_to: messageId,
    order: "asc",
    limit: 100,
    max_bytes: COLLECTION_MAX_MAX_BYTES,
  }).messages.map(previewAsCompatibilityMessage);
}

const THREAD_DESCENDANT_MATCH = (alias: string): string =>
  `(${alias}.thread_id = m.id OR (${alias}.thread_id IS NULL AND ${alias}.reply_to = m.id))`;

/**
 * Thread collection (task bf381fad): roots in a channel that have received at
 * least one reply, with the FULL descendant reply count (the nested reply_to
 * chain), the last activity across the chain, the thread lifecycle status, and
 * — when a reader is supplied — that reader's per-thread unread count derived
 * from its per-message read receipts (message_read_receipts).
 */
export function listThreads(opts: ListThreadsOptions): { threads: ThreadSummary[]; count: number } {
  const db = getDb();
  const channel = normalizeChannelName(opts.channel);
  const limit = Math.min(resolveCollectionLimit(opts.limit ?? 50), 100);
  const offset = resolveCollectionOffset(opts.offset);
  const previewBytes = resolveCollectionPreviewBytes(opts.preview_bytes);
  const reader = opts.from ? opts.from.trim().toLowerCase() : null;

  const descendant = THREAD_DESCENDANT_MATCH("r");
  const replyCountSelect = `, (SELECT COUNT(*) FROM messages r WHERE ${descendant}) AS reply_count`;
  const lastActivitySelect = `, (SELECT MAX(r.created_at) FROM messages r WHERE ${descendant}) AS last_activity_at`;
  const unreadSelect = reader
    ? `, (SELECT COUNT(*) FROM messages r WHERE ${descendant} AND lower(r.from_agent) != ? AND
           NOT EXISTS (SELECT 1 FROM message_read_receipts rc WHERE rc.message_id = r.id AND rc.agent = ?)) AS unread_count`
    : "";

  // SQLite binds positionally: the unread subquery's two placeholders appear in
  // the SELECT text BEFORE the channel placeholder in WHERE, so the reader
  // params must precede the channel param in the array.
  const params: (string | number)[] = reader ? [reader, reader, channel] : [channel];

  const rows = db.prepare(
    `SELECT ${previewProjectionColumns("m")}, m.thread_id, m.thread_status
            ${replyCountSelect}${lastActivitySelect}${unreadSelect}
     FROM messages m
     WHERE m.channel = ? AND m.reply_to IS NULL
       AND EXISTS (SELECT 1 FROM messages r WHERE ${descendant})
     ORDER BY last_activity_at DESC, m.id DESC
     LIMIT ${limit} OFFSET ${offset}`,
  ).all(...params) as Record<string, unknown>[];

  const threads: ThreadSummary[] = rows.map((row) => {
    const summary: ThreadSummary = {
      root: buildMessagePreview(row, previewBytes),
      reply_count: Math.max(0, Number(row.reply_count) || 0),
      last_activity_at: String(row.last_activity_at ?? row.created_at ?? ""),
      thread_status: row.thread_status === "closed" ? "closed" : "open",
    };
    if (reader && row.unread_count != null) summary.unread_count = Math.max(0, Number(row.unread_count) || 0);
    return summary;
  });

  const totalRow = db.prepare(
    `SELECT COUNT(*) AS n FROM messages m
     WHERE m.channel = ? AND m.reply_to IS NULL
       AND EXISTS (SELECT 1 FROM messages r WHERE ${descendant})`,
  ).get(channel) as { n: number } | undefined;

  return { threads, count: Number(totalRow?.n ?? threads.length) };
}

/** Resolve a numeric message reference to its thread root id (walking reply chains). */
export function resolveThreadRootId(messageRef: number, db: Database = getDb()): number | null {
  const row = db.prepare("SELECT id, reply_to, thread_id FROM messages WHERE id = ?").get(messageRef) as
    | { id: number; reply_to: number | null; thread_id: number | null }
    | undefined;
  if (!row) return null;
  if (row.reply_to === null) return row.id;
  return row.thread_id ?? resolveThreadRootIdFor(row.id, db);
}

/**
 * Expand one thread: the root message plus every descendant reply ordered by
 * creation, each annotated with its nesting depth (0 = direct reply to the
 * root). A reference to a REPLY resolves to its chain root, so any member of a
 * thread can be handed to `expand`.
 */
export function getThreadExpand(messageRef: number): ThreadExpandResult {
  const db = getDb();
  const rootId = resolveThreadRootId(messageRef, db);
  if (rootId === null) throw new Error(`Message ${messageRef} not found.`);

  const rootRow = db.prepare(`SELECT * FROM messages WHERE id = ?`).get(rootId) as Record<string, unknown> | undefined;
  if (!rootRow) throw new Error(`Thread root ${rootId} not found.`);
  const root = parseMessage(rootRow);

  const replyRows = db.prepare(
    `SELECT * FROM messages
     WHERE (thread_id = ? OR (thread_id IS NULL AND reply_to = ?))
     ORDER BY created_at ASC, id ASC`,
  ).all(rootId, rootId) as Record<string, unknown>[];

  const depthById = new Map<number, number>();
  const replies = replyRows.map((row) => {
    const message = parseMessage(row);
    if (message.reply_to === rootId) {
      depthById.set(message.id, 0);
    } else if (message.reply_to !== null && depthById.has(message.reply_to)) {
      depthById.set(message.id, (depthById.get(message.reply_to) ?? 0) + 1);
    } else {
      depthById.set(message.id, 0);
    }
    return { message, depth: depthById.get(message.id) ?? 0 };
  });

  return {
    root,
    thread_status: root.thread_status === "closed" ? "closed" : "open",
    reply_count: replies.length,
    replies,
  };
}

/** Close or reopen a thread by toggling thread_status on its root. */
export function setThreadStatus(messageRef: number, status: ThreadStatus): Message {
  const db = getDb();
  const rootId = resolveThreadRootId(messageRef, db);
  if (rootId === null) throw new Error(`Message ${messageRef} not found.`);
  const updated = db.prepare(
    "UPDATE messages SET thread_status = ? WHERE id = ? RETURNING *",
  ).get(status, rootId) as Record<string, unknown> | undefined;
  if (!updated) throw new Error(`Thread root ${rootId} not found.`);
  return parseMessage(updated);
}

/** Per-agent unread count for one thread: foreign replies with no read receipt. */
export function getThreadUnreadCount(messageRef: number, agent: string): number {
  const db = getDb();
  const rootId = resolveThreadRootId(messageRef, db);
  if (rootId === null) throw new Error(`Message ${messageRef} not found.`);
  const normalized = agent.trim().toLowerCase();
  const descendant = THREAD_DESCENDANT_MATCH("r");
  const row = db.prepare(
    `SELECT COUNT(*) AS n FROM messages r
     WHERE ${descendant} AND lower(r.from_agent) != ?
       AND NOT EXISTS (SELECT 1 FROM message_read_receipts rc WHERE rc.message_id = r.id AND rc.agent = ?)`,
  ).get(rootId, rootId, normalized, normalized) as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

/**
 * Which ordering `searchMessages` will actually apply, so a caller can DISCLOSE
 * it instead of guessing. Kept beside the query it describes and asserted
 * end-to-end against real row order in `src/cli/list-ordering.e2e.test.ts`,
 * because a disclosure that can drift from its query is a lie with a delay.
 */
export function describeSearchOrder(sort?: string | null): SortDescriptor {
  return sort === "recent" ? SEARCH_RECENT_ORDER : SEARCH_RELEVANCE_ORDER;
}

function searchMessagesFullRowsInternal(opts: SearchMessagesOptions): SearchResult[] {
  const db = getDb();
  const since = opts.since === undefined ? undefined : normalizeExactIsoTimestamp(opts.since, "search since timestamp");

  const limit = Number.isFinite(opts.limit) && (opts.limit as number) > 0
    ? Math.floor(opts.limit as number)
    : 20;
  const offset = Number.isFinite(opts.offset) && (opts.offset as number) > 0
    ? Math.floor(opts.offset as number)
    : 0;
  const sortByRelevance = opts.sort !== "recent";

  // Priority weight map for scoring boost
  const priorityWeights: Record<string, number> = { urgent: 10, high: 5, normal: 1, low: 0.5 };

  // Try FTS5 first for proper full-text search with BM25 ranking
  try {
    const ftsParams: (string | number)[] = [];

    // Build FTS match expression — support phrase queries and prefix matching
    const query = opts.query.trim();
    let ftsQuery: string;
    if (query.startsWith('"') && query.endsWith('"')) {
      // Exact phrase query — pass through
      ftsQuery = query;
    } else {
      // Quote each word for prefix matching
      const words = query.split(/\s+/).filter(Boolean);
      ftsQuery = words.map((w) => `"${w.replace(/"/g, '""')}"`).join(" ");
    }

    ftsParams.push(ftsQuery);

    let extraWhere = "";
    if (opts.channel) { extraWhere += " AND m.channel = ?"; ftsParams.push(normalizeChannelName(opts.channel)); }
    if (opts.from) { extraWhere += " AND m.from_agent = ?"; ftsParams.push(opts.from); }
    if (opts.to) { extraWhere += " AND m.to_agent = ?"; ftsParams.push(opts.to); }
    if (since) { extraWhere += " AND m.created_at >= ?"; ftsParams.push(since); }
    if (opts.until) { extraWhere += " AND m.created_at <= ?"; ftsParams.push(opts.until); }

    const orderClause = sortByRelevance ? "ORDER BY rank" : "ORDER BY m.created_at DESC, m.id DESC";

    const rows = db.prepare(
      `SELECT m.*, rank,
        snippet(messages_fts, 0, '**', '**', '...', 20) as snippet
       FROM messages m
       JOIN messages_fts ON messages_fts.rowid = m.id
       WHERE messages_fts MATCH ?${extraWhere}
       ${orderClause} LIMIT ${limit} OFFSET ${offset}`
    ).all(...ftsParams) as Record<string, unknown>[];

    // Normalize: FTS5 rank is negative (closer to 0 = better). Convert to positive scale.
    const maxRank = rows.reduce((max, r) => Math.max(max, Math.abs(r.rank as number || 0)), 0) || 1;

    return rows.map((row) => {
      const msg = parseMessage(row);
      // Normalize FTS rank to 0-100 scale (higher = more relevant)
      const ftsScore = maxRank > 0 ? (Math.abs(row.rank as number || 0) / maxRank) * 100 : 50;
      const priorityBoost = priorityWeights[msg.priority] || 1;
      const pinnedBoost = msg.pinned_at ? 20 : 0;
      const blockingBoost = msg.blocking ? 15 : 0;
      const relevance_score = Math.round((ftsScore * priorityBoost + pinnedBoost + blockingBoost) * 100) / 100;
      return { ...msg, snippet: buildSearchSnippet(msg), relevance_score };
    });
  } catch {
    // Fallback to LIKE if FTS not available
  }

  // LIKE fallback
  const conditions: string[] = ["content LIKE ?"];
  const params: (string | number)[] = [`%${opts.query}%`];

  if (opts.channel) { conditions.push("channel = ?"); params.push(normalizeChannelName(opts.channel)); }
  if (opts.from) { conditions.push("from_agent = ?"); params.push(opts.from); }
  if (opts.to) { conditions.push("to_agent = ?"); params.push(opts.to); }
  if (since) { conditions.push("created_at >= ?"); params.push(since); }
  if (opts.until) { conditions.push("created_at <= ?"); params.push(opts.until); }

  const where = `WHERE ${conditions.join(" AND ")}`;

  const rows = db.prepare(
    `SELECT * FROM messages ${where} ORDER BY created_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`
  ).all(...params) as Record<string, unknown>[];

  return rows.map((row) => {
    const msg = parseMessage(row);
    return { ...msg, snippet: buildSearchSnippet(msg), relevance_score: 0 };
  });
}

/** Search inside SQLite while returning only bounded preview projections. */
export function searchMessagePreviews(opts: SearchMessagePreviewsOptions): MessagePreviewPage {
  assertOptionalFilter("query", opts.query);
  assertOptionalFilter("channel", opts.channel);
  assertOptionalFilter("from", opts.from);
  assertOptionalFilter("to", opts.to);
  const since = opts.since === undefined ? undefined : normalizeExactIsoTimestamp(opts.since, "search since timestamp");
  assertOptionalDate("until", opts.until);
  if (since && opts.until && Date.parse(since) > Date.parse(opts.until)) {
    throw new Error("since must not be later than until");
  }
  const startedAt = performance.now();
  const timeoutMs = resolveCollectionTimeoutMs(opts.timeout_ms);
  const limit = resolveCollectionLimit(opts.limit);
  const offset = resolveCollectionOffset(opts.offset);
  const previewBytes = resolveCollectionPreviewBytes(opts.preview_bytes ?? opts.snippet_length);
  const db = getDb();
  if (opts.channel) assertNotReservedHistoricalAlias(db, normalizeChannelName(opts.channel));
  const sortByRelevance = opts.sort !== "recent";

  try {
    const params: (string | number)[] = [];
    const query = opts.query.trim();
    const ftsQuery = query.startsWith('"') && query.endsWith('"')
      ? query
      : query.split(/\s+/).filter(Boolean).map((word) => `"${word.replace(/"/g, '""')}"`).join(" ");
    params.push(ftsQuery);
    const clauses: string[] = [];
    if (opts.channel) { clauses.push("m.channel = ?"); params.push(normalizeChannelName(opts.channel)); }
    if (opts.from) { clauses.push("m.from_agent = ?"); params.push(opts.from); }
    if (opts.to) { clauses.push("m.to_agent = ?"); params.push(opts.to); }
    if (since) { clauses.push("m.created_at >= ?"); params.push(since); }
    if (opts.until) { clauses.push("m.created_at <= ?"); params.push(opts.until); }
    const extra = clauses.length > 0 ? ` AND ${clauses.join(" AND ")}` : "";
    const order = sortByRelevance ? "ORDER BY rank" : "ORDER BY m.created_at DESC, m.id DESC";
    const rows = db.prepare(
      `SELECT ${previewProjectionColumns("m")}, ABS(rank) AS relevance_score
       FROM messages m JOIN messages_fts ON messages_fts.rowid = m.id
       WHERE messages_fts MATCH ?${extra} ${order} LIMIT ${limit + 1} OFFSET ${offset}`,
    ).all(...params) as Record<string, unknown>[];
    assertCollectionDeadline(startedAt, timeoutMs);
    return packMessagePreviewPage(rows.map((row) => buildMessagePreview(row, previewBytes)), {
      limit,
      cursor: offset,
      max_bytes: opts.max_bytes,
      timeout_ms: timeoutMs,
      query: opts.query,
    });
  } catch (error) {
    if (error instanceof Error && (error.message.includes("max_bytes") || error.message.includes("timeout_ms") || error.message.includes("envelope exceeds"))) {
      throw error;
    }
  }

  const conditions: string[] = ["content LIKE ?"];
  const params: (string | number)[] = [`%${opts.query}%`];
  if (opts.channel) { conditions.push("channel = ?"); params.push(normalizeChannelName(opts.channel)); }
  if (opts.from) { conditions.push("from_agent = ?"); params.push(opts.from); }
  if (opts.to) { conditions.push("to_agent = ?"); params.push(opts.to); }
  if (since) { conditions.push("created_at >= ?"); params.push(since); }
  if (opts.until) { conditions.push("created_at <= ?"); params.push(opts.until); }
  const rows = db.prepare(
    `SELECT ${previewProjectionColumns()}, 0 AS relevance_score FROM messages
     WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ${limit + 1} OFFSET ${offset}`,
  ).all(...params) as Record<string, unknown>[];
  assertCollectionDeadline(startedAt, timeoutMs);
  return packMessagePreviewPage(rows.map((row) => buildMessagePreview(row, previewBytes)), {
    limit,
    cursor: offset,
    max_bytes: opts.max_bytes,
    timeout_ms: timeoutMs,
    query: opts.query,
  });
}

/** Public compatibility search: preview text only, never raw rows. */
export function searchMessages(opts: SearchMessagesOptions): SearchResult[] {
  return searchMessagePreviews({
    ...opts,
    preview_bytes: opts.snippet_length,
    max_bytes: COLLECTION_MAX_MAX_BYTES,
  }).messages.map((preview) => ({
    ...previewAsCompatibilityMessage(preview),
    snippet: preview.preview,
    relevance_score: preview.relevance_score ?? 0,
  }));
}

/** The limit `searchMessages` applies when a caller passes none. */
export const DEFAULT_SEARCH_LIMIT = 20;

/**
 * `searchMessages`, plus a truthful answer to "is there more?".
 *
 * Over-fetches one row beyond the requested limit and reports the extra rather
 * than returning it — the same shape `pageFromQuery` already uses for every
 * other listing verb, so a reader who knows one knows this one.
 */
export function searchMessagesPage(opts: SearchMessagesOptions): SearchMessagesPage {
  const limit = Number.isFinite(opts.limit) && (opts.limit as number) > 0
    ? Math.floor(opts.limit as number)
    : DEFAULT_SEARCH_LIMIT;
  const offset = Number.isFinite(opts.offset) && (opts.offset as number) > 0
    ? Math.floor(opts.offset as number)
    : 0;
  const rows = searchMessages({ ...opts, limit: limit + 1, offset });
  const has_more = rows.length > limit;
  const items = has_more ? rows.slice(0, limit) : rows;
  return {
    items,
    has_more,
    next_cursor: has_more ? offset + items.length : null,
    effective_limit: limit,
  };
}

export interface UnreadCount {
  channel: string;
  unread_count: number;
  latest_message_at: string | null;
}

/**
 * Get unread message counts per channel — lightweight alternative to read_messages.
 * Returns only channels where the agent is a member (via channel_members) or has received messages.
 * If agent is omitted, returns counts for all channels.
 */
export function listUnreadCounts(agent?: string): UnreadCount[] {
  const db = getDb();

  if (agent) {
    const rows = db.prepare(`
      SELECT
        channel,
        COUNT(CASE WHEN read_at IS NULL AND from_agent != ? THEN 1 END) AS unread_count,
        MAX(created_at) AS latest_message_at
      FROM messages
      WHERE channel IN (
        SELECT DISTINCT channel FROM channel_members WHERE agent = ?
        UNION
        SELECT DISTINCT channel FROM messages WHERE to_agent = ? AND channel IS NOT NULL
      )
      GROUP BY channel
      HAVING COUNT(*) > 0
      ORDER BY unread_count DESC, latest_message_at DESC
    `).all(agent, agent, agent) as Array<{ channel: string; unread_count: number; latest_message_at: string | null }>;
    return rows;
  }

  const rows = db.prepare(`
    SELECT
      channel,
      COUNT(CASE WHEN read_at IS NULL THEN 1 END) AS unread_count,
      MAX(created_at) AS latest_message_at
    FROM messages
    WHERE channel IS NOT NULL
    GROUP BY channel
    HAVING COUNT(*) > 0
    ORDER BY unread_count DESC, latest_message_at DESC
  `).all() as Array<{ channel: string; unread_count: number; latest_message_at: string | null }>;
  return rows;
}

// ── @mention support ──────────────────────────────────────────────────────────

/** Extract @agentname mentions from message content. Returns unique agent names (lowercase). */
export function parseMentions(content: string): string[] {
  const matches = content.match(/@([a-zA-Z0-9_-]+)/g) ?? [];
  return [...new Set(matches.map((m) => m.slice(1).toLowerCase()))];
}

/** Store mention records and send DM notifications to each mentioned agent. */
async function processMentions(
  messageId: number,
  fromAgent: string,
  channel: string,
  mentionedAgents: string[],
  db: ReturnType<typeof getDb>
): Promise<void> {
  const stmt = db.prepare(
    "INSERT INTO message_mentions (message_id, mentioned_agent, from_agent, channel) VALUES (?, ?, ?, ?)"
  );
  for (const agent of mentionedAgents) {
    try {
      stmt.run(messageId, agent, fromAgent, channel);
      // Send DM notification
      if (agent !== fromAgent.toLowerCase()) {
        sendMessage({
          from: fromAgent,
          to: agent,
          content: `You were mentioned in #${channel} by ${fromAgent} (message #${messageId})`,
          metadata: { type: "mention_notification", source_message_id: messageId, channel },
        });
      }
    } catch { /* ignore duplicate/error */ }
  }
}

export interface MentionCount {
  channel: string;
  unread_count: number;
  mention_count: number;
  latest_message_at: string | null;
}

/** Get unread counts AND mention counts per channel for an agent. */
export function listUnreadCountsWithMentions(agent: string): MentionCount[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      channel,
      COUNT(CASE WHEN read_at IS NULL AND from_agent != ? THEN 1 END) AS unread_count,
      (SELECT COUNT(*) FROM message_mentions mm WHERE mm.channel = m.channel AND mm.mentioned_agent = ? AND mm.notified_at IS NULL) AS mention_count,
      MAX(created_at) AS latest_message_at
    FROM messages m
    WHERE channel IN (
      SELECT DISTINCT channel FROM channel_members WHERE agent = ?
      UNION
      SELECT DISTINCT channel FROM messages WHERE to_agent = ? AND channel IS NOT NULL
    )
    GROUP BY channel
    HAVING COUNT(*) > 0
    ORDER BY mention_count DESC, unread_count DESC, latest_message_at DESC
  `).all(agent, agent, agent, agent) as MentionCount[];
  return rows;
}

/** Dedicated bounded mention projection keyed by mention id and notified_at. */
export function readMentionPreviews(agent: string, opts: ReadMentionPreviewsOptions = {}): MessagePreviewPage {
  assertOptionalFilter("agent", agent);
  assertOptionalFilter("channel", opts.channel);
  const startedAt = performance.now();
  const timeoutMs = resolveCollectionTimeoutMs(opts.timeout_ms);
  const limit = resolveCollectionLimit(opts.limit ?? 50);
  const offset = resolveCollectionOffset(opts.offset);
  const previewBytes = resolveCollectionPreviewBytes(opts.preview_bytes);
  const db = getDb();
  const conditions = ["mm.mentioned_agent = ?"];
  const params: (string | number)[] = [agent.toLowerCase()];
  if (opts.channel) { conditions.push("m.channel = ?"); params.push(normalizeChannelName(opts.channel)); }
  if (opts.unread_only) conditions.push("mm.notified_at IS NULL");
  const rows = db.prepare(
    `SELECT ${previewProjectionColumns("m")}, mm.id AS mention_id,
            CASE WHEN mm.notified_at IS NULL THEN 1 ELSE 0 END AS unread
     FROM messages m
     JOIN message_mentions mm ON mm.message_id = m.id
     WHERE ${conditions.join(" AND ")}
     ORDER BY m.created_at DESC, m.id DESC LIMIT ${limit + 1} OFFSET ${offset}`
  ).all(...params) as Record<string, unknown>[];
  assertCollectionDeadline(startedAt, timeoutMs);
  const page = packMessagePreviewPage(rows.map((row) => buildMessagePreview(row, previewBytes)), {
    limit,
    cursor: offset,
    max_bytes: opts.max_bytes,
    timeout_ms: timeoutMs,
  });
  assertCollectionDeadline(startedAt, timeoutMs);
  return page;
}

/** Bounded compatibility reader for mention collections. */
export function getMessagesForAgent(agent: string, opts?: { channel?: string; unread_only?: boolean; limit?: number }): Array<{ message: Message; mention_id: number }> {
  const page = readMentionPreviews(agent, { ...opts, max_bytes: COLLECTION_MAX_MAX_BYTES });
  return page.messages.map((preview) => ({
    message: previewAsCompatibilityMessage(preview),
    mention_id: preview.mention_id!,
  }));
}

/** Mark only mention rows returned to the named agent. */
export function markMentionsReadByIds(agent: string, mentionIds: number[]): number {
  assertOptionalFilter("agent", agent);
  if (mentionIds.length === 0) return 0;
  if (mentionIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error("mention_ids must contain only positive integers");
  }
  const db = getDb();
  const placeholders = mentionIds.map(() => "?").join(",");
  const result = db.prepare(
    `UPDATE message_mentions
     SET notified_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
     WHERE mentioned_agent = ? AND id IN (${placeholders}) AND notified_at IS NULL`,
  ).run(agent.toLowerCase(), ...mentionIds);
  return result.changes;
}

/** Mark mentions as notified (agent has seen them). */
export function markMentionsRead(agent: string, channel?: string): number {
  const db = getDb();
  if (channel) {
    const normalized = normalizeChannelName(channel);
    const result = db.prepare(
      "UPDATE message_mentions SET notified_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE mentioned_agent = ? AND channel = ? AND notified_at IS NULL"
    ).run(agent, normalized);
    return result.changes;
  }
  const result = db.prepare(
    "UPDATE message_mentions SET notified_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE mentioned_agent = ? AND notified_at IS NULL"
  ).run(agent);
  return result.changes;
}

/** Mark a specific message as unread (resets read_at to null). */
export function markUnread(messageId: number): number {
  const db = getDb();
  const result = db.prepare(
    "UPDATE messages SET read_at = NULL WHERE id = ?"
  ).run(messageId);
  return result.changes;
}

/** Mark multiple messages as unread. */
export function markUnreadByIds(ids: number[]): number {
  if (ids.length === 0) return 0;
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  const result = db.prepare(
    `UPDATE messages SET read_at = NULL WHERE id IN (${placeholders})`
  ).run(...ids);
  return result.changes;
}

// ── Per-agent read receipts ───────────────────────────────────────────────────

export interface ReadReceipt {
  message_id: number;
  agent: string;
  read_at: string;
}

/** Record that an agent has read a specific message. */
export function recordReadReceipt(messageId: number, agent: string): void {
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO message_read_receipts (message_id, agent, read_at)
     VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%f', 'now'))`
  ).run(messageId, agent.toLowerCase());
}

/** Record read receipts for all messages in a batch. */
export function recordReadReceiptsBatch(messageIds: number[], agent: string): void {
  if (!messageIds.length || !agent) return;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO message_read_receipts (message_id, agent, read_at)
     VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%f', 'now'))`
  );
  for (const id of messageIds) {
    stmt.run(id, agent.toLowerCase());
  }
}

/** Get all read receipts for a specific message. */
export function getReadReceipts(messageId: number): ReadReceipt[] {
  const db = getDb();
  return db.prepare(
    "SELECT * FROM message_read_receipts WHERE message_id = ? ORDER BY read_at ASC"
  ).all(messageId) as ReadReceipt[];
}

/** Get read status summary for a channel message: who has read it and who hasn't. */
export function getMessageReadStatus(
  messageId: number,
  channel: string
): { receipts: ReadReceipt[]; unread_by: string[] } {
  const db = getDb();
  const normalized = normalizeChannelName(channel);
  const receipts = getReadReceipts(messageId);
  const readers = new Set(receipts.map((r) => r.agent));
  const members = db.prepare(
    "SELECT agent FROM channel_members WHERE channel = ?"
  ).all(normalized) as { agent: string }[];
  const unread_by = members.map((m) => m.agent).filter((a) => !readers.has(a.toLowerCase()));
  return { receipts, unread_by };
}
