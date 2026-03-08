import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createSpace, updateSpace, archiveSpace, unarchiveSpace, listSpaces, getSpace, joinSpace, leaveSpace, getSpaceMembers, isSpaceMember, getSpaceDepth } from "./spaces";
import { createProject } from "./projects";
import { sendMessage } from "./messages";
import { closeDb } from "./db";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-test-sp-${Date.now()}.db`);

beforeEach(() => {
  process.env.CONVERSATIONS_DB_PATH = TEST_DB;
  closeDb();
});

afterEach(() => {
  closeDb();
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(TEST_DB + "-wal"); } catch {}
  try { unlinkSync(TEST_DB + "-shm"); } catch {}
});

describe("createSpace", () => {
  test("creates space and returns it", () => {
    const sp = createSpace("general", "alice", { description: "General chat" });
    expect(sp.name).toBe("general");
    expect(sp.description).toBe("General chat");
    expect(sp.created_by).toBe("alice");
    expect(sp.parent_id).toBeNull();
    expect(sp.project_id).toBeNull();
    expect(sp.created_at).toBeTruthy();
  });

  test("auto-joins creator", () => {
    createSpace("general", "alice");
    expect(isSpaceMember("general", "alice")).toBe(true);
  });

  test("creates without description", () => {
    const sp = createSpace("test", "alice");
    expect(sp.description).toBeNull();
  });

  test("throws on duplicate name", () => {
    createSpace("general", "alice");
    expect(() => createSpace("general", "bob")).toThrow();
  });

  test("creates child space", () => {
    createSpace("parent", "alice");
    const child = createSpace("child", "alice", { parent_id: "parent" });
    expect(child.parent_id).toBe("parent");
  });

  test("creates grandchild space (3 levels)", () => {
    createSpace("level0", "alice");
    createSpace("level1", "alice", { parent_id: "level0" });
    const level2 = createSpace("level2", "alice", { parent_id: "level1" });
    expect(level2.parent_id).toBe("level1");
  });

  test("throws on 4th level (exceeds max depth)", () => {
    createSpace("level0", "alice");
    createSpace("level1", "alice", { parent_id: "level0" });
    createSpace("level2", "alice", { parent_id: "level1" });
    expect(() => createSpace("level3", "alice", { parent_id: "level2" })).toThrow("Maximum space nesting depth");
  });

  test("throws if parent does not exist", () => {
    expect(() => createSpace("child", "alice", { parent_id: "nonexistent" })).toThrow("Parent space not found");
  });

  test("creates space with project_id", () => {
    const proj = createProject({ name: "myproject", created_by: "alice" });
    const sp = createSpace("dev", "alice", { project_id: proj.id });
    expect(sp.project_id).toBe(proj.id);
  });

  test("throws if project does not exist", () => {
    expect(() => createSpace("dev", "alice", { project_id: "nonexistent" })).toThrow("Project not found");
  });
});

describe("listSpaces", () => {
  test("returns empty when no spaces", () => {
    expect(listSpaces()).toEqual([]);
  });

  test("returns spaces with counts", () => {
    createSpace("general", "alice", { description: "General" });
    joinSpace("general", "bob");
    sendMessage({ from: "alice", to: "general", content: "hi", space: "general" });

    const spaces = listSpaces();
    expect(spaces).toHaveLength(1);
    expect(spaces[0].name).toBe("general");
    expect(spaces[0].member_count).toBe(2);
    expect(spaces[0].message_count).toBe(1);
  });

  test("orders alphabetically", () => {
    createSpace("beta", "alice");
    createSpace("alpha", "alice");
    const spaces = listSpaces();
    expect(spaces[0].name).toBe("alpha");
    expect(spaces[1].name).toBe("beta");
  });

  test("filters by project_id", () => {
    const proj = createProject({ name: "myproject", created_by: "alice" });
    createSpace("proj-space", "alice", { project_id: proj.id });
    createSpace("standalone", "alice");

    const filtered = listSpaces({ project_id: proj.id });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe("proj-space");
  });

  test("filters top-level only (parent_id null)", () => {
    createSpace("parent", "alice");
    createSpace("child", "alice", { parent_id: "parent" });

    const topLevel = listSpaces({ parent_id: null });
    expect(topLevel).toHaveLength(1);
    expect(topLevel[0].name).toBe("parent");
  });

  test("filters by parent_id", () => {
    createSpace("parent", "alice");
    createSpace("child1", "alice", { parent_id: "parent" });
    createSpace("child2", "alice", { parent_id: "parent" });
    createSpace("other", "alice");

    const children = listSpaces({ parent_id: "parent" });
    expect(children).toHaveLength(2);
  });
});

describe("getSpace", () => {
  test("returns null for nonexistent space", () => {
    expect(getSpace("nonexistent")).toBeNull();
  });

  test("returns space info", () => {
    createSpace("general", "alice", { description: "General chat" });
    const sp = getSpace("general");
    expect(sp).toBeTruthy();
    expect(sp!.name).toBe("general");
    expect(sp!.description).toBe("General chat");
    expect(sp!.member_count).toBe(1);
  });
});

describe("joinSpace", () => {
  test("joins existing space", () => {
    createSpace("general", "alice");
    const ok = joinSpace("general", "bob");
    expect(ok).toBe(true);
    expect(isSpaceMember("general", "bob")).toBe(true);
  });

  test("returns false for nonexistent space", () => {
    expect(joinSpace("nonexistent", "bob")).toBe(false);
  });

  test("is idempotent (no error on double join)", () => {
    createSpace("general", "alice");
    joinSpace("general", "bob");
    joinSpace("general", "bob"); // Should not throw
    expect(getSpaceMembers("general")).toHaveLength(2);
  });
});

describe("leaveSpace", () => {
  test("leaves space", () => {
    createSpace("general", "alice");
    joinSpace("general", "bob");
    const ok = leaveSpace("general", "bob");
    expect(ok).toBe(true);
    expect(isSpaceMember("general", "bob")).toBe(false);
  });

  test("returns false if not a member", () => {
    createSpace("general", "alice");
    expect(leaveSpace("general", "bob")).toBe(false);
  });
});

describe("getSpaceMembers", () => {
  test("returns empty for no members", () => {
    expect(getSpaceMembers("nonexistent")).toEqual([]);
  });

  test("returns members in join order", () => {
    createSpace("general", "alice");
    joinSpace("general", "bob");
    joinSpace("general", "charlie");
    const members = getSpaceMembers("general");
    expect(members).toHaveLength(3);
    expect(members[0].agent).toBe("alice");
    expect(members[1].agent).toBe("bob");
  });
});

describe("isSpaceMember", () => {
  test("returns true for member", () => {
    createSpace("general", "alice");
    expect(isSpaceMember("general", "alice")).toBe(true);
  });

  test("returns false for non-member", () => {
    createSpace("general", "alice");
    expect(isSpaceMember("general", "bob")).toBe(false);
  });
});

describe("getSpaceDepth", () => {
  test("returns 0 for top-level space", () => {
    createSpace("top", "alice");
    expect(getSpaceDepth("top")).toBe(0);
  });

  test("returns 1 for child of top-level", () => {
    createSpace("parent", "alice");
    createSpace("child", "alice", { parent_id: "parent" });
    expect(getSpaceDepth("child")).toBe(1);
  });

  test("returns 2 for grandchild", () => {
    createSpace("level0", "alice");
    createSpace("level1", "alice", { parent_id: "level0" });
    createSpace("level2", "alice", { parent_id: "level1" });
    expect(getSpaceDepth("level2")).toBe(2);
  });
});

describe("updateSpace", () => {
  test("updates description", () => {
    createSpace("general", "alice", { description: "Old desc" });
    const sp = updateSpace("general", { description: "New desc" });
    expect(sp.name).toBe("general");
    expect(sp.description).toBe("New desc");
  });

  test("throws if space does not exist", () => {
    expect(() => updateSpace("nonexistent", { description: "test" })).toThrow("Space not found");
  });

  test("updates parent_id", () => {
    createSpace("parent", "alice");
    createSpace("child", "alice");
    const sp = updateSpace("child", { parent_id: "parent" });
    expect(sp.parent_id).toBe("parent");
  });

  test("removes parent_id with null", () => {
    createSpace("parent", "alice");
    createSpace("child", "alice", { parent_id: "parent" });
    const sp = updateSpace("child", { parent_id: null });
    expect(sp.parent_id).toBeNull();
  });

  test("throws if new parent does not exist", () => {
    createSpace("general", "alice");
    expect(() => updateSpace("general", { parent_id: "nonexistent" })).toThrow("Parent space not found");
  });

  test("throws if new parent exceeds max depth", () => {
    createSpace("level0", "alice");
    createSpace("level1", "alice", { parent_id: "level0" });
    createSpace("level2", "alice", { parent_id: "level1" });
    createSpace("orphan", "alice");
    expect(() => updateSpace("orphan", { parent_id: "level2" })).toThrow("Maximum space nesting depth");
  });

  test("throws if space is set as its own parent", () => {
    createSpace("general", "alice");
    expect(() => updateSpace("general", { parent_id: "general" })).toThrow("A space cannot be its own parent");
  });

  test("updates project_id", () => {
    const proj = createProject({ name: "myproject", created_by: "alice" });
    createSpace("general", "alice");
    const sp = updateSpace("general", { project_id: proj.id });
    expect(sp.project_id).toBe(proj.id);
  });

  test("removes project_id with null", () => {
    const proj = createProject({ name: "myproject", created_by: "alice" });
    createSpace("general", "alice", { project_id: proj.id });
    const sp = updateSpace("general", { project_id: null });
    expect(sp.project_id).toBeNull();
  });

  test("throws if new project does not exist", () => {
    createSpace("general", "alice");
    expect(() => updateSpace("general", { project_id: "nonexistent" })).toThrow("Project not found");
  });

  test("returns unchanged space when no updates provided", () => {
    createSpace("general", "alice", { description: "Original" });
    const sp = updateSpace("general", {});
    expect(sp.description).toBe("Original");
  });
});

describe("archiveSpace", () => {
  test("archives a space", () => {
    createSpace("general", "alice");
    const sp = archiveSpace("general");
    expect(sp.name).toBe("general");
    expect(sp.archived_at).toBeTruthy();
  });

  test("throws if space does not exist", () => {
    expect(() => archiveSpace("nonexistent")).toThrow("Space not found");
  });

  test("archived space is excluded from listSpaces by default", () => {
    createSpace("active", "alice");
    createSpace("old", "alice");
    archiveSpace("old");

    const spaces = listSpaces();
    expect(spaces).toHaveLength(1);
    expect(spaces[0].name).toBe("active");
  });

  test("archived space is included when include_archived is true", () => {
    createSpace("active", "alice");
    createSpace("old", "alice");
    archiveSpace("old");

    const spaces = listSpaces({ include_archived: true });
    expect(spaces).toHaveLength(2);
  });
});

describe("unarchiveSpace", () => {
  test("unarchives a space", () => {
    createSpace("general", "alice");
    archiveSpace("general");
    const sp = unarchiveSpace("general");
    expect(sp.name).toBe("general");
    expect(sp.archived_at).toBeNull();
  });

  test("throws if space does not exist", () => {
    expect(() => unarchiveSpace("nonexistent")).toThrow("Space not found");
  });

  test("unarchived space appears in default listSpaces", () => {
    createSpace("general", "alice");
    archiveSpace("general");

    let spaces = listSpaces();
    expect(spaces).toHaveLength(0);

    unarchiveSpace("general");
    spaces = listSpaces();
    expect(spaces).toHaveLength(1);
    expect(spaces[0].name).toBe("general");
  });
});

describe("createSpace archived_at", () => {
  test("new space has null archived_at", () => {
    const sp = createSpace("general", "alice");
    expect(sp.archived_at).toBeNull();
  });

  test("getSpace returns archived_at", () => {
    createSpace("general", "alice");
    archiveSpace("general");
    const sp = getSpace("general");
    expect(sp).toBeTruthy();
    expect(sp!.archived_at).toBeTruthy();
  });
});
