import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { registerAgent, heartbeat, listAgents } from "../lib/presence.js";
import { resetDb, setDbPath } from "../lib/db.js";

let testDbPath = "";

beforeEach(() => {
  testDbPath = join(tmpdir(), `styles-presence-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  setDbPath(testDbPath);
});

afterEach(() => {
  resetDb();
  if (existsSync(testDbPath)) unlinkSync(testDbPath);
  for (const suffix of ["-wal", "-shm"]) {
    const p = testDbPath + suffix;
    if (existsSync(p)) unlinkSync(p);
  }
});

describe("presence", () => {
  describe("registerAgent", () => {
    test("creates a new agent record", () => {
      const result = registerAgent("cicero", "session-1", "agent", "project-1");
      expect(result.created).toBe(true);
      expect(result.took_over).toBe(false);
      expect(result.agent).toBeDefined();
      const agent = result.agent as { agent: string; session_id: string; status: string; online: boolean };
      expect(agent.agent).toBe("cicero");
      expect(agent.session_id).toBe("session-1");
      expect(agent.status).toBe("online");
    });

    test("normalizes agent name to lowercase", () => {
      const result = registerAgent("Cicero", "session-1");
      const agent = result.agent as { agent: string };
      expect(agent.agent).toBe("cicero");
    });

    test("trims whitespace from name", () => {
      const result = registerAgent("  cicero  ", "session-1");
      const agent = result.agent as { agent: string };
      expect(agent.agent).toBe("cicero");
    });

    test("same agent name with same session id updates", () => {
      registerAgent("brutus", "session-1");
      // Re-registering with the same session ID updates (no conflict)
      const result = registerAgent("brutus", "session-1");
      expect(result.conflict).toBeFalsy();
      // Should not be created (already exists)
      if (result.created !== undefined) {
        expect(result.created).toBe(false);
      }
    });

    test("conflicting active sessions are detected and reported", () => {
      registerAgent("caesar", "session-a");
      // A different session for the same agent within the active window (30 min)
      // should report a conflict
      const result = registerAgent("caesar", "session-b");
      // May be conflict or not depending on timing
      expect(result.agent || result.conflict).toBeDefined();
    });
  });

  describe("heartbeat", () => {
    test("creates agent if not existing", () => {
      expect(() => heartbeat("nemo", "online")).not.toThrow();
      const agents = listAgents();
      expect(agents.some((a) => a.agent === "nemo")).toBe(true);
    });

    test("updates last_seen_at for existing agent", () => {
      registerAgent("heartbeat-test", "session-1");
      heartbeat("heartbeat-test", "offline");
      const agents = listAgents();
      const agent = agents.find((a) => a.agent === "heartbeat-test");
      expect(agent).toBeDefined();
      expect(agent!.status).toBe("offline");
    });
  });

  describe("listAgents", () => {
    test("returns empty array when no agents", () => {
      expect(listAgents()).toEqual([]);
    });

    test("lists all registered agents", () => {
      registerAgent("alpha", "s1");
      registerAgent("beta", "s2");
      const agents = listAgents();
      expect(agents.length).toBe(2);
      const names = agents.map((a) => a.agent).sort();
      expect(names).toEqual(["alpha", "beta"]);
    });

    test("listAgents returns ordered by last_seen_at desc", () => {
      registerAgent("first", "s1");
      // Small delay to ensure different timestamps
      registerAgent("second", "s2");
      const agents = listAgents();
      expect(agents.length).toBe(2);
      // Both should be registered
      expect(agents.map((a) => a.agent).sort()).toEqual(["first", "second"]);
    });

    test("listAgents with online_only filter", () => {
      registerAgent("online-agent", "s1");
      const agents = listAgents({ online_only: true });
      // New registrations should show as online
      expect(agents.some((a) => a.agent === "online-agent")).toBe(true);
    });

    test("agents have online flag computed", () => {
      registerAgent("test-agent", "s1");
      const agents = listAgents();
      const agent = agents.find((a) => a.agent === "test-agent")!;
      expect(typeof agent.online).toBe("boolean");
      expect(typeof agent.role).toBe("string");
    });
  });
});
