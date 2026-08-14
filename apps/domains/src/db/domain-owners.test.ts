import { describe, test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Set up temp directory before importing database-dependent modules
const tempDir = mkdtempSync(join(tmpdir(), "open-domains-owners-test-"));
process.env["DOMAINS_DIR"] = tempDir;

import { createDomain } from "./domains";
import {
  createDomainOwner,
  getDomainOwner,
  getDomainOwnerByDomain,
  getDomainOwnerByDomainName,
  listDomainOwners,
  updateDomainOwner,
  deleteDomainOwner,
  listDomainsWithOwners,
  type CreateDomainOwnerInput,
} from "./domain-owners";
import { extractOwnerFromWhois, linkOwnerToContacts } from "./owners";
import { closeDatabase } from "./database";

afterAll(() => {
  closeDatabase();
  rmSync(tempDir, { recursive: true, force: true });
});

// ============================================================
// CRUD Operations
// ============================================================

describe("Domain Owners — CRUD", () => {
  let domainId: string;

  test("setup: create domain for owner tests", async () => {
    const domain = await createDomain({ name: "owner-test.com" });
    domainId = domain.id;
    expect(domainId).toBeTruthy();
  });

  test("create domain owner", async () => {
    const owner = createDomainOwner({
      domain_id: domainId,
      owner_name: "John Doe",
      owner_email: "john@example.com",
      owner_phone: "+1-555-0123",
      owner_organization: "Example Corp",
      source: "manual",
      verified: true,
      notes: "Test owner",
    });

    expect(owner.id).toBeTruthy();
    expect(owner.domain_id).toBe(domainId);
    expect(owner.owner_name).toBe("John Doe");
    expect(owner.owner_email).toBe("john@example.com");
    expect(owner.owner_phone).toBe("+1-555-0123");
    expect(owner.owner_organization).toBe("Example Corp");
    expect(owner.source).toBe("manual");
    expect(owner.verified).toBe(true);
    expect(owner.notes).toBe("Test owner");
    expect(owner.contact_id).toBeNull();
  });

  test("create domain owner with minimal fields", async () => {
    const owner = createDomainOwner({ domain_id: domainId });
    expect(owner.id).toBeTruthy();
    expect(owner.domain_id).toBe(domainId);
    expect(owner.source).toBe("manual");
    expect(owner.verified).toBe(false);
  });

  test("get domain owner by ID", async () => {
    const first = listDomainOwners().filter((o) => o.domain_id === domainId)[0];
    expect(first).toBeDefined();

    const owner = getDomainOwner(first!.id);
    expect(owner).toBeDefined();
    expect(owner!.id).toBe(first!.id);
    expect(owner!.owner_name).toBe(first!.owner_name);
  });

  test("get domain owner by domain ID", async () => {
    const owner = getDomainOwnerByDomain(domainId);
    expect(owner).toBeDefined();
    expect(owner!.domain_id).toBe(domainId);
  });

  test("get domain owner by domain name", async () => {
    const owner = getDomainOwnerByDomainName("owner-test.com");
    expect(owner).toBeDefined();
    expect(owner!.owner_name).toBeTruthy();
  });

  test("get non-existent owner returns null", async () => {
    expect(getDomainOwner("nonexistent-id")).toBeNull();
    expect(getDomainOwnerByDomain("nonexistent-id")).toBeNull();
    expect(getDomainOwnerByDomainName("nonexistent.xyz")).toBeNull();
  });

  test("update domain owner", async () => {
    const first = getDomainOwnerByDomain(domainId);
    expect(first).toBeDefined();

    const updated = updateDomainOwner(first!.id, {
      owner_name: "Jane Doe",
      owner_email: "jane@example.com",
      verified: true,
      notes: "Updated owner",
    });

    expect(updated).toBeDefined();
    expect(updated!.owner_name).toBe("Jane Doe");
    expect(updated!.owner_email).toBe("jane@example.com");
    expect(updated!.verified).toBe(true);
    expect(updated!.notes).toBe("Updated owner");
  });

  test("update non-existent owner returns null", async () => {
    expect(updateDomainOwner("nonexistent-id", { owner_name: "Test" })).toBeNull();
  });

  test("update with no changes returns existing", async () => {
    const first = getDomainOwnerByDomain(domainId);
    const result = updateDomainOwner(first!.id, {});
    expect(result).toBeDefined();
    expect(result!.id).toBe(first!.id);
  });

  test("delete domain owner", async () => {
    const owner = createDomainOwner({ domain_id: domainId, owner_name: "To Delete" });
    expect(deleteDomainOwner(owner.id)).toBe(true);
    expect(getDomainOwner(owner.id)).toBeNull();
  });

  test("delete non-existent owner returns false", async () => {
    expect(deleteDomainOwner("nonexistent-id")).toBe(false);
  });
});

// ============================================================
// Listing and Filtering
// ============================================================

describe("Domain Owners — List & Filter", () => {
  let domainId1: string;
  let domainId2: string;
  let domainId3: string;

  test("setup: create domains for list tests", async () => {
    const d1 = await createDomain({ name: "list-test1.com" });
    const d2 = await createDomain({ name: "list-test2.com" });
    const d3 = await createDomain({ name: "list-test3.com" });
    domainId1 = d1.id;
    domainId2 = d2.id;
    domainId3 = d3.id;

    createDomainOwner({
      domain_id: domainId1,
      owner_name: "Alice Smith",
      owner_email: "alice@company.com",
      owner_organization: "Company A",
      source: "whois",
      verified: true,
    });

    createDomainOwner({
      domain_id: domainId2,
      owner_name: "Bob Jones",
      owner_email: "bob@startup.io",
      owner_organization: "Startup Inc",
      source: "manual",
      verified: false,
    });

    createDomainOwner({
      domain_id: domainId3,
      owner_name: "Charlie Brown",
      owner_email: "charlie@enterprise.com",
      owner_organization: "Enterprise Ltd",
      source: "brandsight",
      verified: true,
    });
  });

  test("list all owners", async () => {
    const owners = listDomainOwners();
    expect(owners.length).toBeGreaterThanOrEqual(3);
  });

  test("search by name", async () => {
    const owners = listDomainOwners({ search: "Alice" });
    expect(owners.length).toBeGreaterThanOrEqual(1);
    expect(owners.some((o) => o.owner_name === "Alice Smith")).toBe(true);
  });

  test("search by email", async () => {
    const owners = listDomainOwners({ search: "bob@startup.io" });
    expect(owners.length).toBeGreaterThanOrEqual(1);
    expect(owners.some((o) => o.owner_email === "bob@startup.io")).toBe(true);
  });

  test("search by organization", async () => {
    const owners = listDomainOwners({ search: "Enterprise Ltd" });
    expect(owners.length).toBeGreaterThanOrEqual(1);
    expect(owners.some((o) => o.owner_organization === "Enterprise Ltd")).toBe(true);
  });

  test("filter by source", async () => {
    const whois = listDomainOwners({ source: "whois" });
    expect(whois.every((o) => o.source === "whois")).toBe(true);

    const manual = listDomainOwners({ source: "manual" });
    expect(manual.every((o) => o.source === "manual")).toBe(true);
  });

  test("filter by verified", async () => {
    const verified = listDomainOwners({ verified: true });
    expect(verified.every((o) => o.verified)).toBe(true);
    expect(verified.some((o) => o.owner_name === "Alice Smith")).toBe(true);

    const unverified = listDomainOwners({ verified: false });
    expect(unverified.every((o) => !o.verified)).toBe(true);
    expect(unverified.some((o) => o.owner_name === "Bob Jones")).toBe(true);
  });

  test("combined filters", async () => {
    const owners = listDomainOwners({ source: "whois", verified: true });
    expect(owners.every((o) => o.source === "whois" && o.verified)).toBe(true);
  });
});

// ============================================================
// WHOIS Extraction
// ============================================================

describe("Domain Owners — WHOIS Extraction", () => {
  test("extract owner from WHOIS creates new record", async () => {
    const domain = await createDomain({ name: "whois-extract-new.com" });
    const whoisRaw = `
Domain Name: WHOIS-EXTRACT-NEW.COM
Registrant Name: WHOIS Person
Registrant Email: whois@test.com
Registrant Phone: +1.5551234567
Registrant Organization: WHOIS Corp
`;

    const owner = await extractOwnerFromWhois("whois-extract-new.com", whoisRaw);
    expect(owner).not.toBeNull();
    expect(owner!.owner_name).toBe("WHOIS Person");
    expect(owner!.owner_email).toBe("whois@test.com");
    expect(owner!.owner_phone).toBe("+1.5551234567");
    expect(owner!.owner_organization).toBe("WHOIS Corp");
    expect(owner!.source).toBe("whois");
  });

  test("extract owner from WHOIS updates existing record", async () => {
    const domain = await createDomain({ name: "whois-extract-existing.com" });
    createDomainOwner({
      domain_id: domain.id,
      owner_name: "Old Name",
      source: "manual",
    });

    const whoisRaw = `
Domain Name: WHOIS-EXTRACT-EXISTING.COM
Registrant Name: New WHOIS Name
Registrant Email: newwhois@test.com
`;

    const owner = await extractOwnerFromWhois("whois-extract-existing.com", whoisRaw);
    expect(owner).not.toBeNull();
    expect(owner!.owner_name).toBe("New WHOIS Name");
    expect(owner!.owner_email).toBe("newwhois@test.com");
    // source stays as original (updateDomainOwner doesn't overwrite source)
    expect(owner!.source).toBe("manual");
  });

  test("extract owner returns null for non-existent domain", async () => {
    const result = await extractOwnerFromWhois("nonexistent-whois.xyz", "some whois text");
    expect(result).toBeNull();
  });

  test("extract owner returns null when no registrant info found", async () => {
    const domain = await createDomain({ name: "whois-empty.com" });
    const whoisRaw = `
Domain Name: WHOIS-EMPTY.COM
Name Server: ns1.example.com
Status: ok
`;
    const result = await extractOwnerFromWhois("whois-empty.com", whoisRaw);
    expect(result).toBeNull();
  });
});

// ============================================================
// List Domains With Owners
// ============================================================

describe("Domain Owners — List Domains With Owners", () => {
  let premiumDomainId: string;
  let ownerDomainId: string;

  test("setup: create premium domain and owned domain", async () => {
    const premium = await createDomain({
      name: "premium-owner.com",
      is_premium: true,
      premium_price: 10000,
      status: "premium_only",
    });
    premiumDomainId = premium.id;

    const owned = await createDomain({ name: "with-owner.com", status: "researching" });
    ownerDomainId = owned.id;
    createDomainOwner({
      domain_id: owned.id,
      owner_name: "Owner Corp",
      owner_email: "owner@corp.com",
    });
  });

  test("listDomainsWithOwners includes premium domains without owners", async () => {
    const results = listDomainsWithOwners();
    expect(results.some((r) => r.domain_name === "premium-owner.com")).toBe(true);
  });

  test("listDomainsWithOwners includes domains with owners", async () => {
    const results = listDomainsWithOwners();
    const owned = results.find((r) => r.domain_name === "with-owner.com");
    expect(owned).toBeDefined();
    expect(owned!.owner_name).toBe("Owner Corp");
    expect(owned!.owner_email).toBe("owner@corp.com");
    expect(owned!.source).toBe("manual");
  });

  test("listDomainsWithOwners returns structured data", async () => {
    const results = listDomainsWithOwners();
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r).toHaveProperty("domain_name");
      expect(r).toHaveProperty("domain_status");
      expect(r).toHaveProperty("is_premium");
      expect(r).toHaveProperty("premium_price");
    }
  });
});

