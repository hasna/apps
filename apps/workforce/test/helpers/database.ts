import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDatabase, resetDatabase } from "../../src/db/database.js";

/** Point the app at a fresh temp SQLite file and open it. Returns the path. */
export function useTestDatabase(prefix = "workforce-test"): string {
  const path = join(tmpdir(), `${prefix}-${crypto.randomUUID()}.db`);
  process.env["HASNA_WORKFORCE_DB_PATH"] = path;
  resetDatabase();
  getDatabase(path);
  return path;
}

export function cleanupTestDatabase(path: string): void {
  resetDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = `${path}${suffix}`;
    if (existsSync(p)) rmSync(p, { force: true });
  }
  delete process.env["HASNA_WORKFORCE_DB_PATH"];
}

const UUID = () => crypto.randomUUID();

export const testEntity = UUID;
