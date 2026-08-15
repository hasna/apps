import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase } from "./database.js";
import { getFreshnessScore, getStaleContacts, markFieldVerified } from "./freshness.js";
import { createContact, addEmailToContact, addPhoneToContact } from "./contacts.js";
import { createCompany } from "./companies.js";

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

describe("getFreshnessScore", () => {
  it("returns a score for a contact with minimal data", () => {
    const c = createContact({ display_name: "Fresh User" });
    const score = getFreshnessScore(c.id);
    expect(score.contact_id).toBe(c.id);
    expect(typeof score.overall_score).toBe("number");
    expect(score.overall_score).toBeGreaterThanOrEqual(0);
    expect(score.overall_score).toBeLessThanOrEqual(100);
    expect(score.fields).toBeInstanceOf(Array);
    expect(score.fields.length).toBeGreaterThan(0);
    expect(score.stale_fields).toBeInstanceOf(Array);
    expect(score.verified_fields).toBeInstanceOf(Array);
  });

  it("throws for non-existent contact", () => {
    expect(() => getFreshnessScore("nonexistent")).toThrow("Contact not found");
  });

  it("scores higher when more fields are populated", () => {
    const sparse = createContact({ display_name: "Sparse" });
    const company = createCompany({ name: "FreshCo" });
    const rich = createContact({
      display_name: "Rich",
      job_title: "Engineer",
      company_id: company.id,
      emails: [{ address: "rich@example.com", type: "work", is_primary: true }],
      phones: [{ number: "+1555000", type: "mobile", is_primary: true }],
    });
    const sparseScore = getFreshnessScore(sparse.id);
    const richScore = getFreshnessScore(rich.id);
    expect(richScore.overall_score).toBeGreaterThan(sparseScore.overall_score);
  });

  it("includes display_name in scored fields", () => {
    const c = createContact({ display_name: "Named" });
    const score = getFreshnessScore(c.id);
    const dnField = score.fields.find(f => f.field_name === "display_name");
    expect(dnField).toBeTruthy();
    expect(dnField!.value).toBe("Named");
  });

  it("reports emails and phones field values", () => {
    const c = createContact({
      display_name: "WithEmail",
      emails: [{ address: "test@test.com", type: "work", is_primary: true }],
    });
    const score = getFreshnessScore(c.id);
    const emailField = score.fields.find(f => f.field_name === "emails");
    expect(emailField).toBeTruthy();
    expect(emailField!.value).toBe("test@test.com");
  });

  it("identifies stale fields (fields with no value)", () => {
    const c = createContact({ display_name: "Minimal" });
    const score = getFreshnessScore(c.id);
    // job_title, company_id, emails, last_contacted_at are all missing
    expect(score.stale_fields.length).toBeGreaterThan(0);
    expect(score.stale_fields).toContain("job_title");
  });

  it("caps overall score at 100", () => {
    const c = createContact({
      display_name: "MaxScore",
      job_title: "CEO",
      emails: [{ address: "max@example.com", type: "work", is_primary: true }],
      phones: [{ number: "+1555", type: "mobile", is_primary: true }],
    });
    const score = getFreshnessScore(c.id);
    expect(score.overall_score).toBeLessThanOrEqual(100);
  });
});

describe("getStaleContacts", () => {
  it("returns contacts below the threshold score", () => {
    createContact({ display_name: "Empty" });
    const stale = getStaleContacts(50);
    expect(stale.length).toBeGreaterThanOrEqual(1);
    expect(stale[0]!.display_name).toBe("Empty");
    expect(typeof stale[0]!.score).toBe("number");
  });

  it("returns empty array when all contacts are well-populated", () => {
    const company = createCompany({ name: "GoodCo" });
    createContact({
      display_name: "Full Contact",
      job_title: "Dev",
      company_id: company.id,
      emails: [{ address: "full@test.com", type: "work", is_primary: true }],
      phones: [{ number: "+1555", type: "mobile", is_primary: true }],
      notes: "some notes",
    });
    // threshold of 10 — a well-populated contact should score above this
    const stale = getStaleContacts(10);
    expect(stale).toHaveLength(0);
  });

  it("uses default threshold of 40", () => {
    createContact({ display_name: "Bare" });
    const stale = getStaleContacts();
    expect(stale.length).toBeGreaterThanOrEqual(1);
  });

  it("does not include archived contacts", () => {
    const c = createContact({ display_name: "Archived" });
    // Archive it manually via the DB since archiveContact is in contacts.ts
    const { getDatabase } = require("./database.js");
    const db = getDatabase();
    db.query(`UPDATE contacts SET archived = 1 WHERE id = ?`).run(c.id);
    const stale = getStaleContacts(100);
    const found = stale.find((s: any) => s.contact_id === c.id);
    expect(found).toBeUndefined();
  });

  it("orders results by score ascending", () => {
    createContact({ display_name: "A" });
    const company = createCompany({ name: "Co" });
    createContact({
      display_name: "B",
      job_title: "Manager",
      company_id: company.id,
    });
    const stale = getStaleContacts(100);
    if (stale.length >= 2) {
      expect(stale[0]!.score).toBeLessThanOrEqual(stale[1]!.score);
    }
  });
});

describe("markFieldVerified", () => {
  it("does not throw when called", () => {
    const c = createContact({ display_name: "Verify Me" });
    // field_verifications table may not exist; function falls back to activity_log
    expect(() => markFieldVerified(c.id, "display_name", "manual")).not.toThrow();
  });

  it("accepts an optional source parameter", () => {
    const c = createContact({ display_name: "Source Test" });
    expect(() => markFieldVerified(c.id, "job_title")).not.toThrow();
    expect(() => markFieldVerified(c.id, "job_title", "linkedin")).not.toThrow();
  });
});