// ============================================================
// linkOwnerToContacts
// ============================================================

describe("Domain Owners — Link to Contacts", () => {

  test("returns null when no owner record exists", async () => {
    const domain = await createDomain({ name: "no-owner-link.com" });
    const result = await linkOwnerToContacts(domain.id, {
      createContact: () => ({ id: "contact_123" }),
      getContactByEmail: () => null,
    });
    expect(result).toBeNull();
  });

  test("returns null when owner has no email", async () => {
    const domain = await createDomain({ name: "no-email-link.com" });
    createDomainOwner({ domain_id: domain.id, owner_name: "No Email" });
    const result = await linkOwnerToContacts(domain.id, {
      createContact: () => ({ id: "contact_123" }),
      getContactByEmail: () => null,
    });
    expect(result).toBeNull();
  });

  test("creates new contact when none exists", async () => {
    const domain = await createDomain({ name: "new-contact-link.com" });
    createDomainOwner({
      domain_id: domain.id,
      owner_name: "Contact Person",
      owner_email: "contact@new.com",
      owner_phone: "+1-555-9999",
      owner_organization: "Contact Org",
    });

    let createdContact: { id: string } | null = null;
    const result = await linkOwnerToContacts(domain.id, {
      createContact: (input) => {
        createdContact = { id: "new_contact_id" };
        return createdContact;
      },
      getContactByEmail: () => null,
    });

    expect(result).toBe("new_contact_id");
    expect(createdContact).not.toBeNull();

    // Verify owner record was updated with contact_id
    const owner = getDomainOwnerByDomain(domain.id);
    expect(owner!.contact_id).toBe("new_contact_id");
  });

  test("uses existing contact when email matches", async () => {
    const domain = await createDomain({ name: "existing-contact-link.com" });
    createDomainOwner({
      domain_id: domain.id,
      owner_name: "Existing Person",
      owner_email: "existing@test.com",
    });

    const result = await linkOwnerToContacts(domain.id, {
      createContact: () => {
        throw new Error("Should not create contact when one exists");
      },
      getContactByEmail: () => ({ id: "existing_contact_id" }),
    });

    expect(result).toBe("existing_contact_id");

    const owner = getDomainOwnerByDomain(domain.id);
    expect(owner!.contact_id).toBe("existing_contact_id");
  });
});

// ============================================================
// Source Types
// ============================================================

describe("Domain Owners — Source Types", () => {
  test("all source types are valid", async () => {
    const domain = await createDomain({ name: "source-types-test.com" });

    for (const source of ["whois", "manual", "brandsight", "import"] as const) {
      const owner = createDomainOwner({
        domain_id: domain.id,
        owner_name: `${source} owner`,
        source,
      });
      expect(owner.source).toBe(source);
    }
  });
});
