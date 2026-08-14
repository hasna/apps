import { describe, expect, test, afterEach } from "bun:test";

import {
  createProfile,
  getProfile,
  getProfileByName,
  listProfiles,
  updateProfile,
  deleteProfile,
} from "../src/lib/profiles.js";
import { initDb } from "../src/lib/db.js";

// Ensure DB is initialized before tests
initDb();

// Track created profile IDs for cleanup
const createdIds: string[] = [];

afterEach(() => {
  // Clean up all profiles created during tests
  for (const id of createdIds.splice(0)) {
    try {
      deleteProfile(id);
    } catch {
      // ignore
    }
  }
});

function uniqueName(base: string) {
  return `${base}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const makeInput = (name: string) => ({
  name,
  displayName: "Test Profile",
  description: "A test profile",
  category: "Minimalist",
  principles: ["Keep it simple"],
  antiPatterns: ["Avoid clutter"],
  typography: { fontFamily: "Inter" },
  colors: { primary: "#000" },
  componentRules: { Button: "flat" },
  tags: ["clean", "simple"],
});

describe("createProfile", () => {
  test("creates and returns profile with id", () => {
    const profile = createProfile(makeInput(uniqueName("create-test")));
    createdIds.push(profile.id);

    expect(typeof profile.id).toBe("string");
    expect(profile.id.length).toBeGreaterThan(0);
    expect(profile.displayName).toBe("Test Profile");
    expect(profile.builtin).toBe(false);
  });
});

describe("getProfile", () => {
  test("retrieves profile by id", () => {
    const created = createProfile(makeInput(uniqueName("getbyid")));
    createdIds.push(created.id);

    const retrieved = getProfile(created.id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(created.id);
  });

  test("returns null for nonexistent id", () => {
    expect(getProfile("nonexistent-id-xyz-abc")).toBeNull();
  });
});

describe("getProfileByName", () => {
  test("retrieves profile by name", () => {
    const name = uniqueName("getbyname");
    const created = createProfile(makeInput(name));
    createdIds.push(created.id);

    const retrieved = getProfileByName(name);
    expect(retrieved).toBeDefined();
    expect(retrieved!.name).toBe(name);
  });

  test("returns null for nonexistent name", () => {
    expect(getProfileByName("does-not-exist-xyz-abc-123")).toBeNull();
  });
});

describe("listProfiles", () => {
  test("returns array of profiles", () => {
    const p1 = createProfile(makeInput(uniqueName("list-p1")));
    const p2 = createProfile(makeInput(uniqueName("list-p2")));
    createdIds.push(p1.id, p2.id);

    const profiles = listProfiles();
    expect(Array.isArray(profiles)).toBe(true);
    const ids = profiles.map((p) => p.id);
    expect(ids).toContain(p1.id);
    expect(ids).toContain(p2.id);
  });
});

describe("updateProfile", () => {
  test("updates fields", () => {
    const created = createProfile(makeInput(uniqueName("update-test")));
    createdIds.push(created.id);

    const updated = updateProfile(created.id, { displayName: "Updated Name" });
    expect(updated.displayName).toBe("Updated Name");
    expect(updated.description).toBe("A test profile"); // unchanged
  });

  test("throws for nonexistent profile", () => {
    expect(() => updateProfile("nonexistent-xyz", { displayName: "X" })).toThrow();
  });
});

describe("deleteProfile", () => {
  test("removes the profile", () => {
    const created = createProfile(makeInput(uniqueName("delete-test")));

    deleteProfile(created.id);
    expect(getProfile(created.id)).toBeNull();
    // Don't push to createdIds since we already deleted it
  });
});
