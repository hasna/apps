import { createHash } from "node:crypto";

/**
 * Stable sha256 checksum of a migration's SQL. Whitespace-normalized (CRLF→LF,
 * trimmed) so trivial reformatting does not change the checksum — but any
 * meaningful edit to a RELEASED migration will, and the migrator will refuse to
 * run it (see `postgres.ts` / `store.ts` checksum verification).
 */
export function checksumStorageSql(sql: string): string {
  const normalized = sql.trim().replace(/\r\n/g, "\n");
  return `sha256:${createHash("sha256").update(normalized).digest("hex")}`;
}
