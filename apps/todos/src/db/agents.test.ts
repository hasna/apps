import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { registerAgent, isAgentConflict, getAgent, getAgentByName, listAgents, updateAgentActivity, updateAgent, deleteAgent, archiveAgent, unarchiveAgent } from "./agents.js";

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
    const first = registerAgent({ name: "test-agent" });
    const second = registerAgent({ name: "test-agent" });
    expect(second.id).toBe(first.id);
    expect(second.last_seen_at).toBeDefined();
  });

  it("should store description and metadata", () => {
    const agent = registerAgent({
      name: "custom-bot",
      description: "A custom bot",
      metadata: { version: "1.0", features: ["search"] },
    });
    expect(agent.description).toBe("A custom bot");
    expect(agent.metadata).toEqual({ version: "1.0", features: ["search"] });
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
    registerAgent({ name: "my-agent" });
    const found = getAgentByName("my-agent");
    expect(found).not.toBeNull();
    expect(found!.name).toBe("my-agent");
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
    const agent = registerAgent({ name: "old-name-" + Date.now() });
    const newName = "new-name-" + Date.now();
    const updated = updateAgent(agent.id, { name: newName });
    expect(updated.name).toBe(newName);
  });

  it("should update agent description", () => {
    const agent = registerAgent({ name: "desc-test-" + Date.now() });
    const updated = updateAgent(agent.id, { description: "New description" });
    expect(updated.description).toBe("New description");
  });

  it("should update agent role", () => {
    const agent = registerAgent({ name: "role-test-" + Date.now() });
    const updated = updateAgent(agent.id, { role: "admin" });
    expect(updated.role).toBe("admin");
  });

  it("should throw for non-existent agent", () => {
    expect(() => updateAgent("nonexistent", { name: "test" })).toThrow();
  });

  it("should update multiple fields at once", () => {
    const agent = registerAgent({ name: "multi-" + Date.now() });
    const updated = updateAgent(agent.id, { name: "renamed-" + Date.now(), description: "Updated", role: "observer" });
    expect(updated.description).toBe("Updated");
    expect(updated.role).toBe("observer");
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
