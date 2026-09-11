import { Database } from "bun:sqlite";
import { createHmac } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";

/** Exact supported source schema. Unknown tables/columns require an explicit adapter. */
export const COLUMNS = {
  secrets: ["key", "value", "type", "label", "expires_at", "created_at", "updated_at"],
  vault_items: ["id", "kind", "title", "subtitle", "domains", "tags", "favorite", "data", "created_at", "updated_at"],
  audit_log: ["id", "action", "key", "agent", "timestamp"],
  users: ["id", "name", "type", "registered_at", "last_seen"],
  feedback: ["id", "message", "email", "category", "version", "machine_id", "created_at"],
  secret_versions: ["key", "version", "value_blob", "value_hash", "value_length", "change_kind", "reason", "label", "source_version", "batch_id", "provider_expires_at", "created_at", "created_by"],
} as const;
export type Table = keyof typeof COLUMNS;
export const TABLES = Object.keys(COLUMNS) as Table[];
export type Row = Record<string, string | number | null>;
export type Snapshot = { schema: 1; audit_sequence: number; tables: Record<Table, Row[]> };
export const MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024;
export const MAX_ROWS = 100_000;
export class MigrationError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function proof(snapshot: Snapshot, nonce: string): string {
  if (!/^[a-f0-9]{64}$/.test(nonce)) throw new MigrationError("invalid_verification_nonce");
  return createHmac("sha256", Buffer.from(nonce, "hex")).update(canonical(snapshot)).digest("hex");
}
export function validateSnapshot(value: unknown): Snapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new MigrationError("invalid_snapshot");
  const s = value as Snapshot;
  if (Object.keys(s).sort().join() !== "audit_sequence,schema,tables" || s.schema !== 1 || !Number.isSafeInteger(s.audit_sequence) || s.audit_sequence < 0 || !s.tables || Object.keys(s.tables).sort().join() !== [...TABLES].sort().join()) throw new MigrationError("unsupported_snapshot_schema");
  let count = 0;
  for (const table of TABLES) {
    const rows = s.tables[table];
    if (!Array.isArray(rows) || (count += rows.length) > MAX_ROWS) throw new MigrationError("snapshot_row_limit");
    const seen = new Set<string>();
    for (const row of rows) {
      if (!row || Object.keys(row).sort().join() !== [...COLUMNS[table]].sort().join() || Object.values(row).some(v => v !== null && typeof v !== "string" && !(typeof v === "number" && Number.isSafeInteger(v)))) throw new MigrationError("invalid_snapshot_row");
      const id = table === "secret_versions" ? [row.key, row.version] : [row[table === "secrets" ? "key" : "id"]];
      if (id.some(x => x === null || x === "" || x === undefined) || seen.has(canonical(id))) throw new MigrationError("duplicate_or_missing_source_identity");
      seen.add(canonical(id));
    }
  }
  if (Buffer.byteLength(canonical(s)) > MAX_SNAPSHOT_BYTES) throw new MigrationError("snapshot_byte_limit", 413);
  return s;
}
/** Read-only transaction; never calls ordinary getDb(), schema upgrades or key generation. */
export function readSnapshot(path: string, decrypt: (value: string) => string): Snapshot {
  if (!path.startsWith("/") || lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) throw new MigrationError("source_requires_explicit_regular_file");
  const db = new Database(realpathSync(path), { readonly: true, create: false });
  try {
    db.exec("BEGIN");
    const names = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as {name:string}[];
    if (names.map(r => r.name).join() !== [...TABLES].sort().join()) throw new MigrationError("unsupported_source_tables");
    const tables = {} as Snapshot["tables"];
    let count = 0;
    for (const table of TABLES) {
      const columns = db.query(`PRAGMA table_info(${table})`).all() as {name:string}[];
      if (columns.map(r => r.name).sort().join() !== [...COLUMNS[table]].sort().join()) throw new MigrationError("unsupported_source_columns");
      const rows = db.query(`SELECT ${COLUMNS[table].join(",")} FROM ${table} ORDER BY ${table === "secrets" ? "key" : table === "secret_versions" ? "key,version" : "id"} LIMIT ${MAX_ROWS + 1}`).all() as Row[];
      count += rows.length;
      if (count > MAX_ROWS) throw new MigrationError("snapshot_row_limit");
      for (const row of rows) {
        const field = table === "secrets" ? "value" : table === "vault_items" ? "data" : table === "secret_versions" ? "value_blob" : undefined;
        if (field) {
          if (typeof row[field] !== "string") throw new MigrationError("invalid_encrypted_source_value");
          try { row[field] = decrypt(row[field]); } catch { throw new MigrationError("source_decryption_failed"); }
        }
      }
      tables[table] = rows;
    }
    const hasSequence=db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'").get();
    const sequence=hasSequence ? db.query("SELECT seq FROM sqlite_sequence WHERE name='audit_log'").get() as {seq:number}|null : null;
    return validateSnapshot({ schema: 1, audit_sequence: sequence?.seq ?? 0, tables });
  } finally { try { db.exec("ROLLBACK"); } finally { db.close(); } }
}
