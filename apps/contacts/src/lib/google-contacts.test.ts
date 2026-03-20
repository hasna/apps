import { describe, test, expect } from "bun:test";
import {
  googlePersonToContactInput,
  contactToGoogleArgs,
} from "./google-contacts.js";
import type { GooglePerson } from "./google-contacts.js";
import type { ContactWithDetails } from "../types/index.js";

describe("googlePersonToContactInput", () => {
  test("maps a full Google person to CreateContactInput", () => {
    const person: GooglePerson = {
      resourceName: "people/c123",
      names: [{ displayName: "Alice Smith", givenName: "Alice", familyName: "Smith" }],
      emailAddresses: [
        { value: "alice@acme.com", type: "work" },
        { value: "alice@personal.com", type: "home" },
      ],
      phoneNumbers: [{ value: "+1-555-000-0001", type: "mobile" }],
      organizations: [{ name: "Acme Corp", title: "Engineer" }],
      urls: [{ value: "https://alice.dev" }],
    };

    const input = googlePersonToContactInput(person);
    expect(input.first_name).toBe("Alice");
    expect(input.last_name).toBe("Smith");
    expect(input.display_name).toBe("Alice Smith");
    expect(input.job_title).toBe("Engineer");
    expect(input.website).toBe("https://alice.dev");
    expect(input.source).toBe("import");
    expect(input.emails).toHaveLength(2);
    expect(input.emails![0]!.address).toBe("alice@acme.com");
    expect(input.emails![0]!.is_primary).toBe(true);
    expect(input.emails![0]!.type).toBe("work");
    expect(input.emails![1]!.type).toBe("personal"); // "home" → "personal"
    expect(input.phones).toHaveLength(1);
    expect(input.phones![0]!.type).toBe("mobile");
    expect(input.custom_fields?.["google_resource_name"]).toBe("people/c123");
  });

  test("handles minimal person with email only", () => {
    const person: GooglePerson = {
      resourceName: "people/c999",
      emailAddresses: [{ value: "minimal@example.com" }],
    };

    const input = googlePersonToContactInput(person);
    expect(input.emails).toHaveLength(1);
    expect(input.emails![0]!.address).toBe("minimal@example.com");
    expect(input.source).toBe("import");
  });

  test("normalises email addresses to lowercase", () => {
    const person: GooglePerson = {
      resourceName: "people/c001",
      emailAddresses: [{ value: "CAPS@EXAMPLE.COM" }],
    };
    const input = googlePersonToContactInput(person);
    expect(input.emails![0]!.address).toBe("caps@example.com");
  });

  test("maps birthday correctly", () => {
    const person: GooglePerson = {
      resourceName: "people/c002",
      emailAddresses: [{ value: "b@b.com" }],
      birthdays: [{ date: { year: 1990, month: 6, day: 15 } }],
    };
    const input = googlePersonToContactInput(person);
    expect(input.birthday).toBe("1990-06-15");
  });

  test("maps biographies to notes", () => {
    const person: GooglePerson = {
      resourceName: "people/c003",
      emailAddresses: [{ value: "n@n.com" }],
      biographies: [{ value: "Software engineer at Acme." }],
    };
    const input = googlePersonToContactInput(person);
    expect(input.notes).toBe("Software engineer at Acme.");
  });

  test("maps fax phone type", () => {
    const person: GooglePerson = {
      resourceName: "people/c004",
      emailAddresses: [{ value: "f@f.com" }],
      phoneNumbers: [{ value: "+15550000", type: "fax" }],
    };
    const input = googlePersonToContactInput(person);
    expect(input.phones![0]!.type).toBe("fax");
  });

  test("unknown phone type falls back to other", () => {
    const person: GooglePerson = {
      resourceName: "people/c005",
      emailAddresses: [{ value: "o@o.com" }],
      phoneNumbers: [{ value: "+15550001", type: "pager" }],
    };
    const input = googlePersonToContactInput(person);
    expect(input.phones![0]!.type).toBe("other");
  });
});

describe("contactToGoogleArgs", () => {
  const baseContact: ContactWithDetails = {
    id: "abc",
    first_name: "Bob",
    last_name: "Jones",
    display_name: "Bob Jones",
    nickname: null,
    avatar_url: null,
    notes: "A note",
    birthday: null,
    company_id: null,
    job_title: "Developer",
    source: "manual",
    custom_fields: {},
    last_contacted_at: null,
    website: "https://bob.dev",
    preferred_contact_method: null,
    status: "active",
    follow_up_at: null,
    archived: false,
    project_id: null,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    emails: [{ id: "e1", contact_id: "abc", company_id: null, address: "bob@test.com", type: "work", is_primary: true, created_at: "2024-01-01T00:00:00Z" }],
    phones: [{ id: "p1", contact_id: "abc", company_id: null, number: "+1555000", country_code: null, type: "mobile", is_primary: true, created_at: "2024-01-01T00:00:00Z" }],
    addresses: [],
    social_profiles: [],
    tags: [],
    company: null,
  };

  test("generates correct CLI args", () => {
    const args = contactToGoogleArgs(baseContact);
    expect(args).toContain("--name");
    expect(args).toContain("Bob Jones");
    expect(args).toContain("--given-name");
    expect(args).toContain("Bob");
    expect(args).toContain("--family-name");
    expect(args).toContain("Jones");
    expect(args).toContain("--email");
    expect(args).toContain("bob@test.com");
    expect(args).toContain("--phone");
    expect(args).toContain("+1555000");
    expect(args).toContain("--title");
    expect(args).toContain("Developer");
    expect(args).toContain("--url");
    expect(args).toContain("https://bob.dev");
    expect(args).toContain("--notes");
  });

  test("includes company name when present", () => {
    const withCompany: ContactWithDetails = {
      ...baseContact,
      company: {
        id: "c1", name: "Acme", domain: null, logo_url: null, description: null,
        industry: null, size: null, founded_year: null, notes: null,
        custom_fields: {}, archived: false, project_id: null,
        is_owned_entity: false, entity_type: null,
        created_at: "2024-01-01T00:00:00Z", updated_at: "2024-01-01T00:00:00Z",
      },
    };
    const args = contactToGoogleArgs(withCompany);
    expect(args).toContain("--company");
    expect(args).toContain("Acme");
  });
});
