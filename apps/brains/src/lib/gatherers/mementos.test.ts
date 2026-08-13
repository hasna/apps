import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

function createMementosDb(homeDir: string): void {
  const dbDir = join(homeDir, ".mementos");
  mkdirSync(dbDir, { recursive: true });
  const db = new Database(join(dbDir, "mementos.db"));
  try {
    db.run(`
      CREATE TABLE memories (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        category TEXT NOT NULL,
        scope TEXT NOT NULL,
        summary TEXT,
        tags TEXT,
        importance INTEGER NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        accessed_at TEXT
      )
    `);
    db.run(
      `INSERT INTO memories (
        id, key, value, category, scope, summary, tags, importance,
        source, status, created_at, accessed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      "memory-1",
      "favorite_editor",
      "Helix",
      "preferences",
      "global",
      null,
      "{not-json",
      7,
      "test",
      "active",
      "2026-01-01T00:00:00.000Z",
      null
    );
  } finally {
    db.close();
  }
}

describe("gatherFromMementos", () => {
  test("uses supplied homeDir and treats malformed memory tags as empty", async () => {
    const homeDir = join(tmpdir(), `brains-mementos-gatherer-${Date.now()}`);
    createMementosDb(homeDir);

    try {
      const { gatherFromMementos } = await import("./mementos.js");
      const result = await gatherFromMementos({ limit: 2, homeDir });

      expect(result.source).toBe("mementos");
      expect(result.count).toBe(2);
      expect(result.examples[1]?.messages[1]?.content).toBe("Remember this for me: favorite_editor = Helix");
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
