import { SqliteAdapter } from "@hasna/cloud";
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const originalDbPath = process.env.HASNA_FILES_DB_PATH;
const testDir = mkdtempSync(join(tmpdir(), "files-database-test-"));

beforeAll(() => {
  process.env.HASNA_FILES_DB_PATH = join(testDir, "files.db");
});

afterAll(async () => {
  const { closeDb } = await import("./database.js");
  closeDb();
  if (originalDbPath === undefined) delete process.env.HASNA_FILES_DB_PATH;
  else process.env.HASNA_FILES_DB_PATH = originalDbPath;
  rmSync(testDir, { recursive: true, force: true });
});

test("initializes the local database through the cloud adapter", async () => {
  const { getDb } = await import("./database.js");
  const db = getDb();

  // The point of this migration: the handle is a @hasna/cloud SqliteAdapter,
  // not a bun:sqlite Database. Reverting database.ts must fail here.
  expect(db).toBeInstanceOf(SqliteAdapter);
  expect(db.raw.constructor.name).toBe("Database");

  const rows = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')",
    )
    .all();
  const names = new Set(rows.map((row) => row.name));

  for (const name of [
    "collections",
    "files",
    "files_fts",
    "machines",
    "peers",
    "projects",
    "sources",
    "tags",
  ]) {
    expect(names.has(name)).toBe(true);
  }
});

test("commits and rolls back writes through the adapter transaction", async () => {
  const { appendKnowledgeSourceOutboxEvent, getKnowledgeSourceOutboxEvent } =
    await import("./knowledge-outbox.js");

  // Converted call site: db.transaction(fn) now runs the body itself.
  const event = appendKnowledgeSourceOutboxEvent({
    event_type: "indexed",
    file_id: "file_tx_commit",
  });
  expect(event.cursor).toBeGreaterThan(0);
  expect(getKnowledgeSourceOutboxEvent(event.id)?.file_id).toBe("file_tx_commit");

  const { getDb } = await import("./database.js");
  const db = getDb();
  expect(() =>
    db.transaction(() => {
      db.run(
        "INSERT INTO knowledge_source_outbox_events (id, cursor, event_type) VALUES (?, ?, ?)",
        ["out_tx_rollback", event.cursor + 1000, "indexed"],
      );
      throw new Error("boom");
    }),
  ).toThrow("boom");
  expect(getKnowledgeSourceOutboxEvent("out_tx_rollback")).toBeNull();
});
