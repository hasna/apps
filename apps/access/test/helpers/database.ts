import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, resetDatabase } from "../../src/db/database.js";

/** Point the app at a fresh temp SQLite DB and reset the cached handle. */
export function useTestDatabase(prefix = "access-test"): string {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
  const path = join(dir, "access.db");
  process.env["HASNA_ACCESS_DB_PATH"] = path;
  delete process.env["HASNA_ACCESS_STORAGE_MODE"];
  delete process.env["HASNA_ACCESS_DATABASE_URL"];
  resetDatabase();
  return path;
}

export function cleanupTestDatabase(path: string): void {
  closeDatabase();
  resetDatabase();
  try {
    rmSync(join(path, ".."), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  delete process.env["HASNA_ACCESS_DB_PATH"];
}
