import { createHash, randomUUID } from "crypto";
import type {
  ChannelMergePlan,
  ChannelMergeReceipt,
  ChannelMergeRollbackResult,
} from "../types.js";
import { normalizeChannelName } from "./channel-names.js";
import { getDb, type ConversationsDatabase } from "./db.js";
import { acquireLock, releaseLock } from "./locks.js";

export const CHANNEL_MERGE_RECEIPTS_TABLE = "channel_merge_receipts";

export interface ChannelMergeOptions {
  source_channel: string;
  destination_channel: string;
  archive_source?: boolean;
}

export interface ApplyChannelMergeOptions extends ChannelMergeOptions {
  expected_revision: string;
  idempotency_key: string;
  /** Identity that acquires and releases the channel locks around the apply. */
  agent_id?: string;
}

export interface RollbackChannelMergeOptions {
  receipt_id: string;
  expected_revision: string;
  idempotency_key: string;
  apply: boolean;
}

/** Message columns whose values survive the merge untouched. */
const MERGE_PRESERVED_COLUMNS = [
  "id", "uuid", "from_agent", "project_id", "content", "priority",
  "working_dir", "repository", "branch", "metadata", "edited_at",
  "pinned_at", "blocking", "attachments", "reply_to", "created_at", "read_at",
] as const;

/** Every message column; the full-row hash detects any row change. */
const MERGE_FULL_COLUMNS = [
  ...MERGE_PRESERVED_COLUMNS,
  "session_id", "to_agent", "channel",
] as const;

type MergeMessageRow = Record<string, unknown> & { id: number; uuid: string; channel: string | null };

type StoredMergeReceipt = {
  id: string;
  idempotency_key: string;
  operation: "apply" | "rollback";
  source_channel: string;
  destination_channel: string;
  source_receipt_id: string | null;
  request_hash: string;
  payload: string;
  created_at: string;
};

export interface MergeGraphEdge extends Record<string, unknown> {
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  relation: string;
  weight: number;
  metadata: string | null;
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(input).sort().map((key) => [key, canonicalize(input[key])]));
  }
  if (typeof value === "bigint") return value.toString();
  return value ?? null;
}

export function stableChannelMergeHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function preservedRow(row: MergeMessageRow): Record<string, unknown> {
  return Object.fromEntries(
    MERGE_PRESERVED_COLUMNS.map((column) => [column, row[column] ?? null]),
  );
}

function fullRow(row: MergeMessageRow): Record<string, unknown> {
  return Object.fromEntries(
    MERGE_FULL_COLUMNS.map((column) => [column, row[column] ?? null]),
  );
}

function columnList(columns: readonly string[]): string {
  return columns.join(", ");
}

interface MergeChannelState {
  source: string;
  destination: string;
  sourceProjectId: string | null;
  destinationProjectId: string | null;
  sourceMessages: MergeMessageRow[];
  sourceMembers: string[];
  destinationMembers: string[];
  sourceSubscriptions: string[];
  destinationSubscriptions: string[];
}

function readState(db: ConversationsDatabase, source: string, destination: string): MergeChannelState {
  const sourceRow = db.prepare("SELECT project_id FROM channels WHERE name = ?").get(source) as {
    project_id: string | null;
  } | null;
  if (!sourceRow) throw new Error(`Channel not found: ${source}`);
  const destinationRow = db.prepare("SELECT project_id FROM channels WHERE name = ?").get(destination) as {
    project_id: string | null;
  } | null;
  if (!destinationRow) throw new Error(`Channel not found: ${destination}`);
  const sourceMessages = db.prepare(
    `SELECT ${columnList(MERGE_FULL_COLUMNS)} FROM messages WHERE channel = ? ORDER BY id ASC`,
  ).all(source) as MergeMessageRow[];
  const sourceMembers = (db.prepare(
    "SELECT agent FROM channel_members WHERE channel = ? ORDER BY agent",
  ).all(source) as Array<{ agent: string }>).map((row) => row.agent);
  const destinationMembers = (db.prepare(
    "SELECT agent FROM channel_members WHERE channel = ? ORDER BY agent",
  ).all(destination) as Array<{ agent: string }>).map((row) => row.agent);
  const sourceSubscriptions = (db.prepare(
    "SELECT agent FROM channel_subscriptions WHERE channel = ? ORDER BY agent",
  ).all(source) as Array<{ agent: string }>).map((row) => row.agent);
  const destinationSubscriptions = (db.prepare(
    "SELECT agent FROM channel_subscriptions WHERE channel = ? ORDER BY agent",
  ).all(destination) as Array<{ agent: string }>).map((row) => row.agent);
  return {
    source,
    destination,
    sourceProjectId: sourceRow.project_id,
    destinationProjectId: destinationRow.project_id,
    sourceMessages,
    sourceMembers,
    destinationMembers,
    sourceSubscriptions,
    destinationSubscriptions,
  };
}

