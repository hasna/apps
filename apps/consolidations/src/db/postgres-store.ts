import {
  AUDIT_GENESIS,
  AUDIT_TABLE,
  computeRowHash,
  type AuditChainRow,
  type AuditPayload,
} from "./audit.js";
import { cloudMigrations } from "./migration-plan.js";
import type { DataTable, InsertRow, ListFilter, Row, Store } from "./store.js";
import { createCloudPoolFromEnv } from "../generated/storage-kit/pool.js";
import { MigrationLedger } from "../generated/storage-kit/migrations.js";
import type { PoolQueryClient } from "../generated/storage-kit/query.js";

interface RawRow {
  id: string;
  entity_id: string | null;
  period: string | null;
  run_id: string | null;
  data: Record<string, unknown>;
  created_at: string | Date;
}

function toRow(raw: RawRow): Row {
  return {
    id: raw.id,
    entity_id: raw.entity_id,
    period: raw.period,
    run_id: raw.run_id,
    data: typeof raw.data === "string" ? (JSON.parse(raw.data) as Record<string, unknown>) : raw.data,
    created_at: raw.created_at instanceof Date ? raw.created_at.toISOString() : String(raw.created_at),
  };
}

/**
 * Cloud, PURE-REMOTE Postgres store wired through the vendored @hasna/contracts
 * storage kit. TLS is `sslmode=verify-full` (enforced by the DSN + kit tls.ts).
 * Genuinely connects and migrates — it NEVER falls back to in-memory storage.
 */
export class PostgresStore implements Store {
  readonly mode = "cloud" as const;
  private constructor(private client: PoolQueryClient) {}

  /** Connect via the kit, run migrations, and return a live store. Fail-closed. */
  static async connect(): Promise<PostgresStore> {
    const { client } = createCloudPoolFromEnv("consolidations");
    const ledger = new MigrationLedger(client, cloudMigrations());
    await ledger.migrate();
    return new PostgresStore(client);
  }

  async insert(table: DataTable, row: InsertRow): Promise<Row> {
    const raw = await this.client.one<RawRow>(
      `INSERT INTO ${table} (id, entity_id, period, run_id, data${row.created_at ? ", created_at" : ""})
       VALUES ($1, $2, $3, $4, $5::jsonb${row.created_at ? ", $6" : ""})
       RETURNING id, entity_id, period, run_id, data, created_at`,
      row.created_at
        ? [row.id, row.entity_id ?? null, row.period ?? null, row.run_id ?? null, JSON.stringify(row.data), row.created_at]
        : [row.id, row.entity_id ?? null, row.period ?? null, row.run_id ?? null, JSON.stringify(row.data)],
    );
    return toRow(raw);
  }

  async get(table: DataTable, id: string): Promise<Row | null> {
    const raw = await this.client.get<RawRow>(
      `SELECT id, entity_id, period, run_id, data, created_at FROM ${table} WHERE id = $1`,
      [id],
    );
    return raw ? toRow(raw) : null;
  }

  async list(table: DataTable, filter: ListFilter = {}): Promise<Row[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.entity_id) {
      params.push(filter.entity_id);
      clauses.push(`entity_id = $${params.length}`);
    }
    if (filter.period) {
      params.push(filter.period);
      clauses.push(`period = $${params.length}`);
    }
    if (filter.run_id) {
      params.push(filter.run_id);
      clauses.push(`run_id = $${params.length}`);
    }
    if (filter.ids && filter.ids.length > 0) {
      const placeholders = filter.ids.map((_, i) => `$${params.length + i + 1}`);
      params.push(...filter.ids);
      clauses.push(`id IN (${placeholders.join(", ")})`);
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
    const raws = await this.client.many<RawRow>(
      `SELECT id, entity_id, period, run_id, data, created_at FROM ${table}${where} ORDER BY created_at ASC, id ASC`,
      params,
    );
    return raws.map(toRow);
  }

  async update(table: DataTable, id: string, data: Record<string, unknown>): Promise<Row> {
    const raw = await this.client.one<RawRow>(
      `UPDATE ${table} SET data = $2::jsonb WHERE id = $1
       RETURNING id, entity_id, period, run_id, data, created_at`,
      [id, JSON.stringify(data)],
    );
    return toRow(raw);
  }

  async remove(table: DataTable, id: string): Promise<boolean> {
    const result = await this.client.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    return result.rowCount > 0;
  }

  async appendAudit(payload: AuditPayload): Promise<AuditChainRow> {
    return this.client.transaction(async (tx) => {
      const last = await tx.get<{ row_hash: string }>(
        `SELECT row_hash FROM ${AUDIT_TABLE} ORDER BY id DESC LIMIT 1`,
      );
      const prevHash = last?.row_hash ?? AUDIT_GENESIS;
      const rowHash = computeRowHash(prevHash, payload);
      const inserted = await tx.one<{ id: string }>(
        `INSERT INTO ${AUDIT_TABLE} (event, actor_id, entity_id, detail, prev_hash, row_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [payload.event, payload.actor_id, payload.entity_id, payload.detail, prevHash, rowHash, payload.created_at],
      );
      return { id: Number(inserted.id), ...payload, prev_hash: prevHash, row_hash: rowHash };
    });
  }

  async listAudit(): Promise<AuditChainRow[]> {
    interface AuditRaw {
      id: string;
      event: string;
      actor_id: string;
      entity_id: string | null;
      detail: string;
      prev_hash: string;
      row_hash: string;
      created_at: string | Date;
    }
    const rows = await this.client.many<AuditRaw>(
      `SELECT id, event, actor_id, entity_id, detail, prev_hash, row_hash, created_at FROM ${AUDIT_TABLE} ORDER BY id ASC`,
    );
    return rows.map((r) => ({
      id: Number(r.id),
      event: r.event,
      actor_id: r.actor_id,
      entity_id: r.entity_id,
      detail: r.detail,
      prev_hash: r.prev_hash,
      row_hash: r.row_hash,
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }));
  }

  async migrationsApplied(): Promise<number> {
    const row = await this.client.get<{ n: string }>("SELECT COUNT(*) AS n FROM schema_migrations");
    return row ? Number(row.n) : 0;
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.get("SELECT 1 AS ok");
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
