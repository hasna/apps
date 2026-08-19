import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { registerAgent, getAgent, getAgentByName, listAgents, heartbeat, updateAgent, deleteAgent } from "./agents.js";
import { getDatabase, resetDatabase } from "./database.js";
import { ConflictError, NotFoundError } from "../types/index.js";

describe("agents", () => {
  beforeEach(() => {
    resetDatabase(":memory:");
    getDatabase(":memory:");
  });

  afterEach(() => resetDatabase(":memory:"));

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

  test("duplicate registration without force throws ConflictError and leaves the row unchanged", () => {
    const first = registerAgent({ name: "dup", role: "member", metadata: { k: "v" }, capabilities: ["go"] });
    expect(() => registerAgent({ name: "dup", role: "admin" })).toThrow(ConflictError);

    const after = getAgent(first.id)!;
    expect(after.role).toBe("member");
    expect(after.metadata).toEqual({ k: "v" });
    expect(after.capabilities).toEqual(["go"]);
  });

  test("force registration takes over the same id, updates supplied fields, preserves omitted ones", () => {
    const first = registerAgent({
      name: "takeover",
      role: "member",
      title: "Original Title",
      metadata: { keep: "me" },
      capabilities: ["go"],
    });

    const taken = registerAgent({ name: "takeover", role: "admin", force: true });
    expect(taken.id).toBe(first.id);
    expect(taken.role).toBe("admin");
    // Omitted fields are preserved, not reset.
    expect(taken.title).toBe("Original Title");
    expect(taken.metadata).toEqual({ keep: "me" });
    expect(taken.capabilities).toEqual(["go"]);
  });

  test("force registration can replace capabilities and set a session", () => {
    registerAgent({ name: "replace-cap", capabilities: ["go"] });
    const taken = registerAgent({
      name: "replace-cap",
      capabilities: ["react"],
      session_id: "sess-1",
      force: true,
    });
    expect(taken.capabilities).toEqual(["react"]);
    expect(taken.session_id).toBe("sess-1");
  });

  test("second delete returns false", () => {
    const agent = registerAgent({ name: "del-twice" });
    expect(deleteAgent(agent.id)).toBe(true);
    expect(deleteAgent(agent.id)).toBe(false);
  });
});
