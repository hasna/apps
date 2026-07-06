import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  AUDIT_GENESIS,
  AUDIT_TABLE,
  computeRowHash,
  type AuditChainRow,
  type AuditPayload,
} from "./audit.js";
import { sqliteSchema } from "./schema.js";
import type { DataTable, InsertRow, ListFilter, Row, Store } from "./store.js";

interface RawRow {
  id: string;
  entity_id: string | null;
  period: string | null;
  run_id: string | null;
  data: string;
  created_at: string;
}

function toRow(raw: RawRow): Row {
  return {
    id: raw.id,
    entity_id: raw.entity_id,
    period: raw.period,
    run_id: raw.run_id,
    data: JSON.parse(raw.data) as Record<string, unknown>,
    created_at: raw.created_at,
  };
}

/** Local, authoritative SQLite-backed store. */
export class SqliteStore implements Store {
  readonly mode = "local" as const;
  private db: Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path);
    this.db.run("PRAGMA journal_mode = WAL;");
    this.db.run("PRAGMA foreign_keys = ON;");
    this.db.run(sqliteSchema());
    this.db.run("INSERT OR IGNORE INTO schema_migrations (id) VALUES (1);");
  }

  async insert(table: DataTable, row: InsertRow): Promise<Row> {
    const createdAt = row.created_at ?? new Date().toISOString();
    this.db
      .query(
        `INSERT INTO ${table} (id, entity_id, period, run_id, data, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.id,
        row.entity_id ?? null,
        row.period ?? null,
        row.run_id ?? null,
        JSON.stringify(row.data),
        createdAt,
      );
    return {
      id: row.id,
      entity_id: row.entity_id ?? null,
      period: row.period ?? null,
      run_id: row.run_id ?? null,
      data: row.data,
      created_at: createdAt,
    };
  }

  async get(table: DataTable, id: string): Promise<Row | null> {
    const raw = this.db.query(`SELECT * FROM ${table} WHERE id = ?`).get(id) as RawRow | null;
    return raw ? toRow(raw) : null;
  }

  async list(table: DataTable, filter: ListFilter = {}): Promise<Row[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.entity_id) {
      clauses.push("entity_id = ?");
      params.push(filter.entity_id);
    }
    if (filter.period) {
      clauses.push("period = ?");
      params.push(filter.period);
    }
    if (filter.run_id) {
      clauses.push("run_id = ?");
      params.push(filter.run_id);
    }
    if (filter.ids && filter.ids.length > 0) {
      clauses.push(`id IN (${filter.ids.map(() => "?").join(", ")})`);
      params.push(...filter.ids);
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
    const raws = this.db
      .query(`SELECT * FROM ${table}${where} ORDER BY created_at ASC, id ASC`)
      .all(...(params as never[])) as RawRow[];
    return raws.map(toRow);
  }

  async update(table: DataTable, id: string, data: Record<string, unknown>): Promise<Row> {
    this.db.query(`UPDATE ${table} SET data = ? WHERE id = ?`).run(JSON.stringify(data), id);
    const row = await this.get(table, id);
    if (!row) throw new Error(`Row ${id} not found in ${table} after update`);
    return row;
  }

  async remove(table: DataTable, id: string): Promise<boolean> {
    const result = this.db.query(`DELETE FROM ${table} WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  async appendAudit(payload: AuditPayload): Promise<AuditChainRow> {
    const last = this.db
      .query(`SELECT row_hash FROM ${AUDIT_TABLE} ORDER BY id DESC LIMIT 1`)
      .get() as { row_hash: string } | null;
    const prevHash = last?.row_hash ?? AUDIT_GENESIS;
    const rowHash = computeRowHash(prevHash, payload);
    const result = this.db
      .query(
        `INSERT INTO ${AUDIT_TABLE} (event, actor_id, entity_id, detail, prev_hash, row_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        payload.event,
        payload.actor_id,
        payload.entity_id,
        payload.detail,
        prevHash,
        rowHash,
        payload.created_at,
      );
    return { id: Number(result.lastInsertRowid), ...payload, prev_hash: prevHash, row_hash: rowHash };
  }

  async listAudit(): Promise<AuditChainRow[]> {
    return this.db.query(`SELECT * FROM ${AUDIT_TABLE} ORDER BY id ASC`).all() as AuditChainRow[];
  }

  async migrationsApplied(): Promise<number> {
    const row = this.db.query("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number };
    return row.n;
  }

  async ping(): Promise<boolean> {
    try {
      this.db.query("SELECT 1").get();
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
