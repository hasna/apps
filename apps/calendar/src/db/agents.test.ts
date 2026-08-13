import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { registerAgent, getAgent, getAgentByName, listAgents, heartbeat, updateAgent, deleteAgent } from "./agents.js";
import { getDatabase, resetDatabase } from "./database.js";
import { ConflictError, NotFoundError } from "../types/index.js";

describe("agents", () => {
  beforeEach(() => {
    resetDatabase();
    getDatabase(":memory:");
  });

  afterEach(() => resetDatabase());

  test("register and get agent", () => {
    const agent = registerAgent({ name: "marcus", description: "Architect", role: "engineer" });
    expect(agent.name).toBe("marcus");
    expect(agent.id).toHaveLength(8);

    const fetched = getAgent(agent.id);
    expect(fetched!.name).toBe("marcus");
  });

  test("get by name", () => {
    registerAgent({ name: "brutus" });
    const agent = getAgentByName("brutus");
    expect(agent).not.toBeNull();
  });

  test("list agents", () => {
    registerAgent({ name: "a" });
    registerAgent({ name: "b" });
    expect(listAgents().length).toBe(2);
  });

  test("duplicate name throws ConflictError", () => {
    registerAgent({ name: "dup" });
    expect(() => registerAgent({ name: "dup" })).toThrow(ConflictError);
  });

  test("force takeover works", () => {
    registerAgent({ name: "agent1", description: "old" });
    const updated = registerAgent({ name: "agent1", description: "new", force: true });
    expect(updated.description).toBe("new");
  });

  test("heartbeat updates last_seen_at", () => {
    const agent = registerAgent({ name: "hb" });
    const before = agent.last_seen_at;
    const after = heartbeat(agent.id)!;
    expect(after.last_seen_at >= before).toBe(true);
  });

  test("update agent fields", () => {
    const agent = registerAgent({ name: "up" });
    const updated = updateAgent(agent.id, { role: "senior", title: "Lead" })!;
    expect(updated.role).toBe("senior");
    expect(updated.title).toBe("Lead");
  });

  test("delete agent", () => {
    const agent = registerAgent({ name: "del" });
    expect(deleteAgent(agent.id)).toBe(true);
    expect(getAgent(agent.id)).toBeNull();
  });

  test("update nonexistent agent throws", () => {
    expect(() => updateAgent("nope", { role: "x" })).toThrow(NotFoundError);
  });

  test("capabilities stored as array", () => {
    const agent = registerAgent({ name: "cap", capabilities: ["react", "go"] });
    expect(agent.capabilities).toEqual(["react", "go"]);
  });
});
