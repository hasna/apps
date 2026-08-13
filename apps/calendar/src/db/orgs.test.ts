import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createOrg, getOrg, getOrgBySlug, listOrgs, updateOrg, deleteOrg } from "./orgs.js";
import { getDatabase, resetDatabase } from "./database.js";
import { ConflictError, NotFoundError } from "../types/index.js";

describe("orgs", () => {
  beforeEach(() => {
    resetDatabase();
  });

  afterEach(() => resetDatabase());

  test("create and get org", () => {
    const org = createOrg({ name: "Acme Corp", slug: "acme" });
    expect(org.name).toBe("Acme Corp");
    expect(org.slug).toBe("acme");
    expect(org.id).toHaveLength(8);

    const fetched = getOrg(org.id);
    expect(fetched!.name).toBe("Acme Corp");
  });

  test("auto-generates slug from name", () => {
    const org = createOrg({ name: "My Great Org!" });
    expect(org.slug).toBe("my-great-org");
  });

  test("get by slug", () => {
    createOrg({ name: "Test", slug: "test-slug" });
    const org = getOrgBySlug("test-slug");
    expect(org).not.toBeNull();
    expect(org!.name).toBe("Test");
  });

  test("list orgs", () => {
    createOrg({ name: "A", slug: "a" });
    createOrg({ name: "B", slug: "b" });
    const orgs = listOrgs();
    expect(orgs.length).toBe(2);
  });

  test("update org", () => {
    const org = createOrg({ name: "Old", slug: "old" });
    const updated = updateOrg(org.id, { name: "New" });
    expect(updated.name).toBe("New");
  });

  test("delete org", () => {
    const org = createOrg({ name: "To Delete", slug: "todel" });
    expect(deleteOrg(org.id)).toBe(true);
    expect(getOrg(org.id)).toBeNull();
  });

  test("duplicate slug throws ConflictError", () => {
    createOrg({ name: "First", slug: "dup" });
    expect(() => createOrg({ name: "Second", slug: "dup" })).toThrow(ConflictError);
  });

  test("update nonexistent org throws NotFoundError", () => {
    expect(() => updateOrg("nope", { name: "x" })).toThrow(NotFoundError);
  });

  test("metadata stored and parsed", () => {
    const org = createOrg({ name: "Meta", slug: "meta", metadata: { billing: "enterprise" } });
    expect(org.metadata.billing).toBe("enterprise");
  });
});
