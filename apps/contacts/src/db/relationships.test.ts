import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase } from "./database.js";
import { createRelationship, listRelationships, getRelationship, deleteRelationship, createCompanyRelationship, listCompanyRelationships, deleteCompanyRelationship } from "./relationships.js";
import { createContact } from "./contacts.js";
import { createCompany } from "./companies.js";
import { ContactNotFoundError } from "../types/index.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "contacts-rel-test-"));
  process.env["CONTACTS_DB_PATH"] = join(tmpDir, "test.db");
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
});

describe("createRelationship", () => {
  it("creates a relationship between two contacts", () => {
    const a = createContact({ display_name: "Alice" });
    const b = createContact({ display_name: "Bob" });
    const rel = createRelationship({
      contact_a_id: a.id,
      contact_b_id: b.id,
      relationship_type: "colleague",
    });
    expect(rel.id).toBeTruthy();
    expect(rel.contact_a_id).toBe(a.id);
    expect(rel.contact_b_id).toBe(b.id);
    expect(rel.relationship_type).toBe("colleague");
  });

  it("creates a relationship with notes", () => {
    const a = createContact({ display_name: "Alice" });
    const b = createContact({ display_name: "Bob" });
    const rel = createRelationship({
      contact_a_id: a.id,
      contact_b_id: b.id,
      relationship_type: "mentor",
      notes: "Alice mentors Bob",
    });
    expect(rel.notes).toBe("Alice mentors Bob");
  });

  it("throws ContactNotFoundError for missing contact_a_id", () => {
    const b = createContact({ display_name: "Bob" });
    expect(() =>
      createRelationship({ contact_a_id: "missing", contact_b_id: b.id, relationship_type: "friend" })
    ).toThrow(ContactNotFoundError);
  });

  it("throws ContactNotFoundError for missing contact_b_id", () => {
    const a = createContact({ display_name: "Alice" });
    expect(() =>
      createRelationship({ contact_a_id: a.id, contact_b_id: "missing", relationship_type: "friend" })
    ).toThrow(ContactNotFoundError);
  });
});

describe("listRelationships", () => {
  it("returns empty array when no relationships", () => {
    expect(listRelationships()).toEqual([]);
  });

  it("lists all relationships", () => {
    const a = createContact({ display_name: "A" });
    const b = createContact({ display_name: "B" });
    const c = createContact({ display_name: "C" });
    createRelationship({ contact_a_id: a.id, contact_b_id: b.id, relationship_type: "friend" });
    createRelationship({ contact_a_id: b.id, contact_b_id: c.id, relationship_type: "colleague" });
    expect(listRelationships()).toHaveLength(2);
  });

  it("filters by contact_id (either side)", () => {
    const a = createContact({ display_name: "A" });
    const b = createContact({ display_name: "B" });
    const c = createContact({ display_name: "C" });
    createRelationship({ contact_a_id: a.id, contact_b_id: b.id, relationship_type: "friend" });
    createRelationship({ contact_a_id: c.id, contact_b_id: b.id, relationship_type: "colleague" });
    createRelationship({ contact_a_id: a.id, contact_b_id: c.id, relationship_type: "mentor" });

    const forA = listRelationships({ contact_id: a.id });
    expect(forA).toHaveLength(2);

    const forB = listRelationships({ contact_id: b.id });
    expect(forB).toHaveLength(2);
  });

  it("filters by relationship_type", () => {
    const a = createContact({ display_name: "A" });
    const b = createContact({ display_name: "B" });
    const c = createContact({ display_name: "C" });
    createRelationship({ contact_a_id: a.id, contact_b_id: b.id, relationship_type: "friend" });
    createRelationship({ contact_a_id: a.id, contact_b_id: c.id, relationship_type: "colleague" });

    const friends = listRelationships({ relationship_type: "friend" });
    expect(friends).toHaveLength(1);
    expect(friends[0]!.relationship_type).toBe("friend");
  });
});

describe("getRelationship", () => {
  it("retrieves relationship by id", () => {
    const a = createContact({ display_name: "A" });
    const b = createContact({ display_name: "B" });
    const rel = createRelationship({ contact_a_id: a.id, contact_b_id: b.id, relationship_type: "partner" });
    const fetched = getRelationship(rel.id);
    expect(fetched).not.toBeNull();
    expect(fetched!.id).toBe(rel.id);
  });

  it("returns null for missing id", () => {
    expect(getRelationship("nonexistent")).toBeNull();
  });
});

