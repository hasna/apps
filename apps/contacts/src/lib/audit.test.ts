import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase } from "../db/database.js";
import { createContact, addEmailToContact, addPhoneToContact, updateContact } from "../db/contacts.js";
import { createCompany } from "../db/companies.js";
import { createTag, addTagToContact } from "../db/tags.js";
import { auditContact, listContactAudit } from "./audit.js";
import type { ContactWithDetails } from "../types/index.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "contacts-test-"));
  process.env["CONTACTS_DB_PATH"] = join(tmpDir, "test.db");
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
});

function makeMinimalContact(overrides: Partial<ContactWithDetails> = {}): ContactWithDetails {
  return {
    id: "c-test",
    first_name: "",
    last_name: "",
    display_name: "Test",
    nickname: null,
    avatar_url: null,
    notes: null,
    birthday: null,
    company_id: null,
    company: null,
    job_title: null,
    source: "manual",
    custom_fields: {},
    created_at: "",
    updated_at: "",
    emails: [],
    phones: [],
    addresses: [],
    social_profiles: [],
    tags: [],
    last_contacted_at: null,
    website: null,
    preferred_contact_method: null,
    status: "active",
    follow_up_at: null,
    archived: false,
    project_id: null,
    sensitivity: "normal",
    do_not_contact: false,
    priority: 3,
    timezone: null,
    relationship_health: 50,
    avg_response_hours: null,
    preferred_channel: null,
    engagement_status: "new",
    interaction_count_30d: 0,
    interaction_count_90d: 0,
    canonical_id: null,
    ...overrides,
  } as unknown as ContactWithDetails;
}

describe("auditContact", () => {
  it("returns score 0 for completely empty contact", () => {
    const result = auditContact(makeMinimalContact());
    expect(result.score).toBe(0);
    expect(result.missing).toContain("email");
    expect(result.missing).toContain("phone");
    expect(result.missing).toContain("company");
    expect(result.missing).toContain("last_contacted_at");
    expect(result.missing).toContain("tags");
    expect(result.missing).toContain("notes");
    expect(result.missing).toContain("job_title");
    expect(result.suggestions).toHaveLength(7);
  });

  it("returns score 100 for fully populated contact", () => {
    const result = auditContact(makeMinimalContact({
      emails: [{ id: "e1", contact_id: "c-test", company_id: null, address: "a@b.com", type: "work", is_primary: true, created_at: "" }] as any,
      phones: [{ id: "p1", contact_id: "c-test", company_id: null, number: "+1", type: "mobile", is_primary: true, country_code: null, created_at: "" }] as any,
      company_id: "co-1",
      last_contacted_at: new Date().toISOString(),
      tags: [{ id: "t1", name: "vip", color: "#000", description: null, created_at: "" }] as any,
      notes: "Some notes",
      job_title: "Engineer",
    }));
    expect(result.score).toBe(100);
    expect(result.missing).toHaveLength(0);
    expect(result.suggestions).toHaveLength(0);
  });

  it("scores email at 20 points", () => {
    const without = auditContact(makeMinimalContact());
    const with_ = auditContact(makeMinimalContact({
      emails: [{ id: "e1", contact_id: "c", company_id: null, address: "a@b.com", type: "work", is_primary: true, created_at: "" }] as any,
    }));
    expect(with_.score - without.score).toBe(20);
  });

  it("scores phone at 15 points", () => {
    const without = auditContact(makeMinimalContact());
    const with_ = auditContact(makeMinimalContact({
      phones: [{ id: "p1", contact_id: "c", company_id: null, number: "+1", type: "mobile", is_primary: true, country_code: null, created_at: "" }] as any,
    }));
    expect(with_.score - without.score).toBe(15);
  });

  it("returns correct contact_id and display_name", () => {
    const result = auditContact(makeMinimalContact({ id: "xyz", display_name: "John" }));
    expect(result.contact_id).toBe("xyz");
    expect(result.display_name).toBe("John");
  });

  it("suggests adding email when missing", () => {
    const result = auditContact(makeMinimalContact());
    expect(result.suggestions).toContain("Add an email address");
  });

  it("suggests logging contact when never contacted", () => {
    const result = auditContact(makeMinimalContact());
    expect(result.suggestions).toContain("Log a contact interaction");
  });
});

describe("listContactAudit", () => {
  it("returns empty array for empty database", async () => {
    const results = await listContactAudit();
    expect(results).toEqual([]);
  });

  it("returns audit for all contacts sorted by score ascending", async () => {
    // Contact with more data (higher score)
    const co = createCompany({ name: "Acme" });
    const c1 = createContact({
      display_name: "Rich",
      job_title: "CEO",
      company_id: co.id,
      notes: "Has lots of info",
    });
    addEmailToContact(c1.id, { address: "rich@test.com", type: "work", is_primary: true });

    // Contact with minimal data (lower score)
    createContact({ display_name: "Poor" });

    const results = await listContactAudit();
    expect(results).toHaveLength(2);
    // Sorted by score ascending, so poorest first
    expect(results[0]!.display_name).toBe("Poor");
    expect(results[1]!.display_name).toBe("Rich");
    expect(results[0]!.score).toBeLessThan(results[1]!.score);
  });

  it("accepts explicit db parameter", async () => {
    createContact({ display_name: "Test" });
    const { getDatabase } = await import("../db/database.js");
    const db = getDatabase();
    const results = await listContactAudit(db);
    expect(results).toHaveLength(1);
  });
});
