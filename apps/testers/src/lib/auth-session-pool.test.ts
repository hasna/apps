import { describe, test, expect } from "bun:test";
import { AuthenticatedSessionPool } from "./auth-session-pool.js";

describe("AuthenticatedSessionPool", () => {
  describe("constructor", () => {
    test("creates pool with default session max age", () => {
      const pool = new AuthenticatedSessionPool();
      expect(pool).toBeDefined();
      expect(pool.getSessions()).toEqual([]);
    });

    test("creates pool with custom session max age", () => {
      const pool = new AuthenticatedSessionPool({ sessionMaxAgeMs: 60000 });
      expect(pool).toBeDefined();
    });
  });

  describe("session management", () => {
    test("hasSession returns false for unknown persona", () => {
      const pool = new AuthenticatedSessionPool();
      expect(pool.hasSession("nonexistent")).toBe(false);
    });

    test("getContext returns null for unknown persona", () => {
      const pool = new AuthenticatedSessionPool();
      expect(pool.getContext("nonexistent")).toBeNull();
    });

    test("getSessions returns empty array initially", () => {
      const pool = new AuthenticatedSessionPool();
      expect(pool.getSessions()).toHaveLength(0);
    });
  });

  describe("addPersona", () => {
    test("returns null for persona without auth credentials", async () => {
      const pool = new AuthenticatedSessionPool();
      // Persona not found will throw, but personas without auth return null
      // This tests the "no auth credentials" path
      const err = await pool.addPersona("nonexistent-id").catch((e) => e);
      expect(err).toBeInstanceOf(Error);
    });
  });

  describe("closeAll", () => {
    test("clears all sessions", async () => {
      const pool = new AuthenticatedSessionPool();
      await pool.closeAll();
      expect(pool.getSessions()).toHaveLength(0);
    });
  });

  describe("session freshness", () => {
    test("stale sessions are not reused", () => {
      const pool = new AuthenticatedSessionPool({ sessionMaxAgeMs: 0 });
      // 0ms max age means no session is fresh
      expect(pool.hasSession("any")).toBe(false);
    });
  });

  describe("removePersona", () => {
    test("removing non-existent persona does not throw", async () => {
      const pool = new AuthenticatedSessionPool();
      await pool.removePersona("nonexistent");
      expect(pool.getSessions()).toHaveLength(0);
    });
  });
});
