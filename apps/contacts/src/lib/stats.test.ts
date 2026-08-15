import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase, getDatabase } from "../db/database.js";
import { createContact, addEmailToContact, addPhoneToContact } from "../db/contacts.js";
import { createCompany } from "../db/companies.js";
import { getNetworkStats } from "./stats.js";

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

describe("getNetworkStats", () => {
  it("returns all zeros for empty database", () => {
    const stats = getNetworkStats();
    expect(stats.total_contacts).toBe(0);
    expect(stats.total_companies).toBe(0);
    expect(stats.owned_entities).toBe(0);
    expect(stats.total_tags).toBe(0);
    expect(stats.total_groups).toBe(0);
    expect(stats.total_deals).toBe(0);
    expect(stats.total_events).toBe(0);
    expect(stats.cold_30d).toBe(0);
    expect(stats.cold_60d).toBe(0);
    expect(stats.cold_never).toBe(0);
    expect(stats.contacts_with_email).toBe(0);
    expect(stats.contacts_with_phone).toBe(0);
    expect(stats.contacts_no_company).toBe(0);
    expect(stats.overdue_tasks).toBe(0);
    expect(stats.pending_applications).toBe(0);
    expect(stats.missing_invoices).toBe(0);
    expect(stats.upcoming_7d).toBe(0);
    expect(stats.notes_count).toBe(0);
    expect(stats.active_deals_value).toBe(0);
  });

  it("counts contacts and companies", () => {
    createContact({ display_name: "Alice" });
    createContact({ display_name: "Bob" });
    createCompany({ name: "Acme" });
    const stats = getNetworkStats();
    expect(stats.total_contacts).toBe(2);
    expect(stats.total_companies).toBe(1);
  });

  it("counts contacts with email and phone", () => {
    const c1 = createContact({ display_name: "Alice" });
    const c2 = createContact({ display_name: "Bob" });
    addEmailToContact(c1.id, { address: "a@b.com", type: "work", is_primary: true });
    addPhoneToContact(c2.id, { number: "+123", type: "mobile", is_primary: true });
    const stats = getNetworkStats();
    expect(stats.contacts_with_email).toBe(1);
    expect(stats.contacts_with_phone).toBe(1);
  });

  it("counts contacts without company", () => {
    createContact({ display_name: "Alice" });
    const co = createCompany({ name: "Acme" });
    createContact({ display_name: "Bob", company_id: co.id });
    const stats = getNetworkStats();
    expect(stats.contacts_no_company).toBe(1);
  });

  it("counts cold_never for contacts never contacted", () => {
    createContact({ display_name: "Alice" });
    createContact({ display_name: "Bob" });
    const stats = getNetworkStats();
    expect(stats.cold_never).toBe(2);
  });

  it("counts owned entities", () => {
    createCompany({ name: "MyCompany", is_owned_entity: true });
    createCompany({ name: "External" });
    const stats = getNetworkStats();
    expect(stats.owned_entities).toBe(1);
  });

  it("accepts explicit db parameter", () => {
    const db = getDatabase();
    createContact({ display_name: "Test" });
    const stats = getNetworkStats(db);
    expect(stats.total_contacts).toBe(1);
  });
});
