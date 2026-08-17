import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolveContactsAuthority } from "./index.js";

describe("projects-serve Contacts authority construction", () => {
  test("leaves the unrelated server surface available when no Contacts configuration exists", () => {
    expect(resolveContactsAuthority({})).toBeUndefined();
  });

  test("fails closed on partial Contacts configuration", () => {
    expect(() => resolveContactsAuthority({
      HASNA_CONTACTS_API_URL: "https://contacts.example.test",
    })).toThrow("HASNA_CONTACTS_API_KEY");
    expect(() => resolveContactsAuthority({
      HASNA_CONTACTS_API_KEY: "test-key",
    })).toThrow("HASNA_CONTACTS_API_URL");
  });

  test("constructs the concrete production adapter when URL and API key are configured", () => {
    const authority = resolveContactsAuthority({
      HASNA_CONTACTS_API_URL: "https://contacts.example.test",
      HASNA_CONTACTS_API_KEY: "test-key",
      HASNA_CONTACTS_SERVICE_INSTANCE: "urn:hasna:contacts:production-test",
    });
    expect(authority).toBeDefined();
    expect(authority?.service_instance).toBe("urn:hasna:contacts:production-test");
  });
});

describe("projects-serve production store construction", () => {
  test("server startup uses the verifier-wired ProjectsPgStore factory", () => {
    const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    expect(source).toContain("const store = createProjectsPgStore(client);");
    expect(source).not.toContain("const store = new ProjectsPgStore(client);");
  });
});
