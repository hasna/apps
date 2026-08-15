import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { registerAgent, isAgentConflict, releaseAgent, autoReleaseStaleAgents, getAgent, getAgentByName, listAgents, updateAgentActivity, updateAgent, deleteAgent, archiveAgent, unarchiveAgent, normalizeGeneratedAgentNames, InvalidAgentNameError } from "./agents.js";
import { PREFERRED_AGENT_NAMES, suggestAgentNames } from "./agent-names.js";
import { IdentityAliasAmbiguousError, listAgentAliases } from "./identity-mapping.js";
import { createTask, getNextTask, listTasks } from "./tasks.js";
import { getAgentMetrics } from "./agent-metrics.js";

let uniqueNameCounter = 0;

function uniqueName(prefix: string): string {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  uniqueNameCounter += 1;
  const first = letters[uniqueNameCounter % letters.length]!;
  const second = letters[Math.floor(uniqueNameCounter / letters.length) % letters.length]!;
  const third = letters[Math.floor(uniqueNameCounter / (letters.length * letters.length)) % letters.length]!;
  return `${prefix}${first}${second}${third}`;
}

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("registerAgent", () => {
  it("should create an agent with 8-char ID", () => {
    const agent = registerAgent({ name: "claude" });
    expect(agent.id).toHaveLength(8);
    expect(agent.name).toBe("claude");
    expect(agent.description).toBeNull();
    expect(agent.metadata).toEqual({});
  });

  it("should be idempotent - same name returns same agent", () => {
    const first = registerAgent({ name: "codex" });
    const second = registerAgent({ name: "codex" });
    expect(second.id).toBe(first.id);
    expect(second.name).toBe("codex");
  });

  it("should be idempotent and return same ID on re-register", () => {
    const first = registerAgent({ name: "testagent" });
    const second = registerAgent({ name: "testagent" });
    expect(second.id).toBe(first.id);
    expect(second.last_seen_at).toBeDefined();
  });

  it("should store description and metadata", () => {
    const agent = registerAgent({
      name: "custombot",
      description: "A custom bot",
      metadata: { version: "1.0", features: ["search"] },
    });
    expect(agent.description).toBe("A custom bot");
    expect(agent.metadata).toEqual({ version: "1.0", features: ["search"] });
  });

  it("should reject generic and generated numbered names", () => {
    expect(() => registerAgent({ name: "agent" })).toThrow(InvalidAgentNameError);
    expect(() => registerAgent({ name: "agent-1" })).toThrow(/generic names/);
    expect(() => registerAgent({ name: "assistant-2" })).toThrow(/generic names/);
    expect(() => registerAgent({ name: "valeria-29" })).toThrow(/numbered suffix/);
    expect(() => registerAgent({ name: "two words" })).toThrow(/single word/);
    expect(() => registerAgent({ name: "busy-agent" })).toThrow(/one word/);
  });

  it("holds an immediate write fence across canonical lookup and insert", () => {
    closeDatabase();
    resetDatabase();
    const root = mkdtempSync(join(tmpdir(), "todos-agent-register-race-"));
    const path = join(root, "todos.db");
    const primary = getDatabase(path);
    const contender = new Database(path);
    contender.run("PRAGMA busy_timeout = 1");
    contender.run("PRAGMA foreign_keys = ON");
    let contenderBlocked = false;

    try {
      const input = {
        name: "quintilian",
        identity_id: "identity-quintilian",
        get description(): string {
          try {
            const createdAt = new Date().toISOString();
            contender.run(
              "INSERT INTO agents (id, name, identity_id, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
              ["racer001", "rivalname", "identity-quintilian", createdAt, createdAt],
            );
          } catch (error) {
            if (error instanceof Error && error.message.includes("database is locked")) {
              contenderBlocked = true;
            } else {
              throw error;
            }
          }
          return "registration race";
        },
      };

      const registered = registerAgent(input, primary);
      if ("conflict" in registered) throw new Error(registered.message);

      expect(contenderBlocked).toBe(true);
      expect(primary.query(
        "SELECT id FROM agents WHERE identity_id = ? ORDER BY id",
      ).all("identity-quintilian")).toEqual([{ id: registered.id }]);
    } finally {
      contender.close();
      closeDatabase();
      resetDatabase();
      rmSync(root, { recursive: true, force: true });
      process.env["TODOS_DB_PATH"] = ":memory:";
      getDatabase();
    }
  });
});

