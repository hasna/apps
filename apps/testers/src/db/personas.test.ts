process.env["TESTERS_DB_PATH"] = ":memory:";

import { describe, it, expect, beforeEach } from "bun:test";
import { resetDatabase } from "../db/database.js";
import {
  createPersona,
  getPersona,
  listPersonas,
  getGlobalPersonas,
  updatePersona,
  deletePersona,
  countPersonas,
} from "./personas.js";
import { createProject } from "./projects.js";
import { PersonaNotFoundError, VersionConflictError } from "../types/index.js";

beforeEach(() => {
  resetDatabase();
});

describe("createPersona", () => {
  it("creates a global persona (no projectId)", () => {
    const p = createPersona({ name: "Power User", role: "admin" });
    expect(p.id).toBeTruthy();
    expect(p.shortId).toBeTruthy();
    expect(p.name).toBe("Power User");
    expect(p.role).toBe("admin");
    expect(p.projectId).toBeNull();
    expect(p.enabled).toBe(true);
    expect(p.version).toBe(1);
    expect(p.traits).toEqual([]);
    expect(p.goals).toEqual([]);
  });

  it("creates a project-scoped persona", () => {
    const project = createProject({ name: "My App" });
    const p = createPersona({
      name: "Mobile User",
      role: "end-user",
      projectId: project.id,
      traits: ["impatient", "mobile-first"],
      goals: ["complete checkout quickly"],
    });
    expect(p.projectId).toBe(project.id);
    expect(p.traits).toEqual(["impatient", "mobile-first"]);
    expect(p.goals).toEqual(["complete checkout quickly"]);
  });

  it("creates a persona with all fields", () => {
    const p = createPersona({
      name: "QA Tester",
      role: "tester",
      description: "A thorough QA tester",
      instructions: "Click everything",
      traits: ["detail-oriented"],
      goals: ["find bugs"],
      enabled: false,
      metadata: { level: 3 },
    });
    expect(p.description).toBe("A thorough QA tester");
    expect(p.instructions).toBe("Click everything");
    expect(p.enabled).toBe(false);
    expect(p.metadata).toEqual({ level: 3 });
  });
});

