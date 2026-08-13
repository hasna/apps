import type { AuditChainRow, AuditPayload } from "./audit.js";

// Storage abstraction shared by the local SQLite store and the cloud Postgres
// store (vendored kit). Domain rows are a small set of indexed columns plus a
// JSON `data` blob, so both backends share one uniform CRUD surface.

/** Domain data tables (audit_log is handled separately and is append-only). */
export const DATA_TABLES = [
  "entities",
  "gl_imports",
  "coa_mappings",
  "fx_rates",
  "eliminations",
  "runs",
  "statements",
] as const;

export type DataTable = (typeof DATA_TABLES)[number];

export interface Row {
  id: string;
  entity_id: string | null;
  period: string | null;
  run_id: string | null;
  data: Record<string, unknown>;
  created_at: string;
}

export interface InsertRow {
  id: string;
  entity_id?: string | null;
  period?: string | null;
  run_id?: string | null;
  data: Record<string, unknown>;
  created_at?: string;
}

export interface ListFilter {
  entity_id?: string;
  period?: string;
  run_id?: string;
  ids?: string[];
}

export interface Store {
  readonly mode: "local" | "cloud";
  insert(table: DataTable, row: InsertRow): Promise<Row>;
  get(table: DataTable, id: string): Promise<Row | null>;
  list(table: DataTable, filter?: ListFilter): Promise<Row[]>;
  update(table: DataTable, id: string, data: Record<string, unknown>): Promise<Row>;
  remove(table: DataTable, id: string): Promise<boolean>;
  /** Append a hash-chained audit event (insert-only). */
  appendAudit(payload: AuditPayload): Promise<AuditChainRow>;
  listAudit(): Promise<AuditChainRow[]>;
  migrationsApplied(): Promise<number>;
  /** Cheap reachability probe. Reports false instead of throwing. */
  ping(): Promise<boolean>;
  close(): Promise<void>;
}
