import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase, getDatabase } from "./database.js";
import { logActivity, listActivity, getActivity } from "./activity.js";
import { createContact } from "./contacts.js";
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

describe("logActivity", () => {
  it("logs an activity with contact_id", () => {
    const db = getDatabase();
    const c = createContact({ display_name: "Alice" });
    const activity = logActivity(db, { contact_id: c.id, action: "created" });
    expect(activity.id).toBeTruthy();
    expect(activity.contact_id).toBe(c.id);
    expect(activity.action).toBe("created");
    expect(activity.company_id).toBeNull();
    expect(activity.details).toBeNull();
  });

  it("logs an activity with company_id", () => {
    const db = getDatabase();
    const co = createCompany({ name: "Acme" });
    const activity = logActivity(db, { company_id: co.id, action: "updated", details: "Changed name" });
    expect(activity.company_id).toBe(co.id);
    expect(activity.action).toBe("updated");
    expect(activity.details).toBe("Changed name");
  });

  it("logs an activity with no contact or company", () => {
    const db = getDatabase();
    const activity = logActivity(db, { action: "system_event" });
    expect(activity.contact_id).toBeNull();
    expect(activity.company_id).toBeNull();
    expect(activity.action).toBe("system_event");
  });
});

describe("listActivity", () => {
  it("lists all activities with defaults", () => {
    const db = getDatabase();
    logActivity(db, { action: "a1" });
    logActivity(db, { action: "a2" });
    const result = listActivity();
    expect(result.entries).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it("returns empty when no activities", () => {
    const result = listActivity();
    expect(result.entries).toEqual([]);
    expect(result.total).toBe(0);
  });

  it("filters by contact_id", () => {
    const db = getDatabase();
    const c = createContact({ display_name: "Alice" });
    // createContact internally logs activity for the contact, so we expect 1 from creation + 1 from explicit log
    logActivity(db, { contact_id: c.id, action: "manual_action" });
    logActivity(db, { action: "other" });
    const result = listActivity({ contact_id: c.id });
    expect(result.entries.length).toBeGreaterThanOrEqual(1);
    const actions = result.entries.map(e => e.action);
    expect(actions).toContain("manual_action");
  });

  it("filters by company_id", () => {
    const db = getDatabase();
    const co = createCompany({ name: "Acme" });
    // createCompany internally logs activity for the company
    logActivity(db, { company_id: co.id, action: "manual_update" });
    logActivity(db, { action: "other" });
    const result = listActivity({ company_id: co.id });
    expect(result.entries.length).toBeGreaterThanOrEqual(1);
    const actions = result.entries.map(e => e.action);
    expect(actions).toContain("manual_update");
  });

  it("respects limit and offset", () => {
    const db = getDatabase();
    for (let i = 0; i < 10; i++) {
      logActivity(db, { action: `action_${i}` });
    }
    const page1 = listActivity({ limit: 3, offset: 0 });
    expect(page1.entries).toHaveLength(3);
    expect(page1.total).toBe(10);

    const page2 = listActivity({ limit: 3, offset: 3 });
    expect(page2.entries).toHaveLength(3);
    expect(page2.total).toBe(10);

    // No overlap between pages
    const ids1 = page1.entries.map(e => e.id);
    const ids2 = page2.entries.map(e => e.id);
    for (const id of ids1) {
      expect(ids2).not.toContain(id);
    }
  });
});

describe("getActivity", () => {
  it("returns an activity by id", () => {
    const db = getDatabase();
    const activity = logActivity(db, { action: "test_action" });
    const found = getActivity(activity.id);
    expect(found).not.toBeNull();
    expect(found!.action).toBe("test_action");
  });

  it("returns null for non-existent id", () => {
    expect(getActivity("non-existent")).toBeNull();
  });
});
