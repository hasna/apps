import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Create a fresh temp SQLite DB path and point the app env at it. */
export function useTempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "consolidations-test-"));
  const path = join(dir, "consolidations.db");
  process.env["HASNA_CONSOLIDATIONS_DB_PATH"] = path;
  return path;
}

export function cleanupTempDb(path: string): void {
  const dir = path.replace(/\/consolidations\.db$/, "");
  rmSync(dir, { recursive: true, force: true });
  delete process.env["HASNA_CONSOLIDATIONS_DB_PATH"];
}
