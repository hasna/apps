import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { getDatabase, getDatabasePath, resetDatabase } from "../db/database.js";
import { resetTodosTestEnvironment } from "./setup.js";

afterAll(() => resetDatabase());
beforeEach(() => resetTodosTestEnvironment({ forceBaseline: true }));

describe("repository test preload isolation", () => {
  test("uses a disposable HOME and one explicit file-backed database", () => {
    const root = process.env.HASNA_TODOS_TEST_ROOT;
    const home = process.env.HOME;
    const primaryDb = process.env.HASNA_TODOS_DB_PATH;
    const fallbackDb = process.env.TODOS_DB_PATH;

    expect(root).toBeTruthy();
    expect(home).toBe(root);
    expect(primaryDb).toBeUndefined();
    expect(fallbackDb).toBe(join(root!, "todos-tests.db"));
    expect(isAbsolute(root!)).toBe(true);
    expect(relative(tmpdir(), root!).startsWith("..")).toBe(false);
    expect(getDatabasePath()).toBe(fallbackDb!);

    const defaultDb = join(root!, ".hasna", "todos", "todos.db");
    getDatabase();
    expect(existsSync(fallbackDb!)).toBe(true);
    expect(existsSync(defaultDb)).toBe(false);
  });

  test("clears storage routing and shadow state before selecting local mode", () => {
    expect(process.env.HASNA_TODOS_STORAGE_MODE).toBe("local");
    expect(process.env.TODOS_STORAGE_MODE).toBe("local");
    for (const name of [
      "HASNA_TODOS_SHADOW", "TODOS_SHADOW",
      "HASNA_TODOS_DATABASE_URL", "TODOS_DATABASE_URL",
      "HASNA_TODOS_API_URL", "HASNA_TODOS_API_KEY",
      "TODOS_URL", "DATABASE_URL", "TODOS_DB_SCOPE", "TODOS_AUTO_PROJECT",
      "TODOS_APP_SLUG", "TODOS_TASK_LIST_ID", "TODOS_CLAUDE_TASK_LIST", "TODOS_PROFILE",
    ]) {
      expect(process.env[name]).toBeUndefined();
    }
  });

  test("never reuses or mutates an unrelated inherited temporary database", () => {
    const root = process.env.HASNA_TODOS_TEST_ROOT!;
    const unrelatedRoot = mkdtempSync(join(dirname(root), "unrelated-todos-db-"));
    const unrelatedDb = join(unrelatedRoot, "unrelated.db");
    const sentinel = "not-a-todos-database";
    writeFileSync(unrelatedDb, sentinel);

    try {
      process.env.TODOS_DB_PATH = unrelatedDb;
      process.env.HOME = unrelatedRoot;
      resetTodosTestEnvironment();

      expect(process.env.TODOS_DB_PATH).toBe(join(root, "todos-tests.db"));
      expect(process.env.HOME).toBe(root);
      expect(readFileSync(unrelatedDb, "utf8")).toBe(sentinel);
    } finally {
      rmSync(unrelatedRoot, { recursive: true, force: true });
    }
  });
});
