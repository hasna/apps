import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Database } from "bun:sqlite";
import { closeDatabase, getDatabase, resetDatabase, uuid } from "../../src/db/database.js";
import { upsertEntity } from "../../src/db/crud.js";
import { FIXTURE_ENTITIES } from "../../src/adapters/fixtures.js";
import { localOwnerPrincipal, type ApiPrincipal } from "../../src/server/auth.js";
import { defaultAdapters } from "../../src/adapters/index.js";
import type { OpContext } from "../../src/services/registry.js";

export function createTestDatabasePath(prefix = "fleet-test"): string {
  return join(tmpdir(), `${prefix}-${Date.now()}-${uuid().slice(0, 8)}.db`);
}

export function useTestDatabase(prefix?: string): string {
  const dbPath = createTestDatabasePath(prefix);
  process.env["HASNA_FLEET_DB_PATH"] = dbPath;
  resetDatabase();
  return dbPath;
}

export function cleanupTestDatabase(dbPath: string): void {
  closeDatabase();
  for (const suffix of ["", "-shm", "-wal"]) {
    const p = `${dbPath}${suffix}`;
    if (existsSync(p)) rmSync(p);
  }
  delete process.env["HASNA_FLEET_DB_PATH"];
}

export function seededDb(): Database {
  const db = getDatabase();
  for (const e of FIXTURE_ENTITIES) upsertEntity(db, e.id, e.slug, e.name);
  return db;
}

export function ownerCtx(db?: Database, principal: ApiPrincipal = localOwnerPrincipal()): OpContext {
  return { db: db ?? getDatabase(), principal, adapters: defaultAdapters() };
}

export function getDbHelper(): Database {
  return getDatabase();
}
