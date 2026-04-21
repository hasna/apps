import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createCalendar, getCalendar, listCalendars, updateCalendar, deleteCalendar } from "./calendars.js";
import { createOrg } from "./orgs.js";
import { getDatabase, resetDatabase } from "./database.js";
import { NotFoundError, ConflictError } from "../types/index.js";

describe("calendars", () => {
  let orgId: string;

  beforeEach(() => {
    resetDatabase();
    getDatabase(":memory:");
    const org = createOrg({ name: "Test Org", slug: "test" });
    orgId = org.id;
  });

  afterEach(() => resetDatabase());

  test("create and get calendar", () => {
    const cal = createCalendar({ name: "Team Calendar", org_id: orgId });
    expect(cal.name).toBe("Team Calendar");
    expect(cal.org_id).toBe(orgId);
    expect(cal.timezone).toBe("UTC");
    expect(cal.visibility).toBe("org");

    const fetched = getCalendar(cal.id);
    expect(fetched!.name).toBe("Team Calendar");
  });

  test("auto-generates slug", () => {
    const cal = createCalendar({ name: "My Team Events", org_id: orgId });
    expect(cal.slug).toBe("my-team-events");
  });

  test("list calendars by org", () => {
    createCalendar({ name: "A", org_id: orgId });
    createCalendar({ name: "B", org_id: orgId });
    expect(listCalendars(orgId).length).toBe(2);
  });

  test("update calendar", () => {
    const cal = createCalendar({ name: "Old", org_id: orgId });
    const updated = updateCalendar(cal.id, { name: "New", color: "#ff0000" });
    expect(updated.name).toBe("New");
    expect(updated.color).toBe("#ff0000");
  });

  test("delete calendar", () => {
    const cal = createCalendar({ name: "Delete Me", org_id: orgId });
    expect(deleteCalendar(cal.id)).toBe(true);
    expect(getCalendar(cal.id)).toBeNull();
  });

  test("duplicate slug in same org throws", () => {
    createCalendar({ name: "First", org_id: orgId, slug: "dup" });
    expect(() => createCalendar({ name: "Second", org_id: orgId, slug: "dup" })).toThrow(ConflictError);
  });

  test("update nonexistent throws", () => {
    expect(() => updateCalendar("nope", { name: "x" })).toThrow(NotFoundError);
  });

  test("custom timezone and visibility", () => {
    const cal = createCalendar({
      name: "TZ Test",
      org_id: orgId,
      timezone: "America/New_York",
      visibility: "private",
    });
    expect(cal.timezone).toBe("America/New_York");
    expect(cal.visibility).toBe("private");
  });
});
