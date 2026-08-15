import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase, getDatabase } from "../db/database.js";
import { createContact } from "../db/contacts.js";
import { addNote } from "../db/notes.js";
import { getContactTimeline } from "./timeline.js";

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

describe("getContactTimeline", () => {
  it("includes the contact.created activity for a new contact", () => {
    const c = createContact({ display_name: "Alice" });
    const timeline = getContactTimeline(c.id);
    // createContact logs an activity entry
    const created = timeline.find(i => i.type === "interaction" && i.title === "contact.created");
    expect(created).toBeTruthy();
  });

  it("includes notes in timeline", () => {
    const c = createContact({ display_name: "Alice" });
    addNote(c.id, "First meeting notes");
    const timeline = getContactTimeline(c.id);
    const noteItems = timeline.filter(i => i.type === "note");
    expect(noteItems).toHaveLength(1);
    expect(noteItems[0]!.title).toBe("Note");
    expect(noteItems[0]!.body).toBe("First meeting notes");
  });

  it("includes multiple notes", () => {
    const c = createContact({ display_name: "Alice" });
    addNote(c.id, "Note 1");
    addNote(c.id, "Note 2");
    const timeline = getContactTimeline(c.id);
    const noteItems = timeline.filter(i => i.type === "note");
    expect(noteItems).toHaveLength(2);
  });

  it("respects the limit parameter", () => {
    const c = createContact({ display_name: "Alice" });
    // createContact adds 1 activity_log entry
    addNote(c.id, "Note 1");
    addNote(c.id, "Note 2");
    addNote(c.id, "Note 3");
    // Total items: 1 (activity) + 3 (notes) = 4
    const timeline = getContactTimeline(c.id, 2);
    expect(timeline).toHaveLength(2);
  });

  it("includes tasks in timeline", () => {
    const db = getDatabase();
    const c = createContact({ display_name: "Alice" });
    db.run(
      `INSERT INTO contact_tasks (id, title, contact_id, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["t1", "Send proposal", c.id, "pending", "high", new Date().toISOString(), new Date().toISOString()]
    );
    const timeline = getContactTimeline(c.id);
    const taskItems = timeline.filter(i => i.type === "task_created");
    expect(taskItems).toHaveLength(1);
    expect(taskItems[0]!.title).toContain("Send proposal");
  });

  it("includes task_completed entries for completed tasks", () => {
    const db = getDatabase();
    const c = createContact({ display_name: "Alice" });
    db.run(
      `INSERT INTO contact_tasks (id, title, contact_id, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["t1", "Done task", c.id, "completed", "medium", new Date().toISOString(), new Date().toISOString()]
    );
    const timeline = getContactTimeline(c.id);
    const types = timeline.map(i => i.type);
    expect(types).toContain("task_created");
    expect(types).toContain("task_completed");
  });

  it("includes activity log entries", () => {
    const db = getDatabase();
    const c = createContact({ display_name: "Alice" });
    db.run(
      `INSERT INTO activity_log (id, contact_id, action, details, created_at) VALUES (?, ?, ?, ?, ?)`,
      ["a1", c.id, "phone_call", "Discussed project", new Date().toISOString()]
    );
    const timeline = getContactTimeline(c.id);
    const interactions = timeline.filter(i => i.type === "interaction" && i.title === "phone_call");
    expect(interactions).toHaveLength(1);
    expect(interactions[0]!.body).toBe("Discussed project");
  });

  it("accepts explicit db parameter", () => {
    const db = getDatabase();
    const c = createContact({ display_name: "Alice" });
    addNote(c.id, "Test note");
    const timeline = getContactTimeline(c.id, 50, db);
    const noteItems = timeline.filter(i => i.type === "note");
    expect(noteItems).toHaveLength(1);
  });

  it("returns items sorted by date descending", () => {
    const db = getDatabase();
    const c = createContact({ display_name: "Alice" });
    // Insert activity with older date
    db.run(
      `INSERT INTO activity_log (id, contact_id, action, created_at) VALUES (?, ?, ?, ?)`,
      ["a1", c.id, "old_action", "2020-01-01T00:00:00.000Z"]
    );
    // Add a note (will have current timestamp)
    addNote(c.id, "Recent note");
    const timeline = getContactTimeline(c.id);
    expect(timeline.length).toBeGreaterThanOrEqual(2);
    // Should be sorted descending (most recent first)
    for (let i = 0; i < timeline.length - 1; i++) {
      expect(timeline[i]!.date >= timeline[i + 1]!.date).toBe(true);
    }
    // The old action should be last
    const lastItem = timeline[timeline.length - 1]!;
    expect(lastItem.title).toBe("old_action");
  });

  it("returns empty array for non-existent contact", () => {
    const timeline = getContactTimeline("non-existent-id");
    expect(timeline).toEqual([]);
  });
});
