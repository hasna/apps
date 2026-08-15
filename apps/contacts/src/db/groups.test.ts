import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase, getDatabase } from "./database.js";
import {
  createGroup, getGroup, listGroups, updateGroup, deleteGroup,
  addContactToGroup, removeContactFromGroup, listContactsInGroup, listGroupsForContact,
  addCompanyToGroup, removeCompanyFromGroup, listCompaniesInGroup, listGroupsForCompany,
} from "./groups.js";
import { createContact } from "./contacts.js";
import { createCompany } from "./companies.js";
import type { ContactsDatabase } from "./database.js";

let tmpDir: string;
let db: ContactsDatabase;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "contacts-test-"));
  process.env["CONTACTS_DB_PATH"] = join(tmpDir, "test.db");
  resetDatabase();
  db = getDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
});

describe("createGroup", () => {
  it("creates a group with minimal fields", () => {
    const g = createGroup(db, { name: "VIP" });
    expect(g.id).toBeTruthy();
    expect(g.name).toBe("VIP");
    expect(g.description).toBeNull();
    expect(g.project_id).toBeNull();
    expect(g.created_at).toBeTruthy();
    expect(g.updated_at).toBeTruthy();
  });

  it("creates a group with all fields", () => {
    const g = createGroup(db, { name: "Team", description: "Main team", project_id: "proj-123" });
    expect(g.name).toBe("Team");
    expect(g.description).toBe("Main team");
    expect(g.project_id).toBe("proj-123");
  });
});

describe("getGroup", () => {
  it("returns a group by id", () => {
    const g = createGroup(db, { name: "Test" });
    const found = getGroup(db, g.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Test");
  });

  it("returns null for non-existent group", () => {
    expect(getGroup(db, "non-existent")).toBeNull();
  });
});

describe("listGroups", () => {
  it("lists all groups", () => {
    createGroup(db, { name: "A" });
    createGroup(db, { name: "B" });
    const groups = listGroups(db);
    expect(groups).toHaveLength(2);
  });

  it("returns empty array when no groups", () => {
    expect(listGroups(db)).toEqual([]);
  });

  it("filters by project_id", () => {
    createGroup(db, { name: "A", project_id: "proj-1" });
    createGroup(db, { name: "B", project_id: "proj-2" });
    const groups = listGroups(db, "proj-1");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.name).toBe("A");
  });

  it("includes member_count and company_count", () => {
    const g = createGroup(db, { name: "Test" });
    const c = createContact({ display_name: "Alice" });
    const co = createCompany({ name: "Acme" });
    addContactToGroup(db, c.id, g.id);
    addCompanyToGroup(db, co.id, g.id);
    const groups = listGroups(db);
    expect(groups[0]!.member_count).toBe(1);
    expect(groups[0]!.company_count).toBe(1);
  });
});

describe("updateGroup", () => {
  it("updates group name", () => {
    const g = createGroup(db, { name: "Old" });
    const updated = updateGroup(db, g.id, { name: "New" });
    expect(updated.name).toBe("New");
  });

  it("updates description and project_id", () => {
    const g = createGroup(db, { name: "Test" });
    const updated = updateGroup(db, g.id, { description: "Updated desc", project_id: "proj-99" });
    expect(updated.description).toBe("Updated desc");
    expect(updated.project_id).toBe("proj-99");
  });

  it("clears nullable fields", () => {
    const g = createGroup(db, { name: "Test", description: "Desc", project_id: "proj" });
    const updated = updateGroup(db, g.id, { description: null, project_id: null });
    expect(updated.description).toBeNull();
    expect(updated.project_id).toBeNull();
  });
});

describe("deleteGroup", () => {
  it("deletes a group", () => {
    const g = createGroup(db, { name: "To Delete" });
    deleteGroup(db, g.id);
    expect(getGroup(db, g.id)).toBeNull();
  });

  it("does not throw for non-existent id", () => {
    expect(() => deleteGroup(db, "non-existent")).not.toThrow();
  });
});

