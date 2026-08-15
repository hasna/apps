import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import {
  createSession,
  getSession,
  listSessions,
  updateSessionActivity,
  deleteSession,
} from "./sessions.js";
import { createProject } from "./projects.js";

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

describe("createSession", () => {
  it("should create a session with defaults", () => {
    const session = createSession({}, db);
    expect(session.id).toBeTruthy();
    expect(session.agent_id).toBeNull();
    expect(session.project_id).toBeNull();
    expect(session.working_dir).toBeNull();
    expect(session.started_at).toBeTruthy();
    expect(session.last_activity).toBeTruthy();
    expect(session.metadata).toEqual({});
  });

  it("should create a session with all fields", () => {
    const project = createProject({ name: "Proj", path: "/tmp/proj" }, db);
    const session = createSession(
      {
        agent_id: "agent-42",
        project_id: project.id,
        working_dir: "/home/user/code",
        metadata: { editor: "vscode", theme: "dark" },
      },
      db,
    );
    expect(session.agent_id).toBe("agent-42");
    expect(session.project_id).toBe(project.id);
    expect(session.working_dir).toBe("/home/user/code");
    expect(session.metadata).toEqual({ editor: "vscode", theme: "dark" });
  });
});

describe("getSession", () => {
  it("should get a session by ID", () => {
    const created = createSession({ agent_id: "test-agent" }, db);
    const fetched = getSession(created.id, db);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(created.id);
    expect(fetched!.agent_id).toBe("test-agent");
  });

  it("should return null for non-existent session", () => {
    expect(getSession("non-existent-id", db)).toBeNull();
  });
});

describe("listSessions", () => {
  it("should list multiple sessions", () => {
    createSession({ agent_id: "agent-1" }, db);
    createSession({ agent_id: "agent-2" }, db);
    createSession({ agent_id: "agent-3" }, db);
    const sessions = listSessions(db);
    expect(sessions).toHaveLength(3);
  });

  it("should return empty array when no sessions exist", () => {
    const sessions = listSessions(db);
    expect(sessions).toHaveLength(0);
  });

  it("should order sessions by last_activity DESC", () => {
    const s1 = createSession({ agent_id: "first" }, db);
    const s2 = createSession({ agent_id: "second" }, db);

    // Update activity on s1 to make it the most recent
    updateSessionActivity(s1.id, db);

    const sessions = listSessions(db);
    expect(sessions).toHaveLength(2);
    // s1 was updated more recently, so it should be first
    expect(sessions[0]!.id).toBe(s1.id);
  });
});

describe("updateSessionActivity", () => {
  it("should update the last_activity field", () => {
    const session = createSession({}, db);
    const originalActivity = session.last_activity;

    updateSessionActivity(session.id, db);

    const updated = getSession(session.id, db);
    expect(updated).not.toBeNull();
    expect(typeof updated!.last_activity).toBe("string");
    expect(updated!.last_activity >= originalActivity).toBe(true);
  });

  it("should not modify other fields", () => {
    const session = createSession(
      { agent_id: "my-agent", working_dir: "/tmp" },
      db,
    );

    updateSessionActivity(session.id, db);

    const updated = getSession(session.id, db);
    expect(updated!.agent_id).toBe("my-agent");
    expect(updated!.working_dir).toBe("/tmp");
    expect(updated!.started_at).toBe(session.started_at);
  });
});

describe("deleteSession", () => {
  it("should delete an existing session and return true", () => {
    const session = createSession({}, db);
    expect(deleteSession(session.id, db)).toBe(true);
    expect(getSession(session.id, db)).toBeNull();
  });

  it("should return false for non-existent session", () => {
    expect(deleteSession("non-existent-id", db)).toBe(false);
  });
});

describe("session metadata", () => {
  it("should properly parse metadata from JSON", () => {
    const session = createSession(
      {
        metadata: {
          version: 3,
          tags: ["alpha", "beta"],
          nested: { key: "value" },
        },
      },
      db,
    );
    expect(session.metadata).toEqual({
      version: 3,
      tags: ["alpha", "beta"],
      nested: { key: "value" },
    });

    // Also verify round-trip through getSession
    const fetched = getSession(session.id, db);
    expect(fetched!.metadata).toEqual({
      version: 3,
      tags: ["alpha", "beta"],
      nested: { key: "value" },
    });
  });

  it("should default metadata to empty object when not provided", () => {
    const session = createSession({}, db);
    expect(session.metadata).toEqual({});
  });
});
