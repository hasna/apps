import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getDatabase, closeDatabase, resetDatabase } from "./database.js";
import { createOrg, getOrg, getOrgByName, listOrgs, updateOrg, deleteOrg } from "./orgs.js";
import type { Database } from "bun:sqlite";

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

describe("createOrg", () => {
  it("should create an org with a name", () => {
    const org = createOrg({ name: "Acme Corp" });
    expect(org.id).toBeTruthy();
    expect(org.name).toBe("Acme Corp");
    expect(org.description).toBeNull();
    expect(org.metadata).toEqual({});
  });

  it("should create an org with description and metadata", () => {
    const org = createOrg({ name: "Beta Inc", description: "A test org", metadata: { industry: "tech" } });
    expect(org.description).toBe("A test org");
    expect(org.metadata).toEqual({ industry: "tech" });
  });

  it("should fail on duplicate name", () => {
    createOrg({ name: "UniqueOrg" });
    expect(() => createOrg({ name: "UniqueOrg" })).toThrow();
  });
});

describe("getOrg", () => {
  it("should return null for non-existent org", () => {
    expect(getOrg("nonexistent")).toBeNull();
  });

  it("should return an org by ID", () => {
    const org = createOrg({ name: "FindMe" });
    const found = getOrg(org.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("FindMe");
  });
});

describe("getOrgByName", () => {
  it("should return null for non-existent name", () => {
    expect(getOrgByName("NoSuchOrg")).toBeNull();
  });

  it("should return an org by name", () => {
    createOrg({ name: "ByNameSearch" });
    const org = getOrgByName("ByNameSearch");
    expect(org).not.toBeNull();
    expect(org!.name).toBe("ByNameSearch");
  });
});

describe("listOrgs", () => {
  it("should return empty array when no orgs exist", () => {
    expect(listOrgs()).toEqual([]);
  });

  it("should list all orgs ordered by name", () => {
    createOrg({ name: "Zeta Corp" });
    createOrg({ name: "Alpha Inc" });
    createOrg({ name: "Beta Ltd" });
    const orgs = listOrgs();
    expect(orgs).toHaveLength(3);
    expect(orgs[0].name).toBe("Alpha Inc");
    expect(orgs[1].name).toBe("Beta Ltd");
    expect(orgs[2].name).toBe("Zeta Corp");
  });
});

describe("updateOrg", () => {
  it("should update an org's name", () => {
    const org = createOrg({ name: "OldName" });
    const updated = updateOrg(org.id, { name: "NewName" });
    expect(updated.name).toBe("NewName");
  });

  it("should update description", () => {
    const org = createOrg({ name: "DescOrg" });
    const updated = updateOrg(org.id, { description: "New desc" });
    expect(updated.description).toBe("New desc");
  });

  it("should update metadata", () => {
    const org = createOrg({ name: "MetaOrg" });
    const updated = updateOrg(org.id, { metadata: { key: "value" } });
    expect(updated.metadata).toEqual({ key: "value" });
  });

  it("should throw for non-existent org", () => {
    expect(() => updateOrg("nonexistent", { name: "X" })).toThrow("Org not found");
  });
});

describe("deleteOrg", () => {
  it("should delete an org and return true", () => {
    const org = createOrg({ name: "DeleteMe" });
    const result = deleteOrg(org.id);
    expect(result).toBe(true);
    expect(getOrg(org.id)).toBeNull();
  });

  it("should return false for non-existent org", () => {
    expect(deleteOrg("nonexistent")).toBe(false);
  });
});
