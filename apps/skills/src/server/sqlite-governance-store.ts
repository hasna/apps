/**
 * SQLite governance store — SERVER side.
 *
 * Moved out of `src/sdk/governance-store.ts` (fail-closed re-cut, owner ruling
 * 2026-09-07 / hasna/apps#1720): the published `./sdk` surface must not open
 * SQLite, so the on-disk implementation and the database-target factory live
 * with the rest of the server code and are reached by `skills-serve`, the
 * worker and the migrator only. The interface, the memory twin and the
 * Postgres implementation stay in the SDK.
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { assertReservationCents } from "../sdk/amounts.js";
import {
  ACTIVE_RUN_SQL,
  EXPIRED_ARTIFACT_SQL,
  MONTHLY_SPEND_SQL,
  PostgresGovernanceStore,
  nextMonthPrefix,
  receiptId,
  reservationId,
  type CreditReservation,
  type GovernanceStore,
  type LifecycleReceipt,
  type ReceiptKind,
  type ReservationStatus,
} from "../sdk/governance-store.js";
import { resolveDatabaseTarget, SQLITE_MEMORY_PATH } from "./database-url.js";
import { applySqliteMigrations } from "./sqlite-store.js";
import { nowIso, parseJsonObject, rowToArtifact } from "./rows.js";
import type { ServerArtifact } from "./types.js";

/** SQLite governance store: a second connection to the same database file, WAL-safe. */
export class SqliteGovernanceStore implements GovernanceStore {
  readonly backend = "sqlite";
  private db: Database;
  private closed = false;

