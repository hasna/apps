import type { Database } from "../db/database.js";
import { cappedLimit, safeOffset } from "../db/pagination.js";
import type { IngestionSourceInventoryRepository } from "../store/repositories.js";
import type { IngestionSourceInventoryRow } from "../store/records.js";
import { ok } from "./outcome.js";

/** Uses only the already supplied Database. No config lookup or default database. */
export function createSourceInventoryRepository(db: Database): IngestionSourceInventoryRepository {
  return {
    async list(opts = {}) {
      const rows = db.query(`SELECT id, status, last_synced_at FROM mailbox_sources
        ORDER BY status ASC, type ASC, created_at ASC, id ASC LIMIT ? OFFSET ?`)
        .all(cappedLimit(opts.limit, 100, 500), safeOffset(opts.offset)) as IngestionSourceInventoryRow[];
      if (rows.some(row => typeof row.id !== "string" || !row.id.trim()
        || (row.status !== null && typeof row.status !== "string")
        || (row.last_synced_at !== null && typeof row.last_synced_at !== "string"))) {
        throw new Error("The source inventory contains invalid metadata.");
      }
      return ok(rows.map(row => ({ id: row.id, status: row.status, last_synced_at: row.last_synced_at })));
    },
  };
}
