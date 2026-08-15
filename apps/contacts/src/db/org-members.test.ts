import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase } from "./database.js";
import {
  addOrgMember,
  getOrgMember,
  listOrgMembers,
  updateOrgMember,
  removeOrgMember,
  listOrgMembersForContact,
} from "./org-members.js";
import { createContact } from "./contacts.js";
import { createCompany } from "./companies.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "contacts-org-members-test-"));
  process.env["CONTACTS_DB_PATH"] = join(tmpDir, "test.db");
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
});

describe("addOrgMember", () => {
  it("adds an org member with minimal fields", () => {
    const company = createCompany({ name: "Acme Corp" });
    const contact = createContact({ display_name: "Alice" });
    const member = addOrgMember({ company_id: company.id, contact_id: contact.id });
    expect(member.id).toBeTruthy();
    expect(member.company_id).toBe(company.id);
    expect(member.contact_id).toBe(contact.id);
    expect(member.title).toBeNull();
    expect(member.specialization).toBeNull();
    expect(member.office_phone).toBeNull();
    expect(member.response_sla_hours).toBeNull();
    expect(member.notes).toBeNull();
    expect(member.created_at).toBeTruthy();
    expect(member.updated_at).toBeTruthy();
  });

  it("adds an org member with all fields", () => {
    const company = createCompany({ name: "BigCo" });
    const contact = createContact({ display_name: "Bob" });
    const member = addOrgMember({
      company_id: company.id,
      contact_id: contact.id,
      title: "Account Manager",
      specialization: "Enterprise Sales",
      office_phone: "+1-555-0100",
      response_sla_hours: 24,
      notes: "Primary point of contact",
    });
    expect(member.title).toBe("Account Manager");
    expect(member.specialization).toBe("Enterprise Sales");
    expect(member.office_phone).toBe("+1-555-0100");
    expect(member.response_sla_hours).toBe(24);
    expect(member.notes).toBe("Primary point of contact");
  });

  it("enforces unique company_id + contact_id", () => {
    const company = createCompany({ name: "UniCo" });
    const contact = createContact({ display_name: "Carol" });
    addOrgMember({ company_id: company.id, contact_id: contact.id });
    expect(() => addOrgMember({ company_id: company.id, contact_id: contact.id })).toThrow();
  });
});

describe("getOrgMember", () => {
  it("retrieves an org member by id", () => {
    const company = createCompany({ name: "Acme" });
    const contact = createContact({ display_name: "Alice" });
    const created = addOrgMember({ company_id: company.id, contact_id: contact.id, title: "CTO" });
    const member = getOrgMember(created.id);
    expect(member).not.toBeNull();
    expect(member!.id).toBe(created.id);
    expect(member!.title).toBe("CTO");
  });

  it("returns null for non-existent id", () => {
    expect(getOrgMember("non-existent")).toBeNull();
  });
});

describe("listOrgMembers", () => {
  it("lists all members of a company", () => {
    const company = createCompany({ name: "Acme" });
    const alice = createContact({ display_name: "Alice" });
    const bob = createContact({ display_name: "Bob" });
    addOrgMember({ company_id: company.id, contact_id: alice.id, title: "CEO" });
    addOrgMember({ company_id: company.id, contact_id: bob.id, title: "CTO" });
    const members = listOrgMembers(company.id);
    expect(members.length).toBe(2);
  });

  it("returns empty array for company with no members", () => {
    const company = createCompany({ name: "EmptyCo" });
    expect(listOrgMembers(company.id)).toEqual([]);
  });

  it("does not include members from other companies", () => {
    const company1 = createCompany({ name: "Co1" });
    const company2 = createCompany({ name: "Co2" });
    const contact = createContact({ display_name: "Alice" });
    addOrgMember({ company_id: company1.id, contact_id: contact.id });
    expect(listOrgMembers(company2.id)).toEqual([]);
  });

  it("returns members in ascending created_at order", () => {
    const company = createCompany({ name: "OrderCo" });
    const alice = createContact({ display_name: "Alice" });
    const bob = createContact({ display_name: "Bob" });
    const carol = createContact({ display_name: "Carol" });
    addOrgMember({ company_id: company.id, contact_id: alice.id });
    addOrgMember({ company_id: company.id, contact_id: bob.id });
    addOrgMember({ company_id: company.id, contact_id: carol.id });
    const members = listOrgMembers(company.id);
    expect(members[0].contact_id).toBe(alice.id);
    expect(members[2].contact_id).toBe(carol.id);
  });
});