function mergedRevision(state: MergeChannelState): string {
  return stableChannelMergeHash({
    source_channel: state.source,
    destination_channel: state.destination,
    source_project_id: state.sourceProjectId,
    destination_project_id: state.destinationProjectId,
    source_messages: state.sourceMessages.map((row) => ({
      id: Number(row.id),
      uuid: String(row.uuid),
      preserved_hash: stableChannelMergeHash(preservedRow(row)),
    })),
    source_members: state.sourceMembers,
    destination_members: state.destinationMembers,
    source_subscriptions: state.sourceSubscriptions,
    destination_subscriptions: state.destinationSubscriptions,
  });
}

interface MergePostState {
  destinationMessages: MergeMessageRow[];
  destinationMembers: string[];
  destinationSubscriptions: string[];
  source: string;
  destination: string;
  sourceProjectId: string | null;
  destinationProjectId: string | null;
}

function readPostState(db: ConversationsDatabase, source: string, destination: string): MergePostState {
  const destinationMessages = db.prepare(
    `SELECT ${columnList(MERGE_FULL_COLUMNS)} FROM messages WHERE channel = ? ORDER BY id ASC`,
  ).all(destination) as MergeMessageRow[];
  const destinationMembers = (db.prepare(
    "SELECT agent FROM channel_members WHERE channel = ? ORDER BY agent",
  ).all(destination) as Array<{ agent: string }>).map((row) => row.agent);
  const destinationSubscriptions = (db.prepare(
    "SELECT agent FROM channel_subscriptions WHERE channel = ? ORDER BY agent",
  ).all(destination) as Array<{ agent: string }>).map((row) => row.agent);
  const sourceProjectId = (db.prepare("SELECT project_id FROM channels WHERE name = ?").get(source) as {
    project_id: string | null;
  }).project_id;
  const destinationProjectId = (db.prepare("SELECT project_id FROM channels WHERE name = ?").get(destination) as {
    project_id: string | null;
  }).project_id;
  return {
    destinationMessages,
    destinationMembers,
    destinationSubscriptions,
    source,
    destination,
    sourceProjectId,
    destinationProjectId,
  };
}

function postRevision(state: MergePostState): string {
  return stableChannelMergeHash({
    source_channel: state.source,
    destination_channel: state.destination,
    source_project_id: state.sourceProjectId,
    destination_project_id: state.destinationProjectId,
    source_messages: [],
    destination_messages: state.destinationMessages.map((row) => ({
      id: Number(row.id),
      uuid: String(row.uuid),
      hash: stableChannelMergeHash(fullRow(row)),
    })),
    destination_members: state.destinationMembers,
    destination_subscriptions: state.destinationSubscriptions,
  });
}

function memberOverlap(sourceMembers: string[], destinationMembers: string[]): string[] {
  const destinationSet = new Set(destinationMembers);
  return sourceMembers.filter((agent) => destinationSet.has(agent));
}

/**
 * Collision and ambiguity checks shared by plan and apply. Every refusal is
 * decided from a read of the current store state; nothing here writes.
 */
