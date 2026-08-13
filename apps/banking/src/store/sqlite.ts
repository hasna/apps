import { Database } from "bun:sqlite";
import type { ApprovalRecord } from "../core/approvals.ts";
import type { AuditEvent } from "../core/audit.ts";
import type { IdempotencyFingerprint, IdempotencyReplayDecision } from "../core/idempotency.ts";
import type { BankingIntent } from "../core/intents.ts";
import type { ReconciliationRecord } from "../core/reconciliation.ts";
import type { DevOnlyStore, OutboxEntry, OutboxStatus } from "../core/store.ts";

export interface SqliteDevStoreOptions {
  readonly path?: string;
}

export function createSqliteDevStore(options: SqliteDevStoreOptions = {}): DevOnlyStore {
  const db = new Database(options.path ?? ":memory:");
  db.exec("pragma foreign_keys = on;");
  db.exec(SQLITE_SCHEMA);

  return {
    mode: "dev",
    async reserveIdempotency(fingerprint) {
      const existing = getFingerprint(db, fingerprint.key);
      if (!existing) {
        db.query("insert into idempotency_reservations (key, payload_hash) values (?, ?)").run(fingerprint.key, fingerprint.payloadHash);
        return { status: "new", key: fingerprint.key };
      }
      if (existing.payloadHash === fingerprint.payloadHash) {
        return { status: "replay", key: fingerprint.key };
      }
      return { status: "conflict", key: fingerprint.key, reason: "Idempotency key already exists with a different payload." };
    },
    async saveIntent(intent, fingerprint) {
      const reservation = getFingerprint(db, fingerprint.key);
      if (!reservation) {
        throw new Error(`Idempotency reservation does not exist: ${fingerprint.key}`);
      }
      if (reservation.payloadHash !== fingerprint.payloadHash) {
        throw new Error("Idempotency reservation payload hash does not match the intent fingerprint.");
      }
      db.query("insert into intents (id, fingerprint_key, payload_hash, payload) values (?, ?, ?, ?)").run(
        intent.id,
        fingerprint.key,
        fingerprint.payloadHash,
        JSON.stringify(intent),
      );
    },
    async getIntent(id) {
      const row = db.query("select payload from intents where id = ?").get(id) as { payload: string } | null;
      return row ? JSON.parse(row.payload) as BankingIntent : undefined;
    },
    async getIntentFingerprint(intentId) {
      const row = db.query("select fingerprint_key, payload_hash from intents where id = ?").get(intentId) as { fingerprint_key: string; payload_hash: string } | null;
      return row ? { key: row.fingerprint_key, payloadHash: row.payload_hash } : undefined;
    },
    async saveApproval(approval) {
      db.query("insert into approvals (id, intent_id, payload) values (?, ?, ?)").run(approval.id, approval.intentId, JSON.stringify(approval));
    },
    async appendAuditEvent(event) {
      db.query("insert into audit_events (id, previous_hash, hash, payload) values (?, ?, ?, ?)").run(
        event.id,
        event.previousHash ?? null,
        event.hash,
        JSON.stringify(event),
      );
    },
    async saveReconciliation(record) {
      db.query("insert into reconciliation_records (id, provider_event_id, payload) values (?, ?, ?)").run(
        record.id,
        record.providerEventId,
        JSON.stringify(record),
      );
    },
    async enqueueOutbox(entry) {
      if (entry.status !== "pending") {
        throw new Error("Outbox entries must be enqueued with pending status.");
      }
      if (entry.attempts !== 0) {
        throw new Error("Outbox entries must be enqueued with zero attempts.");
      }
      db.query("insert into outbox_entries (id, topic, status, attempts, payload, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)").run(
        entry.id,
        entry.topic,
        entry.status,
        entry.attempts,
        JSON.stringify(entry.payload),
        entry.createdAt,
        entry.updatedAt,
      );
    },
    async listPendingOutbox(limit = 50) {
      const rows = db.query("select * from outbox_entries where status = 'pending' order by created_at asc limit ?").all(limit) as SqliteOutboxRow[];
      return rows.map(outboxFromRow);
    },
    async markOutboxStatus(id, status, now = new Date()) {
      const current = db.query("select status from outbox_entries where id = ?").get(id) as { status: OutboxStatus } | null;
      if (!current) {
        throw new Error(`Outbox entry does not exist: ${id}`);
      }
      if (!isAllowedOutboxTransition(current.status, status)) {
        throw new Error(`Invalid outbox status transition: ${current.status} -> ${status}`);
      }
      db.query("update outbox_entries set status = ?, updated_at = ?, attempts = attempts + 1 where id = ?").run(status, now.toISOString(), id);
    },
    async reset() {
      db.exec("delete from reconciliation_records; delete from audit_events; delete from approvals; delete from intents; delete from idempotency_reservations; delete from outbox_entries;");
    },
  };
}

function isAllowedOutboxTransition(from: OutboxStatus, to: OutboxStatus): boolean {
  if (from === to) return true;
  if (from === "pending") return to === "processing" || to === "failed";
  if (from === "processing") return to === "sent" || to === "failed";
  if (from === "failed") return to === "pending";
  return false;
}

interface SqliteOutboxRow {
  readonly id: string;
  readonly topic: string;
  readonly status: OutboxStatus;
  readonly attempts: number;
  readonly payload: string;
  readonly created_at: string;
  readonly updated_at: string;
}

function getFingerprint(db: Database, key: string): IdempotencyFingerprint | undefined {
  const row = db.query("select key, payload_hash from idempotency_reservations where key = ?").get(key) as { key: string; payload_hash: string } | null;
  return row ? { key: row.key, payloadHash: row.payload_hash } : undefined;
}

function outboxFromRow(row: SqliteOutboxRow): OutboxEntry {
  return {
    id: row.id,
    topic: row.topic,
    status: row.status,
    attempts: row.attempts,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SQLITE_SCHEMA = `
create table if not exists idempotency_reservations (
  key text primary key,
  payload_hash text not null,
  created_at text not null default current_timestamp,
  unique (key, payload_hash)
);

create table if not exists intents (
  id text primary key,
  fingerprint_key text not null,
  payload_hash text not null,
  payload text not null,
  created_at text not null default current_timestamp,
  foreign key (fingerprint_key, payload_hash) references idempotency_reservations (key, payload_hash)
);

create table if not exists approvals (
  id text primary key,
  intent_id text not null,
  payload text not null,
  created_at text not null default current_timestamp
);

create table if not exists audit_events (
  id text primary key,
  previous_hash text,
  hash text not null unique,
  payload text not null,
  created_at text not null default current_timestamp
);

create table if not exists reconciliation_records (
  id text primary key,
  provider_event_id text not null,
  payload text not null,
  created_at text not null default current_timestamp
);

create table if not exists outbox_entries (
  id text primary key,
  topic text not null,
  status text not null check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  payload text not null,
  created_at text not null,
  updated_at text not null
);
`;