describe("contact-group membership", () => {
  it("adds a contact to a group", () => {
    const g = createGroup(db, { name: "Team" });
    const c = createContact({ display_name: "Alice" });
    const result = addContactToGroup(db, c.id, g.id);
    expect(result.added).toBe(true);
    expect(result.already_member).toBe(false);
  });

  it("returns already_member when adding duplicate", () => {
    const g = createGroup(db, { name: "Team" });
    const c = createContact({ display_name: "Alice" });
    addContactToGroup(db, c.id, g.id);
    const result = addContactToGroup(db, c.id, g.id);
    expect(result.added).toBe(false);
    expect(result.already_member).toBe(true);
  });

  it("lists contacts in a group", () => {
    const g = createGroup(db, { name: "Team" });
    const c1 = createContact({ display_name: "Alice" });
    const c2 = createContact({ display_name: "Bob" });
    addContactToGroup(db, c1.id, g.id);
    addContactToGroup(db, c2.id, g.id);
    const contacts = listContactsInGroup(db, g.id);
    expect(contacts).toHaveLength(2);
    expect(contacts).toContain(c1.id);
    expect(contacts).toContain(c2.id);
  });

  it("removes a contact from a group", () => {
    const g = createGroup(db, { name: "Team" });
    const c = createContact({ display_name: "Alice" });
    addContactToGroup(db, c.id, g.id);
    removeContactFromGroup(db, c.id, g.id);
    expect(listContactsInGroup(db, g.id)).toEqual([]);
  });

  it("lists groups for a contact", () => {
    const g1 = createGroup(db, { name: "Alpha" });
    const g2 = createGroup(db, { name: "Beta" });
    const c = createContact({ display_name: "Alice" });
    addContactToGroup(db, c.id, g1.id);
    addContactToGroup(db, c.id, g2.id);
    const groups = listGroupsForContact(db, c.id);
    expect(groups).toHaveLength(2);
    const names = groups.map(g => g.name);
    expect(names).toContain("Alpha");
    expect(names).toContain("Beta");
  });
});

describe("company-group membership", () => {
  it("adds a company to a group", () => {
    const g = createGroup(db, { name: "Partners" });
    const co = createCompany({ name: "Acme" });
    const result = addCompanyToGroup(db, co.id, g.id);
    expect(result.added).toBe(true);
    expect(result.already_member).toBe(false);
  });

  it("returns already_member when adding duplicate company", () => {
    const g = createGroup(db, { name: "Partners" });
    const co = createCompany({ name: "Acme" });
    addCompanyToGroup(db, co.id, g.id);
    const result = addCompanyToGroup(db, co.id, g.id);
    expect(result.added).toBe(false);
    expect(result.already_member).toBe(true);
  });

  it("lists companies in a group", () => {
    const g = createGroup(db, { name: "Partners" });
    const co1 = createCompany({ name: "Acme" });
    const co2 = createCompany({ name: "Globex" });
    addCompanyToGroup(db, co1.id, g.id);
    addCompanyToGroup(db, co2.id, g.id);
    const companies = listCompaniesInGroup(db, g.id);
    expect(companies).toHaveLength(2);
    expect(companies).toContain(co1.id);
    expect(companies).toContain(co2.id);
  });

  it("removes a company from a group", () => {
    const g = createGroup(db, { name: "Partners" });
    const co = createCompany({ name: "Acme" });
    addCompanyToGroup(db, co.id, g.id);
    removeCompanyFromGroup(db, co.id, g.id);
    expect(listCompaniesInGroup(db, g.id)).toEqual([]);
  });

  it("lists groups for a company", () => {
    const g1 = createGroup(db, { name: "Alpha" });
    const g2 = createGroup(db, { name: "Beta" });
    const co = createCompany({ name: "Acme" });
    addCompanyToGroup(db, co.id, g1.id);
    addCompanyToGroup(db, co.id, g2.id);
    const groups = listGroupsForCompany(db, co.id);
    expect(groups).toHaveLength(2);
    const names = groups.map(g => g.name);
    expect(names).toContain("Alpha");
    expect(names).toContain("Beta");
  });
});