function assertMergeSafe(
  db: ConversationsDatabase,
  state: MergeChannelState,
): void {
  const memberOverlaps = memberOverlap(state.sourceMembers, state.destinationMembers);
  if (memberOverlaps.length > 0) {
    throw new Error(
      `Channel merge refused: member overlap with #${state.destination}: ${memberOverlaps.join(", ")}.`,
    );
  }
  const subscriptionOverlaps = memberOverlap(state.sourceSubscriptions, state.destinationSubscriptions);
  if (subscriptionOverlaps.length > 0) {
    throw new Error(
      `Channel merge refused: subscription overlap with #${state.destination}: ${subscriptionOverlaps.join(", ")}.`,
    );
  }
  if (
    state.sourceProjectId !== null &&
    state.destinationProjectId !== null &&
    state.sourceProjectId !== state.destinationProjectId
  ) {
    throw new Error(
      `Channel merge refused: channels belong to different projects (${state.sourceProjectId} vs ${state.destinationProjectId}).`,
    );
  }
  const stranded = db.prepare(
    `SELECT COUNT(*) AS n FROM messages
     WHERE channel IS NOT NULL AND channel <> ? AND channel <> ?
       AND reply_to IN (SELECT id FROM messages WHERE channel = ?)`,
  ).get(state.source, state.destination, state.source) as { n: number };
  if (stranded.n > 0) {
    throw new Error(
      `Channel merge refused: ${stranded.n} message(s) in a third channel reply to a #${state.source} message.`,
    );
  }
}

function readAliasCurrent(db: ConversationsDatabase, oldChannel: string): string | null {
  const row = db.prepare(
    "SELECT current_channel FROM channel_rename_aliases WHERE old_channel = ?",
  ).get(oldChannel) as { current_channel: string } | null;
  return row?.current_channel ?? null;
}

function readHeldByOther(db: ConversationsDatabase, source: string, destination: string): string | null {
  const row = db.prepare(
    `SELECT agent_id FROM resource_locks
     WHERE resource_type = 'channel' AND resource_id IN (?, ?)
     ORDER BY locked_at ASC LIMIT 1`,
  ).get(source, destination) as { agent_id: string } | null;
  return row?.agent_id ?? null;
}

function buildPlan(state: MergeChannelState, archiveSource = false): ChannelMergePlan {
  const ordered = state.sourceMessages.slice().sort((a, b) => Number(a.id) - Number(b.id));
  const ids = ordered.map((row) => Number(row.id));
  return {
    operation: "merge",
    dry_run: true,
    source_channel: state.source,
    destination_channel: state.destination,
    archive_source: archiveSource,
    revision: mergedRevision(state),
    source_message_count: ordered.length,
    moved_message_count: ordered.length,
    message_ids: ids,
    message_uuids: ordered.map((row) => String(row.uuid)),
    message_id_min: ids.length > 0 ? Math.min(...ids) : null,
    message_id_max: ids.length > 0 ? Math.max(...ids) : null,
  };
}

export function planChannelMerge(
  options: ChannelMergeOptions,
  internal: { skipLockCheck?: boolean } = {},
): ChannelMergePlan {
  const db = getDb();
  const source = normalizeChannelName(options.source_channel);
  const destination = normalizeChannelName(options.destination_channel);
  if (source === destination) {
    throw new Error(`Channel merge refused: source and destination must differ (both normalize to ${source}).`);
  }
  // Destination must not be a reserved historical alias of a third channel.
  const aliasCurrent = readAliasCurrent(db, destination);
  if (aliasCurrent !== null && aliasCurrent !== source) {
    throw new Error(
      `Channel merge refused: #${destination} is a reserved historical alias for #${aliasCurrent}.`,
    );
  }
  // The plan refuses any held lock (a plan under contention is untrustworthy).
  // The apply path skips this check and relies on acquireLock, which refuses
  // only locks held by ANOTHER agent and refreshes the operator's own lock.
  if (!internal.skipLockCheck) {
    const heldBy = readHeldByOther(db, source, destination);
    if (heldBy !== null) {
      throw new Error(`Channel merge refused: #${source} or #${destination} is locked by ${heldBy}.`);
    }
  }
  const state = readState(db, source, destination);
  assertMergeSafe(db, state);
  return buildPlan(state, options.archive_source === true);
}

function receiptByIdempotencyKey(db: ConversationsDatabase, key: string): StoredMergeReceipt | null {
  return db.prepare(
    `SELECT * FROM ${CHANNEL_MERGE_RECEIPTS_TABLE} WHERE idempotency_key = ?`,
  ).get(key) as StoredMergeReceipt | null;
}

function receiptById(db: ConversationsDatabase, id: string): StoredMergeReceipt | null {
  return db.prepare(
    `SELECT * FROM ${CHANNEL_MERGE_RECEIPTS_TABLE} WHERE id = ?`,
  ).get(id) as StoredMergeReceipt | null;
}

