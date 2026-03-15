import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { createHandoff, listHandoffs, getLatestHandoff } from "./handoffs.js";

let db: Database;

beforeEach(() => {
  process.env["TODOS_DB_PATH"] = ":memory:";
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  closeDatabase();
  delete process.env["TODOS_DB_PATH"];
});

describe("createHandoff", () => {
  it("should create a handoff with all fields", () => {
    const h = createHandoff({
      agent_id: "brutus",
      summary: "Built 8 commands",
      completed: ["week", "overdue", "blocked"],
      in_progress: ["handoff MCP tool"],
      blockers: ["needs review"],
      next_steps: ["publish"],
    }, db);
    expect(h.id).toBeDefined();
    expect(h.agent_id).toBe("brutus");
    expect(h.summary).toBe("Built 8 commands");
    expect(h.completed).toEqual(["week", "overdue", "blocked"]);
    expect(h.in_progress).toEqual(["handoff MCP tool"]);
    expect(h.blockers).toEqual(["needs review"]);
    expect(h.next_steps).toEqual(["publish"]);
  });

  it("should create a minimal handoff", () => {
    const h = createHandoff({ summary: "Quick session" }, db);
    expect(h.summary).toBe("Quick session");
    expect(h.agent_id).toBeNull();
    expect(h.completed).toBeNull();
  });
});

describe("listHandoffs", () => {
  it("should list handoffs in reverse chronological order", () => {
    createHandoff({ summary: "First", agent_id: "a" }, db);
    createHandoff({ summary: "Second", agent_id: "b" }, db);
    const list = listHandoffs(undefined, 10, db);
    expect(list.length).toBe(2);
    expect(list[0].summary).toBe("Second");
    expect(list[1].summary).toBe("First");
  });

  it("should respect limit", () => {
    for (let i = 0; i < 5; i++) createHandoff({ summary: `H${i}` }, db);
    const list = listHandoffs(undefined, 3, db);
    expect(list.length).toBe(3);
  });
});

describe("getLatestHandoff", () => {
  it("should return latest handoff by agent", () => {
    createHandoff({ summary: "Old", agent_id: "brutus" }, db);
    createHandoff({ summary: "New", agent_id: "brutus" }, db);
    createHandoff({ summary: "Other", agent_id: "maximus" }, db);
    const latest = getLatestHandoff("brutus", undefined, db);
    expect(latest).not.toBeNull();
    expect(latest!.summary).toBe("New");
  });

  it("should return null when no handoffs exist", () => {
    const latest = getLatestHandoff("nobody", undefined, db);
    expect(latest).toBeNull();
  });
});
