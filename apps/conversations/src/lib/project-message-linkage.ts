import { createHash, randomUUID } from "crypto";
import type {
  ProjectMessageLinkageHash,
  ProjectMessageLinkagePlan,
  ProjectMessageLinkagePriorProject,
  ProjectMessageLinkageReceipt,
  ProjectMessageLinkageRollbackResult,
} from "../types.js";
import { normalizeChannelName } from "./channel-names.js";
import { getDb, type ConversationsDatabase } from "./db.js";

export const PROJECT_MESSAGE_LINKAGE_RECEIPTS_TABLE = "channel_project_linkage_receipts";

export interface ProjectMessageLinkageOptions {
  channel: string;
  project_id: string;
}

export interface ApplyProjectMessageLinkageOptions extends ProjectMessageLinkageOptions {
  expected_revision: string;
  idempotency_key: string;
}

export interface RollbackProjectMessageLinkageOptions {
  receipt_id: string;
  expected_revision: string;
  idempotency_key: string;
  apply: boolean;
}

export interface ProjectMessageLinkageRow extends Record<string, unknown> {
  id: number;
  uuid: string;
  channel: string | null;
  project_id: string | null;
}

type StoredReceipt = {
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

const MESSAGE_SNAPSHOT_COLUMNS = [
  "id", "uuid", "session_id", "from_agent", "to_agent", "channel", "project_id",
  "content", "priority", "working_dir", "repository", "branch", "metadata",
  "edited_at", "pinned_at", "blocking", "attachments", "reply_to", "created_at", "read_at",
] as const;

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

export function stableProjectMessageLinkageHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function normalizedRow(row: ProjectMessageLinkageRow): ProjectMessageLinkageRow {
  return Object.fromEntries(
    MESSAGE_SNAPSHOT_COLUMNS.map((column) => [column, row[column] ?? null]),
  ) as ProjectMessageLinkageRow;
}

function withoutProjectId(row: ProjectMessageLinkageRow): Record<string, unknown> {
  const { project_id: _projectId, ...copy } = normalizedRow(row);
  return copy;
}

export function projectMessageLinkageHashes(rows: ProjectMessageLinkageRow[]): ProjectMessageLinkageHash[] {
  return rows.map((row) => ({
    id: Number(row.id),
    uuid: String(row.uuid),
    hash: stableProjectMessageLinkageHash(normalizedRow(row)),
    preserved_hash: stableProjectMessageLinkageHash(withoutProjectId(row)),
  }));
}

export function projectMessageLinkageRevision(
  channel: string,
  projectId: string,
  rows: ProjectMessageLinkageRow[],
): string {
  const hashes = projectMessageLinkageHashes(rows);
  return stableProjectMessageLinkageHash({
    channel,
    project_id: projectId,
    messages: rows.map((row, index) => ({
      id: Number(row.id),
      uuid: String(row.uuid),
      project_id: row.project_id ?? null,
      preserved_hash: hashes[index].preserved_hash,
    })),
  });
}

export function projectMessageLinkageTargetRevision(rows: ProjectMessageLinkageRow[]): string {
  return stableProjectMessageLinkageHash(projectMessageLinkageHashes(rows).map((entry) => ({
    id: entry.id,
    uuid: entry.uuid,
    hash: entry.hash,
  })));
}

export function buildProjectMessageLinkagePlan(
  channel: string,
  projectId: string,
  rows: ProjectMessageLinkageRow[],
): ProjectMessageLinkagePlan {
  const ordered = rows.slice().sort((a, b) => Number(a.id) - Number(b.id));
  const conflicting = ordered.filter((row) => row.project_id !== null && row.project_id !== projectId);
  if (conflicting.length > 0) {
    throw new Error(
      `Channel ${channel} contains ${conflicting.length} message(s) linked to a conflicting project; refusing to overwrite them.`,
    );
  }
  const beforeProjects: ProjectMessageLinkagePriorProject[] = ordered.map((row) => ({
    id: Number(row.id),
    uuid: String(row.uuid),
    project_id: row.project_id ?? null,
  }));
  return {
    operation: "apply",
    dry_run: true,
    channel,
    project_id: projectId,
    revision: projectMessageLinkageRevision(channel, projectId, ordered),
    count: ordered.length,
    target_count: ordered.filter((row) => row.project_id === null).length,
    message_ids: ordered.map((row) => Number(row.id)),
    message_uuids: ordered.map((row) => String(row.uuid)),
    before_hashes: projectMessageLinkageHashes(ordered),
    before_project_ids: beforeProjects,
  };
}

function readChannelProject(db: ConversationsDatabase, rawChannel: string, expectedProjectId?: string) {
  const channel = normalizeChannelName(rawChannel);
  const row = db.prepare("SELECT name, project_id FROM channels WHERE name = ?").get(channel) as {
    name: string;
    project_id: string | null;
  } | null;
  if (!row) throw new Error(`Channel not found: ${channel}`);
  if (!row.project_id) throw new Error(`Channel ${channel} is not linked to a project.`);
  if (expectedProjectId !== undefined && row.project_id !== expectedProjectId) {
    throw new Error(`Project ${expectedProjectId} conflicts with channel project ${row.project_id}.`);
  }
  return { channel, project_id: row.project_id };
}

function readChannelRows(db: ConversationsDatabase, channel: string): ProjectMessageLinkageRow[] {
  return db.prepare(
    `SELECT ${MESSAGE_SNAPSHOT_COLUMNS.join(", ")} FROM messages WHERE channel = ? ORDER BY id ASC`,
  ).all(channel) as ProjectMessageLinkageRow[];
}

function readRowsByPriorProjects(
  db: ConversationsDatabase,
  priors: ProjectMessageLinkagePriorProject[],
): ProjectMessageLinkageRow[] {
  if (priors.length === 0) return [];
  const rows: ProjectMessageLinkageRow[] = [];
  const statement = db.prepare(
    `SELECT ${MESSAGE_SNAPSHOT_COLUMNS.join(", ")} FROM messages WHERE id = ? AND uuid = ?`,
  );
  for (const prior of priors) {
    const row = statement.get(prior.id, prior.uuid) as ProjectMessageLinkageRow | null;
    if (!row) throw new Error(`Message ${prior.id}/${prior.uuid} from the linkage receipt no longer exists.`);
    rows.push(row);
  }
  return rows.sort((a, b) => Number(a.id) - Number(b.id));
}

function receiptByIdempotencyKey(db: ConversationsDatabase, key: string): StoredReceipt | null {
  return db.prepare(
    `SELECT * FROM ${PROJECT_MESSAGE_LINKAGE_RECEIPTS_TABLE} WHERE idempotency_key = ?`,
  ).get(key) as StoredReceipt | null;
}

function receiptById(db: ConversationsDatabase, id: string): StoredReceipt | null {
  return db.prepare(
    `SELECT * FROM ${PROJECT_MESSAGE_LINKAGE_RECEIPTS_TABLE} WHERE id = ?`,
  ).get(id) as StoredReceipt | null;
}

function replayOrReject<T extends { replayed?: boolean }>(existing: StoredReceipt, requestHash: string): T {
  if (existing.request_hash !== requestHash) {
    throw new Error(`Idempotency key was already used with a different request.`);
  }
  return { ...(JSON.parse(existing.payload) as T), replayed: true };
}

function insertReceipt(db: ConversationsDatabase, receipt: StoredReceipt): void {
  db.prepare(`
    INSERT INTO ${PROJECT_MESSAGE_LINKAGE_RECEIPTS_TABLE} (
      id, idempotency_key, operation, channel, project_id, source_receipt_id,
      request_hash, payload, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    receipt.id,
    receipt.idempotency_key,
    receipt.operation,
    receipt.channel,
    receipt.project_id,
    receipt.source_receipt_id,
    receipt.request_hash,
    receipt.payload,
    receipt.created_at,
  );
}

function assertPreservedRows(
  beforeHashes: ProjectMessageLinkageHash[],
  afterRows: ProjectMessageLinkageRow[],
): void {
  const afterHashes = new Map(
    projectMessageLinkageHashes(afterRows).map((entry) => [`${entry.id}:${entry.uuid}`, entry]),
  );
  for (const before of beforeHashes) {
    const after = afterHashes.get(`${before.id}:${before.uuid}`);
    if (!after || after.preserved_hash !== before.preserved_hash) {
      throw new Error(`Message ${before.id}/${before.uuid} changed outside project_id during linkage.`);
    }
  }
}

export function planChannelProjectMessageLinkage(options: ProjectMessageLinkageOptions): ProjectMessageLinkagePlan {
  const db = getDb();
  const target = readChannelProject(db, options.channel, options.project_id);
  return buildProjectMessageLinkagePlan(target.channel, target.project_id, readChannelRows(db, target.channel));
}

export function applyChannelProjectMessageLinkage(
  options: ApplyProjectMessageLinkageOptions,
): ProjectMessageLinkageReceipt {
  if (!options.expected_revision.trim()) throw new Error("expected_revision is required.");
  if (!options.idempotency_key.trim()) throw new Error("idempotency_key is required.");
  const db = getDb();
  const channel = normalizeChannelName(options.channel);
  const requestHash = stableProjectMessageLinkageHash({
    operation: "apply",
    channel,
    project_id: options.project_id,
    expected_revision: options.expected_revision,
  });

  return db.transaction(() => {
    const existing = receiptByIdempotencyKey(db, options.idempotency_key);
    if (existing) return replayOrReject<ProjectMessageLinkageReceipt>(existing, requestHash);

    // This no-op write obtains SQLite's single-writer lock before the snapshot.
    // A concurrent new-code send therefore lands before this snapshot or waits
    // and then writes the inherited channel project after this transaction.
    const lock = db.prepare("UPDATE channels SET name = name WHERE name = ?").run(channel);
    if (lock.changes !== 1) throw new Error(`Channel not found: ${channel}`);
    const target = readChannelProject(db, channel, options.project_id);
    const beforeRows = readChannelRows(db, target.channel);
    const plan = buildProjectMessageLinkagePlan(target.channel, target.project_id, beforeRows);
    if (plan.revision !== options.expected_revision) {
      throw new Error(
        `Stale project-message linkage revision: expected ${options.expected_revision}, current ${plan.revision}.`,
      );
    }

    const targets = plan.before_project_ids.filter((entry) => entry.project_id === null);
    const update = db.prepare(
      "UPDATE messages SET project_id = ? WHERE id = ? AND uuid = ? AND channel = ? AND project_id IS NULL",
    );
    for (const targetMessage of targets) {
      const result = update.run(target.project_id, targetMessage.id, targetMessage.uuid, target.channel);
      if (result.changes !== 1) {
        throw new Error(`Message ${targetMessage.id}/${targetMessage.uuid} changed during linkage.`);
      }
    }

    const afterRows = readChannelRows(db, target.channel);
    if (afterRows.length !== beforeRows.length) {
      throw new Error(`Channel membership changed during linkage.`);
    }
    assertPreservedRows(plan.before_hashes, afterRows);
    if (afterRows.some((row) => row.project_id !== target.project_id)) {
      throw new Error(`Project-message linkage verification failed for channel ${target.channel}.`);
    }
    const afterByKey = new Map(afterRows.map((row) => [`${row.id}:${row.uuid}`, row]));
    const targetRows = targets.map((entry) => afterByKey.get(`${entry.id}:${entry.uuid}`)!).filter(Boolean);
    const createdAt = new Date().toISOString();
    const receipt: ProjectMessageLinkageReceipt = {
      ...plan,
      dry_run: false,
      receipt_id: randomUUID(),
      idempotency_key: options.idempotency_key,
      request_hash: requestHash,
      pre_revision: plan.revision,
      post_revision: projectMessageLinkageRevision(target.channel, target.project_id, afterRows),
      target_revision: projectMessageLinkageTargetRevision(targetRows),
      target_message_ids: targets.map((entry) => entry.id),
      target_message_uuids: targets.map((entry) => entry.uuid),
      created_at: createdAt,
      replayed: false,
    };
    insertReceipt(db, {
      id: receipt.receipt_id,
      idempotency_key: receipt.idempotency_key,
      operation: "apply",
      channel: receipt.channel,
      project_id: receipt.project_id,
      source_receipt_id: null,
      request_hash: receipt.request_hash,
      payload: JSON.stringify(receipt),
      created_at: receipt.created_at,
    });
    return receipt;
  });
}

function loadApplyReceipt(db: ConversationsDatabase, receiptId: string): ProjectMessageLinkageReceipt {
  const stored = receiptById(db, receiptId);
  if (!stored || stored.operation !== "apply") {
    throw new Error(`Project-message linkage apply receipt not found: ${receiptId}`);
  }
  return JSON.parse(stored.payload) as ProjectMessageLinkageReceipt;
}

export function rollbackChannelProjectMessageLinkage(
  options: RollbackProjectMessageLinkageOptions,
): ProjectMessageLinkageRollbackResult {
  if (!options.expected_revision.trim()) throw new Error("expected_revision is required.");
  if (!options.idempotency_key.trim()) throw new Error("idempotency_key is required.");
  const db = getDb();
  const source = loadApplyReceipt(db, options.receipt_id);
  const requestHash = stableProjectMessageLinkageHash({
    operation: "rollback",
    source_receipt_id: source.receipt_id,
    expected_revision: options.expected_revision,
  });
  const buildResult = (currentRevision: string): ProjectMessageLinkageRollbackResult => ({
    operation: "rollback",
    dry_run: !options.apply,
    source_receipt_id: source.receipt_id,
    channel: source.channel,
    project_id: source.project_id,
    expected_revision: options.expected_revision,
    current_revision: currentRevision,
    target_count: source.target_count,
    target_message_ids: source.target_message_ids,
    target_message_uuids: source.target_message_uuids,
    restored_count: 0,
  });

  const targets = source.before_project_ids.filter((entry) => source.target_message_ids.includes(entry.id));
  if (!options.apply) {
    const currentRows = readRowsByPriorProjects(db, targets);
    const currentRevision = projectMessageLinkageTargetRevision(currentRows);
    if (options.expected_revision !== source.target_revision || currentRevision !== options.expected_revision) {
      throw new Error(
        `Stale project-message linkage rollback revision: expected ${options.expected_revision}, current ${currentRevision}.`,
      );
    }
    return buildResult(currentRevision);
  }

  return db.transaction(() => {
    const existing = receiptByIdempotencyKey(db, options.idempotency_key);
    if (existing) return replayOrReject<ProjectMessageLinkageRollbackResult>(existing, requestHash);
    const lock = db.prepare("UPDATE channels SET name = name WHERE name = ? AND project_id = ?").run(source.channel, source.project_id);
    if (lock.changes !== 1) {
      throw new Error(`Channel ${source.channel} is no longer linked to project ${source.project_id}.`);
    }
    const currentRows = readRowsByPriorProjects(db, targets);
    const currentRevision = projectMessageLinkageTargetRevision(currentRows);
    if (options.expected_revision !== source.target_revision || currentRevision !== options.expected_revision) {
      throw new Error(
        `Stale project-message linkage rollback revision: expected ${options.expected_revision}, current ${currentRevision}.`,
      );
    }

    const update = db.prepare(
      "UPDATE messages SET project_id = ? WHERE id = ? AND uuid = ? AND channel = ? AND project_id = ?",
    );
    for (const target of targets) {
      const result = update.run(target.project_id, target.id, target.uuid, source.channel, source.project_id);
      if (result.changes !== 1) {
        throw new Error(`Message ${target.id}/${target.uuid} changed during linkage rollback.`);
      }
    }
    const restoredRows = readRowsByPriorProjects(db, targets);
    const beforeHashByKey = new Map(source.before_hashes.map((entry) => [`${entry.id}:${entry.uuid}`, entry]));
    assertPreservedRows(
      targets.map((target) => beforeHashByKey.get(`${target.id}:${target.uuid}`)!).filter(Boolean),
      restoredRows,
    );
    for (let index = 0; index < targets.length; index++) {
      if ((restoredRows[index].project_id ?? null) !== targets[index].project_id) {
        throw new Error(`Message ${targets[index].id}/${targets[index].uuid} rollback verification failed.`);
      }
    }

    const createdAt = new Date().toISOString();
    const result: ProjectMessageLinkageRollbackResult = {
      ...buildResult(currentRevision),
      dry_run: false,
      restored_count: targets.length,
      receipt_id: randomUUID(),
      idempotency_key: options.idempotency_key,
      request_hash: requestHash,
      post_revision: projectMessageLinkageTargetRevision(restoredRows),
      created_at: createdAt,
      replayed: false,
    };
    insertReceipt(db, {
      id: result.receipt_id!,
      idempotency_key: result.idempotency_key!,
      operation: "rollback",
      channel: source.channel,
      project_id: source.project_id,
      source_receipt_id: source.receipt_id,
      request_hash: requestHash,
      payload: JSON.stringify(result),
      created_at: createdAt,
    });
    return result;
  });
}
