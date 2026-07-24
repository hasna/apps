import { beforeEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const ROOT_ENV = "HASNA_TODOS_TEST_ROOT";
const ROOT_PREFIX = "hasna-todos-test-run-";
const systemTmp = resolve(tmpdir());

// Always mint this process its own root. A prefix-matching inherited path is
// not proof of ownership and must never become a writable test capability.
const testRoot = mkdtempSync(join(systemTmp, ROOT_PREFIX));

// Establish filesystem isolation before any application module can derive a
// home directory, config path, artifact path, or SQLite fallback.
process.env[ROOT_ENV] = testRoot;
process.env.HOME = testRoot;
process.env.USERPROFILE = testRoot;
process.env.TMPDIR = testRoot;

const ROUTING_AND_STORAGE_ENV = [
  "HASNA_TODOS_STORAGE_MODE", "TODOS_STORAGE_MODE",
  "HASNA_TODOS_SHADOW", "TODOS_SHADOW",
  "HASNA_TODOS_DATABASE_URL", "TODOS_DATABASE_URL",
  "HASNA_TODOS_DATABASE_SSL", "TODOS_DATABASE_SSL",
  "HASNA_TODOS_DATABASE_SCHEMA", "TODOS_DATABASE_SCHEMA",
  "HASNA_TODOS_S3_BUCKET", "TODOS_S3_BUCKET",
  "HASNA_TODOS_S3_PREFIX", "TODOS_S3_PREFIX",
  "HASNA_TODOS_AWS_REGION", "TODOS_AWS_REGION",
  "HASNA_TODOS_S3_ENDPOINT", "TODOS_S3_ENDPOINT",
  "HASNA_TODOS_S3_FORCE_PATH_STYLE", "TODOS_S3_FORCE_PATH_STYLE",
  "HASNA_TODOS_S3_ACCESS_KEY_ID", "TODOS_S3_ACCESS_KEY_ID",
  "HASNA_TODOS_S3_SECRET_ACCESS_KEY", "TODOS_S3_SECRET_ACCESS_KEY",
  "HASNA_TODOS_S3_SESSION_TOKEN", "TODOS_S3_SESSION_TOKEN",
  "HASNA_TODOS_SYNC_BATCH_SIZE", "TODOS_SYNC_BATCH_SIZE",
  "HASNA_TODOS_SYNC_DRY_RUN", "TODOS_SYNC_DRY_RUN",
  "HASNA_TODOS_API_URL", "HASNA_TODOS_API_KEY", "HASNA_TODOS_API_SIGNING_KEY",
  "TODOS_API_KEY", "TODOS_URL",
  "DATABASE_URL",
  "HASNA_TODOS_ARTIFACTS_DIR", "TODOS_ARTIFACTS_DIR",
  "HASNA_TODOS_DB_PATH", "TODOS_DB_PATH", "TODOS_DB_SCOPE", "TODOS_AUTO_PROJECT",
  "TODOS_APP_SLUG", "TODOS_TASK_LIST_ID", "TODOS_CLAUDE_TASK_LIST", "TODOS_PROFILE",
] as const;

const databasePath = join(testRoot, "todos-tests.db");

function isDisposableDatabasePath(value: string | undefined): value is string {
  if (!value) return false;
  if (value === ":memory:") return true;
  const candidate = resolve(value);
  return candidate.startsWith(`${testRoot}${sep}`);
}

function removeBaselineDatabase(): void {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${databasePath}${suffix}`, { force: true });
  }
}

function applyLocalTestEnvironment(selectedDatabasePath: string): void {
  for (const name of ROUTING_AND_STORAGE_ENV) delete process.env[name];

  process.env[ROOT_ENV] = testRoot;
  process.env.HOME = testRoot;
  process.env.USERPROFILE = testRoot;
  process.env.TMPDIR = testRoot;

  // Use the legacy fallback key deliberately: hundreds of existing tests set
  // it in their own narrow beforeEach hook. Setting the higher-priority key in
  // the preload would silently override those disposable fixtures.
  process.env.TODOS_DB_PATH = selectedDatabasePath;
  process.env.HASNA_TODOS_STORAGE_MODE = "local";
  process.env.TODOS_STORAGE_MODE = "local";
}

export function resetTodosTestEnvironment(options: { forceBaseline?: boolean } = {}): void {
  resetApplicationDatabase();
  const inheritedTestPath = process.env.TODOS_DB_PATH;
  const selectedDatabasePath = !options.forceBaseline && isDisposableDatabasePath(inheritedTestPath)
    ? inheritedTestPath
    : databasePath;

  if (selectedDatabasePath === databasePath) removeBaselineDatabase();
  applyLocalTestEnvironment(selectedDatabasePath);
}

// Establish an explicit file-backed baseline before application modules load.
removeBaselineDatabase();
applyLocalTestEnvironment(databasePath);

// Import only after HOME and the DB path are isolated. Merely importing the DB
// module does not open SQLite; the hook resets any handle a preceding test left.
const { resetDatabase: resetApplicationDatabase } = await import("../db/database.js");

beforeEach(() => {
  resetTodosTestEnvironment();
});

process.once("exit", () => {
  rmSync(testRoot, { recursive: true, force: true });
});
