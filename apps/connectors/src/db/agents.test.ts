import { describe, test, expect, beforeEach } from "bun:test";
import { SqliteAdapter as Database } from "./sqlite-adapter.js";
import {
  registerAgent,
  listAgents,
  getAgent,
  getAgentByName,
  updateAgentActivity,
  heartbeat,
  setFocus,
  deleteAgent,
  isAgentConflict,
} from "./agents.js";

function makeDb(): Database {
  const db = new Database(":memory:");
  db.run(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      session_id TEXT,
      role TEXT NOT NULL DEFAULT 'agent',
      project_id TEXT,
      last_seen_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
  return db;
}

describe("registerAgent", () => {
  test("creates a new agent", () => {
    const db = makeDb();
    const result = registerAgent({ name: "titus", session_id: "sess-1" }, db);
    expect(isAgentConflict(result)).toBe(false);
    if (!isAgentConflict(result)) {
      expect(result.name).toBe("titus");
      expect(result.session_id).toBe("sess-1");
      expect(result.role).toBe("agent");
      expect(result.id).toHaveLength(8);
      expect(result.created_at).toBeTruthy();
      expect(result.last_seen_at).toBeTruthy();
    }
  });

  test("normalizes name to lowercase", () => {
    const db = makeDb();
    const result = registerAgent({ name: "  TITUS  ", session_id: "sess-1" }, db);
    if (!isAgentConflict(result)) {
      expect(result.name).toBe("titus");
    }
  });

  test("heartbeat: same session_id returns existing agent and updates last_seen_at", async () => {
    const db = makeDb();
    const first = registerAgent({ name: "titus", session_id: "sess-1" }, db) as ReturnType<typeof getAgent>;
    if (!first || isAgentConflict(first)) return;
    const firstSeen = first.last_seen_at;
    await new Promise((r) => setTimeout(r, 5));
    const second = registerAgent({ name: "titus", session_id: "sess-1" }, db);
    expect(isAgentConflict(second)).toBe(false);
    if (!isAgentConflict(second)) {
      expect(second.id).toBe(first.id);
      expect(second.last_seen_at >= firstSeen).toBe(true);
    }
  });

  test("conflict: active agent with different session_id", () => {
    const db = makeDb();
    registerAgent({ name: "titus", session_id: "sess-1" }, db);
    const result = registerAgent({ name: "titus", session_id: "sess-2" }, db);
    expect(isAgentConflict(result)).toBe(true);
    if (isAgentConflict(result)) {
      expect(result.conflict).toBe(true);
      expect(result.existing_name).toBe("titus");
      expect(result.message).toContain("titus");
    }
  });

  test("takeover: stale agent (>30min) with different session_id", () => {
    const db = makeDb();
    // Insert stale agent manually
    const staleTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    db.run(
      "INSERT INTO agents (id, name, session_id, role, last_seen_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ["oldid123", "titus", "sess-old", "agent", staleTime, staleTime]
    );
    const result = registerAgent({ name: "titus", session_id: "sess-new" }, db);
    expect(isAgentConflict(result)).toBe(false);
    if (!isAgentConflict(result)) {
      expect(result.session_id).toBe("sess-new");
    }
  });

  test("no session_id: heartbeat without conflict check", () => {
    const db = makeDb();
    registerAgent({ name: "titus", session_id: "sess-1" }, db);
    const result = registerAgent({ name: "titus" }, db);
    expect(isAgentConflict(result)).toBe(false);
  });

  test("custom role is stored", () => {
    const db = makeDb();
    const result = registerAgent({ name: "titus", role: "coordinator" }, db);
    if (!isAgentConflict(result)) {
      expect(result.role).toBe("coordinator");
    }
  });
});

describe("getAgent / getAgentByName", () => {
  test("getAgentByName returns null for unknown agent", () => {
    const db = makeDb();
    expect(getAgentByName("nobody", db)).toBeNull();
  });

  test("getAgentByName is case-insensitive", () => {
    const db = makeDb();
    registerAgent({ name: "titus" }, db);
    const found = getAgentByName("TITUS", db);
    expect(found).not.toBeNull();
    expect(found?.name).toBe("titus");
  });

  test("getAgent returns null for unknown id", () => {
    const db = makeDb();
    expect(getAgent("nope1234", db)).toBeNull();
  });
});

describe("listAgents", () => {
  test("returns all agents ordered by name", () => {
    const db = makeDb();
    registerAgent({ name: "zeus" }, db);
    registerAgent({ name: "apollo" }, db);
    registerAgent({ name: "titus" }, db);
    const agents = listAgents(db);
    expect(agents.map((a) => a.name)).toEqual(["apollo", "titus", "zeus"]);
  });
});

describe("updateAgentActivity", () => {
  test("updates last_seen_at", async () => {
    const db = makeDb();
    const result = registerAgent({ name: "titus" }, db);
    if (isAgentConflict(result)) return;
    const agent = result;
    const before = agent.last_seen_at;
    await new Promise((r) => setTimeout(r, 5));
    updateAgentActivity(agent.id, db);
    const updated = getAgent(agent.id, db)!;
    expect(updated.last_seen_at > before).toBe(true);
  });
});

describe("deleteAgent", () => {
  test("deletes an existing agent", () => {
    const db = makeDb();
    const result = registerAgent({ name: "titus" }, db);
    if (isAgentConflict(result)) return;
    expect(deleteAgent(result.id, db)).toBe(true);
    expect(getAgent(result.id, db)).toBeNull();
  });

  test("returns false for non-existent agent", () => {
    const db = makeDb();
    expect(deleteAgent("nope1234", db)).toBe(false);
  });
});

describe("isAgentConflict", () => {
  test("identifies conflict objects", () => {
    expect(isAgentConflict({ conflict: true, existing_id: "x", existing_name: "y", last_seen_at: "z", session_hint: null, working_dir: null, message: "m" })).toBe(true);
  });

  test("identifies agent objects", () => {
    const db = makeDb();
    const result = registerAgent({ name: "titus" }, db);
    expect(isAgentConflict(result)).toBe(false);
  });
});

describe("heartbeat", () => {
  test("updates last_seen_at and returns agent", async () => {
    const db = makeDb();
    const reg = registerAgent({ name: "hb-agent" }, db);
    if (isAgentConflict(reg)) return;
    const before = reg.last_seen_at;
    await new Promise((r) => setTimeout(r, 5));
    const agent = heartbeat(reg.id, db);
    expect(agent).not.toBeNull();
    expect(agent!.id).toBe(reg.id);
    expect(agent!.last_seen_at >= before).toBe(true);
  });

  test("returns null for unknown agent id", () => {
    const db = makeDb();
    const result = heartbeat("unknown-id", db);
    expect(result).toBeNull();
  });
});

describe("setFocus", () => {
  test("sets project_id on agent", () => {
    const db = makeDb();
    const reg = registerAgent({ name: "focus-agent" }, db);
    if (isAgentConflict(reg)) return;
    const agent = setFocus(reg.id, "proj-abc", db);
    expect(agent).not.toBeNull();
    expect(agent!.project_id).toBe("proj-abc");
  });

  test("clears project_id when null passed", () => {
    const db = makeDb();
    const reg = registerAgent({ name: "focus-agent2" }, db);
    if (isAgentConflict(reg)) return;
    setFocus(reg.id, "proj-xyz", db);
    const cleared = setFocus(reg.id, null, db);
    expect(cleared!.project_id).toBeNull();
  });

  test("returns null for unknown agent id", () => {
    const db = makeDb();
    const result = setFocus("unknown-id", "proj-1", db);
    expect(result).toBeNull();
  });
});
