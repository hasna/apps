import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ConversationsDatabase, closeDb } from "./db.js";
import type { RemoteAdapter } from "./message-sync.js";
import { registerAgent, removePresence, renameAgent } from "./presence.js";
import type { PgAdapterAsync } from "./remote-storage.js";
import { syncPull, syncPush } from "./storage-sync.js";
import {
  SYNC_AGENT_TOMBSTONES_TABLE,
  applyAgentTombstonesLocal,
  ensureAgentTombstonesTable,
  listAgentTombstones,
  pullAgentTombstones,
  pushAgentTombstones,
  recordAgentTombstone,
} from "./sync-tombstones.js";

// Mirrors the production SQLite agent_presence shape (naive-UTC text timestamps).
const LOCAL_PRESENCE_DDL = `
  CREATE TABLE agent_presence (
    id TEXT NOT NULL,
    agent TEXT NOT NULL,
    session_id TEXT,
    role TEXT NOT NULL DEFAULT 'agent',
    project_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'online',
    last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
    metadata TEXT,
    PRIMARY KEY (agent, project_id)
  );
  CREATE UNIQUE INDEX idx_agent_presence_agent_unique ON agent_presence(agent);
`;

// SQLite stand-in for the hub Postgres schema. TEXT timestamps keep the
// lexicographic comparison semantics the raw-naive convention relies on.
const REMOTE_DDL = `
  CREATE TABLE agent_presence (
    id TEXT NOT NULL DEFAULT '',
    agent TEXT NOT NULL,
    session_id TEXT,
    role TEXT NOT NULL DEFAULT 'agent',
    project_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'online',
    last_seen_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
    metadata TEXT,
    PRIMARY KEY (agent, project_id)
  );
  CREATE UNIQUE INDEX idx_agent_presence_agent_unique ON agent_presence(agent);
  CREATE TABLE ${SYNC_AGENT_TOMBSTONES_TABLE} (
    agent TEXT PRIMARY KEY,
    deleted_at TEXT NOT NULL
  );
`;

const PRESENCE_COLUMNS = [
  "id", "agent", "session_id", "role", "project_id", "status", "last_seen_at", "created_at", "metadata",
];

class FakeRemote implements RemoteAdapter {
  readonly db: ConversationsDatabase;

  constructor(options: { tombstonesTable?: boolean } = {}) {
    this.db = new ConversationsDatabase(":memory:");
    this.db.exec(REMOTE_DDL);
    if (options.tombstonesTable === false) {
      this.db.exec(`DROP TABLE ${SYNC_AGENT_TOMBSTONES_TABLE}`);
    }
    // pushTable discovers remote columns through information_schema; give the
    // SQLite stand-in one via an attached schema of that name.
    this.db.exec("ATTACH ':memory:' AS information_schema");
    this.db.exec(`
      CREATE TABLE information_schema.columns (
        table_schema TEXT NOT NULL DEFAULT 'public',
        table_name TEXT NOT NULL,
        column_name TEXT NOT NULL,
        data_type TEXT NOT NULL DEFAULT 'text'
      )
    `);
    const seed = this.db.prepare(
      "INSERT INTO information_schema.columns (table_schema, table_name, column_name) VALUES ('public', ?, ?)",
    );
    for (const column of PRESENCE_COLUMNS) seed.run("agent_presence", column);
  }

  async run(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
    return this.db.run(sql, ...params);
  }

  async all(sql: string, ...params: unknown[]): Promise<unknown[]> {
    return this.db.all(sql, ...params);
  }

