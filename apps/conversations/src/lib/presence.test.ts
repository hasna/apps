import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { heartbeat, getPresence, listAgents, removePresence, renameAgent, registerAgent, isAgentConflict } from "./presence";
import { closeDb, getDb } from "./db";
import type { AgentConflictError, RegisterAgentResult } from "../types";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-test-presence-${Date.now()}.db`);

beforeEach(() => {
  process.env.CONVERSATIONS_DB_PATH = TEST_DB;
  closeDb();
});

afterEach(() => {
  closeDb();
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_DB + "-wal"); } catch {}
  try { unlinkSync(TEST_DB + "-shm"); } catch {}
});

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
