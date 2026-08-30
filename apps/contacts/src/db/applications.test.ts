import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase } from "./database.js";
import {
  createApplication, getApplication, listApplications, updateApplication,
  deleteApplication, listFollowUpDue, listPendingApplications,
} from "./applications.js";
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

describe("createApplication", () => {
  it("creates an application with minimal fields", () => {
    const app = createApplication({ program_name: "Y Combinator" });
    expect(app.id).toBeTruthy();
    expect(app.program_name).toBe("Y Combinator");
    expect(app.type).toBe("other");
    expect(app.status).toBe("draft");
    expect(app.provider_company_id).toBeNull();
    expect(app.value_usd).toBeNull();
    expect(app.applicant_contact_id).toBeNull();
    expect(app.primary_contact_id).toBeNull();
    expect(app.submitted_date).toBeNull();
    expect(app.decision_date).toBeNull();
    expect(app.follow_up_date).toBeNull();
    expect(app.notes).toBeNull();
    expect(app.method).toBeNull();
    expect(app.form_url).toBeNull();
    expect(app.metadata).toEqual({});
    expect(app.created_at).toBeTruthy();
    expect(app.updated_at).toBeTruthy();
  });

  it("creates an application with all fields", () => {
    const co = createCompany({ name: "Provider Co" });
    const c1 = createContact({ display_name: "Applicant" });
    const c2 = createContact({ display_name: "Contact Person" });
    const app = createApplication({
      program_name: "Grant Program",
      provider_company_id: co.id,
      type: "grant",
      value_usd: 25000,
      applicant_contact_id: c1.id,
      primary_contact_id: c2.id,
      status: "submitted",
      submitted_date: "2026-03-01",
      decision_date: "2026-06-01",
      follow_up_date: "2026-04-15",
      notes: "Strong candidate",
      method: "form",
      form_url: "https://example.com/apply",
      metadata: { round: 2, category: "tech" },
    });
    expect(app.program_name).toBe("Grant Program");
    expect(app.provider_company_id).toBe(co.id);
    expect(app.type).toBe("grant");
    expect(app.value_usd).toBe(25000);
    expect(app.applicant_contact_id).toBe(c1.id);
    expect(app.primary_contact_id).toBe(c2.id);
    expect(app.status).toBe("submitted");
    expect(app.submitted_date).toBe("2026-03-01");
    expect(app.decision_date).toBe("2026-06-01");
    expect(app.follow_up_date).toBe("2026-04-15");
    expect(app.notes).toBe("Strong candidate");
    expect(app.method).toBe("form");
    expect(app.form_url).toBe("https://example.com/apply");
    expect(app.metadata).toEqual({ round: 2, category: "tech" });
  });
});

describe("getApplication", () => {
  it("returns an application by id", () => {
    const app = createApplication({ program_name: "Test" });
    const found = getApplication(app.id);
    expect(found).not.toBeNull();
    expect(found!.program_name).toBe("Test");
  });

  it("returns null for non-existent id", () => {
    expect(getApplication("non-existent")).toBeNull();
  });
});

describe("listApplications", () => {
  it("lists all applications", () => {
    createApplication({ program_name: "A" });
    createApplication({ program_name: "B" });
    expect(listApplications()).toHaveLength(2);
  });

  it("returns empty when none exist", () => {
    expect(listApplications()).toEqual([]);
  });

  it("filters by type", () => {
    createApplication({ program_name: "Grant", type: "grant" });
    createApplication({ program_name: "Other", type: "other" });
    const results = listApplications({ type: "grant" });
    expect(results).toHaveLength(1);
    expect(results[0]!.program_name).toBe("Grant");
  });

  it("filters by status", () => {
    createApplication({ program_name: "A", status: "submitted" });
    createApplication({ program_name: "B", status: "draft" });
    const results = listApplications({ status: "submitted" });
    expect(results).toHaveLength(1);
    expect(results[0]!.program_name).toBe("A");
  });

  it("filters by provider_company_id", () => {
    const co = createCompany({ name: "Provider" });
    createApplication({ program_name: "A", provider_company_id: co.id });
    createApplication({ program_name: "B" });
    const results = listApplications({ provider_company_id: co.id });
    expect(results).toHaveLength(1);
    expect(results[0]!.program_name).toBe("A");
  });

  it("filters by applicant_contact_id", () => {
    const c = createContact({ display_name: "Alice" });
    createApplication({ program_name: "A", applicant_contact_id: c.id });
    createApplication({ program_name: "B" });
    const results = listApplications({ applicant_contact_id: c.id });
    expect(results).toHaveLength(1);
    expect(results[0]!.program_name).toBe("A");
  });
});

