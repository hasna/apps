import { describe, it, expect } from "bun:test";
import { exportContacts } from "./export.js";

function makeContact(overrides: Record<string, any> = {}): any {
  return {
    id: "c-1",
    first_name: "Alice",
    last_name: "Smith",
    display_name: "Alice Smith",
    nickname: null,
    avatar_url: null,
    notes: null,
    birthday: null,
    company_id: null,
    company: null,
    job_title: null,
    source: "manual",
    custom_fields: {},
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: "2024-01-01T00:00:00.000Z",
    emails: [],
    phones: [],
    addresses: [],
    social_profiles: [],
    tags: [],
    last_contacted_at: null,
    website: null,
    preferred_contact_method: null,
    status: "active",
    follow_up_at: null,
    archived: false,
    project_id: null,
    sensitivity: "normal",
    do_not_contact: false,
    priority: 3,
    timezone: null,
    relationship_health: 50,
    avg_response_hours: null,
    preferred_channel: null,
    engagement_status: "new",
    interaction_count_30d: 0,
    interaction_count_90d: 0,
    canonical_id: null,
    ...overrides,
  };
}

describe("exportContacts", () => {
  // ── JSON ──────────────────────────────────────────────────────────────
  describe("json format", () => {
    it("exports empty array", async () => {
      const result = await exportContacts("json", []);
      expect(result).toBe("[]");
    });

    it("exports contacts as pretty JSON", async () => {
      const contacts = [makeContact()];
      const result = await exportContacts("json", contacts);
      const parsed = JSON.parse(result);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].display_name).toBe("Alice Smith");
    });
  });

  // ── CSV ───────────────────────────────────────────────────────────────
  describe("csv format", () => {
    it("exports header row for empty array", async () => {
      const result = await exportContacts("csv", []);
      const lines = result.split("\n");
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("First Name");
      expect(lines[0]).toContain("Email 1 - Value");
    });

    it("exports contact data rows", async () => {
      const c = makeContact({
        emails: [{ id: "e1", contact_id: "c-1", company_id: null, address: "alice@example.com", type: "work", is_primary: true, created_at: "" }],
        phones: [{ id: "p1", contact_id: "c-1", company_id: null, number: "+1555", type: "mobile", is_primary: true, country_code: null, created_at: "" }],
        tags: [{ id: "t1", name: "vip", color: "#000", description: null, created_at: "" }],
      });
      const result = await exportContacts("csv", [c]);
      const lines = result.split("\n");
      expect(lines).toHaveLength(2);
      expect(lines[1]).toContain("Alice");
      expect(lines[1]).toContain("alice@example.com");
      expect(lines[1]).toContain("+1555");
      expect(lines[1]).toContain("vip");
    });

    it("escapes CSV fields with commas and quotes", async () => {
      const c = makeContact({ notes: 'He said "hello, world"' });
      const result = await exportContacts("csv", [c]);
      expect(result).toContain('"He said ""hello, world"""');
    });

    it("includes address fields", async () => {
      const c = makeContact({
        addresses: [{ id: "a1", contact_id: "c-1", company_id: null, street: "123 Main St", city: "NYC", state: "NY", zip: "10001", country: "US", type: "physical", is_primary: true, created_at: "" }],
      });
      const result = await exportContacts("csv", [c]);
      expect(result).toContain("123 Main St");
      expect(result).toContain("NYC");
    });
  });

  // ── VCF ───────────────────────────────────────────────────────────────
  describe("vcf format", () => {
    it("exports empty string for no contacts", async () => {
      const result = await exportContacts("vcf", []);
      expect(result).toBe("");
    });

    it("exports valid vCard structure", async () => {
      const result = await exportContacts("vcf", [makeContact()]);
      expect(result).toContain("BEGIN:VCARD");
      expect(result).toContain("VERSION:3.0");
      expect(result).toContain("FN:Alice Smith");
      expect(result).toContain("N:Smith;Alice;;;");
      expect(result).toContain("END:VCARD");
    });

    it("includes emails with PREF", async () => {
      const c = makeContact({
        emails: [
          { id: "e1", contact_id: "c-1", company_id: null, address: "a@b.com", type: "work", is_primary: true, created_at: "" },
          { id: "e2", contact_id: "c-1", company_id: null, address: "c@d.com", type: "personal", is_primary: false, created_at: "" },
        ],
      });
      const result = await exportContacts("vcf", [c]);
      expect(result).toContain("EMAIL;TYPE=WORK;PREF:a@b.com");
      expect(result).toContain("EMAIL;TYPE=PERSONAL:c@d.com");
    });

    it("includes phone with mobile to CELL mapping", async () => {
      const c = makeContact({
        phones: [{ id: "p1", contact_id: "c-1", company_id: null, number: "+1234", type: "mobile", is_primary: true, country_code: null, created_at: "" }],
      });
      const result = await exportContacts("vcf", [c]);
      expect(result).toContain("TEL;TYPE=CELL;PREF:+1234");
    });

    it("includes birthday without dashes", async () => {
      const c = makeContact({ birthday: "1990-05-15" });
      const result = await exportContacts("vcf", [c]);
      expect(result).toContain("BDAY:19900515");
    });

    it("includes nickname, title, org", async () => {
      const c = makeContact({
        nickname: "Al",
        job_title: "Engineer",
        company: { id: "co1", name: "Acme Inc" },
        company_id: "co1",
      });
      const result = await exportContacts("vcf", [c]);
      expect(result).toContain("NICKNAME:Al");
      expect(result).toContain("TITLE:Engineer");
      expect(result).toContain("ORG:Acme Inc");
    });

    it("includes tags as CATEGORIES", async () => {
      const c = makeContact({
        tags: [
          { id: "t1", name: "friend", color: "#000", description: null, created_at: "" },
          { id: "t2", name: "vip", color: "#000", description: null, created_at: "" },
        ],
      });
      const result = await exportContacts("vcf", [c]);
      expect(result).toContain("CATEGORIES:");
    });

    it("escapes special characters in vCard values", async () => {
      const c = makeContact({ notes: "Line1\nLine2" });
      const result = await exportContacts("vcf", [c]);
      expect(result).toContain("NOTE:Line1\\nLine2");
    });

    it("includes social profiles", async () => {
      const c = makeContact({
        social_profiles: [
          { id: "sp1", contact_id: "c-1", company_id: null, platform: "linkedin", handle: "alice", url: "https://linkedin.com/in/alice", is_primary: true, created_at: "" },
        ],
      });
      const result = await exportContacts("vcf", [c]);
      expect(result).toContain("URL;TYPE=LINKEDIN:");
      expect(result).toContain("X-SOCIALPROFILE;TYPE=linkedin:");
    });

    it("includes notes", async () => {
      const c = makeContact({ notes: "Important person" });
      const result = await exportContacts("vcf", [c]);
      expect(result).toContain("NOTE:Important person");
    });

    it("includes UID from contact id", async () => {
      const c = makeContact({ id: "unique-123" });
      const result = await exportContacts("vcf", [c]);
      expect(result).toContain("UID:unique-123");
    });
  });

  // ── Unsupported format ────────────────────────────────────────────────
  it("throws on unsupported format", async () => {
    await expect(exportContacts("xml" as any, [])).rejects.toThrow("Unsupported export format");
  });
});