describe("registerAgent — pool is advisory", () => {
  it("should allow names outside the pool", () => {
    const result = registerAgent({ name: "tacitus", pool: ["maximus", "cassius", "brutus"] });
    expect(isAgentConflict(result)).toBe(false);
    expect((result as any).name).toBe("tacitus");
  });

  it("should allow names inside the pool", () => {
    const result = registerAgent({ name: "maximus", pool: ["maximus", "cassius", "brutus"] });
    expect(isAgentConflict(result)).toBe(false);
    expect((result as any).name).toBe("maximus");
  });

  it("should block login to recently-active agent with different session", () => {
    // Register agent with session A
    const agent = registerAgent({ name: "cassius", session_id: "session-aaa" });
    expect(isAgentConflict(agent)).toBe(false);

    // Try to take over with session B — should be blocked (agent is active)
    const result = registerAgent({ name: "cassius", session_id: "session-bbb" });
    expect(isAgentConflict(result)).toBe(true);
    expect((result as any).message).toContain("already active");
  });

  it("should allow login to same agent with same session_id", () => {
    registerAgent({ name: "brutus", session_id: "session-xxx" });
    const result = registerAgent({ name: "brutus", session_id: "session-xxx" });
    expect(isAgentConflict(result)).toBe(false);
    expect((result as any).name).toBe("brutus");
  });

  it("should allow takeover of stale agent", () => {
    const db = getDatabase();
    // Register agent, then manually set last_seen_at to >30 min ago
    const agent = registerAgent({ name: "nero", session_id: "old-session" });
    expect(isAgentConflict(agent)).toBe(false);
    const staleTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    db.run("UPDATE agents SET last_seen_at = ? WHERE id = ?", [staleTime, (agent as any).id]);

    // New session should take over
    const result = registerAgent({ name: "nero", session_id: "new-session" });
    expect(isAgentConflict(result)).toBe(false);
    expect((result as any).name).toBe("nero");
  });
});