describe("updateApplication", () => {
  it("updates basic fields", () => {
    const app = createApplication({ program_name: "Old", status: "draft" });
    const updated = updateApplication(app.id, { program_name: "New", status: "submitted" });
    expect(updated.program_name).toBe("New");
    expect(updated.status).toBe("submitted");
  });

  it("updates nullable fields to null", () => {
    const app = createApplication({
      program_name: "Test",
      notes: "Some notes",
      value_usd: 1000,
      form_url: "https://example.com",
    });
    const updated = updateApplication(app.id, { notes: null, value_usd: null, form_url: null });
    expect(updated.notes).toBeNull();
    expect(updated.value_usd).toBeNull();
    expect(updated.form_url).toBeNull();
  });

  it("updates metadata", () => {
    const app = createApplication({ program_name: "Test", metadata: { a: 1 } });
    const updated = updateApplication(app.id, { metadata: { b: 2, c: 3 } });
    expect(updated.metadata).toEqual({ b: 2, c: 3 });
  });

  it("updates updated_at timestamp", () => {
    const app = createApplication({ program_name: "Test" });
    const updated = updateApplication(app.id, { program_name: "Updated" });
    expect(updated.updated_at).not.toBe(app.created_at);
  });
});

describe("deleteApplication", () => {
  it("deletes an application", () => {
    const app = createApplication({ program_name: "To Delete" });
    deleteApplication(app.id);
    expect(getApplication(app.id)).toBeNull();
  });

  it("does not throw for non-existent id", () => {
    expect(() => deleteApplication("non-existent")).not.toThrow();
  });
});

describe("listFollowUpDue", () => {
  it("returns applications with follow_up_date in the past and status follow_up_needed", () => {
    createApplication({
      program_name: "Due",
      status: "follow_up_needed",
      follow_up_date: "2020-01-01",
    });
    createApplication({
      program_name: "Not Due",
      status: "follow_up_needed",
      follow_up_date: "2099-01-01",
    });
    createApplication({
      program_name: "Wrong Status",
      status: "submitted",
      follow_up_date: "2020-01-01",
    });
    const due = listFollowUpDue();
    expect(due).toHaveLength(1);
    expect(due[0]!.program_name).toBe("Due");
  });

  it("returns empty when nothing is due", () => {
    createApplication({ program_name: "Test", status: "draft" });
    expect(listFollowUpDue()).toEqual([]);
  });
});

describe("listPendingApplications", () => {
  it("returns applications with draft, submitted, or pending status", () => {
    createApplication({ program_name: "Draft", status: "draft" });
    createApplication({ program_name: "Submitted", status: "submitted" });
    createApplication({ program_name: "Pending", status: "pending" });
    createApplication({ program_name: "Approved", status: "approved" });
    createApplication({ program_name: "Rejected", status: "rejected" });
    const pending = listPendingApplications();
    expect(pending).toHaveLength(3);
    const names = pending.map(a => a.program_name);
    expect(names).toContain("Draft");
    expect(names).toContain("Submitted");
    expect(names).toContain("Pending");
  });

  it("returns empty when no pending applications", () => {
    createApplication({ program_name: "Approved", status: "approved" });
    expect(listPendingApplications()).toEqual([]);
  });
});