  constructor(path: string = SQLITE_MEMORY_PATH, options: { migrate?: boolean } = {}) {
    if (path !== SQLITE_MEMORY_PATH) mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true, readwrite: true });
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA foreign_keys = ON");
    if (options.migrate !== false) applySqliteMigrations(this.db);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.db.close(false);
  }

  get database(): Database {
    return this.db;
  }

  async appendReceipt(receipt: Omit<LifecycleReceipt, "id" | "createdAt">): Promise<LifecycleReceipt> {
    const next = { ...receipt, id: receiptId(), createdAt: nowIso() };
    this.db.run(
      `INSERT INTO skills_lifecycle_receipts (id, kind, org_id, run_id, artifact_id, requested_by, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [next.id, next.kind, next.orgId, next.runId, next.artifactId ?? null, next.requestedBy, JSON.stringify(next.metadata), next.createdAt],
    );
    return next;
  }

  async listReceipts(orgId: string, runId: string): Promise<LifecycleReceipt[]> {
    const rows = this.db
      .query("SELECT * FROM skills_lifecycle_receipts WHERE org_id = ? AND run_id = ? ORDER BY created_at ASC, rowid ASC")
      .all(orgId, runId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id),
      kind: String(row.kind) as ReceiptKind,
      orgId: String(row.org_id),
      runId: String(row.run_id),
      ...(typeof row.artifact_id === "string" ? { artifactId: row.artifact_id } : {}),
      requestedBy: String(row.requested_by),
      metadata: parseJsonObject(row.metadata_json),
      createdAt: String(row.created_at),
    }));
  }

  async createReservation(input: { orgId: string; runId: string; estimatedCents: number }): Promise<CreditReservation> {
    const estimatedCents = input.estimatedCents;
    assertReservationCents(estimatedCents, "estimatedCents");
    const reservation: CreditReservation = { ...input, estimatedCents, id: reservationId(), status: "reserved", createdAt: nowIso() };
    this.db.run(
      `INSERT INTO skills_credit_reservations (id, org_id, run_id, estimated_cents, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [reservation.id, reservation.orgId, reservation.runId, reservation.estimatedCents, reservation.status, reservation.createdAt],
    );
    return reservation;
  }

  async reservationsForRun(orgId: string, runId: string): Promise<CreditReservation[]> {
    const rows = this.db
      .query("SELECT * FROM skills_credit_reservations WHERE org_id = ? AND run_id = ? ORDER BY created_at ASC, rowid ASC")
      .all(orgId, runId) as Array<Record<string, unknown>>;
    return rows.map((row) => this.reservationFrom(row));
  }

  async reconcileReservation(reservationId: string, actualCents: number, status: "charged" | "released"): Promise<CreditReservation | null> {
    assertReservationCents(actualCents, "actualCents");
    // The predicate and transition must be one SQLite statement: separate
    // connections can both observe reserved before either writes a result.
    const updated = this.db.query(
      `UPDATE skills_credit_reservations SET actual_cents = ?, status = ?, reconciled_at = ?
       WHERE id = ? AND status = 'reserved' RETURNING *`,
    ).get(actualCents, status, nowIso(), reservationId) as Record<string, unknown> | null;
    if (updated) return this.reservationFrom(updated);
    const existing = this.db.query("SELECT * FROM skills_credit_reservations WHERE id = ? LIMIT 1")
      .get(reservationId) as Record<string, unknown> | null;
    return existing ? this.reservationFrom(existing) : null;
  }

  async monthlySpendCents(orgId: string, monthPrefix: string): Promise<number> {
    const from = `${monthPrefix}-01T00:00:00.000Z`;
    const nextMonth = nextMonthPrefix(monthPrefix);
    const spent = this.db
      .query("SELECT COALESCE(SUM(cost_cents), 0) AS spent FROM skills_runs WHERE org_id = ? AND created_at >= ? AND created_at < ?")
      .get(orgId, from, `${nextMonth}-01T00:00:00.000Z`) as { spent: number };
    const pending = this.db
      .query("SELECT COALESCE(SUM(estimated_cents), 0) AS pending FROM skills_credit_reservations WHERE org_id = ? AND status = 'reserved'")
      .get(orgId) as { pending: number };
    return Number(spent.spent ?? 0) + Number(pending.pending ?? 0);
  }

  async activeRunCount(orgId: string): Promise<number> {
    const row = this.db.query(ACTIVE_RUN_SQL).get(orgId) as { n: number };
    return Number(row.n ?? 0);
  }

  async listExpiredArtifacts(at: string): Promise<ServerArtifact[]> {
    const rows = this.db.query(EXPIRED_ARTIFACT_SQL).all(at) as Array<Record<string, unknown>>;
    return rows.map(rowToArtifact);
  }

  async deleteArtifactRow(artifactId: string, orgId: string): Promise<boolean> {
    const result = this.db.run("DELETE FROM skills_artifacts WHERE id = ? AND org_id = ?", [artifactId, orgId]);
    return result.changes === 1;
  }

  async updateArtifactStorageKey(artifactId: string, orgId: string, storageKey: string): Promise<boolean> {
    const result = this.db.run("UPDATE skills_artifacts SET storage_key = ? WHERE id = ? AND org_id = ?", [storageKey, artifactId, orgId]);
    return result.changes === 1;
  }

  private reservationFrom(row: Record<string, unknown>): CreditReservation {
    return {
      id: String(row.id),
      orgId: String(row.org_id),
      runId: String(row.run_id),
      estimatedCents: Number(row.estimated_cents ?? 0),
      ...(row.actual_cents !== null && row.actual_cents !== undefined ? { actualCents: Number(row.actual_cents) } : {}),
      status: String(row.status) as ReservationStatus,
      createdAt: String(row.created_at),
      ...(typeof row.reconciled_at === "string" ? { reconciledAt: row.reconciled_at } : {}),
    };
  }
}

/** Open the governance store matching a database target: sqlite (default) or postgres. */
export async function createGovernanceStore(databaseUrl?: string): Promise<GovernanceStore> {
  const target = resolveDatabaseTarget(databaseUrl);
  if (target.kind === "postgres") return new PostgresGovernanceStore(target.url);
  if (target.kind === "memory") return new SqliteGovernanceStore(SQLITE_MEMORY_PATH);
  return new SqliteGovernanceStore(target.path);
}
