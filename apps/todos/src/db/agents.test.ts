import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { registerAgent, isAgentConflict, releaseAgent, autoReleaseStaleAgents, getAgent, getAgentByName, listAgents, updateAgentActivity, updateAgent, deleteAgent, archiveAgent, unarchiveAgent } from "./agents.js";

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

describe("releaseAgent", () => {
  it("should clear session_id and make agent immediately stale", () => {
    const agent = registerAgent({ name: "release-test", session_id: "sess-1" }) as any;
    expect(releaseAgent(agent.id)).toBe(true);
    const after = getAgent(agent.id)!;
    expect(after.session_id).toBeNull();
    // last_seen_at should be epoch (1970)
    expect(new Date(after.last_seen_at).getFullYear()).toBe(1970);
  });

  it("should allow release with matching session_id", () => {
    const agent = registerAgent({ name: "release-match", session_id: "sess-abc" }) as any;
    expect(releaseAgent(agent.id, "sess-abc")).toBe(true);
    expect(getAgent(agent.id)!.session_id).toBeNull();
  });

  it("should deny release with non-matching session_id", () => {
    const agent = registerAgent({ name: "release-deny", session_id: "sess-real" }) as any;
    expect(releaseAgent(agent.id, "sess-fake")).toBe(false);
    // Agent should still have its session
    expect(getAgent(agent.id)!.session_id).toBe("sess-real");
  });

  it("should return false for non-existent agent", () => {
    expect(releaseAgent("nonexistent")).toBe(false);
  });

  it("should make name immediately available for re-registration", () => {
    const agent = registerAgent({ name: "reuse-me", session_id: "sess-old" }) as any;
    releaseAgent(agent.id);
    // Now a different session should be able to take the name
    const result = registerAgent({ name: "reuse-me", session_id: "sess-new" });
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
    const agent = registerAgent({ name: "stale-guard", session_id: "old-sess" }) as any;
    const staleTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    db.run("UPDATE agents SET last_seen_at = ? WHERE id = ?", [staleTime, agent.id]);
    // No-session registration should succeed for stale agents
    const result = registerAgent({ name: "stale-guard" });
    expect(isAgentConflict(result)).toBe(false);
  });
});

describe("registerAgent — force flag", () => {
  it("should allow force takeover of active agent with different session", () => {
    registerAgent({ name: "force-target", session_id: "sess-a" });
    const result = registerAgent({ name: "force-target", session_id: "sess-b", force: true });
    expect(isAgentConflict(result)).toBe(false);
    expect((result as any).session_id).toBe("sess-b");
  });

  it("should allow force takeover when caller has no session", () => {
    registerAgent({ name: "force-nosess", session_id: "active-sess" });
    const result = registerAgent({ name: "force-nosess", force: true });
    expect(isAgentConflict(result)).toBe(false);
  });

  it("should not need force for stale agents", () => {
    const db = getDatabase();
    const agent = registerAgent({ name: "no-force-needed", session_id: "old" }) as any;
    const staleTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    db.run("UPDATE agents SET last_seen_at = ? WHERE id = ?", [staleTime, agent.id]);
    const result = registerAgent({ name: "no-force-needed", session_id: "new" });
    expect(isAgentConflict(result)).toBe(false);
  });
});

describe("updateAgent — rename conflict check", () => {
  it("should reject rename to a name held by active agent", () => {
    const agentA = registerAgent({ name: "holder-a" }) as any;
    const agentB = registerAgent({ name: "holder-b" }) as any;
    expect(() => updateAgent(agentB.id, { name: "holder-a" })).toThrow("Cannot rename");
  });

  it("should allow rename to a free name", () => {
    const agent = registerAgent({ name: "rename-free" }) as any;
    const updated = updateAgent(agent.id, { name: "totally-new-name" });
    expect(updated.name).toBe("totally-new-name");
  });

  it("should allow rename to a stale agent's name", () => {
    const db = getDatabase();
    const holder = registerAgent({ name: "stale-holder" }) as any;
    const staleTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    db.run("UPDATE agents SET last_seen_at = ? WHERE id = ?", [staleTime, holder.id]);
    const agent = registerAgent({ name: "wants-rename" }) as any;
    const updated = updateAgent(agent.id, { name: "stale-holder" });
    expect(updated.name).toBe("stale-holder");
  });
});

describe("configurable stale window", () => {
  it("should use TODOS_AGENT_TIMEOUT_MS when set", () => {
    const db = getDatabase();
    // Set a 5-second timeout
    process.env["TODOS_AGENT_TIMEOUT_MS"] = "5000";
    const agent = registerAgent({ name: "short-timeout", session_id: "sess-short" }) as any;
    // Manually set last_seen_at to 6 seconds ago (beyond the 5s window)
    const staleTime = new Date(Date.now() - 6000).toISOString();
    db.run("UPDATE agents SET last_seen_at = ? WHERE id = ?", [staleTime, agent.id]);
    // Different session should succeed — agent is stale under the 5s window
    const result = registerAgent({ name: "short-timeout", session_id: "sess-other" });
    expect(isAgentConflict(result)).toBe(false);
    delete process.env["TODOS_AGENT_TIMEOUT_MS"];
  });

  it("should default to 30 minutes when env var is not set", () => {
    delete process.env["TODOS_AGENT_TIMEOUT_MS"];
    const agent = registerAgent({ name: "default-timeout", session_id: "sess-default" }) as any;
    // Should be active (not stale) — different session should be blocked
    const result = registerAgent({ name: "default-timeout", session_id: "sess-intruder" });
    expect(isAgentConflict(result)).toBe(true);
  });

  it("should ignore invalid env var values", () => {
    process.env["TODOS_AGENT_TIMEOUT_MS"] = "not-a-number";
    const agent = registerAgent({ name: "bad-env", session_id: "sess-1" }) as any;
    // Should fall back to 30min default — agent is active, so different session blocked
    const result = registerAgent({ name: "bad-env", session_id: "sess-2" });
    expect(isAgentConflict(result)).toBe(true);
    delete process.env["TODOS_AGENT_TIMEOUT_MS"];
  });
});

describe("autoReleaseStaleAgents", () => {
  it("should clear session_id for stale agents when enabled", () => {
    const db = getDatabase();
    process.env["TODOS_AGENT_AUTO_RELEASE"] = "true";
    process.env["TODOS_AGENT_TIMEOUT_MS"] = "5000";
    const agent = registerAgent({ name: "auto-rel", session_id: "sess-auto" }) as any;
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
    const agent = registerAgent({ name: "no-auto", session_id: "sess-no" }) as any;
    const staleTime = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    db.run("UPDATE agents SET last_seen_at = ? WHERE id = ?", [staleTime, agent.id]);
    const released = autoReleaseStaleAgents(db);
    expect(released).toBe(0);
    expect(getAgent(agent.id)!.session_id).toBe("sess-no");
  });

  it("should not release active agents", () => {
    const db = getDatabase();
    process.env["TODOS_AGENT_AUTO_RELEASE"] = "true";
    const agent = registerAgent({ name: "still-active", session_id: "sess-act" }) as any;
    // Agent was just created — should be active
    const released = autoReleaseStaleAgents(db);
    expect(released).toBe(0);
    expect(getAgent(agent.id)!.session_id).toBe("sess-act");
    delete process.env["TODOS_AGENT_AUTO_RELEASE"];
  });
});
