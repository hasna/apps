import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase, getDatabase } from "../db/database.js";
import { createContact, updateContact } from "../db/contacts.js";
import { getUpcomingItems } from "./upcoming.js";

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

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

describe("getUpcomingItems", () => {
  it("returns empty array when no data", () => {
    const items = getUpcomingItems();
    expect(items).toEqual([]);
  });

  it("finds follow-up contacts within range", () => {
    const tomorrow = daysFromNow(1);
    createContact({ display_name: "Alice", follow_up_at: tomorrow });
    const items = getUpcomingItems(7);
    expect(items).toHaveLength(1);
    expect(items[0]!.type).toBe("follow_up");
    expect(items[0]!.contact_name).toBe("Alice");
    expect(items[0]!.urgency).toBe("upcoming");
  });

  it("marks overdue follow-ups correctly", () => {
    const pastDate = daysFromNow(-3);
    createContact({ display_name: "Bob", follow_up_at: pastDate });
    const items = getUpcomingItems(7);
    const fu = items.find(i => i.type === "follow_up");
    expect(fu).toBeTruthy();
    expect(fu!.urgency).toBe("overdue");
  });

  it("marks today follow-ups as 'today'", () => {
    const today = todayStr();
    createContact({ display_name: "Carol", follow_up_at: today });
    const items = getUpcomingItems(7);
    const fu = items.find(i => i.type === "follow_up");
    expect(fu).toBeTruthy();
    expect(fu!.urgency).toBe("today");
  });

  it("excludes do_not_contact contacts from follow-ups", () => {
    const tomorrow = daysFromNow(1);
    const c = createContact({ display_name: "DNC Person", follow_up_at: tomorrow, do_not_contact: true });
    const items = getUpcomingItems(7);
    const fu = items.filter(i => i.type === "follow_up");
    expect(fu).toHaveLength(0);
  });

  it("excludes follow-ups beyond the days range", () => {
    const farFuture = daysFromNow(30);
    createContact({ display_name: "Future", follow_up_at: farFuture });
    const items = getUpcomingItems(7);
    const fu = items.filter(i => i.type === "follow_up");
    expect(fu).toHaveLength(0);
  });

  it("finds task deadlines within range", () => {
    const db = getDatabase();
    const c = createContact({ display_name: "Alice" });
    const deadline = daysFromNow(3);
    db.run(
      `INSERT INTO contact_tasks (id, title, contact_id, deadline, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["t1", "Review doc", c.id, deadline, "pending", "high", new Date().toISOString(), new Date().toISOString()]
    );
    const items = getUpcomingItems(7);
    const taskItems = items.filter(i => i.type === "task_deadline");
    expect(taskItems).toHaveLength(1);
    expect(taskItems[0]!.title).toBe("Review doc");
    expect(taskItems[0]!.urgency).toBe("upcoming");
  });

  it("excludes completed tasks from deadlines", () => {
    const db = getDatabase();
    const c = createContact({ display_name: "Alice" });
    const deadline = daysFromNow(3);
    db.run(
      `INSERT INTO contact_tasks (id, title, contact_id, deadline, status, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ["t1", "Done task", c.id, deadline, "completed", "medium", new Date().toISOString(), new Date().toISOString()]
    );
    const items = getUpcomingItems(7);
    const taskItems = items.filter(i => i.type === "task_deadline");
    expect(taskItems).toHaveLength(0);
  });

  it("finds upcoming birthdays", () => {
    // Create a contact with birthday in next few days (same year logic)
    const now = new Date();
    const bday = new Date(1990, now.getMonth(), now.getDate() + 2);
    const bdayStr = `${bday.getFullYear()}-${String(bday.getMonth() + 1).padStart(2, "0")}-${String(bday.getDate()).padStart(2, "0")}`;
    createContact({ display_name: "Birthday Person", birthday: bdayStr });
    const items = getUpcomingItems(7);
    const bdays = items.filter(i => i.type === "birthday");
    expect(bdays).toHaveLength(1);
    expect(bdays[0]!.title).toContain("Birthday: Birthday Person");
  });

  it("returns items sorted by date ascending", () => {
    createContact({ display_name: "Later", follow_up_at: daysFromNow(5) });
    createContact({ display_name: "Sooner", follow_up_at: daysFromNow(1) });
    const items = getUpcomingItems(7);
    if (items.length >= 2) {
      expect(items[0]!.date <= items[1]!.date).toBe(true);
    }
  });

  it("uses default 7 days range", () => {
    createContact({ display_name: "InRange", follow_up_at: daysFromNow(6) });
    createContact({ display_name: "OutOfRange", follow_up_at: daysFromNow(10) });
    const items = getUpcomingItems();
    const names = items.map(i => i.contact_name);
    expect(names).toContain("InRange");
    expect(names).not.toContain("OutOfRange");
  });

  it("accepts explicit db parameter", () => {
    const db = getDatabase();
    createContact({ display_name: "Test", follow_up_at: daysFromNow(1) });
    const items = getUpcomingItems(7, db);
    expect(items).toHaveLength(1);
  });
});
