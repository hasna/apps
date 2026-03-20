import { describe, it, expect } from "bun:test";
import { importContacts } from "./import.js";

describe("importContacts - CSV", () => {
  it("imports contacts from CSV with First Name / Last Name columns", async () => {
    const csv = `First Name,Last Name,Email 1 - Value,Email 1 - Type
Alice,Smith,alice@example.com,work
Bob,Jones,bob@example.com,personal`;
    const contacts = await importContacts("csv", csv);
    expect(contacts).toHaveLength(2);
    expect(contacts[0]!.first_name).toBe("Alice");
    expect(contacts[0]!.last_name).toBe("Smith");
    expect(contacts[0]!.emails).toHaveLength(1);
    expect(contacts[0]!.emails![0]!.address).toBe("alice@example.com");
  });

  it("imports contacts from CSV with Name column", async () => {
    const csv = `Name,Email
Charlie Brown,charlie@example.com`;
    const contacts = await importContacts("csv", csv);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]!.display_name).toBe("Charlie Brown");
  });

  it("sets source to import", async () => {
    const csv = `Name\nDana`;
    const contacts = await importContacts("csv", csv);
    expect(contacts[0]!.source).toBe("import");
  });

  it("skips rows with no name", async () => {
    const csv = `First Name,Last Name
,`;
    const contacts = await importContacts("csv", csv);
    expect(contacts).toHaveLength(0);
  });

  it("handles quoted fields with commas", async () => {
    const csv = `Name,Notes
"Smith, Alice","Manager, Acme Corp"`;
    const contacts = await importContacts("csv", csv);
    expect(contacts[0]!.display_name).toBe("Smith, Alice");
    expect(contacts[0]!.notes).toBe("Manager, Acme Corp");
  });
});

describe("importContacts - vCard", () => {
  it("imports a simple vCard", async () => {
    const vcf = `BEGIN:VCARD
VERSION:3.0
FN:Eve Adams
N:Adams;Eve;;;
EMAIL;TYPE=WORK:eve@example.com
TEL;TYPE=CELL:+1555000001
END:VCARD`;
    const contacts = await importContacts("vcf", vcf);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]!.display_name).toBe("Eve Adams");
    expect(contacts[0]!.first_name).toBe("Eve");
    expect(contacts[0]!.last_name).toBe("Adams");
    expect(contacts[0]!.emails).toHaveLength(1);
    expect(contacts[0]!.emails![0]!.address).toBe("eve@example.com");
    expect(contacts[0]!.phones).toHaveLength(1);
    expect(contacts[0]!.phones![0]!.type).toBe("mobile");
  });

  it("imports multiple vCards", async () => {
    const vcf = `BEGIN:VCARD
VERSION:3.0
FN:Frank
N:;;;Frank;;
END:VCARD
BEGIN:VCARD
VERSION:3.0
FN:Grace
N:;;;Grace;;
END:VCARD`;
    const contacts = await importContacts("vcf", vcf);
    expect(contacts).toHaveLength(2);
  });

  it("imports vCard with birthday", async () => {
    const vcf = `BEGIN:VCARD
VERSION:3.0
FN:Hannah
BDAY:19900115
END:VCARD`;
    const contacts = await importContacts("vcf", vcf);
    expect(contacts[0]!.birthday).toBe("1990-01-15");
  });

  it("skips malformed vCards", async () => {
    const vcf = `BEGIN:VCARD
VERSION:3.0
FN:Valid Person
END:VCARD
BEGIN:VCARD
VERSION:3.0
END:VCARD`;
    const contacts = await importContacts("vcf", vcf);
    // Valid one should be imported, malformed one skipped
    expect(contacts.length).toBeGreaterThanOrEqual(1);
    expect(contacts.some((c) => c.display_name === "Valid Person")).toBe(true);
  });
});

describe("importContacts - JSON", () => {
  it("imports contacts from JSON array", async () => {
    const json = JSON.stringify([
      { display_name: "Ivan Petrov", first_name: "Ivan", last_name: "Petrov" },
      { display_name: "Jane Doe" },
    ]);
    const contacts = await importContacts("json", json);
    expect(contacts).toHaveLength(2);
    expect(contacts[0]!.display_name).toBe("Ivan Petrov");
    expect(contacts[1]!.display_name).toBe("Jane Doe");
  });

  it("handles single object (not array)", async () => {
    const json = JSON.stringify({ display_name: "Solo Contact" });
    const contacts = await importContacts("json", json);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]!.display_name).toBe("Solo Contact");
  });

  it("uses name field as fallback for display_name", async () => {
    const json = JSON.stringify([{ name: "Karl Marks" }]);
    const contacts = await importContacts("json", json);
    expect(contacts[0]!.display_name).toBe("Karl Marks");
  });

  it("derives display_name from first_name + last_name", async () => {
    const json = JSON.stringify([{ first_name: "Leo", last_name: "Tolstoy" }]);
    const contacts = await importContacts("json", json);
    expect(contacts[0]!.display_name).toBe("Leo Tolstoy");
  });

  it("throws for invalid JSON", async () => {
    expect(importContacts("json", "not json")).rejects.toThrow("Invalid JSON");
  });

  it("sets source to import", async () => {
    const json = JSON.stringify([{ display_name: "Maria" }]);
    const contacts = await importContacts("json", json);
    expect(contacts[0]!.source).toBe("import");
  });
});
