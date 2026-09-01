import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ContactsClientConfigurationError,
  resolveContactsClientTransport,
  resolveContactsStorageClient,
} from "./http-storage.js";

const tempHomes: string[] = [];

function env(overrides: Record<string, string> = {}): Record<string, string> {
  const tempHome = mkdtempSync(join(tmpdir(), "contacts-transport-home-"));
  tempHomes.push(tempHome);
  return { HOME: tempHome, XDG_CONFIG_HOME: join(tempHome, "config"), ...overrides };
}

afterEach(() => {
  for (const tempHome of tempHomes.splice(0)) rmSync(tempHome, { recursive: true, force: true });
});

describe("canonical contacts client transport", () => {
  test("is fail-closed without an explicit URL and key", () => {
    const resolution = resolveContactsClientTransport("contacts", env());
    expect(resolution).toMatchObject({ transport: "unconfigured", configured: false, misconfigured: true });
    expect(() => resolveContactsStorageClient("contacts", env())).toThrow(ContactsClientConfigurationError);
  });

  test("does not treat a key without an authority as configured", () => {
    expect(resolveContactsClientTransport("contacts", env({ HASNA_CONTACTS_API_KEY: "test-key" }))).toMatchObject({
      transport: "unconfigured",
      configured: false,
      apiKeyPresent: true,
    });
  });

  test("does not treat an authority without a key as configured", () => {
    expect(resolveContactsClientTransport("contacts", env({ HASNA_CONTACTS_API_URL: "https://contacts.example.invalid" }))).toMatchObject({
      transport: "unconfigured",
      configured: false,
    });
  });

  test("requires HTTPS even for loopback", () => {
    const resolution = resolveContactsClientTransport("contacts", env({
      HASNA_CONTACTS_API_URL: "http://127.0.0.1:54321",
      HASNA_CONTACTS_API_KEY: "test-key",
    }));
    expect(resolution).toMatchObject({ transport: "unconfigured", configured: false });
    expect(resolution.issue).toContain("CONTACTS_API_HTTPS_REQUIRED");
  });

  test("accepts one explicit authenticated HTTPS authority", () => {
    const resolved = resolveContactsStorageClient("contacts", env({
      HASNA_CONTACTS_API_URL: "https://contacts.example.invalid",
      HASNA_CONTACTS_API_KEY: "test-key",
    }));
    expect(resolved.transport).toBe("https");
    expect(resolved.client.baseUrl).toBe("https://contacts.example.invalid/v1");
  });

  test("rejects retired database and mode selectors", () => {
    for (const [key, value] of [
      ["HASNA_CONTACTS_STORAGE_MODE", "cloud"],
      ["CONTACTS_DB_PATH", "/tmp/contacts.db"],
      ["CONTACTS_DATABASE_URL", "postgresql://client-dsn"],
    ] as const) {
      expect(() => resolveContactsClientTransport("contacts", env({ [key]: value }))).toThrow("RETIRED_CONTACTS_CLIENT_SELECTOR");
    }
  });
});