describe("deleteRelationship", () => {
  it("deletes a relationship", () => {
    const a = createContact({ display_name: "A" });
    const b = createContact({ display_name: "B" });
    const rel = createRelationship({ contact_a_id: a.id, contact_b_id: b.id, relationship_type: "client" });
    deleteRelationship(rel.id);
    expect(getRelationship(rel.id)).toBeNull();
  });

  it("does nothing for nonexistent id", () => {
    // Should not throw
    deleteRelationship("nonexistent");
  });
});

describe("createCompanyRelationship", () => {
  it("creates a contact→company relationship", () => {
    const contact = createContact({ display_name: "Alice" });
    const company = createCompany({ name: "Acme Corp" });
    const rel = createCompanyRelationship({
      contact_id: contact.id,
      company_id: company.id,
      relationship_type: "client",
    });
    expect(rel.contact_id).toBe(contact.id);
    expect(rel.company_id).toBe(company.id);
    expect(rel.relationship_type).toBe("client");
    expect(rel.notes).toBeNull();
  });

  it("stores optional notes", () => {
    const contact = createContact({ display_name: "Bob" });
    const company = createCompany({ name: "Corp B" });
    const rel = createCompanyRelationship({
      contact_id: contact.id,
      company_id: company.id,
      relationship_type: "vendor",
      notes: "handles logistics",
    });
    expect(rel.notes).toBe("handles logistics");
  });

  it("throws ContactNotFoundError for invalid contact", () => {
    const company = createCompany({ name: "Corp C" });
    expect(() =>
      createCompanyRelationship({ contact_id: "bad-id", company_id: company.id, relationship_type: "other" })
    ).toThrow(ContactNotFoundError);
  });

  it("throws for invalid company", () => {
    const contact = createContact({ display_name: "Carol" });
    expect(() =>
      createCompanyRelationship({ contact_id: contact.id, company_id: "bad-id", relationship_type: "other" })
    ).toThrow();
  });
});

describe("listCompanyRelationships", () => {
  it("filters by contact_id", () => {
    const c1 = createContact({ display_name: "A" });
    const c2 = createContact({ display_name: "B" });
    const co = createCompany({ name: "Corp" });
    createCompanyRelationship({ contact_id: c1.id, company_id: co.id, relationship_type: "client" });
    createCompanyRelationship({ contact_id: c2.id, company_id: co.id, relationship_type: "vendor" });
    const results = listCompanyRelationships({ contact_id: c1.id });
    expect(results).toHaveLength(1);
    expect(results[0]!.contact_id).toBe(c1.id);
  });

  it("filters by company_id", () => {
    const c = createContact({ display_name: "A" });
    const co1 = createCompany({ name: "Corp1" });
    const co2 = createCompany({ name: "Corp2" });
    createCompanyRelationship({ contact_id: c.id, company_id: co1.id, relationship_type: "client" });
    createCompanyRelationship({ contact_id: c.id, company_id: co2.id, relationship_type: "vendor" });
    const results = listCompanyRelationships({ company_id: co1.id });
    expect(results).toHaveLength(1);
    expect(results[0]!.company_id).toBe(co1.id);
  });

  it("filters by relationship_type", () => {
    const c = createContact({ display_name: "A" });
    const co = createCompany({ name: "Corp" });
    createCompanyRelationship({ contact_id: c.id, company_id: co.id, relationship_type: "client" });
    createCompanyRelationship({ contact_id: c.id, company_id: co.id, relationship_type: "advisor" });
    const clients = listCompanyRelationships({ relationship_type: "client" });
    expect(clients).toHaveLength(1);
    expect(clients[0]!.relationship_type).toBe("client");
  });

  it("returns all when no filter", () => {
    const c = createContact({ display_name: "A" });
    const co = createCompany({ name: "Corp" });
    createCompanyRelationship({ contact_id: c.id, company_id: co.id, relationship_type: "client" });
    createCompanyRelationship({ contact_id: c.id, company_id: co.id, relationship_type: "investor" });
    expect(listCompanyRelationships()).toHaveLength(2);
  });
});

describe("deleteCompanyRelationship", () => {
  it("deletes a relationship", () => {
    const c = createContact({ display_name: "A" });
    const co = createCompany({ name: "Corp" });
    const rel = createCompanyRelationship({ contact_id: c.id, company_id: co.id, relationship_type: "partner" });
    deleteCompanyRelationship(rel.id);
    expect(listCompanyRelationships()).toHaveLength(0);
  });

  it("does nothing for nonexistent id", () => {
    deleteCompanyRelationship("nonexistent"); // should not throw
  });
});
