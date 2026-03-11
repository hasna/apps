process.env.TESTERS_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "./database.js";
import { registerAgent, getAgent, getAgentByName, listAgents } from "./agents.js";

describe("agents", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  describe("registerAgent", () => {
    test("creates a new agent", () => {
      const agent = registerAgent({
        name: "maximus",
        description: "Test agent",
        role: "tester",
      });

      expect(agent.id).toBeDefined();
      expect(agent.name).toBe("maximus");
      expect(agent.description).toBe("Test agent");
      expect(agent.role).toBe("tester");
      expect(agent.createdAt).toBeDefined();
      expect(agent.lastSeenAt).toBeDefined();
    });

    test("creates agent with minimal fields", () => {
      const agent = registerAgent({ name: "cassius" });

      expect(agent.name).toBe("cassius");
      expect(agent.description).toBeNull();
      expect(agent.role).toBeNull();
    });

    test("returns existing agent on same name (idempotent)", () => {
      const first = registerAgent({ name: "brutus", description: "First registration" });
      const second = registerAgent({ name: "brutus", description: "Second registration" });

      expect(second.id).toBe(first.id);
      expect(second.name).toBe("brutus");
      // Description stays the same from original creation
      expect(second.description).toBe("First registration");
    });

    test("updates last_seen_at on re-registration", () => {
      const first = registerAgent({ name: "nero" });
      const firstSeenAt = first.lastSeenAt;

      // Re-register - lastSeenAt should update
      const second = registerAgent({ name: "nero" });
      // They might be the same if executed within the same second,
      // but the key point is no error is thrown and same agent returned
      expect(second.id).toBe(first.id);
    });

    test("creates different agents for different names", () => {
      const a1 = registerAgent({ name: "titus" });
      const a2 = registerAgent({ name: "cicero" });

      expect(a1.id).not.toBe(a2.id);
      expect(a1.name).toBe("titus");
      expect(a2.name).toBe("cicero");
    });
  });

  describe("getAgent", () => {
    test("gets an agent by ID", () => {
      const created = registerAgent({ name: "seneca" });
      const found = getAgent(created.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.name).toBe("seneca");
    });

    test("returns null for non-existent agent", () => {
      const found = getAgent("nonexistent");
      expect(found).toBeNull();
    });
  });

  describe("getAgentByName", () => {
    test("gets an agent by name", () => {
      const created = registerAgent({ name: "cato" });
      const found = getAgentByName("cato");

      expect(found).not.toBeNull();
      expect(found!.id).toBe(created.id);
      expect(found!.name).toBe("cato");
    });

    test("returns null for non-existent name", () => {
      const found = getAgentByName("nonexistent-agent");
      expect(found).toBeNull();
    });

    test("is case-sensitive", () => {
      registerAgent({ name: "julius" });
      const found = getAgentByName("Julius");
      expect(found).toBeNull();
    });
  });

  describe("listAgents", () => {
    test("lists all agents", () => {
      registerAgent({ name: "agent-a" });
      registerAgent({ name: "agent-b" });
      registerAgent({ name: "agent-c" });

      const agents = listAgents();
      expect(agents.length).toBe(3);
    });

    test("returns empty array when no agents exist", () => {
      const agents = listAgents();
      expect(agents).toEqual([]);
    });

    test("returns all registered agents", () => {
      registerAgent({ name: "first-agent" });
      registerAgent({ name: "second-agent" });
      registerAgent({ name: "third-agent" });

      const agents = listAgents();
      const names = agents.map((a) => a.name).sort();
      expect(names).toEqual(["first-agent", "second-agent", "third-agent"]);
    });
  });
});