describe("updateOrgMember", () => {
  it("updates title", () => {
    const company = createCompany({ name: "Acme" });
    const contact = createContact({ display_name: "Alice" });
    const member = addOrgMember({ company_id: company.id, contact_id: contact.id, title: "CTO" });
    const updated = updateOrgMember(member.id, { title: "CEO" });
    expect(updated.title).toBe("CEO");
  });

  it("updates multiple fields at once", () => {
    const company = createCompany({ name: "BigCo" });
    const contact = createContact({ display_name: "Bob" });
    const member = addOrgMember({ company_id: company.id, contact_id: contact.id });
    const updated = updateOrgMember(member.id, {
      title: "VP Engineering",
      specialization: "Backend",
      office_phone: "+1-555-0200",
      response_sla_hours: 48,
      notes: "Updated notes",
    });
    expect(updated.title).toBe("VP Engineering");
    expect(updated.specialization).toBe("Backend");
    expect(updated.office_phone).toBe("+1-555-0200");
    expect(updated.response_sla_hours).toBe(48);
    expect(updated.notes).toBe("Updated notes");
  });

  it("can set fields to null", () => {
    const company = createCompany({ name: "NullCo" });
    const contact = createContact({ display_name: "Carol" });
    const member = addOrgMember({ company_id: company.id, contact_id: contact.id, title: "CTO", notes: "Important" });
    const updated = updateOrgMember(member.id, { title: null, notes: null });
    expect(updated.title).toBeNull();
    expect(updated.notes).toBeNull();
  });

  it("updates the updated_at timestamp", () => {
    const company = createCompany({ name: "TimeCo" });
    const contact = createContact({ display_name: "Dave" });
    const member = addOrgMember({ company_id: company.id, contact_id: contact.id });
    const updated = updateOrgMember(member.id, { title: "New Title" });
    expect(updated.updated_at).toBeTruthy();
    // updated_at should be >= created_at
    expect(new Date(updated.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(member.created_at).getTime());
  });
});

describe("removeOrgMember", () => {
  it("removes an org member", () => {
    const company = createCompany({ name: "Acme" });
    const contact = createContact({ display_name: "Alice" });
    const member = addOrgMember({ company_id: company.id, contact_id: contact.id });
    removeOrgMember(member.id);
    expect(getOrgMember(member.id)).toBeNull();
  });

  it("does not throw for non-existent id", () => {
    expect(() => removeOrgMember("non-existent")).not.toThrow();
  });

  it("only removes the specified member", () => {
    const company = createCompany({ name: "KeepCo" });
    const alice = createContact({ display_name: "Alice" });
    const bob = createContact({ display_name: "Bob" });
    const m1 = addOrgMember({ company_id: company.id, contact_id: alice.id });
    const m2 = addOrgMember({ company_id: company.id, contact_id: bob.id });
    removeOrgMember(m1.id);
    expect(getOrgMember(m1.id)).toBeNull();
    expect(getOrgMember(m2.id)).not.toBeNull();
  });
});

describe("listOrgMembersForContact", () => {
  it("lists all org memberships for a contact", () => {
    const company1 = createCompany({ name: "Co1" });
    const company2 = createCompany({ name: "Co2" });
    const contact = createContact({ display_name: "Alice" });
    addOrgMember({ company_id: company1.id, contact_id: contact.id, title: "Consultant" });
    addOrgMember({ company_id: company2.id, contact_id: contact.id, title: "Advisor" });
    const memberships = listOrgMembersForContact(contact.id);
    expect(memberships.length).toBe(2);
  });

  it("returns empty array for contact with no memberships", () => {
    const contact = createContact({ display_name: "Bob" });
    expect(listOrgMembersForContact(contact.id)).toEqual([]);
  });

  it("does not include memberships from other contacts", () => {
    const company = createCompany({ name: "Acme" });
    const alice = createContact({ display_name: "Alice" });
    const bob = createContact({ display_name: "Bob" });
    addOrgMember({ company_id: company.id, contact_id: alice.id });
    const bobMemberships = listOrgMembersForContact(bob.id);
    expect(bobMemberships).toEqual([]);
  });
});
