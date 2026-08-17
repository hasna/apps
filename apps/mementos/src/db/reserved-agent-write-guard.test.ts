// Set in-memory DB before any imports
process.env["MEMENTOS_DB_PATH"] = ":memory:";

import { describe, it, expect, beforeEach } from "bun:test";
import { SqliteAdapter as Database } from "../storage.js";
import { createMemory, bulkUpsertMemories } from "./memories.js";

// ============================================================================
// Regression: test harnesses must not be able to write memories into the
// production store under reserved placeholder agent identifiers.
//
// Measured on the fleet store 2026-08-02: four rows were created in a
// 36-second window with agent_id values of "agent-a", "agent-x", "agent-z"
// and "nonexistent-agent" — literal placeholder ids straight from test
// fixtures. The store layer's createMemory/bulkUpsertMemories accepted them
// because ensureMemoryReferences stubs the referenced agents row, so the FK
// never blocked the write. The rows then polluted agent attribution and
// agent-filtered reads of the shared store.
//
// These tests assert the store layer itself refuses reserved placeholder
// agent identifiers, so no caller — CLI, SDK, MCP, server, or a test harness
// that bypasses the CLI — can persist a memory under one of them.
// ============================================================================

const RESERVED_IDS = ["agent-a", "agent-x", "agent-z", "nonexistent-agent"];

function freshDb(): Database {
  const db = new Database(":memory:", { create: true });
  db.run("PRAGMA foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'knowledge' CHECK(category IN ('preference', 'fact', 'knowledge', 'history', 'procedural', 'resource')),
      scope TEXT NOT NULL DEFAULT 'private' CHECK(scope IN ('global', 'shared', 'private', 'working')),
      summary TEXT,
      tags TEXT DEFAULT '[]',
      importance INTEGER NOT NULL DEFAULT 5 CHECK(importance >= 1 AND importance <= 10),
      source TEXT NOT NULL DEFAULT 'agent' CHECK(source IN ('user', 'agent', 'system', 'auto', 'imported')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived', 'expired')),
      pinned INTEGER NOT NULL DEFAULT 0,
      agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      session_id TEXT,
      machine_id TEXT,
      when_to_use TEXT DEFAULT NULL,
      sequence_group TEXT DEFAULT NULL,
      sequence_order INTEGER DEFAULT NULL,
      metadata TEXT DEFAULT '{}',
      access_count INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1,
      expires_at TEXT,
      valid_from TEXT DEFAULT NULL,
      valid_until TEXT DEFAULT NULL,
      ingested_at TEXT DEFAULT NULL,
      namespace TEXT DEFAULT NULL,
      created_by_agent TEXT DEFAULT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      accessed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS memory_tags (
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      tag TEXT NOT NULL,
      PRIMARY KEY (memory_id, tag)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_unique_key
      ON memories(key, scope, COALESCE(agent_id, ''), COALESCE(project_id, ''), COALESCE(session_id, ''));
  `);
  return db;
}

describe("reserved placeholder agent id guard", () => {
  let db: Database;

  beforeEach(() => {
    db = freshDb();
  });

  for (const reserved of RESERVED_IDS) {
    it(`createMemory rejects agent_id "${reserved}"`, () => {
      expect(() =>
        createMemory(
          {
            key: `leak-${reserved}`,
            value: "must not land",
            scope: "private",
            category: "knowledge",
            agent_id: reserved,
          },
          "merge",
          db
        )
      ).toThrow(new RegExp(`Reserved placeholder agent id "${reserved}"`));

      // Nothing was written, and no stub agent row was created either.
      const rows = db.query("SELECT COUNT(*) AS n FROM memories").get() as { n: number };
      expect(rows.n).toBe(0);
    });
  }

  it("createMemory rejects a case/whitespace variant of a reserved id", () => {
    expect(() =>
      createMemory(
        {
          key: "leak-case",
          value: "must not land",
          agent_id: "  Agent-A  ",
        },
        "merge",
        db
      )
    ).toThrow(/Reserved placeholder agent id/);
  });

  it("createMemory still accepts a real agent id (positive control)", () => {
    db.run("INSERT INTO agents (id, name, created_at, last_seen_at) VALUES (?, ?, datetime('now'), datetime('now'))", [
      "agent-42",
      "test-agent-42",
    ]);
    const memory = createMemory(
      {
        key: "legit",
        value: "belongs to a real agent",
        scope: "private",
        agent_id: "agent-42",
      },
      "merge",
      db
    );
    expect(memory.key).toBe("legit");
    expect(memory.agent_id).toBe("agent-42");
  });

  it("createMemory still accepts a null agent_id (positive control)", () => {
    const memory = createMemory(
      {
        key: "unowned",
        value: "no owner",
        scope: "private",
      },
      "merge",
      db
    );
    expect(memory.key).toBe("unowned");
    expect(memory.agent_id).toBeNull();
  });

  it("bulkUpsertMemories rejects rows under reserved ids and reports them", () => {
    db.run("INSERT INTO agents (id, name, created_at, last_seen_at) VALUES (?, ?, datetime('now'), datetime('now'))", [
      "agent-42",
      "test-agent-42",
    ]);
    const result = bulkUpsertMemories(
      [
        { key: "ok-row", value: "fine", agent_id: "agent-42" },
        { key: "bad-row", value: "must not land", agent_id: "agent-a" },
        { key: "bad-row-2", value: "must not land", agent_id: "nonexistent-agent" },
      ],
      db
    );

    expect(result.inserted).toBe(1);
    expect(result.rejected).toBe(2);
    expect(result.errors.join("\n")).toContain('Reserved placeholder agent id "agent-a"');
    expect(result.errors.join("\n")).toContain('Reserved placeholder agent id "nonexistent-agent"');

    const rows = db.query("SELECT COUNT(*) AS n FROM memories").get() as { n: number };
    expect(rows.n).toBe(1);
  });
});
