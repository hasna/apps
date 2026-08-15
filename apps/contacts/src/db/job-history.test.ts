import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase } from "./database.js";
import {
  addJobEntry,
  getJobHistory,
  getCurrentRole,
  getPreviousEmployers,
} from "./job-history.js";
import { createContact } from "./contacts.js";
import { createCompany } from "./companies.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "contacts-job-history-test-"));
  process.env["CONTACTS_DB_PATH"] = join(tmpDir, "test.db");
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
});

describe("addJobEntry", () => {
  it("adds a basic job entry", () => {
    const contact = createContact({ display_name: "Alice" });
    const job = addJobEntry(contact.id, { company_name: "Acme Corp" });
    expect(job.id).toBeTruthy();
    expect(job.contact_id).toBe(contact.id);
    expect(job.company_name).toBe("Acme Corp");
    expect(job.is_current).toBe(false);
    expect(job.inferred).toBe(false);
    expect(job.title).toBeNull();
    expect(job.start_date).toBeNull();
    expect(job.end_date).toBeNull();
    expect(job.source).toBeNull();
    expect(job.company_id).toBeNull();
  });

  it("adds a job entry with all fields", () => {
    const contact = createContact({ display_name: "Bob" });
    const company = createCompany({ name: "BigCo" });
    const job = addJobEntry(contact.id, {
      company_name: "BigCo",
      company_id: company.id,
      title: "VP Engineering",
      start_date: "2020-01-15",
      end_date: "2023-06-30",
      is_current: false,
      inferred: true,
      source: "linkedin",
    });
    expect(job.company_name).toBe("BigCo");
    expect(job.company_id).toBe(company.id);
    expect(job.title).toBe("VP Engineering");
    expect(job.start_date).toBe("2020-01-15");
    expect(job.end_date).toBe("2023-06-30");
    expect(job.is_current).toBe(false);
    expect(job.inferred).toBe(true);
    expect(job.source).toBe("linkedin");
  });

  it("marks previous current jobs as not current when adding a new current job", () => {
    const contact = createContact({ display_name: "Carol" });
    const job1 = addJobEntry(contact.id, { company_name: "OldCo", is_current: true });
    expect(job1.is_current).toBe(true);

    const job2 = addJobEntry(contact.id, { company_name: "NewCo", is_current: true });
    expect(job2.is_current).toBe(true);

    // Check that old job is no longer current
    const current = getCurrentRole(contact.id);
    expect(current).not.toBeNull();
    expect(current!.company_name).toBe("NewCo");

    const previous = getPreviousEmployers(contact.id);
    expect(previous.length).toBe(1);
    expect(previous[0].company_name).toBe("OldCo");
    expect(previous[0].is_current).toBe(false);
    expect(previous[0].end_date).toBeTruthy(); // Should have been set
  });

  it("does not affect other current jobs when adding non-current", () => {
    const contact = createContact({ display_name: "Dave" });
    addJobEntry(contact.id, { company_name: "CurrentCo", is_current: true });
    addJobEntry(contact.id, { company_name: "PastCo", is_current: false });

    const current = getCurrentRole(contact.id);
    expect(current!.company_name).toBe("CurrentCo");
  });
});

describe("getJobHistory", () => {
  it("returns all jobs for a contact ordered by is_current DESC, start_date DESC", () => {
    const contact = createContact({ display_name: "Alice" });
    addJobEntry(contact.id, { company_name: "OldCo", start_date: "2015-01-01", is_current: false });
    addJobEntry(contact.id, { company_name: "CurrentCo", start_date: "2023-01-01", is_current: true });
    addJobEntry(contact.id, { company_name: "MidCo", start_date: "2019-01-01", is_current: false });

    const history = getJobHistory(contact.id);
    expect(history.length).toBe(3);
    // Current job first
    expect(history[0].company_name).toBe("CurrentCo");
    expect(history[0].is_current).toBe(true);
    // Then by start_date DESC
    expect(history[1].company_name).toBe("MidCo");
    expect(history[2].company_name).toBe("OldCo");
  });

  it("returns empty array for contact with no jobs", () => {
    const contact = createContact({ display_name: "Bob" });
    expect(getJobHistory(contact.id)).toEqual([]);
  });

  it("returns empty array for non-existent contact", () => {
    expect(getJobHistory("non-existent")).toEqual([]);
  });

  it("correctly converts boolean fields", () => {
    const contact = createContact({ display_name: "Carol" });
    addJobEntry(contact.id, { company_name: "TestCo", is_current: true, inferred: true });
    const history = getJobHistory(contact.id);
    expect(history[0].is_current).toBe(true);
    expect(history[0].inferred).toBe(true);
  });
});

describe("getCurrentRole", () => {
  it("returns the current role", () => {
    const contact = createContact({ display_name: "Alice" });
    addJobEntry(contact.id, { company_name: "CurrentCo", title: "CTO", is_current: true });
    const role = getCurrentRole(contact.id);
    expect(role).not.toBeNull();
    expect(role!.company_name).toBe("CurrentCo");
    expect(role!.title).toBe("CTO");
    expect(role!.is_current).toBe(true);
  });

  it("returns null when no current role exists", () => {
    const contact = createContact({ display_name: "Bob" });
    addJobEntry(contact.id, { company_name: "OldCo", is_current: false });
    expect(getCurrentRole(contact.id)).toBeNull();
  });

  it("returns null for contact with no jobs", () => {
    const contact = createContact({ display_name: "Carol" });
    expect(getCurrentRole(contact.id)).toBeNull();
  });
});

describe("getPreviousEmployers", () => {
  it("returns only non-current jobs", () => {
    const contact = createContact({ display_name: "Alice" });
    addJobEntry(contact.id, { company_name: "CurrentCo", is_current: true });
    addJobEntry(contact.id, { company_name: "PastCo1", is_current: false, start_date: "2020-01-01" });
    addJobEntry(contact.id, { company_name: "PastCo2", is_current: false, start_date: "2015-01-01" });

    const previous = getPreviousEmployers(contact.id);
    expect(previous.length).toBe(2);
    expect(previous.every(j => j.is_current === false)).toBe(true);
  });

  it("returns previous employers in descending start_date order", () => {
    const contact = createContact({ display_name: "Bob" });
    addJobEntry(contact.id, { company_name: "First", start_date: "2010-01-01", is_current: false });
    addJobEntry(contact.id, { company_name: "Second", start_date: "2015-01-01", is_current: false });
    addJobEntry(contact.id, { company_name: "Third", start_date: "2020-01-01", is_current: false });

    const previous = getPreviousEmployers(contact.id);
    expect(previous[0].company_name).toBe("Third");
    expect(previous[1].company_name).toBe("Second");
    expect(previous[2].company_name).toBe("First");
  });

  it("returns empty array when all jobs are current", () => {
    const contact = createContact({ display_name: "Carol" });
    addJobEntry(contact.id, { company_name: "CurrentCo", is_current: true });
    expect(getPreviousEmployers(contact.id)).toEqual([]);
  });

  it("returns empty array for contact with no jobs", () => {
    const contact = createContact({ display_name: "Dave" });
    expect(getPreviousEmployers(contact.id)).toEqual([]);
  });
});
