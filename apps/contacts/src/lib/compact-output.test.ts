import { describe, expect, test } from "bun:test";
import { compactContactsPage, normalizeContactsLimit, normalizeContactsOffset, summarizeContact } from "./compact-output.js";

const contact = {
  id: "c1", first_name: "Ada", last_name: "Lovelace", display_name: "Ada Lovelace", nickname: null,
  avatar_url: null, notes: "long private note", birthday: null, company_id: "co1", job_title: "Engineer",
  source: "manual", custom_fields: { private: true }, last_contacted_at: null, website: null,
  preferred_contact_method: "email", status: "active", follow_up_at: null, archived: false, project_id: null,
  sensitivity: "normal", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z",
  emails: [{ id: "e1", contact_id: "c1", address: "ada@example.com", type: "work", is_primary: true }],
  phones: [], addresses: [], social_profiles: [], tags: [{ id: "t1", name: "math", color: "blue" }],
  company: { id: "co1", name: "Analytical", domain: null, description: null, industry: null, size: null, founded_year: null, notes: null, archived: false, created_at: "", updated_at: "" },
} as any;

describe("Contacts compact output", () => {
  test("bounds limits and omits verbose contact metadata", () => {
    expect(normalizeContactsLimit(undefined)).toBe(20);
    expect(normalizeContactsLimit(9999)).toBe(200);
    expect(normalizeContactsOffset(-2)).toBe(0);
    const summary = summarizeContact(contact) as any;
    expect(summary.primary_email).toBe("ada@example.com");
    expect(summary.notes).toBeUndefined();
    expect(summary.custom_fields).toBeUndefined();
  });

  test("emits truthful continuation metadata", () => {
    const page = compactContactsPage([contact], { total: 3, limit: 1, offset: 1 });
    expect(page).toMatchObject({ count: 1, total: 3, limit: 1, cursor: 1, next_cursor: 2, has_more: true, compact: true });
  });
});