  async get(sql: string, ...params: unknown[]): Promise<unknown | null> {
    return this.db.get(sql, ...params);
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

function newLocal(): ConversationsDatabase {
  const db = new ConversationsDatabase(":memory:");
  db.exec(LOCAL_PRESENCE_DDL);
  return db;
}

function insertPresence(
  db: ConversationsDatabase,
  agent: string,
  lastSeenAt: string,
  projectId = "",
): void {
  db.prepare(`
    INSERT INTO agent_presence (id, agent, project_id, status, last_seen_at, created_at)
    VALUES (?, ?, ?, 'online', ?, ?)
  `).run(agent.slice(0, 8).padEnd(8, "0"), agent, projectId, lastSeenAt, lastSeenAt);
}

async function insertRemotePresence(remote: FakeRemote, agent: string, lastSeenAt: string): Promise<void> {
  await remote.run(
    "INSERT INTO agent_presence (id, agent, project_id, status, last_seen_at, created_at) VALUES (?, ?, '', 'online', ?, ?)",
    agent.slice(0, 8).padEnd(8, "0"), agent, lastSeenAt, lastSeenAt,
  );
}

async function remoteAgents(remote: FakeRemote): Promise<string[]> {
  const rows = await remote.all("SELECT agent FROM agent_presence ORDER BY agent") as Array<{ agent: string }>;
  return rows.map((row) => row.agent);
}

function localAgents(db: ConversationsDatabase): string[] {
  return db.all<{ agent: string }>("SELECT agent FROM agent_presence ORDER BY agent").map((row) => row.agent);
}

const STALE = "2026-04-01T00:00:00.000";
const RECENT = "2026-07-06T12:00:00.000";
const TOMBSTONE_AT = "2026-07-06T15:50:00.000";

describe("agent tombstones", () => {
  it("records tombstones normalized and keeps the newest deleted_at", () => {
    const db = newLocal();
    try {
      recordAgentTombstone(db, "  Ghost ", TOMBSTONE_AT);
      recordAgentTombstone(db, "ghost", STALE); // older — must not win
      const rows = listAgentTombstones(db);
      expect(rows).toEqual([{ agent: "ghost", deleted_at: TOMBSTONE_AT }]);

      recordAgentTombstone(db, "ghost", "2026-07-06T16:00:00.000"); // newer — wins
      expect(listAgentTombstones(db)[0]!.deleted_at).toBe("2026-07-06T16:00:00.000");

      recordAgentTombstone(db, "   ");
      expect(listAgentTombstones(db)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it("applies tombstones locally only to rows older than the tombstone", () => {
    const db = newLocal();
    try {
      insertPresence(db, "ghost", STALE);
      insertPresence(db, "phoenix", RECENT); // re-registered after removal
      recordAgentTombstone(db, "ghost", TOMBSTONE_AT);
      recordAgentTombstone(db, "phoenix", "2026-07-06T10:00:00.000"); // older than row

      expect(applyAgentTombstonesLocal(db)).toBe(1);
      expect(localAgents(db)).toEqual(["phoenix"]);
    } finally {
      db.close();
    }
  });

  it("push propagates agent removal to the remote (registry-purge regression)", async () => {
    const db = newLocal();
    const remote = new FakeRemote();
    try {
      insertPresence(db, "alpha", RECENT); // live local agent
      recordAgentTombstone(db, "ghost", TOMBSTONE_AT); // purged locally
      await insertRemotePresence(remote, "ghost", STALE); // hub still has pre-purge row
      await insertRemotePresence(remote, "beta", RECENT); // live agent from another machine

      const results = await syncPush(db, remote as unknown as PgAdapterAsync, { tables: ["agent_presence"] });

      expect(await remoteAgents(remote)).toEqual(["alpha", "beta"]);
      const tombstoneResult = results.find((r) => r.table === SYNC_AGENT_TOMBSTONES_TABLE);
      expect(tombstoneResult).toBeDefined();
      expect(tombstoneResult!.rowsRead).toBe(1);
      expect(tombstoneResult!.rowsWritten).toBe(1); // ghost deleted remotely
      expect(tombstoneResult!.errors).toEqual([]);
      const presenceResult = results.find((r) => r.table === "agent_presence");
      expect(presenceResult!.errors).toEqual([]);
    } finally {
      await remote.close();
      db.close();
    }
  });

  it("push never deletes a remote row that re-registered after the tombstone", async () => {
    const db = newLocal();
    const remote = new FakeRemote();
    try {
      recordAgentTombstone(db, "phoenix", TOMBSTONE_AT);
      await insertRemotePresence(remote, "phoenix", "2026-07-06T16:30:00.000"); // newer than tombstone

      await syncPush(db, remote as unknown as PgAdapterAsync, { tables: ["agent_presence"] });

      expect(await remoteAgents(remote)).toEqual(["phoenix"]);
    } finally {
      await remote.close();
      db.close();
    }
  });

  it("pull does not resurrect agents the hub has tombstones for", async () => {
    const db = newLocal();
    const remote = new FakeRemote();
    try {
      await insertRemotePresence(remote, "ghost", STALE); // un-purged row still on hub
      await insertRemotePresence(remote, "beta", RECENT);
      await remote.run(
        `INSERT INTO ${SYNC_AGENT_TOMBSTONES_TABLE} (agent, deleted_at) VALUES (?, ?)`,
        "ghost", TOMBSTONE_AT,
      );

      const results = await syncPull(remote as unknown as PgAdapterAsync, db, { tables: ["agent_presence"] });

      expect(localAgents(db)).toEqual(["beta"]); // ghost pulled then reconciled away
      expect(listAgentTombstones(db)).toEqual([{ agent: "ghost", deleted_at: TOMBSTONE_AT }]);
      const tombstoneResult = results.find((r) => r.table === SYNC_AGENT_TOMBSTONES_TABLE);
      expect(tombstoneResult!.rowsRead).toBe(1);
      expect(tombstoneResult!.rowsWritten).toBe(1);
    } finally {
      await remote.close();
      db.close();
    }
  });

  it("pull reconciles a stale replica's own copy of a fleet-removed agent", async () => {
    // The spark02 scenario: replica never purged, hub already purged + tombstoned.
    const db = newLocal();
    const remote = new FakeRemote();
    try {
      insertPresence(db, "ghost", STALE); // replica's own stale copy
      await remote.run(
        `INSERT INTO ${SYNC_AGENT_TOMBSTONES_TABLE} (agent, deleted_at) VALUES (?, ?)`,
        "ghost", TOMBSTONE_AT,
      );

      await syncPull(remote as unknown as PgAdapterAsync, db, { tables: ["agent_presence"] });

      expect(localAgents(db)).toEqual([]);
    } finally {
      await remote.close();
      db.close();
    }
  });

  it("pull tolerates a remote that predates the tombstones migration", async () => {
    const db = newLocal();
    const remote = new FakeRemote({ tombstonesTable: false });
    try {
      insertPresence(db, "ghost", STALE);
      recordAgentTombstone(db, "ghost", TOMBSTONE_AT); // local tombstone still applies

      const result = await pullAgentTombstones(remote, db);

      expect(result.errors).toEqual([]);
      expect(result.rowsRead).toBe(0);
      expect(result.rowsWritten).toBe(1);
      expect(localAgents(db)).toEqual([]);
    } finally {
      await remote.close();
      db.close();
    }
  });

  it("presence upserts converge on agent name across differing project_ids", async () => {
    // The pre-fix conflict target (agent, project_id) missed the agent-unique
    // index: the same name with another project_id took the INSERT path and
    // aborted the whole presence sync (spark02's cutover push never converged).
    const db = newLocal();
    const remote = new FakeRemote();
    try {
      insertPresence(db, "wanderer", "2026-07-06T17:00:00.000", "/home/hasna/project-a");
      await insertRemotePresence(remote, "wanderer", RECENT); // project_id '' on hub

      const results = await syncPush(db, remote as unknown as PgAdapterAsync, { tables: ["agent_presence"] });

      expect(results.find((r) => r.table === "agent_presence")!.errors).toEqual([]);
      const rows = await remote.all(
        "SELECT agent, project_id, last_seen_at FROM agent_presence WHERE agent = 'wanderer'",
      ) as Array<{ agent: string; project_id: string; last_seen_at: string }>;
      expect(rows).toHaveLength(1); // one identity per agent name — no dupes, no abort
      expect(rows[0]!.project_id).toBe("/home/hasna/project-a"); // newer row won
      expect(rows[0]!.last_seen_at).toBe("2026-07-06T17:00:00.000");
    } finally {
      await remote.close();
      db.close();
    }
  });

  it("a stale replica never regresses fresher presence (push or pull)", async () => {
    const db = newLocal();
    const remote = new FakeRemote();
    try {
      insertPresence(db, "keeper", "2026-07-06T10:00:00.000"); // replica's stale view
      await insertRemotePresence(remote, "keeper", "2026-07-06T17:00:00.000"); // hub fresher

      await syncPush(db, remote as unknown as PgAdapterAsync, { tables: ["agent_presence"] });
      const remoteRow = await remote.get(
        "SELECT last_seen_at FROM agent_presence WHERE agent = 'keeper'",
      ) as { last_seen_at: string };
      expect(remoteRow.last_seen_at).toBe("2026-07-06T17:00:00.000"); // guard held

      await syncPull(remote as unknown as PgAdapterAsync, db, { tables: ["agent_presence"] });
      const localRow = db.get<{ last_seen_at: string }>(
        "SELECT last_seen_at FROM agent_presence WHERE agent = 'keeper'",
      );
      expect(localRow!.last_seen_at).toBe("2026-07-06T17:00:00.000"); // pull updated stale local
    } finally {
      await remote.close();
      db.close();
    }
  });

  it("only the agent_presence phase emits tombstone results", async () => {
    const db = newLocal();
    const remote = new FakeRemote();
    try {
      const pushResults = await syncPush(db, remote as unknown as PgAdapterAsync, { tables: ["channels"] });
      const pullResults = await syncPull(remote as unknown as PgAdapterAsync, db, { tables: ["channels"] });
      expect(pushResults.find((r) => r.table === SYNC_AGENT_TOMBSTONES_TABLE)).toBeUndefined();
      expect(pullResults.find((r) => r.table === SYNC_AGENT_TOMBSTONES_TABLE)).toBeUndefined();
    } finally {
      await remote.close();
      db.close();
    }
  });

  it("push and pull upserts keep the newest tombstone on each side", async () => {
    const db = newLocal();
    const remote = new FakeRemote();
    try {
      recordAgentTombstone(db, "ghost", TOMBSTONE_AT);
      await remote.run(
        `INSERT INTO ${SYNC_AGENT_TOMBSTONES_TABLE} (agent, deleted_at) VALUES (?, ?)`,
        "ghost", "2026-07-06T18:00:00.000", // remote newer
      );

      await pushAgentTombstones(db, remote);
      const remoteRow = await remote.get(
        `SELECT deleted_at FROM ${SYNC_AGENT_TOMBSTONES_TABLE} WHERE agent = 'ghost'`,
      ) as { deleted_at: string };
      expect(remoteRow.deleted_at).toBe("2026-07-06T18:00:00.000"); // older push did not regress it

      await pullAgentTombstones(remote, db);
      expect(listAgentTombstones(db)[0]!.deleted_at).toBe("2026-07-06T18:00:00.000"); // newer pulled in
    } finally {
      await remote.close();
      db.close();
    }
  });
});

describe("removePresence tombstone integration", () => {
  const TEST_DB = join(tmpdir(), `conversations-test-tombstones-${Date.now()}.db`);

  beforeEach(() => {
    process.env.CONVERSATIONS_DB_PATH = TEST_DB;
    closeDb();
  });

  afterEach(() => {
    closeDb();
    delete process.env.CONVERSATIONS_DB_PATH;
    for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(TEST_DB + suffix); } catch { /* ignore */ }
    }
  });

  it("removePresence records a tombstone for the removed agent", async () => {
    const registered = registerAgent("doomed", "session-1");
    expect("agent" in registered).toBe(true);

    expect(removePresence("Doomed")).toBe(true);

    const { getDb } = await import("./db.js");
    const db = getDb();
    const tombstones = listAgentTombstones(db);
    expect(tombstones.map((t) => t.agent)).toEqual(["doomed"]);
    expect(db.all("SELECT agent FROM agent_presence")).toHaveLength(0);
  });

  it("re-registering after removal outlives the tombstone locally", async () => {
    registerAgent("lazarus", "session-1");
    removePresence("lazarus");
    registerAgent("lazarus", "session-2");

    const { getDb } = await import("./db.js");
    expect(applyAgentTombstonesLocal(getDb())).toBe(0);
    const rows = getDb().all<{ agent: string }>("SELECT agent FROM agent_presence WHERE agent = 'lazarus'");
    expect(rows).toHaveLength(1);
  });

  it("renameAgent tombstones the old name and revives the new one", async () => {
    registerAgent("before", "session-1");
    removePresence("after"); // the target name carries an old tombstone

    expect(renameAgent("before", "after")).toBe(true);

    const { getDb } = await import("./db.js");
    const db = getDb();
    const tombstoned = listAgentTombstones(db).map((t) => t.agent);
    expect(tombstoned).toContain("before"); // old name must not resurrect from the hub
    expect(tombstoned).not.toContain("after"); // revived name cleared locally
    // The renamed row's bumped last_seen_at outlives any remaining hub-side
    // tombstone copy for the new name — the local apply must keep it too.
    expect(applyAgentTombstonesLocal(db)).toBe(0);
    expect(db.all("SELECT agent FROM agent_presence")).toHaveLength(1);
  });
});
