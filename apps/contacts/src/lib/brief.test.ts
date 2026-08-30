import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase } from "../db/database.js";
import { createContact, addEmailToContact, addPhoneToContact, updateContact } from "../db/contacts.js";
import { createCompany } from "../db/companies.js";
import { addNote } from "../db/notes.js";
import { generateBrief } from "./brief.js";

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

describe("generateBrief", () => {
  it("returns a brief with the contact display name as heading", () => {
    const c = createContact({ display_name: "Alice Smith" });
    const brief = generateBrief(c.id);
    expect(brief).toContain("# Alice Smith");
  });

  it("shows 'never' when no last_contacted_at", () => {
    const c = createContact({ display_name: "Alice" });
    const brief = generateBrief(c.id);
    expect(brief).toContain("Last contacted: never");
  });

  it("shows days since last contact", () => {
    const c = createContact({ display_name: "Alice" });
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    updateContact(c.id, { last_contacted_at: yesterday });
    const brief = generateBrief(c.id);
    expect(brief).toContain("days ago");
  });

  it("includes job title when present", () => {
    const c = createContact({ display_name: "Alice", job_title: "Engineer" });
    const brief = generateBrief(c.id);
    expect(brief).toContain("**Role:** Engineer");
  });

  it("includes primary email", () => {
    const c = createContact({ display_name: "Alice" });
    addEmailToContact(c.id, { address: "alice@test.com", type: "work", is_primary: true });
    const brief = generateBrief(c.id);
    expect(brief).toContain("**Email:** alice@test.com");
  });

  it("includes primary phone", () => {
    const c = createContact({ display_name: "Alice" });
    addPhoneToContact(c.id, { number: "+1234", type: "mobile", is_primary: true });
    const brief = generateBrief(c.id);
    expect(brief).toContain("**Phone:** +1234");
  });

  it("includes preferred contact method", () => {
    const c = createContact({ display_name: "Alice", preferred_contact_method: "email" });
    const brief = generateBrief(c.id);
    expect(brief).toContain("**Preferred contact:** email");
  });

  it("includes status", () => {
    const c = createContact({ display_name: "Alice" });
    const brief = generateBrief(c.id);
    expect(brief).toContain("Status: active");
  });

  it("includes follow-up date when set", () => {
    const c = createContact({ display_name: "Alice", follow_up_at: "2025-06-01" });
    const brief = generateBrief(c.id);
    expect(brief).toContain("Follow-up scheduled: 2025-06-01");
  });

  it("includes recent notes", () => {
    const c = createContact({ display_name: "Alice" });
    addNote(c.id, "Met at conference");
    const brief = generateBrief(c.id);
    expect(brief).toContain("## Recent Notes");
    expect(brief).toContain("Met at conference");
  });

  it("includes background notes from contact.notes", () => {
    const c = createContact({ display_name: "Alice", notes: "Known since 2020" });
    const brief = generateBrief(c.id);
    expect(brief).toContain("## Background Notes");
    expect(brief).toContain("Known since 2020");
  });

  it("handles minimal contact (no extras)", () => {
    const c = createContact({ display_name: "Minimal" });
    const brief = generateBrief(c.id);
    expect(brief).toContain("# Minimal");
    expect(brief).toContain("Last contacted: never");
    expect(brief).toContain("Status: active");
    // Should NOT contain sections that require data
    expect(brief).not.toContain("## Open Tasks");
    expect(brief).not.toContain("## Entity Relationships");
  });
});