describe("getPersona", () => {
  it("gets a persona by id", () => {
    const created = createPersona({ name: "Admin", role: "admin" });
    const found = getPersona(created.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Admin");
  });

  it("gets a persona by short_id", () => {
    const created = createPersona({ name: "Admin", role: "admin" });
    const found = getPersona(created.shortId);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
  });

  it("returns null for a missing persona", () => {
    expect(getPersona("nonexistent-id")).toBeNull();
  });
});

describe("listPersonas", () => {
  it("lists all personas when no filter given", () => {
    createPersona({ name: "Global User", role: "user" });
    createPersona({ name: "Admin", role: "admin" });
    const all = listPersonas();
    expect(all.length).toBe(2);
  });

  it("globalOnly filter returns only personas with null project_id", () => {
    const project = createProject({ name: "App" });
    createPersona({ name: "Global User", role: "user" });
    createPersona({ name: "Project User", role: "user", projectId: project.id });
    const globals = listPersonas({ globalOnly: true });
    expect(globals.length).toBe(1);
    expect(globals[0]!.name).toBe("Global User");
  });

  it("projectId filter includes both project-specific and global personas", () => {
    const project = createProject({ name: "App" });
    const otherProject = createProject({ name: "Other App" });
    createPersona({ name: "Global User", role: "user" });
    createPersona({ name: "Project User", role: "user", projectId: project.id });
    createPersona({ name: "Other Project User", role: "user", projectId: otherProject.id });
    const results = listPersonas({ projectId: project.id });
    expect(results.length).toBe(2);
    const names = results.map((p) => p.name);
    expect(names).toContain("Global User");
    expect(names).toContain("Project User");
  });

  it("enabled filter returns only enabled personas", () => {
    createPersona({ name: "Active", role: "user", enabled: true });
    createPersona({ name: "Inactive", role: "user", enabled: false });
    const enabled = listPersonas({ enabled: true });
    expect(enabled.length).toBe(1);
    expect(enabled[0]!.name).toBe("Active");
  });

  it("enabled: false filter returns only disabled personas", () => {
    createPersona({ name: "Active", role: "user", enabled: true });
    createPersona({ name: "Inactive", role: "user", enabled: false });
    const disabled = listPersonas({ enabled: false });
    expect(disabled.length).toBe(1);
    expect(disabled[0]!.name).toBe("Inactive");
  });

  it("limit and offset pagination work", () => {
    createPersona({ name: "A", role: "user" });
    createPersona({ name: "B", role: "user" });
    createPersona({ name: "C", role: "user" });
    const page1 = listPersonas({ limit: 2 });
    expect(page1.length).toBe(2);
    const page2 = listPersonas({ limit: 2, offset: 2 });
    expect(page2.length).toBe(1);
  });
});

describe("getGlobalPersonas", () => {
  it("returns only enabled global personas", () => {
    const project = createProject({ name: "App" });
    createPersona({ name: "Global Active", role: "user", enabled: true });
    createPersona({ name: "Global Inactive", role: "user", enabled: false });
    createPersona({ name: "Project User", role: "user", projectId: project.id, enabled: true });
    const globals = getGlobalPersonas();
    expect(globals.length).toBe(1);
    expect(globals[0]!.name).toBe("Global Active");
  });

  it("returns empty array when no global personas exist", () => {
    const project = createProject({ name: "App" });
    createPersona({ name: "Project User", role: "user", projectId: project.id });
    expect(getGlobalPersonas()).toEqual([]);
  });
});

describe("updatePersona", () => {
  it("updates fields and bumps version", () => {
    const p = createPersona({ name: "Original", role: "user" });
    const updated = updatePersona(p.id, { name: "Updated", role: "admin" }, 1);
    expect(updated.name).toBe("Updated");
    expect(updated.role).toBe("admin");
    expect(updated.version).toBe(2);
  });

  it("returns unchanged persona when no updates provided", () => {
    const p = createPersona({ name: "Same", role: "user" });
    const result = updatePersona(p.id, {}, 1);
    expect(result.version).toBe(1);
    expect(result.name).toBe("Same");
  });

  it("throws VersionConflictError on wrong version", () => {
    const p = createPersona({ name: "Versioned", role: "user" });
    expect(() => updatePersona(p.id, { name: "Conflict" }, 99)).toThrow(VersionConflictError);
  });

  it("throws PersonaNotFoundError for missing persona", () => {
    expect(() => updatePersona("no-such-id", { name: "X" }, 1)).toThrow(PersonaNotFoundError);
  });

  it("updates traits and goals", () => {
    const p = createPersona({ name: "Trait Test", role: "user", traits: ["a"] });
    const updated = updatePersona(p.id, { traits: ["b", "c"], goals: ["goal1"] }, 1);
    expect(updated.traits).toEqual(["b", "c"]);
    expect(updated.goals).toEqual(["goal1"]);
  });

  it("updates enabled flag", () => {
    const p = createPersona({ name: "Toggle", role: "user", enabled: true });
    const updated = updatePersona(p.id, { enabled: false }, 1);
    expect(updated.enabled).toBe(false);
  });
});

describe("deletePersona", () => {
  it("deletes an existing persona and returns true", () => {
    const p = createPersona({ name: "To Delete", role: "user" });
    expect(deletePersona(p.id)).toBe(true);
    expect(getPersona(p.id)).toBeNull();
  });

  it("returns false for a missing persona", () => {
    expect(deletePersona("nonexistent-id")).toBe(false);
  });
});

describe("countPersonas", () => {
  it("counts all personas", () => {
    createPersona({ name: "A", role: "user" });
    createPersona({ name: "B", role: "user" });
    expect(countPersonas()).toBe(2);
  });

  it("counts with globalOnly filter", () => {
    const project = createProject({ name: "App" });
    createPersona({ name: "Global", role: "user" });
    createPersona({ name: "Project", role: "user", projectId: project.id });
    expect(countPersonas({ globalOnly: true })).toBe(1);
  });

  it("counts with enabled filter", () => {
    createPersona({ name: "Active", role: "user", enabled: true });
    createPersona({ name: "Inactive", role: "user", enabled: false });
    expect(countPersonas({ enabled: true })).toBe(1);
    expect(countPersonas({ enabled: false })).toBe(1);
  });

  it("counts with projectId filter (includes globals)", () => {
    const project = createProject({ name: "App" });
    createPersona({ name: "Global", role: "user" });
    createPersona({ name: "Project", role: "user", projectId: project.id });
    expect(countPersonas({ projectId: project.id })).toBe(2);
  });
});
