process.env.TESTERS_DB_PATH = ":memory:";

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { resetDatabase, closeDatabase } from "./database.js";
import { createAuthPreset, getAuthPreset, listAuthPresets, deleteAuthPreset } from "./auth-presets.js";

describe("auth-presets", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => {
    closeDatabase();
  });

  describe("createAuthPreset", () => {
    test("creates with all fields", () => {
      const preset = createAuthPreset({
        name: "admin",
        email: "admin@example.com",
        password: "secret123",
        loginPath: "/auth/login",
      });

      expect(preset.id).toBeDefined();
      expect(preset.name).toBe("admin");
      expect(preset.email).toBe("admin@example.com");
      expect(preset.password).toBe("secret123");
      expect(preset.loginPath).toBe("/auth/login");
      expect(preset.metadata).toEqual({});
      expect(preset.createdAt).toBeDefined();
    });

    test("uses default loginPath when not provided", () => {
      const preset = createAuthPreset({
        name: "user",
        email: "user@example.com",
        password: "pass",
      });

      expect(preset.loginPath).toBe("/login");
    });

    test("creates multiple presets with unique names", () => {
      createAuthPreset({ name: "admin", email: "admin@test.com", password: "a" });
      createAuthPreset({ name: "editor", email: "editor@test.com", password: "b" });

      const all = listAuthPresets();
      expect(all.length).toBe(2);
    });
  });

  describe("getAuthPreset", () => {
    test("finds by name", () => {
      createAuthPreset({ name: "staging", email: "staging@test.com", password: "s" });

      const found = getAuthPreset("staging");
      expect(found).not.toBeNull();
      expect(found!.name).toBe("staging");
      expect(found!.email).toBe("staging@test.com");
    });

    test("returns null for nonexistent name", () => {
      const found = getAuthPreset("nonexistent");
      expect(found).toBeNull();
    });
  });

  describe("listAuthPresets", () => {
    test("returns all presets", () => {
      createAuthPreset({ name: "a", email: "a@test.com", password: "x" });
      createAuthPreset({ name: "b", email: "b@test.com", password: "y" });
      createAuthPreset({ name: "c", email: "c@test.com", password: "z" });

      const all = listAuthPresets();
      expect(all.length).toBe(3);
    });

    test("returns empty array when no presets exist", () => {
      const all = listAuthPresets();
      expect(all).toEqual([]);
    });

    test("returns presets with all fields populated", () => {
      createAuthPreset({ name: "full", email: "full@test.com", password: "pw", loginPath: "/auth" });

      const all = listAuthPresets();
      expect(all.length).toBe(1);
      expect(all[0]!.name).toBe("full");
      expect(all[0]!.email).toBe("full@test.com");
      expect(all[0]!.password).toBe("pw");
      expect(all[0]!.loginPath).toBe("/auth");
      expect(all[0]!.id).toBeDefined();
      expect(all[0]!.createdAt).toBeDefined();
    });
  });

  describe("deleteAuthPreset", () => {
    test("removes and returns true", () => {
      createAuthPreset({ name: "deleteme", email: "d@test.com", password: "x" });

      const result = deleteAuthPreset("deleteme");
      expect(result).toBe(true);

      const found = getAuthPreset("deleteme");
      expect(found).toBeNull();
    });

    test("returns false for nonexistent name", () => {
      const result = deleteAuthPreset("nonexistent");
      expect(result).toBe(false);
    });
  });
});
