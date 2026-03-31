import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase } from "./database.js";
import {
  recordFieldChange,
  getFieldHistory,
  getContactAt,
} from "./field-history.js";
import { createContact } from "./contacts.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "contacts-field-history-test-"));
  process.env["CONTACTS_DB_PATH"] = join(tmpDir, "test.db");
  resetDatabase();
});

afterEach(() => {
  resetDatabase();
  try { rmSync(tmpDir, { recursive: true }); } catch {}
});

describe("recordFieldChange", () => {
  it("records a field change with all parameters", () => {
    const contact = createContact({ display_name: "Alice" });
    recordFieldChange(contact.id, "job_title", "Engineer", "Senior Engineer", "linkedin", "agent-1");
    const history = getFieldHistory(contact.id, "job_title");
    expect(history.length).toBe(1);
    expect(history[0].field_name).toBe("job_title");
    expect(history[0].old_value).toBe("Engineer");
    expect(history[0].new_value).toBe("Senior Engineer");
    expect(history[0].source).toBe("linkedin");
    expect(history[0].created_by).toBe("agent-1");
  });

  it("handles null old_value and new_value", () => {
    const contact = createContact({ display_name: "Bob" });
    recordFieldChange(contact.id, "email", null, "bob@example.com");
    const history = getFieldHistory(contact.id, "email");
    expect(history.length).toBe(1);
    expect(history[0].old_value).toBeNull();
    expect(history[0].new_value).toBe("bob@example.com");
  });

  it("converts non-string values to strings", () => {
    const contact = createContact({ display_name: "Carol" });
    recordFieldChange(contact.id, "age", 25, 26);
    const history = getFieldHistory(contact.id, "age");
    expect(history[0].old_value).toBe("25");
    expect(history[0].new_value).toBe("26");
  });

  it("defaults source and created_by to null", () => {
    const contact = createContact({ display_name: "Dave" });
    recordFieldChange(contact.id, "name", "Dave", "David");
    const history = getFieldHistory(contact.id, "name");
    expect(history[0].source).toBeNull();
    expect(history[0].created_by).toBeNull();
  });

  it("records multiple changes to the same field", () => {
    const contact = createContact({ display_name: "Eve" });
    recordFieldChange(contact.id, "job_title", null, "Intern");
    recordFieldChange(contact.id, "job_title", "Intern", "Junior Dev");
    recordFieldChange(contact.id, "job_title", "Junior Dev", "Senior Dev");
    const history = getFieldHistory(contact.id, "job_title");
    expect(history.length).toBe(3);
  });
});

describe("getFieldHistory", () => {
  it("returns history for all fields when fieldName is omitted", () => {
    const contact = createContact({ display_name: "Alice" });
    recordFieldChange(contact.id, "job_title", null, "Engineer");
    recordFieldChange(contact.id, "company", null, "Acme");
    recordFieldChange(contact.id, "email", null, "alice@acme.com");
    const history = getFieldHistory(contact.id);
    expect(history.length).toBe(3);
  });

  it("filters by field name when provided", () => {
    const contact = createContact({ display_name: "Bob" });
    recordFieldChange(contact.id, "job_title", null, "Engineer");
    recordFieldChange(contact.id, "company", null, "Acme");
    const history = getFieldHistory(contact.id, "job_title");
    expect(history.length).toBe(1);
    expect(history[0].field_name).toBe("job_title");
  });

  it("returns results in descending order by valid_from", () => {
    const contact = createContact({ display_name: "Carol" });
    recordFieldChange(contact.id, "job_title", null, "First");
    recordFieldChange(contact.id, "job_title", "First", "Second");
    recordFieldChange(contact.id, "job_title", "Second", "Third");
    const history = getFieldHistory(contact.id, "job_title");
    expect(history[0].new_value).toBe("Third");
    expect(history[2].new_value).toBe("First");
  });

  it("returns empty array for contact with no history", () => {
    const contact = createContact({ display_name: "Dave" });
    expect(getFieldHistory(contact.id)).toEqual([]);
  });

  it("returns empty array for non-existent contact", () => {
    expect(getFieldHistory("non-existent")).toEqual([]);
  });
});

describe("getContactAt", () => {
  it("reconstructs contact state at a given timestamp", () => {
    const contact = createContact({ display_name: "Alice" });
    const t1 = new Date(Date.now() - 3000).toISOString();
    const t2 = new Date(Date.now() - 2000).toISOString();
    const t3 = new Date(Date.now() - 1000).toISOString();

    // Record changes with specific valid_from by inserting directly
    recordFieldChange(contact.id, "job_title", null, "Engineer");
    recordFieldChange(contact.id, "company", null, "Acme");

    // Get state at a future timestamp — should have all values
    const futureState = getContactAt(contact.id, new Date(Date.now() + 60000).toISOString());
    expect(futureState["job_title"]).toBe("Engineer");
    expect(futureState["company"]).toBe("Acme");
  });

  it("returns empty object for timestamp before any changes", () => {
    const contact = createContact({ display_name: "Bob" });
    recordFieldChange(contact.id, "job_title", null, "Engineer");
    const pastState = getContactAt(contact.id, "1970-01-01T00:00:00.000Z");
    expect(Object.keys(pastState).length).toBe(0);
  });

  it("returns empty object for contact with no history", () => {
    const contact = createContact({ display_name: "Carol" });
    const state = getContactAt(contact.id, new Date().toISOString());
    expect(state).toEqual({});
  });

  it("returns empty object for non-existent contact", () => {
    const state = getContactAt("non-existent", new Date().toISOString());
    expect(state).toEqual({});
  });

  it("uses the last value per field (overwrite semantics)", () => {
    const contact = createContact({ display_name: "Dave" });
    recordFieldChange(contact.id, "job_title", null, "Intern");
    recordFieldChange(contact.id, "job_title", "Intern", "Senior");
    const state = getContactAt(contact.id, new Date(Date.now() + 60000).toISOString());
    expect(state["job_title"]).toBe("Senior");
  });
});
