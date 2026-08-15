import { describe, it, expect } from "bun:test";
import { parseEmailSignature, extractContactsFromEmailThread } from "./signature-parser.js";

describe("parseEmailSignature", () => {
  it("extracts phone number", () => {
    const result = parseEmailSignature("John Doe\n+1 555-123-4567");
    expect(result.phone).toBe("+1 555-123-4567");
  });

  it("extracts email address", () => {
    const result = parseEmailSignature("Contact me at john@example.com");
    expect(result.email).toBe("john@example.com");
  });

  it("extracts LinkedIn URL", () => {
    const result = parseEmailSignature("John Doe\nhttps://linkedin.com/in/johndoe");
    expect(result.linkedin).toBe("https://linkedin.com/in/johndoe");
  });

  it("extracts website URL (not LinkedIn/Twitter)", () => {
    const result = parseEmailSignature("Visit https://example.com for more");
    expect(result.website).toBe("https://example.com");
  });

  it("extracts name from first line", () => {
    const result = parseEmailSignature("Jane Doe\nSenior Engineer\nAcme Corp");
    expect(result.name).toBe("Jane Doe");
  });

  it("extracts title from lines with title keywords", () => {
    const result = parseEmailSignature("Jane Doe\nVP of Engineering\nAcme Corp");
    expect(result.title).toBe("VP of Engineering");
  });

  it("extracts company from capitalized line without title keywords", () => {
    // The parser picks the first capitalized line that isn't a title as company
    const result = parseEmailSignature("Jane Doe\nDirector of Sales\nAcme Corp");
    expect(result.company).toBe("Acme Corp");
  });

  it("handles empty string", () => {
    const result = parseEmailSignature("");
    expect(result).toEqual({});
  });

  it("handles signature with all fields", () => {
    const sig = `John Smith
CEO
Acme Corp
+1 (555) 123-4567
john@acme.com
https://linkedin.com/in/johnsmith
https://acme.com`;
    const result = parseEmailSignature(sig);
    expect(result.name).toBe("John Smith");
    expect(result.title).toBe("CEO");
    expect(result.phone).toBeTruthy();
    expect(result.email).toBe("john@acme.com");
    expect(result.linkedin).toBe("https://linkedin.com/in/johnsmith");
    expect(result.website).toBe("https://acme.com");
  });

  it("recognizes various title keywords", () => {
    for (const keyword of ["CEO", "CTO", "Director", "Manager", "Engineer", "Partner", "Consultant", "Analyst", "President", "Founder"]) {
      const result = parseEmailSignature(`Name\n${keyword} of Something`);
      expect(result.title).toContain(keyword);
    }
  });

  it("does not extract LinkedIn as website", () => {
    const result = parseEmailSignature("https://linkedin.com/in/foo");
    expect(result.website).toBeUndefined();
  });

  it("does not extract Twitter as website", () => {
    const result = parseEmailSignature("https://twitter.com/foo");
    expect(result.website).toBeUndefined();
  });

  it("ignores very short lines for name/title", () => {
    const result = parseEmailSignature("AB\nCD\nJohn Smith");
    // Lines "AB" and "CD" are <= 2 chars, filtered out
    expect(result.name).toBe("John Smith");
  });
});

describe("extractContactsFromEmailThread", () => {
  it("returns empty array for no participants", () => {
    const result = extractContactsFromEmailThread([]);
    expect(result).toEqual([]);
  });

  it("creates contact from participant with name and email", () => {
    const result = extractContactsFromEmailThread([
      { name: "Alice", email: "alice@example.com" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]!.display_name).toBe("Alice");
    expect(result[0]!.emails).toEqual([{ address: "alice@example.com", type: "work", is_primary: true }]);
    expect(result[0]!.source).toBe("import");
  });

  it("falls back to email prefix when no name", () => {
    const result = extractContactsFromEmailThread([
      { email: "bob@example.com" },
    ]);
    expect(result[0]!.display_name).toBe("bob");
  });

  it("extracts signature data into contact fields", () => {
    const sig = `Alice Smith
Director of Engineering
+1 555-999-0000
https://linkedin.com/in/alicesmith
https://mysite.com`;
    const result = extractContactsFromEmailThread([
      { email: "alice@example.com", signature: sig },
    ]);
    expect(result[0]!.display_name).toBe("Alice Smith");
    expect(result[0]!.job_title).toContain("Director");
    expect(result[0]!.phones).toHaveLength(1);
    expect(result[0]!.social_profiles).toHaveLength(1);
    expect(result[0]!.social_profiles![0]!.platform).toBe("linkedin");
    expect(result[0]!.website).toBe("https://mysite.com");
  });

  it("uses participant name over signature name", () => {
    const result = extractContactsFromEmailThread([
      { name: "Given Name", email: "x@y.com", signature: "Sig Name\nEngineer" },
    ]);
    expect(result[0]!.display_name).toBe("Given Name");
  });

  it("handles multiple participants", () => {
    const result = extractContactsFromEmailThread([
      { name: "A", email: "a@x.com" },
      { name: "B", email: "b@x.com" },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]!.display_name).toBe("A");
    expect(result[1]!.display_name).toBe("B");
  });

  it("does not include optional fields when not in signature", () => {
    const result = extractContactsFromEmailThread([
      { name: "Simple", email: "s@x.com" },
    ]);
    expect(result[0]!.job_title).toBeUndefined();
    expect(result[0]!.phones).toBeUndefined();
    expect(result[0]!.social_profiles).toBeUndefined();
    expect(result[0]!.website).toBeUndefined();
  });
});