function replayOrReject<T extends { replayed?: boolean }>(existing: StoredMergeReceipt, requestHash: string): T {
  if (existing.request_hash !== requestHash) {
    throw new Error(`Idempotency key was already used with a different request.`);
  }
  return { ...(JSON.parse(existing.payload) as T), replayed: true };
}

function insertReceipt(db: ConversationsDatabase, receipt: StoredMergeReceipt): void {
  db.prepare(`
    INSERT INTO ${CHANNEL_MERGE_RECEIPTS_TABLE} (
      id, idempotency_key, operation, source_channel, destination_channel,
      source_receipt_id, request_hash, payload, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    receipt.id,
    receipt.idempotency_key,
    receipt.operation,
    receipt.source_channel,
    receipt.destination_channel,
    receipt.source_receipt_id,
    receipt.request_hash,
    receipt.payload,
    receipt.created_at,
  );
}

function localTableExists(db: ConversationsDatabase, table: string): boolean {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table),
  );
}

function sourceGraphEdges(db: ConversationsDatabase, source: string): MergeGraphEdge[] {
  if (!localTableExists(db, "graph_edges")) return [];
  return db.prepare(
    `SELECT from_type, from_id, to_type, to_id, relation, weight, metadata
     FROM graph_edges
     WHERE (from_type = 'channel' AND from_id = ?) OR (to_type = 'channel' AND to_id = ?)
     ORDER BY from_type, from_id, to_type, to_id, relation`,
  ).all(source, source) as MergeGraphEdge[];
}

function sourceTaskIds(db: ConversationsDatabase, source: string): number[] {
  return (db.prepare("SELECT id FROM tasks WHERE channel = ?").all(source) as Array<{ id: number }>)
    .map((row) => Number(row.id));
}

export function applyChannelMerge(options: ApplyChannelMergeOptions): ChannelMergeReceipt {
  if (!options.expected_revision.trim()) throw new Error("expected_revision is required.");
  if (!options.idempotency_key.trim()) throw new Error("idempotency_key is required.");
  const db = getDb();
  const source = normalizeChannelName(options.source_channel);
  const destination = normalizeChannelName(options.destination_channel);
  const archiveSource = options.archive_source === true;
  const agentId = options.agent_id?.trim() || "channel-merge";
  const requestHash = stableChannelMergeHash({
    operation: "apply",
    source_channel: source,
    destination_channel: destination,
    archive_source: archiveSource,
    expected_revision: options.expected_revision,
  });

  const existing = receiptByIdempotencyKey(db, options.idempotency_key);
  if (existing) return replayOrReject<ChannelMergeReceipt>(existing, requestHash);

  const plan = planChannelMerge(
    { source_channel: source, destination_channel: destination },
    { skipLockCheck: true },
  );
  if (plan.revision !== options.expected_revision) {
    throw new Error(
      `Stale channel merge revision: expected ${options.expected_revision}, current ${plan.revision}. ` +
      `Re-run a dry-run and use its exact revision.`,
    );
  }

  // Active-write contention guard: hold an advisory lock on BOTH channel names
  // for the duration of the operation and refuse with the named holder when
  // either is already held by another agent.
  const sourceLock = acquireLock("channel", source, agentId, "advisory");
  if (!sourceLock.acquired) {
    throw new Error(`Channel merge refused: #${source} is locked by ${sourceLock.held_by}.`);
  }
  const destinationLock = acquireLock("channel", destination, agentId, "advisory");
  if (!destinationLock.acquired) {
    releaseLock("channel", source, agentId);
    throw new Error(`Channel merge refused: #${destination} is locked by ${destinationLock.held_by}.`);
  }

  try {
    return db.transaction((): ChannelMergeReceipt => {
      const replayed = receiptByIdempotencyKey(db, options.idempotency_key);
      if (replayed) return replayOrReject<ChannelMergeReceipt>(replayed, requestHash);

      // No-op write obtains SQLite's single-writer lock before the snapshot.
      const lock = db.prepare("UPDATE channels SET name = name WHERE name = ?").run(source);
      if (lock.changes !== 1) throw new Error(`Channel not found: ${source}`);

      const state = readState(db, source, destination);
      assertMergeSafe(db, state);
      const currentPlan = buildPlan(state, archiveSource);
      if (currentPlan.revision !== options.expected_revision) {
        throw new Error(
          `Stale channel merge revision: expected ${options.expected_revision}, current ${currentPlan.revision}. ` +
          `Re-run a dry-run and use its exact revision.`,
        );
      }

      const movedRows = currentPlan.message_ids
        .map((id) => state.sourceMessages.find((row) => Number(row.id) === id))
        .filter((row): row is MergeMessageRow => Boolean(row));

      const priorAliasDestination = db.prepare(
        "SELECT old_channel, current_channel, renamed_at FROM channel_rename_aliases WHERE old_channel = ?",
      ).get(destination) as { old_channel: string; current_channel: string; renamed_at: string } | null;
      const priorAliasesOfSource = db.prepare(
        "SELECT old_channel, renamed_at FROM channel_rename_aliases WHERE current_channel = ?",
      ).all(source) as Array<{ old_channel: string; renamed_at: string }>;
      const priorSourceArchivedAt = (db.prepare(
        "SELECT archived_at FROM channels WHERE name = ?",
      ).get(source) as { archived_at: string | null }).archived_at;

      const sourceTaskIdsBefore = sourceTaskIds(db, source);
      const sourceGraphEdgesBefore = sourceGraphEdges(db, source);

      db.exec("PRAGMA defer_foreign_keys = ON");
      // The message scope rewrite guard lets reply scopes move atomically
      // with the merge (exact renameChannel token pattern).
      db.prepare(
        `INSERT INTO message_scope_rewrite_guard (
           token, old_session_id, new_session_id, old_channel, new_channel, old_to_agent, new_to_agent
         ) VALUES (1, ?, ?, ?, ?, ?, ?)`,
      ).run(`channel:${source}`, `channel:${destination}`, source, destination, source, destination);

      // Messages move by in-place rewrite; ids and uuids never change.
      db.prepare(
        `UPDATE messages
         SET channel = ?,
             session_id = CASE WHEN session_id = ? THEN ? ELSE session_id END,
             to_agent = CASE WHEN to_agent = ? THEN ? ELSE to_agent END
         WHERE channel = ?`,
      ).run(destination, `channel:${source}`, `channel:${destination}`, source, destination, source);
      db.prepare(
        "UPDATE messages SET session_id = ? WHERE session_id = ? AND (channel IS NULL OR channel <> ?)",
      ).run(`channel:${destination}`, `channel:${source}`, destination);

      // Memberships and subscriptions move only when the overlap refusal
      // already proved the destination rows are disjoint.
      db.prepare("UPDATE channel_members SET channel = ? WHERE channel = ?").run(destination, source);
      db.prepare("UPDATE channel_subscriptions SET channel = ? WHERE channel = ?").run(destination, source);

      // Mentions and tasks reference the channel by name.
      db.prepare("UPDATE message_mentions SET channel = ? WHERE channel = ?").run(destination, source);
      db.prepare("UPDATE tasks SET channel = ? WHERE channel = ?").run(destination, source);

      // Graph edges: a duplicate destination edge inherits the source edge's
      // weight/metadata and is removed, then the remaining source edges move
      // to the destination name (exact renameChannel dedupe pattern). The
      // table is created on demand by the graph module, so it may not exist.
      if (localTableExists(db, "graph_edges")) {
      db.prepare(
        `UPDATE graph_edges AS target
         SET weight = source.weight, metadata = source.metadata, updated_at = source.updated_at
         FROM graph_edges AS source
         WHERE source.from_type = 'channel' AND source.from_id = ?
           AND target.from_type = source.from_type AND target.from_id = ?
           AND target.to_type = source.to_type AND target.to_id = source.to_id
           AND target.relation = source.relation`,
      ).run(source, destination);
      // SQLite has no DELETE ... USING (Postgres-only); the portable form is a
      // correlated EXISTS against the destination edge (exact dedupe semantics).
      db.prepare(
        `DELETE FROM graph_edges
         WHERE from_type = 'channel' AND from_id = ?
           AND EXISTS (
             SELECT 1 FROM graph_edges AS target
             WHERE target.from_type = 'channel' AND target.from_id = ?
               AND target.to_type = graph_edges.to_type AND target.to_id = graph_edges.to_id
               AND target.relation = graph_edges.relation
           )`,
      ).run(source, destination);
      db.prepare(
        "UPDATE graph_edges SET from_id = ? WHERE from_type = 'channel' AND from_id = ?",
      ).run(destination, source);
      db.prepare(
        `UPDATE graph_edges AS target
         SET weight = source.weight, metadata = source.metadata, updated_at = source.updated_at
         FROM graph_edges AS source
         WHERE source.to_type = 'channel' AND source.to_id = ?
           AND target.to_type = source.to_type AND target.to_id = ?
           AND target.from_type = source.from_type AND target.from_id = source.from_id
           AND target.relation = source.relation`,
      ).run(source, destination);
      db.prepare(
        `DELETE FROM graph_edges
         WHERE to_type = 'channel' AND to_id = ?
           AND EXISTS (
             SELECT 1 FROM graph_edges AS target
             WHERE target.to_type = 'channel' AND target.to_id = ?
               AND target.from_type = graph_edges.from_type AND target.from_id = graph_edges.from_id
               AND target.relation = graph_edges.relation
           )`,
      ).run(source, destination);
      db.prepare(
        "UPDATE graph_edges SET to_id = ? WHERE to_type = 'channel' AND to_id = ?",
      ).run(destination, source);
      }

      // resource_locks rows are deliberately NOT rewritten: the operation
      // holds its own advisory locks on both names and releases them after
      // the commit; renaming would collide with the held destination lock.

      if (archiveSource) {
        db.prepare(
          "UPDATE channels SET archived_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE name = ?",
        ).run(source);
        // Alias block so historical reads of #source resolve to #destination
        // (exact renameChannel alias pattern).
        db.prepare("DELETE FROM channel_rename_aliases WHERE old_channel = ?").run(destination);
        db.prepare(
          `UPDATE channel_rename_aliases
           SET current_channel = ?, renamed_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')
           WHERE current_channel = ?`,
        ).run(destination, source);
        db.prepare(
          `INSERT INTO channel_rename_aliases (old_channel, current_channel)
           VALUES (?, ?)
           ON CONFLICT(old_channel) DO UPDATE SET
             current_channel = excluded.current_channel,
             renamed_at = strftime('%Y-%m-%dT%H:%M:%f', 'now')`,
        ).run(source, destination);
        db.prepare("DELETE FROM channel_rename_aliases WHERE old_channel = current_channel").run();
      }

      db.prepare("DELETE FROM message_scope_rewrite_guard WHERE token = 1").run();

      // Verify the moved rows in place: ids and uuids must be exactly the moved
      // set, now owned by the destination.
      const postState = readPostState(db, source, destination);
      const movedIdSet = new Set(currentPlan.message_ids);
      const movedStillPresent = postState.destinationMessages.filter((row) => movedIdSet.has(Number(row.id)));
      if (movedStillPresent.length !== movedRows.length) {
        throw new Error(
          `Channel merge verification failed: ${movedRows.length - movedStillPresent.length} moved message(s) missing after commit.`,
        );
      }
      for (const row of movedRows) {
        const after = postState.destinationMessages.find((candidate) => candidate.id === row.id);
        if (!after || String(after.uuid) !== String(row.uuid)) {
          throw new Error(`Message ${row.id}/${row.uuid} changed during channel merge.`);
        }
        if (stableChannelMergeHash(preservedRow(after)) !== stableChannelMergeHash(preservedRow(row))) {
          throw new Error(`Message ${row.id}/${row.uuid} changed outside the channel scope during merge.`);
        }
      }

      const createdAt = new Date().toISOString();
      const receipt: ChannelMergeReceipt = {
        ...currentPlan,
        dry_run: false,
        archive_source: archiveSource,
        receipt_id: randomUUID(),
        idempotency_key: options.idempotency_key,
        request_hash: requestHash,
        pre_revision: currentPlan.revision,
        post_revision: postRevision(postState),
        source_members: state.sourceMembers,
        source_subscriptions: state.sourceSubscriptions,
        source_task_ids: sourceTaskIdsBefore,
        source_graph_edges: sourceGraphEdgesBefore,
        prior_source_archived_at: priorSourceArchivedAt,
        prior_alias_destination: priorAliasDestination,
        prior_aliases_of_source: priorAliasesOfSource,
        created_at: createdAt,
        replayed: false,
      };
      insertReceipt(db, {
        id: receipt.receipt_id,
        idempotency_key: receipt.idempotency_key,
        operation: "apply",
        source_channel: receipt.source_channel,
        destination_channel: receipt.destination_channel,
        source_receipt_id: null,
        request_hash: receipt.request_hash,
        payload: JSON.stringify(receipt),
        created_at: receipt.created_at,
      });
      return receipt;
    });
  } finally {
    releaseLock("channel", source, agentId);
    releaseLock("channel", destination, agentId);
  }
}

