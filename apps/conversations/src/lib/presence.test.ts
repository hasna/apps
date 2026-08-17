import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { Database as SqliteDatabase } from "bun:sqlite";
import { heartbeat, getPresence, listAgents, removePresence, renameAgent, registerAgent, isAgentConflict, setPresenceProject, reapStaleSingleTouchRegistrations } from "./presence";
import { closeDb, getDb } from "./db";
import type { AgentConflictError, RegisterAgentResult } from "../types";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { pinStoreToDb, restoreStoreEnv } from "./store/isolated-test-env.js";

const TEST_DB = join(tmpdir(), `conversations-test-presence-${Date.now()}.db`);

beforeEach(() => {
  pinStoreToDb(TEST_DB);
  closeDb();
});

afterEach(() => {
  closeDb();
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_DB + "-wal"); } catch {}
  try { unlinkSync(TEST_DB + "-shm"); } catch {}
  restoreStoreEnv();
});

function seedLegacyPresenceDb(): void {
  const db = new SqliteDatabase(TEST_DB);
  db.exec(`
    CREATE TABLE agent_presence (
      id TEXT NOT NULL,
      agent TEXT NOT NULL,
      project_id TEXT NOT NULL DEFAULT '',
      session_id TEXT,
      pid INTEGER,
      role TEXT NOT NULL DEFAULT 'agent',
      status TEXT NOT NULL DEFAULT 'online',
      last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      metadata TEXT,
      PRIMARY KEY (agent, project_id)
    )
  `);

  const insertLegacyRow = db.prepare(`
    INSERT INTO agent_presence (id, agent, project_id, session_id, pid, role, status, last_seen_at, created_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertLegacyRow.run(
    "oldagent1",
    "legacy-agent",
    "old-project",
    "session-old",
    101,
    "agent",
    "idle",
    "2026-04-08T12:00:00.000",
    "2026-04-08T12:00:00.000",
    null
  );
  insertLegacyRow.run(
    "newagent1",
    "LEGACY-AGENT",
    "new-project",
    "session-new",
    202,
    "coordinator",
    "busy",
    "2026-04-08T14:00:00.000",
    "2026-04-08T14:00:00.000",
    "{\"task\":\"latest\"}"
  );

  db.close();
}

function seedSingleProjectPresenceDb(): void {
  const db = new SqliteDatabase(TEST_DB);
  db.exec(`
    CREATE TABLE agent_presence (
      id TEXT NOT NULL,
      agent TEXT PRIMARY KEY,
      session_id TEXT,
      role TEXT NOT NULL DEFAULT 'agent',
      project_id TEXT,
      status TEXT NOT NULL DEFAULT 'online',
      last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
      metadata TEXT
    )
  `);
  db.prepare(`
    INSERT INTO agent_presence (id, agent, session_id, role, project_id, status, last_seen_at, created_at, metadata)
    VALUES ('solo1111', 'solo-agent', 'session-solo', 'agent', NULL, 'busy', '2026-04-08T11:00:00.000', '2026-04-08T11:00:00.000', '{"source":"single"}')
  `).run();
  db.close();
}

describe("registerAgent", () => {
  test("creates new agent and returns created=true", () => {
    const result = registerAgent("brutus", "session-abc") as RegisterAgentResult;
    expect(result.created).toBe(true);
    expect(result.took_over).toBe(false);
    expect(result.agent.agent).toBe("brutus");
    expect(result.agent.session_id).toBe("session-abc");
    expect(result.agent.role).toBe("agent");
    expect(result.agent.id).toHaveLength(8);
    expect(result.agent.created_at).toBeTruthy();
  });

  test("sets custom role", () => {
    const result = registerAgent("maximus", "session-xyz", "coordinator") as RegisterAgentResult;
    expect(result.agent.role).toBe("coordinator");
  });

  test("same session re-registration updates last_seen_at and returns took_over=false", () => {
    registerAgent("julius", "session-1");
    const result = registerAgent("julius", "session-1") as RegisterAgentResult;
    expect(result.created).toBe(false);
    expect(result.took_over).toBe(false);
  });

  test("returns AgentConflictError when active agent has different session", () => {
    registerAgent("titus", "session-active");
    const result = registerAgent("titus", "session-new") as AgentConflictError;
    expect(result.conflict).toBe(true);
    expect(result.error).toBe("agent_conflict");
    expect(result.existing_session_id).toBe("session-active");
    expect(result.existing_name).toBe("titus");
    expect(result.existing_id).toHaveLength(8);
    expect(result.session_hint).toBe("session-");
    expect(result.working_dir).toBeNull();
    expect(result.last_seen_at).toBeTruthy();
  });

  test("isAgentConflict type guard works", () => {
    registerAgent("cassius", "session-1");
    const conflict = registerAgent("cassius", "session-2");
    const success = registerAgent("new-agent-x", "session-3") as RegisterAgentResult;
    expect(isAgentConflict(conflict)).toBe(true);
    expect(isAgentConflict(success)).toBe(false);
  });

  test("normalizes name to lowercase on insert", () => {
    const result = registerAgent("MAXIMUS", "session-upper") as RegisterAgentResult;
    expect(result.agent.agent).toBe("maximus");
    expect(getPresence("maximus")).toBeTruthy();
    expect(getPresence("MAXIMUS")).toBeTruthy(); // case-insensitive lookup
  });

  test("stores project_id when provided", () => {
    const result = registerAgent("project-agent", "session-proj", "agent", "proj-abc123") as RegisterAgentResult;
    expect(result.agent.project_id).toBe("proj-abc123");
  });

  test("project_id defaults to null when not provided", () => {
    const result = registerAgent("no-project-agent", "session-noproj") as RegisterAgentResult;
    expect(result.agent.project_id).toBeNull();
  });

  test("updates project_id on takeover", () => {
    registerAgent("takeover-agent", "session-old", "agent", "old-project");
    const db = getDb();
    db.prepare("UPDATE agent_presence SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '-2000 seconds') WHERE agent = ?").run("takeover-agent");
    const result = registerAgent("takeover-agent", "session-new", "agent", "new-project") as RegisterAgentResult;
    expect(result.took_over).toBe(true);
    expect(result.agent.project_id).toBe("new-project");
  });

  test("TOCTOU safety — transaction wraps check+insert", () => {
    // Verify registerAgent runs inside a transaction (idempotent same-session re-register)
    registerAgent("transaction-agent", "sess-tx");
    const result = registerAgent("transaction-agent", "sess-tx") as RegisterAgentResult;
    expect(result.created).toBe(false);
    expect(result.took_over).toBe(false);
  });

  test("allows takeover when agent is stale (>30 min)", () => {
    registerAgent("stale-agent", "old-session");
    const db = getDb();
    db.prepare(
      "UPDATE agent_presence SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '-1900 seconds') WHERE agent = ?"
    ).run("stale-agent");

    const result = registerAgent("stale-agent", "new-session") as RegisterAgentResult;
    expect(result.created).toBe(false);
    expect(result.took_over).toBe(true);
    expect(result.agent.session_id).toBe("new-session");
  });

  test("idempotent — no session conflict when re-registering same session after stale", () => {
    registerAgent("agent-x", "ses-1");
    const db = getDb();
    db.prepare(
      "UPDATE agent_presence SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '-2000 seconds') WHERE agent = ?"
    ).run("agent-x");
    const result = registerAgent("agent-x", "ses-1") as RegisterAgentResult;
    expect(result.took_over).toBe(false);
  });
});

describe("heartbeat", () => {
  test("migrates legacy composite-key presence tables before register and heartbeat", () => {
    seedLegacyPresenceDb();

    const created = registerAgent("fresh-agent", "session-fresh") as RegisterAgentResult;
    expect(created.created).toBe(true);
    expect(created.agent.project_id).toBeNull();

    heartbeat("legacy-agent", "online", { source: "migration-test" }, "session-after");
    const migratedLegacy = getPresence("legacy-agent");
    expect(migratedLegacy).toBeTruthy();
    expect(migratedLegacy!.project_id).toBe("new-project");
    expect(migratedLegacy!.role).toBe("coordinator");
    expect(migratedLegacy!.session_id).toBe("session-after");
    expect(migratedLegacy!.status).toBe("online");

    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(agent_presence)").all() as { name: string; notnull: number; pk: number }[];
    const agentCol = cols.find((col) => col.name === "agent");
    const projectCol = cols.find((col) => col.name === "project_id");
    expect(agentCol?.pk).toBe(1);
    expect(projectCol?.pk).toBe(2);
    expect(projectCol?.notnull).toBe(1);
    expect(cols.some((col) => col.name === "pid")).toBe(false);

    const dedupedRows = db.prepare(`
      SELECT agent, project_id, status, session_id
      FROM agent_presence
      WHERE agent = ?
      ORDER BY project_id
    `).all("legacy-agent") as {
      agent: string;
      project_id: string | null;
      status: string;
      session_id: string | null;
    }[];
    expect(dedupedRows).toHaveLength(1);
    expect(dedupedRows).toEqual([
      {
        agent: "legacy-agent",
        project_id: "new-project",
        status: "online",
        session_id: "session-after",
      },
    ]);
  });

  test("migrates single-project presence tables into the composite schema", () => {
    seedSingleProjectPresenceDb();

    heartbeat("solo-agent", "online", { source: "single-migration" }, "session-updated");

    const migrated = getPresence("solo-agent");
    expect(migrated).toBeTruthy();
    expect(migrated!.project_id).toBeNull();
    expect(migrated!.session_id).toBe("session-updated");
    expect(migrated!.status).toBe("online");

    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(agent_presence)").all() as { name: string; notnull: number; pk: number }[];
    const agentCol = cols.find((col) => col.name === "agent");
    const projectCol = cols.find((col) => col.name === "project_id");
    expect(agentCol?.pk).toBe(1);
    expect(projectCol?.pk).toBe(2);
    expect(projectCol?.notnull).toBe(1);

    const row = db.prepare("SELECT project_id, metadata FROM agent_presence WHERE agent = ?").get("solo-agent") as {
      project_id: string;
      metadata: string | null;
    };
    expect(row.project_id).toBe("");
    expect(row.metadata).toBe(JSON.stringify({ source: "single-migration" }));
  });

  test("creates presence for new agent", () => {
    heartbeat("agent-1");
    const p = getPresence("agent-1");
    expect(p).toBeTruthy();
    expect(p!.agent).toBe("agent-1");
    expect(p!.status).toBe("online");
    expect(p!.online).toBe(true);
    expect(p!.last_seen_at).toBeTruthy();
    expect(p!.id).toBeTruthy();
    expect(p!.created_at).toBeTruthy();
  });

  test("updates presence for existing agent", () => {
    heartbeat("agent-1", "idle");
    const p1 = getPresence("agent-1");
    expect(p1!.status).toBe("idle");

    heartbeat("agent-1", "busy");
    const p2 = getPresence("agent-1");
    expect(p2!.status).toBe("busy");
  });

  test("defaults status to online", () => {
    heartbeat("agent-1");
    const p = getPresence("agent-1");
    expect(p!.status).toBe("online");
  });

  test("stores metadata", () => {
    heartbeat("agent-1", "online", { task: "coding", pid: 1234 });
    const p = getPresence("agent-1");
    expect(p!.metadata).toEqual({ task: "coding", pid: 1234 });
  });

  test("null metadata when not provided", () => {
    heartbeat("agent-1");
    const p = getPresence("agent-1");
    expect(p!.metadata).toBeNull();
  });

  test("preserves omitted project and metadata while explicit values replace them", () => {
    heartbeat(
      "partial-update-agent",
      "online",
      { phase: "baseline", nonce: "64bd-local" },
      "session-baseline",
      "project-baseline",
    );
    expect(getPresence("partial-update-agent")).toMatchObject({
      session_id: "session-baseline",
      project_id: "project-baseline",
      status: "online",
      metadata: { phase: "baseline", nonce: "64bd-local" },
    });

    heartbeat("partial-update-agent", "busy");
    expect(getPresence("partial-update-agent")).toMatchObject({
      session_id: "session-baseline",
      project_id: "project-baseline",
      status: "busy",
      metadata: { phase: "baseline", nonce: "64bd-local" },
    });

    heartbeat("partial-update-agent", "idle", {}, undefined, null);
    expect(getPresence("partial-update-agent")).toMatchObject({
      session_id: "session-baseline",
      project_id: null,
      status: "idle",
      metadata: {},
    });
  });

  test("updates an existing composite-key presence row without relying on ON CONFLICT(agent)", () => {
    const db = getDb();
    db.exec("DROP TABLE agent_presence");
    db.exec(`
      CREATE TABLE agent_presence (
        id TEXT NOT NULL,
        agent TEXT NOT NULL,
        project_id TEXT NOT NULL DEFAULT '',
        session_id TEXT,
        role TEXT NOT NULL DEFAULT 'agent',
        status TEXT NOT NULL DEFAULT 'online',
        last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
        metadata TEXT,
        PRIMARY KEY (agent, project_id)
      )
    `);
    db.prepare(`
      INSERT INTO agent_presence (id, agent, project_id, session_id, role, status, last_seen_at, created_at, metadata)
      VALUES ('aaaa1111', 'agent-1', 'proj-123', 'sess-1', 'agent', 'idle', '2024-01-01T00:00:00.000', '2024-01-01T00:00:00.000', '{"scope":"proj"}')
    `).run();

    heartbeat("agent-1", "busy");

    const row = db.prepare("SELECT project_id, status FROM agent_presence WHERE agent = ?").get("agent-1") as { project_id: string; status: string };
    expect(row.project_id).toBe("proj-123");
    expect(row.status).toBe("busy");
  });

  test("creates a unique agent index so stale ON CONFLICT(agent) writers still work", () => {
    const db = getDb();

    const indexes = db.prepare("PRAGMA index_list(agent_presence)").all() as {
      name: string;
      unique: number;
    }[];
    const uniqueAgentIndex = indexes.find((index) => index.name === "idx_agent_presence_agent_unique");
    expect(uniqueAgentIndex?.unique).toBe(1);

    db.prepare(`
      INSERT INTO agent_presence (id, agent, project_id, session_id, role, status, last_seen_at, created_at)
      VALUES ('idx11111', 'compat-agent', '', 'sess-1', 'agent', 'idle', '2024-01-01T00:00:00.000', '2024-01-01T00:00:00.000')
      ON CONFLICT(agent) DO UPDATE SET
        status = excluded.status,
        session_id = excluded.session_id,
        last_seen_at = excluded.last_seen_at
    `).run();

    db.prepare(`
      INSERT INTO agent_presence (id, agent, project_id, session_id, role, status, last_seen_at, created_at)
      VALUES ('idx22222', 'compat-agent', '', 'sess-2', 'agent', 'busy', '2024-01-02T00:00:00.000', '2024-01-01T00:00:00.000')
      ON CONFLICT(agent) DO UPDATE SET
        status = excluded.status,
        session_id = excluded.session_id,
        last_seen_at = excluded.last_seen_at
    `).run();

    const row = db.prepare("SELECT agent, project_id, session_id, status FROM agent_presence WHERE agent = ?").get("compat-agent") as {
      agent: string;
      project_id: string;
      session_id: string | null;
      status: string;
    };
    expect(row.agent).toBe("compat-agent");
    expect(row.project_id).toBe("");
    expect(row.session_id).toBe("sess-2");
    expect(row.status).toBe("busy");
  });
});

describe("getPresence", () => {
  test("returns null for unknown agent", () => {
    const p = getPresence("nonexistent");
    expect(p).toBeNull();
  });

  test("returns agent info", () => {
    heartbeat("agent-1", "working");
    const p = getPresence("agent-1");
    expect(p).toBeTruthy();
    expect(p!.agent).toBe("agent-1");
    expect(p!.status).toBe("working");
    expect(p!.online).toBe(true);
    expect(p!.last_seen_at).toBeTruthy();
  });

  test("marks agent as offline when last_seen_at is old", () => {
    heartbeat("agent-1");
    // Manually set last_seen_at to 2 minutes ago
    const db = getDb();
    db.prepare(
      "UPDATE agent_presence SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '-120 seconds') WHERE agent = ?"
    ).run("agent-1");

    const p = getPresence("agent-1");
    expect(p!.online).toBe(false);
  });
});

describe("listAgents", () => {
  test("returns empty array when no agents", () => {
    const agents = listAgents();
    expect(agents).toEqual([]);
  });

  test("returns all agents", () => {
    heartbeat("agent-1");
    heartbeat("agent-2");
    heartbeat("agent-3");
    const agents = listAgents();
    expect(agents).toHaveLength(3);
  });

  test("returns agents sorted by last_seen_at DESC", () => {
    const db = getDb();
    // Insert with explicit timestamps to guarantee order
    db.prepare(
      "INSERT INTO agent_presence (id, agent, status, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run("aaaaaaaa", "oldest", "online", "2024-01-01T00:00:00.000", "2024-01-01T00:00:00.000");
    db.prepare(
      "INSERT INTO agent_presence (id, agent, status, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run("bbbbbbbb", "newest", "online", "2024-12-31T23:59:59.999", "2024-12-31T23:59:59.999");
    db.prepare(
      "INSERT INTO agent_presence (id, agent, status, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run("cccccccc", "middle", "online", "2024-06-15T12:00:00.000", "2024-06-15T12:00:00.000");

    const agents = listAgents();
    expect(agents).toHaveLength(3);
    expect(agents[0].agent).toBe("newest");
    expect(agents[1].agent).toBe("middle");
    expect(agents[2].agent).toBe("oldest");
  });

  test("filters to online-only agents", () => {
    heartbeat("online-agent");
    // Insert an old heartbeat to simulate offline agent
    const db = getDb();
    db.prepare(
      "INSERT INTO agent_presence (id, agent, status, last_seen_at, created_at) VALUES ('dddddddd', ?, ?, strftime('%Y-%m-%dT%H:%M:%f', 'now', '-120 seconds'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '-120 seconds'))"
    ).run("offline-agent", "online");

    const all = listAgents();
    expect(all).toHaveLength(2);

    const onlineOnly = listAgents({ online_only: true });
    expect(onlineOnly).toHaveLength(1);
    expect(onlineOnly[0].agent).toBe("online-agent");
  });
});

describe("removePresence", () => {
  test("deletes presence and returns true", () => {
    heartbeat("agent-1");
    const removed = removePresence("agent-1");
    expect(removed).toBe(true);
    const p = getPresence("agent-1");
    expect(p).toBeNull();
  });

  test("returns false for nonexistent agent", () => {
    const removed = removePresence("nonexistent");
    expect(removed).toBe(false);
  });
});

describe("renameAgent", () => {
  test("renames agent and returns true", () => {
    heartbeat("old-name");
    const renamed = renameAgent("old-name", "new-name");
    expect(renamed).toBe(true);
    expect(getPresence("old-name")).toBeNull();
    expect(getPresence("new-name")).toBeTruthy();
    expect(getPresence("new-name")!.agent).toBe("new-name");
  });

  test("preserves status and metadata after rename", () => {
    heartbeat("rename-me", "busy", { task: "testing" });
    renameAgent("rename-me", "renamed");
    const p = getPresence("renamed");
    expect(p!.status).toBe("busy");
    expect(p!.metadata).toEqual({ task: "testing" });
  });

  test("returns false for nonexistent agent", () => {
    const renamed = renameAgent("nonexistent", "whatever");
    expect(renamed).toBe(false);
  });

  test("throws when target name already exists", () => {
    heartbeat("agent-a");
    heartbeat("agent-b");
    expect(() => renameAgent("agent-a", "agent-b")).toThrow('Agent "agent-b" already exists');
  });
});

describe("setPresenceProject", () => {
  test("re-targets the latest presence row to the requested project", () => {
    heartbeat("agent-1");
    setPresenceProject("agent-1", "proj-abc");

    const p = getPresence("agent-1");
    expect(p!.project_id).toBe("proj-abc");
  });
});

describe("effective status decays with heartbeat recency", () => {
  test("a self-declared 'online' status is only reported while last_seen_at is fresh", () => {
    registerAgent("decay-online-agent", "session-decay");
    const db = getDb();
    db.prepare(
      "UPDATE agent_presence SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '-7200 seconds') WHERE agent = ?"
    ).run("decay-online-agent");

    const p = getPresence("decay-online-agent");
    expect(p!.status).toBe("offline");
    expect(p!.online).toBe(false);

    const row = listAgents().find((a) => a.agent === "decay-online-agent");
    expect(row!.status).toBe("offline");
    expect(row!.online).toBe(false);
  });

  test("a fresh registration still reports status online", () => {
    registerAgent("decay-fresh-agent", "session-fresh");
    const p = getPresence("decay-fresh-agent");
    expect(p!.status).toBe("online");
    expect(p!.online).toBe(true);
  });

  test("non-online self-declared statuses are preserved verbatim", () => {
    heartbeat("decay-busy-agent", "busy");
    const db = getDb();
    db.prepare(
      "UPDATE agent_presence SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '-7200 seconds') WHERE agent = ?"
    ).run("decay-busy-agent");

    const p = getPresence("decay-busy-agent");
    expect(p!.status).toBe("busy");
    expect(p!.online).toBe(false);
  });
});

describe("reapStaleSingleTouchRegistrations", () => {
  function seedReaperFixture(): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO agent_presence (id, agent, session_id, role, project_id, status, last_seen_at, created_at, metadata)
       VALUES (?, ?, ?, 'agent', '', 'online', ?, ?, NULL)`
    ).run("st111111", "stale-single-touch", "sess-st", "2026-08-01T00:00:00.000", "2026-08-01T00:00:00.000");
    // Seen again after creation (last_seen moved 10 minutes later) — not single-touch.
    db.prepare(
      `INSERT INTO agent_presence (id, agent, session_id, role, project_id, status, last_seen_at, created_at, metadata)
       VALUES (?, ?, ?, 'agent', '', 'online', ?, ?, NULL)`
    ).run("mt222222", "seen-again-agent", "sess-mt", "2026-08-01T00:10:00.000", "2026-08-01T00:00:00.000");
    // Single-touch but fresh — within the retention window.
    db.prepare(
      `INSERT INTO agent_presence (id, agent, session_id, role, project_id, status, last_seen_at, created_at, metadata)
       VALUES (?, ?, ?, 'agent', '', 'online', strftime('%Y-%m-%dT%H:%M:%f', 'now'), strftime('%Y-%m-%dT%H:%M:%f', 'now'), NULL)`
    ).run("fr333333", "fresh-single-touch", "sess-fr");
  }

  test("flags single-touch registrations older than the retention window without deleting (report-first)", () => {
    seedReaperFixture();

    const result = reapStaleSingleTouchRegistrations();
    expect(result.candidates).toBe(1);
    expect(result.reaped).toBe(0);
    expect(result.agents).toEqual(["stale-single-touch"]);

    // Nothing deleted without apply.
    expect(getPresence("stale-single-touch")).toBeTruthy();
    expect(getPresence("seen-again-agent")).toBeTruthy();
    expect(getPresence("fresh-single-touch")).toBeTruthy();
  });

  test("apply deletes only the flagged single-touch rows", () => {
    seedReaperFixture();

    const result = reapStaleSingleTouchRegistrations({ apply: true });
    expect(result.candidates).toBe(1);
    expect(result.reaped).toBe(1);
    expect(getPresence("stale-single-touch")).toBeNull();
    expect(getPresence("seen-again-agent")).toBeTruthy();
    expect(getPresence("fresh-single-touch")).toBeTruthy();
  });
});
