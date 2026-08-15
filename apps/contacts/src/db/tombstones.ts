/**
 * Local delete-tracking tombstones.
 *
 * When a core row (contact / company / tag) is deleted, we record a tombstone in
 * the on-box `_contacts_tombstones` table so a server-side sync/parity pull can
 * see *what was deleted* (a plain absence can't be distinguished from "never
 * existed"). This is a PURE local-table write inside the SQLite transport — it
 * opens no network connection and never touches a Postgres DSN. The forbidden
 * client-side DSN sync path (removed in the DSN-hardening commit) is unrelated;
 * this only writes the local table the LocalStore already owns.
 */
import type { ContactsDatabase } from "./database.js";
import { getDatabase } from "./database.js";

export type ContactsDeletableTable = "contacts" | "companies" | "tags";

export function recordTombstone(
  table: ContactsDeletableTable,
  rowId: string,
  options?: { actor?: string; reason?: string; db?: ContactsDatabase },
): void {
  const d = options?.db ?? getDatabase();
  d.run(
    `INSERT INTO _contacts_tombstones (table_name, row_id, deleted_at, actor, reason)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(table_name, row_id) DO UPDATE SET
       deleted_at = excluded.deleted_at,
       actor = excluded.actor,
       reason = excluded.reason`,
    [table, rowId, new Date().toISOString(), options?.actor ?? "local", options?.reason ?? null],
  );
}