function loadApplyReceipt(db: ConversationsDatabase, receiptId: string): ChannelMergeReceipt {
  const stored = receiptById(db, receiptId);
  if (!stored || stored.operation !== "apply") {
    throw new Error(`Channel merge apply receipt not found: ${receiptId}`);
  }
  return JSON.parse(stored.payload) as ChannelMergeReceipt;
}

export function rollbackChannelMerge(
  options: RollbackChannelMergeOptions,
): ChannelMergeRollbackResult {
  if (!options.expected_revision.trim()) throw new Error("expected_revision is required.");
  if (!options.idempotency_key.trim()) throw new Error("idempotency_key is required.");
  const db = getDb();
  const source = loadApplyReceipt(db, options.receipt_id);
  const requestHash = stableChannelMergeHash({
    operation: "rollback",
    source_receipt_id: source.receipt_id,
    expected_revision: options.expected_revision,
  });

  const buildResult = (currentRevision: string): ChannelMergeRollbackResult => ({
    operation: "rollback",
    dry_run: !options.apply,
    source_receipt_id: source.receipt_id,
    source_channel: source.source_channel,
    destination_channel: source.destination_channel,
    expected_revision: options.expected_revision,
    current_revision: currentRevision,
    target_count: source.moved_message_count,
    target_message_ids: source.message_ids,
    target_message_uuids: source.message_uuids,
    restored_count: 0,
  });

  const verifyTargetState = (): string => {
    const state = readPostState(db, source.source_channel, source.destination_channel);
    const currentRevision = postRevision(state);
    if (options.expected_revision !== source.post_revision || currentRevision !== options.expected_revision) {
      throw new Error(
        `Stale channel merge rollback revision: expected ${options.expected_revision}, current ${currentRevision}.`,
      );
    }
    return currentRevision;
  };

  if (!options.apply) {
    return buildResult(verifyTargetState());
  }

  return db.transaction(() => {
    const existing = receiptByIdempotencyKey(db, options.idempotency_key);
    if (existing) return replayOrReject<ChannelMergeRollbackResult>(existing, requestHash);
    const currentRevision = verifyTargetState();

    const movedIds = source.message_ids;
    const placeholders = movedIds.map(() => "?").join(", ");
    const idParams = movedIds.map(String);

    db.exec("PRAGMA defer_foreign_keys = ON");
    db.prepare(
      `INSERT INTO message_scope_rewrite_guard (
         token, old_session_id, new_session_id, old_channel, new_channel, old_to_agent, new_to_agent
       ) VALUES (1, ?, ?, ?, ?, ?, ?)`,
    ).run(
      `channel:${source.destination_channel}`,
      `channel:${source.source_channel}`,
      source.destination_channel,
      source.source_channel,
      source.destination_channel,
      source.source_channel,
    );
    db.prepare(
      `UPDATE messages
       SET channel = ?,
           session_id = CASE WHEN session_id = ? THEN ? ELSE session_id END,
           to_agent = CASE WHEN to_agent = ? THEN ? ELSE to_agent END
       WHERE channel = ? AND id IN (${placeholders})`,
    ).run(
      source.source_channel,
      `channel:${source.destination_channel}`,
      `channel:${source.source_channel}`,
      source.destination_channel,
      source.source_channel,
      source.destination_channel,
      ...idParams,
    );
    db.prepare(
      `UPDATE messages SET session_id = ?
       WHERE session_id = ? AND (channel IS NULL OR channel <> ?) AND id IN (${placeholders})`,
    ).run(
      `channel:${source.source_channel}`,
      `channel:${source.destination_channel}`,
      source.source_channel,
      ...idParams,
    );

    const memberParams = source.source_members.map(() => "?").join(", ");
    if (source.source_members.length > 0) {
      db.prepare(
        `UPDATE channel_members SET channel = ?
         WHERE channel = ? AND agent IN (${memberParams})`,
      ).run(source.source_channel, source.destination_channel, ...source.source_members);
      db.prepare(
        `UPDATE channel_subscriptions SET channel = ?
         WHERE channel = ? AND agent IN (${memberParams})`,
      ).run(source.source_channel, source.destination_channel, ...source.source_members);
    }
    db.prepare(
      `UPDATE message_mentions SET channel = ?
       WHERE channel = ? AND message_id IN (${placeholders})`,
    ).run(source.source_channel, source.destination_channel, ...idParams);
    if (source.source_task_ids.length > 0) {
      const taskParams = source.source_task_ids.map(() => "?").join(", ");
      db.prepare(
        `UPDATE tasks SET channel = ?
         WHERE channel = ? AND id IN (${taskParams})`,
      ).run(source.source_channel, source.destination_channel, ...source.source_task_ids.map(String));
    }

    // Graph edges: remove destination-side rows that match the recorded
    // source edges, then restore the recorded source rows. The table is
    // created on demand by the graph module, so it may not exist.
    for (const edge of source.source_graph_edges) {
      if (edge.from_type === "channel" && edge.from_id === source.source_channel) {
        db.prepare(
          `DELETE FROM graph_edges
           WHERE from_type = 'channel' AND from_id = ?
             AND to_type = ? AND to_id = ? AND relation = ?`,
        ).run(source.destination_channel, edge.to_type, edge.to_id, edge.relation);
      }
      if (edge.to_type === "channel" && edge.to_id === source.source_channel) {
        db.prepare(
          `DELETE FROM graph_edges
           WHERE to_type = 'channel' AND to_id = ?
             AND from_type = ? AND from_id = ? AND relation = ?`,
        ).run(source.destination_channel, edge.from_type, edge.from_id, edge.relation);
      }
      db.prepare(
        `INSERT OR IGNORE INTO graph_edges (from_type, from_id, to_type, to_id, relation, weight, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(edge.from_type, edge.from_id, edge.to_type, edge.to_id, edge.relation, edge.weight, edge.metadata);
    }

    if (source.archive_source) {
      // Reverse the alias block and the archive.
      db.prepare("DELETE FROM channel_rename_aliases WHERE old_channel = ?").run(source.source_channel);
      if (source.prior_alias_destination) {
        db.prepare(
          `INSERT INTO channel_rename_aliases (old_channel, current_channel, renamed_at)
           VALUES (?, ?, ?)`,
        ).run(
          source.prior_alias_destination.old_channel,
          source.prior_alias_destination.current_channel,
          source.prior_alias_destination.renamed_at,
        );
      }
      for (const prior of source.prior_aliases_of_source) {
        db.prepare(
          `INSERT INTO channel_rename_aliases (old_channel, current_channel, renamed_at)
           VALUES (?, ?, ?)`,
        ).run(prior.old_channel, source.source_channel, prior.renamed_at);
      }
      db.prepare("UPDATE channels SET archived_at = ? WHERE name = ?").run(
        source.prior_source_archived_at,
        source.source_channel,
      );
    }

    db.prepare("DELETE FROM message_scope_rewrite_guard WHERE token = 1").run();

    const restoredState = readState(db, source.source_channel, source.destination_channel);
    const restoredIds = restoredState.sourceMessages.map((row) => Number(row.id));
    for (const id of source.message_ids) {
      if (!restoredIds.includes(id)) {
        throw new Error(`Message ${id} missing after channel merge rollback.`);
      }
    }

    const createdAt = new Date().toISOString();
    const result: ChannelMergeRollbackResult = {
      ...buildResult(currentRevision),
      dry_run: false,
      restored_count: source.message_ids.length,
      receipt_id: randomUUID(),
      idempotency_key: options.idempotency_key,
      request_hash: requestHash,
      post_revision: mergedRevision(restoredState),
      created_at: createdAt,
      replayed: false,
    };
    insertReceipt(db, {
      id: result.receipt_id!,
      idempotency_key: result.idempotency_key!,
      operation: "rollback",
      source_channel: source.source_channel,
      destination_channel: source.destination_channel,
      source_receipt_id: source.receipt_id,
      request_hash: requestHash,
      payload: JSON.stringify(result),
      created_at: createdAt,
    });
    return result;
  });
}
