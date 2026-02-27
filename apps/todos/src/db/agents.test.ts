import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { registerAgent, getAgent, getAgentByName, listAgents, updateAgentActivity, deleteAgent } from "./agents.js";

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

describe("deleteAgent", () => {
  it("should delete existing agent", () => {
    const agent = registerAgent({ name: "doomed" });
    expect(deleteAgent(agent.id)).toBe(true);
    expect(getAgent(agent.id)).toBeNull();
  });

  it("should return false for non-existent agent", () => {
    expect(deleteAgent("nope")).toBe(false);
  });
});
