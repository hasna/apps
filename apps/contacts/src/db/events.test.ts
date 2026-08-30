import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resetDatabase } from "./database.js";
import { logEvent, getEvent, listEvents, deleteEvent } from "./events.js";
import { createContact } from "./contacts.js";
import { createCompany } from "./companies.js";
import { createDeal } from "./deals.js";

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

describe("logEvent", () => {
  it("creates an event with minimal fields", () => {
    const ev = logEvent({ title: "Lunch meeting", event_date: "2026-04-01" });
    expect(ev.id).toBeTruthy();
    expect(ev.title).toBe("Lunch meeting");
    expect(ev.type).toBe("meeting");
    expect(ev.event_date).toBe("2026-04-01");
    expect(ev.contact_ids).toEqual([]);
    expect(ev.company_id).toBeNull();
    expect(ev.duration_min).toBeNull();
    expect(ev.notes).toBeNull();
    expect(ev.outcome).toBeNull();
    expect(ev.deal_id).toBeNull();
    expect(ev.created_at).toBeTruthy();
  });

  it("creates an event with all fields", () => {
    const c = createContact({ display_name: "Alice" });
    const co = createCompany({ name: "Acme" });
    const deal = createDeal({ title: "Related Deal" });
    const ev = logEvent({
      title: "Strategy Call",
      type: "call",
      event_date: "2026-04-15",
      duration_min: 60,
      contact_ids: [c.id],
      company_id: co.id,
      notes: "Discussed pricing",
      outcome: "Follow-up needed",
      deal_id: deal.id,
    });
    expect(ev.type).toBe("call");
    expect(ev.duration_min).toBe(60);
    expect(ev.contact_ids).toEqual([c.id]);
    expect(ev.company_id).toBe(co.id);
    expect(ev.notes).toBe("Discussed pricing");
    expect(ev.outcome).toBe("Follow-up needed");
    expect(ev.deal_id).toBe(deal.id);
  });

  it("stores multiple contact_ids", () => {
    const c1 = createContact({ display_name: "Alice" });
    const c2 = createContact({ display_name: "Bob" });
    const ev = logEvent({
      title: "Team meeting",
      event_date: "2026-04-01",
      contact_ids: [c1.id, c2.id],
    });
    expect(ev.contact_ids).toHaveLength(2);
    expect(ev.contact_ids).toContain(c1.id);
    expect(ev.contact_ids).toContain(c2.id);
  });
});

describe("getEvent", () => {
  it("returns an event by id", () => {
    const ev = logEvent({ title: "Test Event", event_date: "2026-01-01" });
    const found = getEvent(ev.id);
    expect(found).not.toBeNull();
    expect(found!.title).toBe("Test Event");
  });

  it("returns null for non-existent event", () => {
    expect(getEvent("non-existent")).toBeNull();
  });
});

describe("listEvents", () => {
  it("lists all events", () => {
    logEvent({ title: "E1", event_date: "2026-01-01" });
    logEvent({ title: "E2", event_date: "2026-01-02" });
    const events = listEvents();
    expect(events).toHaveLength(2);
  });

  it("returns empty array when no events exist", () => {
    expect(listEvents()).toEqual([]);
  });

  it("filters by contact_id", () => {
    const c = createContact({ display_name: "Alice" });
    logEvent({ title: "E1", event_date: "2026-01-01", contact_ids: [c.id] });
    logEvent({ title: "E2", event_date: "2026-01-02" });
    const events = listEvents({ contact_id: c.id });
    expect(events).toHaveLength(1);
    expect(events[0]!.title).toBe("E1");
  });

  it("filters by company_id", () => {
    const co = createCompany({ name: "Acme" });
    logEvent({ title: "E1", event_date: "2026-01-01", company_id: co.id });
    logEvent({ title: "E2", event_date: "2026-01-02" });
    const events = listEvents({ company_id: co.id });
    expect(events).toHaveLength(1);
    expect(events[0]!.title).toBe("E1");
  });

  it("filters by type", () => {
    logEvent({ title: "Call", event_date: "2026-01-01", type: "call" });
    logEvent({ title: "Meeting", event_date: "2026-01-02", type: "meeting" });
    const calls = listEvents({ type: "call" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.title).toBe("Call");
  });

  it("filters by date range", () => {
    logEvent({ title: "Early", event_date: "2026-01-01" });
    logEvent({ title: "Mid", event_date: "2026-06-15" });
    logEvent({ title: "Late", event_date: "2026-12-31" });
    const events = listEvents({ date_from: "2026-03-01", date_to: "2026-09-01" });
    expect(events).toHaveLength(1);
    expect(events[0]!.title).toBe("Mid");
  });

  it("combines multiple filters", () => {
    const co = createCompany({ name: "Acme" });
    logEvent({ title: "E1", event_date: "2026-01-01", company_id: co.id, type: "call" });
    logEvent({ title: "E2", event_date: "2026-01-02", company_id: co.id, type: "meeting" });
    logEvent({ title: "E3", event_date: "2026-01-03", type: "call" });
    const events = listEvents({ company_id: co.id, type: "call" });
    expect(events).toHaveLength(1);
    expect(events[0]!.title).toBe("E1");
  });
});

describe("deleteEvent", () => {
  it("deletes an event", () => {
    const ev = logEvent({ title: "To Delete", event_date: "2026-01-01" });
    deleteEvent(ev.id);
    expect(getEvent(ev.id)).toBeNull();
  });

  it("does not throw for non-existent id", () => {
    expect(() => deleteEvent("non-existent")).not.toThrow();
  });
});