describe("getAgent", () => {
  it("should return agent by ID", () => {
    const created = registerAgent({ name: "test" });
    const found = getAgent(created.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("test");
  });

  it("should return null for non-existent ID", () => {
    expect(getAgent("nonexist")).toBeNull();
  });
});

describe("getAgentByName", () => {
  it("should return agent by name", () => {
    registerAgent({ name: "myagent" });
    const found = getAgentByName("myagent");
    expect(found).not.toBeNull();
    expect(found!.name).toBe("myagent");
  });

  it("should return null for non-existent name", () => {
    expect(getAgentByName("nope")).toBeNull();
  });
});

describe("listAgents", () => {
  it("should return all agents ordered by name", () => {
    registerAgent({ name: "zebra" });
    registerAgent({ name: "alpha" });
    registerAgent({ name: "middle" });
    const agents = listAgents();
    expect(agents).toHaveLength(3);
    expect(agents[0]!.name).toBe("alpha");
    expect(agents[1]!.name).toBe("middle");
    expect(agents[2]!.name).toBe("zebra");
  });

  it("should return empty array when no agents", () => {
    expect(listAgents()).toEqual([]);
  });
});

describe("updateAgentActivity", () => {
  it("should update last_seen_at field", () => {
    const agent = registerAgent({ name: "active" });
    updateAgentActivity(agent.id);
    const updated = getAgent(agent.id)!;
    expect(updated.last_seen_at).toBeDefined();
    expect(typeof updated.last_seen_at).toBe("string");
  });
});

describe("updateAgent", () => {
  it("should update agent name", () => {
    const agent = registerAgent({ name: uniqueName("oldname") });
    const newName = uniqueName("newname");
    const updated = updateAgent(agent.id, { name: newName });
    expect(updated.name).toBe(newName);
  });

  it("should update agent description", () => {
    const agent = registerAgent({ name: uniqueName("desctest") });
    const updated = updateAgent(agent.id, { description: "New description" });
    expect(updated.description).toBe("New description");
  });

  it("should update agent role", () => {
    const agent = registerAgent({ name: uniqueName("roletest") });
    const updated = updateAgent(agent.id, { role: "admin" });
    expect(updated.role).toBe("admin");
  });

  it("should throw for non-existent agent", () => {
    expect(() => updateAgent("nonexistent", { name: "test" })).toThrow();
  });

  it("should update multiple fields at once", () => {
    const agent = registerAgent({ name: uniqueName("multi") });
    const updated = updateAgent(agent.id, { name: uniqueName("renamed"), description: "Updated", role: "observer" });
    expect(updated.description).toBe("Updated");
    expect(updated.role).toBe("observer");
  });

  it("should reject renames to generated numbered names", () => {
    const agent = registerAgent({ name: uniqueName("plain") });
    expect(() => updateAgent(agent.id, { name: "agent-3" })).toThrow(InvalidAgentNameError);
  });
});

describe("normalizeGeneratedAgentNames", () => {
  it("keeps historical assignments discoverable through task, queue, and metrics entry points without mutation", () => {
    const db = getDatabase();
    const timestamp = new Date().toISOString();
    const agentId = "legacy01";
    const historicalName = "agent-1";
    db.run(
      "INSERT INTO agents (id, name, created_at, last_seen_at) VALUES (?, ?, ?, ?)",
      [agentId, historicalName, timestamp, timestamp],
    );

    const assigned = createTask({
      title: "Historical assignment",
      priority: "low",
      assigned_to: historicalName,
    }, db);
    createTask({ title: "Unassigned competitor", priority: "critical" }, db);
    createTask({
      title: "Historical local-id metric",
      status: "completed",
      agent_id: agentId,
    }, db);
    const locked = createTask({
      title: "Historical lock",
      status: "in_progress",
      assigned_to: historicalName,
    }, db);
    db.run("UPDATE tasks SET locked_by = ?, locked_at = ? WHERE id = ?", [historicalName, timestamp, locked.id]);
    db.run(
      "INSERT INTO task_comments (id, task_id, agent_id, content, created_at) VALUES (?, ?, ?, ?, ?)",
      ["legacyc1", assigned.id, historicalName, "Historical progress", timestamp],
    );

    expect(listTasks({ assigned_to: historicalName }, db).map((task) => task.id)).toContain(assigned.id);
    expect(getNextTask(historicalName, undefined, db)?.id).toBe(assigned.id);
    expect(getAgentMetrics(historicalName, {}, db)?.tasks_completed).toBe(1);
    const agentBefore = db.query("SELECT * FROM agents WHERE id = ?").get(agentId);

    db.exec(`
      CREATE TEMP TRIGGER reject_agent_name_rewrite
      BEFORE UPDATE OF name ON agents
      BEGIN SELECT RAISE(ABORT, 'agents.name mutation is forbidden'); END;

      CREATE TEMP TRIGGER reject_task_reference_rewrite
      BEFORE UPDATE OF assigned_to, agent_id, locked_by ON tasks
      BEGIN SELECT RAISE(ABORT, 'historical task reference rewrite is forbidden'); END;

      CREATE TEMP TRIGGER reject_comment_reference_rewrite
      BEFORE UPDATE OF agent_id ON task_comments
      BEGIN SELECT RAISE(ABORT, 'historical comment reference rewrite is forbidden'); END;
    `);

    const changesBefore = (db.query("SELECT total_changes() AS count").get() as { count: number }).count;
    const planned = normalizeGeneratedAgentNames(db);
    const changesAfter = (db.query("SELECT total_changes() AS count").get() as { count: number }).count;
    expect(planned).toHaveLength(1);
    expect(planned[0]!.old_name).toBe(historicalName);
    expect(planned[0]!.new_name).not.toBe(historicalName);
    expect(planned[0]!.applied).toBe(false);
    expect(planned[0]!.disposition).toBe("candidate");
    expect(planned[0]!.alias_kind).toBe("candidate");
    expect(planned[0]!.status).toBe("quarantined");
    expect(planned[0]!.name_updates).toBe(0);
    expect(planned[0]!.reference_updates).toBe(0);

    expect(getAgent(agentId, db)?.name).toBe(historicalName);
    expect(db.query("SELECT * FROM agents WHERE id = ?").get(agentId)).toEqual(agentBefore);
    expect(changesAfter).toBe(changesBefore);
    expect(listTasks({ assigned_to: historicalName }, db).map((task) => task.id)).toContain(assigned.id);
    expect(getNextTask(historicalName, undefined, db)?.id).toBe(assigned.id);
    expect(getAgentMetrics(historicalName, {}, db)?.tasks_completed).toBe(1);
    expect(db.query("SELECT locked_by FROM tasks WHERE id = ?").get(locked.id)).toEqual({ locked_by: historicalName });
    expect(db.query("SELECT agent_id FROM task_comments WHERE id = ?").get("legacyc1")).toEqual({ agent_id: historicalName });
  });

  it("should retain generated labels without persisting replacement candidates", () => {
    const db = getDatabase();
    const timestamp = new Date().toISOString();
    db.run(
      "INSERT INTO agents (id, name, created_at, last_seen_at) VALUES (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)",
      ["bad00001", "agent-1", timestamp, timestamp, "bad00002", "valeria-29", timestamp, timestamp, "bad00003", "busy-agent", timestamp, timestamp],
    );
    db.run(
      "INSERT INTO tasks (id, title, status, priority, assigned_to, agent_id, locked_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ["task0001", "Assigned", "pending", "medium", "agent-1", "valeria-29", "busy-agent", timestamp, timestamp],
    );
    db.run(
      "INSERT INTO task_comments (id, task_id, agent_id, content, created_at) VALUES (?, ?, ?, ?, ?)",
      ["comment1", "task0001", "agent-1", "progress", timestamp],
    );

    const planned = normalizeGeneratedAgentNames(db);
    expect(planned).toHaveLength(3);
    expect(planned.map((item) => item.old_name)).toEqual(["agent-1", "valeria-29", "busy-agent"]);
    expect(planned.every((item) => !item.new_name.match(/-\d+$/))).toBe(true);
    expect(planned.every((item) => item.applied === false)).toBe(true);
    expect(planned.every((item) => item.disposition === "candidate")).toBe(true);
    expect(planned.every((item) => item.name_updates === 0)).toBe(true);

    const task = db.query("SELECT assigned_to, agent_id, locked_by FROM tasks WHERE id = ?").get("task0001") as { assigned_to: string; agent_id: string; locked_by: string };
    const comment = db.query("SELECT agent_id FROM task_comments WHERE id = ?").get("comment1") as { agent_id: string };
    expect(task.assigned_to).toBe("agent-1");
    expect(comment.agent_id).toBe("agent-1");
    expect(task.agent_id).toBe("valeria-29");
    expect(task.locked_by).toBe("busy-agent");
    expect(planned.every((item) => item.reference_updates === 0)).toBe(true);
    expect(db.query("SELECT id, name FROM agents ORDER BY id").all()).toEqual([
      { id: "bad00001", name: "agent-1" },
      { id: "bad00002", name: "valeria-29" },
      { id: "bad00003", name: "busy-agent" },
    ]);
    expect(db.query("SELECT * FROM agent_identity_aliases").all()).toEqual([]);
  });

  it("should use distinct fallback names when the preferred pool is exhausted", () => {
    const db = getDatabase();
    const timestamp = new Date().toISOString();
    for (const [index, name] of PREFERRED_AGENT_NAMES.entries()) {
      db.run(
        "INSERT INTO agents (id, name, created_at, last_seen_at) VALUES (?, ?, ?, ?)",
        [`pref${String(index).padStart(4, "0")}`, name, timestamp, timestamp],
      );
    }
    db.run(
      "INSERT INTO agents (id, name, created_at, last_seen_at) VALUES (?, ?, ?, ?)",
      ["bad99999", "agent-1", timestamp, timestamp],
    );

    const planned = normalizeGeneratedAgentNames(db);
    expect(planned).toHaveLength(1);
    expect(planned[0]!.old_name).toBe("agent-1");
    expect(planned[0]!.new_name).toMatch(/^[a-z]+$/);
    expect(PREFERRED_AGENT_NAMES).not.toContain(planned[0]!.new_name as any);
    expect(getAgent("bad99999", db)?.name).toBe("agent-1");
    expect(listAgentAliases("bad99999", db)).toEqual([]);
  });

  it("should reuse the same deterministic candidate without writing state", () => {
    const db = getDatabase();
    const timestamp = new Date().toISOString();
    db.run(
      "INSERT INTO agents (id, name, created_at, last_seen_at) VALUES (?, ?, ?, ?)",
      ["bad00004", "agent-2", timestamp, timestamp],
    );

    const first = normalizeGeneratedAgentNames(db);
    const second = normalizeGeneratedAgentNames(db);

    expect(second).toEqual(first);
    expect(getAgent("bad00004", db)?.name).toBe("agent-2");
    expect(listAgentAliases("bad00004", db)).toEqual([]);
  });

  it("should not suggest preferred-name suffix variants after exhausting the name pool", () => {
    const preferredSuffix = new RegExp(`^(${PREFERRED_AGENT_NAMES.join("|")})[a-z]+$`);
    const suggestions = suggestAgentNames(PREFERRED_AGENT_NAMES);

    expect(suggestions).toHaveLength(20);
    expect(suggestions.every((name) => /^[a-z]+$/.test(name))).toBe(true);
    expect(suggestions.some((name) => preferredSuffix.test(name))).toBe(false);
  });
});

describe("deleteAgent (soft delete / archive)", () => {
  it("should archive existing agent", () => {
    const agent = registerAgent({ name: "doomed" });
    expect(deleteAgent(agent.id)).toBe(true);
    const archived = getAgent(agent.id);
    expect(archived).not.toBeNull();
    expect(archived!.status).toBe("archived");
  });

  it("should hide archived agents from listAgents by default", () => {
    const agent = registerAgent({ name: "hidden" });
    deleteAgent(agent.id);
    const agents = listAgents();
    expect(agents.find(a => a.id === agent.id)).toBeUndefined();
  });

  it("should show archived agents when include_archived is true", () => {
    const agent = registerAgent({ name: "visible" });
    deleteAgent(agent.id);
    const agents = listAgents({ include_archived: true });
    const found = agents.find(a => a.id === agent.id);
    expect(found).not.toBeUndefined();
    expect(found!.status).toBe("archived");
  });

  it("should return false for non-existent agent", () => {
    expect(deleteAgent("nope")).toBe(false);
  });
});

describe("archiveAgent / unarchiveAgent", () => {
  it("should archive and restore an agent", () => {
    const agent = registerAgent({ name: "toggle" });
    expect(agent.status).toBe("active");

    const archived = archiveAgent(agent.id);
    expect(archived!.status).toBe("archived");

    const restored = unarchiveAgent(agent.id);
    expect(restored!.status).toBe("active");
  });

  it("should reactivate archived agent on re-register", () => {
    const agent = registerAgent({ name: "comeback" });
    archiveAgent(agent.id);
    expect(getAgent(agent.id)!.status).toBe("archived");

    // Re-register should reactivate
    const result = registerAgent({ name: "comeback" });
    expect(isAgentConflict(result)).toBe(false);
    expect((result as any).status).toBe("active");
  });
});

describe("releaseAgent", () => {
  it("should clear session_id and make agent immediately stale", () => {
    const agent = registerAgent({ name: "releasetest", session_id: "sess-1" }) as any;
    expect(releaseAgent(agent.id)).toBe(true);
    const after = getAgent(agent.id)!;
    expect(after.session_id).toBeNull();
    // last_seen_at should be epoch (1970)
    expect(new Date(after.last_seen_at).getFullYear()).toBe(1970);
  });

  it("should allow release with matching session_id", () => {
    const agent = registerAgent({ name: "releasematch", session_id: "sess-abc" }) as any;
    expect(releaseAgent(agent.id, "sess-abc")).toBe(true);
    expect(getAgent(agent.id)!.session_id).toBeNull();
  });

  it("should deny release with non-matching session_id", () => {
    const agent = registerAgent({ name: "releasedeny", session_id: "sess-real" }) as any;
    expect(releaseAgent(agent.id, "sess-fake")).toBe(false);
    // Agent should still have its session
    expect(getAgent(agent.id)!.session_id).toBe("sess-real");
  });

  it("should return false for non-existent agent", () => {
    expect(releaseAgent("nonexistent")).toBe(false);
  });

  it("should make name immediately available for re-registration", () => {
    const agent = registerAgent({ name: "reuseme", session_id: "sess-old" }) as any;
    releaseAgent(agent.id);
    // Now a different session should be able to take the name
    const result = registerAgent({ name: "reuseme", session_id: "sess-new" });
    expect(isAgentConflict(result)).toBe(false);
    expect((result as any).session_id).toBe("sess-new");
  });
});

describe("registerAgent — tightened no-session path", () => {
  it("should block no-session registration when active session-bound agent holds name", () => {
    // Register with a session
    registerAgent({ name: "guarded", session_id: "active-sess" });
    // Try to register same name without session — should now be blocked
    const result = registerAgent({ name: "guarded" });
    expect(isAgentConflict(result)).toBe(true);
    expect((result as any).message).toContain("already active");
  });

  it("should allow no-session registration when agent has no session binding", () => {
    // Register without session
    registerAgent({ name: "unbound" });
    // Re-register without session — should still work (backward compat for unbound agents)
    const result = registerAgent({ name: "unbound" });
    expect(isAgentConflict(result)).toBe(false);
  });

  it("should allow no-session registration when agent is stale", () => {
    const db = getDatabase();
    const agent = registerAgent({ name: "staleguard", session_id: "old-sess" }) as any;
    const staleTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    db.run("UPDATE agents SET last_seen_at = ? WHERE id = ?", [staleTime, agent.id]);
    // No-session registration should succeed for stale agents
    const result = registerAgent({ name: "staleguard" });
    expect(isAgentConflict(result)).toBe(false);
  });
});

describe("registerAgent — force flag", () => {
  it("should allow force takeover of active agent with different session", () => {
    registerAgent({ name: "forcetarget", session_id: "sess-a" });
    const result = registerAgent({ name: "forcetarget", session_id: "sess-b", force: true });
    expect(isAgentConflict(result)).toBe(false);
    expect((result as any).session_id).toBe("sess-b");
  });

  it("should allow force takeover when caller has no session", () => {
    registerAgent({ name: "forcenosess", session_id: "active-sess" });
    const result = registerAgent({ name: "forcenosess", force: true });
    expect(isAgentConflict(result)).toBe(false);
  });

  it("should not need force for stale agents", () => {
    const db = getDatabase();
    const agent = registerAgent({ name: "noforceneeded", session_id: "old" }) as any;
    const staleTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    db.run("UPDATE agents SET last_seen_at = ? WHERE id = ?", [staleTime, agent.id]);
    const result = registerAgent({ name: "noforceneeded", session_id: "new" });
    expect(isAgentConflict(result)).toBe(false);
  });
});

describe("updateAgent — rename conflict check", () => {
  it("should reject rename to a name held by active agent", () => {
    const agentA = registerAgent({ name: "holdera" }) as any;
    const agentB = registerAgent({ name: "holderb" }) as any;
    expect(() => updateAgent(agentB.id, { name: "holdera" })).toThrow(IdentityAliasAmbiguousError);
  });

  it("should allow rename to a free name", () => {
    const agent = registerAgent({ name: "renamefree" }) as any;
    const updated = updateAgent(agent.id, { name: "totallynewname" });
    expect(updated.name).toBe("totallynewname");
  });

  it("should reject rename to a stale agent's label without evicting either record", () => {
    const db = getDatabase();
    const holder = registerAgent({ name: "staleholder" }) as any;
    const staleTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    db.run("UPDATE agents SET last_seen_at = ? WHERE id = ?", [staleTime, holder.id]);
    const agent = registerAgent({ name: "wantsrename" }) as any;
    expect(() => updateAgent(agent.id, { name: "staleholder" })).toThrow(IdentityAliasAmbiguousError);
    expect(getAgent(holder.id)?.name).toBe("staleholder");
    expect(getAgent(agent.id)?.name).toBe("wantsrename");
    expect(db.query("SELECT name FROM agents WHERE name LIKE '%__evicted_%'").all()).toEqual([]);
  });
});

describe("configurable stale window", () => {
  it("should use TODOS_AGENT_TIMEOUT_MS when set", () => {
    const db = getDatabase();
    // Set a 5-second timeout
    process.env["TODOS_AGENT_TIMEOUT_MS"] = "5000";
    const agent = registerAgent({ name: "shorttimeout", session_id: "sess-short" }) as any;
    // Manually set last_seen_at to 6 seconds ago (beyond the 5s window)
    const staleTime = new Date(Date.now() - 6000).toISOString();
    db.run("UPDATE agents SET last_seen_at = ? WHERE id = ?", [staleTime, agent.id]);
    // Different session should succeed — agent is stale under the 5s window
    const result = registerAgent({ name: "shorttimeout", session_id: "sess-other" });
    expect(isAgentConflict(result)).toBe(false);
    delete process.env["TODOS_AGENT_TIMEOUT_MS"];
  });

  it("should default to 30 minutes when env var is not set", () => {
    delete process.env["TODOS_AGENT_TIMEOUT_MS"];
    const agent = registerAgent({ name: "defaulttimeout", session_id: "sess-default" }) as any;
    // Should be active (not stale) — different session should be blocked
    const result = registerAgent({ name: "defaulttimeout", session_id: "sess-intruder" });
    expect(isAgentConflict(result)).toBe(true);
  });

  it("should ignore invalid env var values", () => {
    process.env["TODOS_AGENT_TIMEOUT_MS"] = "not-a-number";
    const agent = registerAgent({ name: "badenv", session_id: "sess-1" }) as any;
    // Should fall back to 30min default — agent is active, so different session blocked
    const result = registerAgent({ name: "badenv", session_id: "sess-2" });
    expect(isAgentConflict(result)).toBe(true);
    delete process.env["TODOS_AGENT_TIMEOUT_MS"];
  });
});

describe("autoReleaseStaleAgents", () => {
  it("should clear session_id for stale agents when enabled", () => {
    const db = getDatabase();
    process.env["TODOS_AGENT_AUTO_RELEASE"] = "true";
    process.env["TODOS_AGENT_TIMEOUT_MS"] = "5000";
    const agent = registerAgent({ name: "autorel", session_id: "sess-auto" }) as any;
    // Make agent stale
    const staleTime = new Date(Date.now() - 6000).toISOString();
    db.run("UPDATE agents SET last_seen_at = ? WHERE id = ?", [staleTime, agent.id]);
    const released = autoReleaseStaleAgents(db);
    expect(released).toBe(1);
    expect(getAgent(agent.id)!.session_id).toBeNull();
    delete process.env["TODOS_AGENT_AUTO_RELEASE"];
    delete process.env["TODOS_AGENT_TIMEOUT_MS"];
  });

  it("should not release when disabled", () => {
    const db = getDatabase();
    delete process.env["TODOS_AGENT_AUTO_RELEASE"];
    const agent = registerAgent({ name: "noauto", session_id: "sess-no" }) as any;
    const staleTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    db.run("UPDATE agents SET last_seen_at = ? WHERE id = ?", [staleTime, agent.id]);
    const released = autoReleaseStaleAgents(db);
    expect(released).toBe(0);
    expect(getAgent(agent.id)!.session_id).toBe("sess-no");
  });

  it("should not release active agents", () => {
    const db = getDatabase();
    process.env["TODOS_AGENT_AUTO_RELEASE"] = "true";
    const agent = registerAgent({ name: "stillactive", session_id: "sess-act" }) as any;
    // Agent was just created — should be active
    const released = autoReleaseStaleAgents(db);
    expect(released).toBe(0);
    expect(getAgent(agent.id)!.session_id).toBe("sess-act");
    delete process.env["TODOS_AGENT_AUTO_RELEASE"];
  });
});
