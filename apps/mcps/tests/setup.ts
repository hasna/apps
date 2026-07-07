/**
 * Test setup: redirect the database to a temp directory so tests
 * don't touch the real ~/.mcps/registry.db.
 *
 * IMPORTANT: This file must be imported (or preloaded) before any
 * source module that depends on config / db.
 */

import { mock } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

export const TEST_DIR = mkdtempSync(join(tmpdir(), "mcps-test-"));
export const TEST_DB_PATH = join(TEST_DIR, "test.db");

// Mock the config module so all downstream imports (db, registry, …)
// use the temp directory instead of ~/.mcps/
mock.module(join(import.meta.dir, "../src/lib/config.ts"), () => ({
  MCPS_DIR: TEST_DIR,
  DB_PATH: TEST_DB_PATH,
  resolveStorageMode: () => "local",
  REGISTRY_API_URL: "https://registry.modelcontextprotocol.io/v0/servers",
  TOOL_PREFIX_SEPARATOR: "__",
}));
