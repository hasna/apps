import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { unlinkSync, existsSync, mkdirSync, rmdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import {
  createProfile,
  getProfile,
  getProfileByName,
  listProfiles,
  updateProfile,
  deleteProfile,
  setActiveProfile,
  getActiveProfile,
  getBuiltinStyleProfile,
} from "../lib/profiles.js";
import { resetDb, setDbPath } from "../lib/db.js";
import { setPref } from "../lib/preferences.js";

let testDbPath = "";

beforeEach(() => {
  testDbPath = join(tmpdir(), `styles-profiles-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
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

const FIXTURE_INPUT = {
  name: "test-style",
  displayName: "Test Style",
  description: "A test profile",
  category: "custom",
  principles: ["Keep it simple", "Use white space"],
  antiPatterns: ["Don't nest cards"],
  typography: { fontFamilies: ["Inter"] },
  colors: { primary: "#000" },
  componentRules: { borderRadius: ["8px"] },
  tags: ["minimal", "test"],
};

describe("profiles CRUD", () => {
  describe("createProfile", () => {
    test("creates a profile with all fields", () => {
      const profile = createProfile(FIXTURE_INPUT);
      expect(profile.id).toBeDefined();
      expect(profile.name).toBe("test-style");
      expect(profile.displayName).toBe("Test Style");
      expect(profile.builtin).toBe(false);
      expect(profile.createdAt).toBeGreaterThan(0);
      expect(profile.principles).toEqual(FIXTURE_INPUT.principles);
    });
  });

  describe("getProfile", () => {
    test("returns null for unknown id", () => {
      expect(getProfile("nonexistent")).toBeNull();
    });

    test("retrieves a saved profile", () => {
      const created = createProfile(FIXTURE_INPUT);
      const retrieved = getProfile(created.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe("test-style");
    });
  });

  describe("getProfileByName", () => {
    test("returns null for unknown name", () => {
      expect(getProfileByName("nonexistent")).toBeNull();
    });

    test("retrieves by name", () => {
      createProfile(FIXTURE_INPUT);
      const profile = getProfileByName("test-style");
      expect(profile).not.toBeNull();
      expect(profile!.id).toBeDefined();
    });
  });

  describe("listProfiles", () => {
    test("returns empty array when no profiles", () => {
      expect(listProfiles()).toEqual([]);
    });

    test("returns all profiles sorted by creation time", () => {
      createProfile({ ...FIXTURE_INPUT, name: "first" });
      createProfile({ ...FIXTURE_INPUT, name: "second" });
      const profiles = listProfiles();
      expect(profiles.length).toBe(2);
      expect(profiles[0].createdAt).toBeLessThanOrEqual(profiles[1].createdAt);
    });
  });

  describe("updateProfile", () => {
    test("updates profile fields", () => {
      const profile = createProfile(FIXTURE_INPUT);
      const updated = updateProfile(profile.id, { displayName: "Updated Name", tags: ["updated"] });
      expect(updated.displayName).toBe("Updated Name");
      expect(updated.tags).toEqual(["updated"]);
      expect(updated.name).toBe("test-style"); // unchanged
    });

    test("throws for unknown id", () => {
      expect(() => updateProfile("bad-id", { name: "x" })).toThrow("Profile not found");
    });
  });

  describe("deleteProfile", () => {
    test("removes a profile", () => {
      const profile = createProfile(FIXTURE_INPUT);
      deleteProfile(profile.id);
      expect(getProfile(profile.id)).toBeNull();
    });
  });
});

describe("active profile", () => {
  test("getActiveProfile returns null when no profile set", () => {
    expect(getActiveProfile("/some/project")).toBeNull();
  });

  test("setActiveProfile and getActiveProfile", () => {
    const profile = createProfile(FIXTURE_INPUT);
    setActiveProfile("/my/project", profile.id);
    const active = getActiveProfile("/my/project");
    expect(active).not.toBeNull();
    expect(active!.id).toBe(profile.id);
  });

  test("falls back to global preference", () => {
    const profile = createProfile(FIXTURE_INPUT);
    setPref("active_profile", profile.id, "global");
    const active = getActiveProfile("/some/other/project");
    expect(active).not.toBeNull();
    expect(active!.name).toBe("test-style");
  });

  test("setActiveProfile updates existing config", () => {
    const p1 = createProfile({ ...FIXTURE_INPUT, name: "style-1" });
    const p2 = createProfile({ ...FIXTURE_INPUT, name: "style-2" });
    setActiveProfile("/my/project", p1.id);
    setActiveProfile("/my/project", p2.id);
    const active = getActiveProfile("/my/project");
    expect(active!.id).toBe(p2.id);
  });
});

describe("getBuiltinStyleProfile", () => {
  test("returns profile for valid built-in style", () => {
    const profile = getBuiltinStyleProfile("minimalist");
    expect(profile.name).toBe("minimalist");
    expect(profile.builtin).toBe(true);
    expect(profile.id).toBe("builtin:minimalist");
  });

  test("throws for unknown style", () => {
    expect(() => getBuiltinStyleProfile("nonexistent")).toThrow("Unknown style");
  });
});
