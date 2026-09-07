import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KeychainCommandRunner } from "@hasna/contracts/client";
import { ContactsV1Client, createContactsClient } from "./index.js";

const tempHomes: string[] = [];

function env(overrides: Record<string, string> = {}): Record<string, string | undefined> {
  const home = mkdtempSync(join(tmpdir(), "contacts-sdk-home-"));
  tempHomes.push(home);
  return { HOME: home, ...overrides };
}

function writeCredentialsFile(home: string, lines: string[]): void {
  const dir = join(home, ".hasna", "contacts", "config");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "credentials");
  writeFileSync(file, `${lines.join("\n")}\n`);
  chmodSync(file, 0o600);
}

function captureFetch() {
  const calls: Array<{ url: string; key: string | null; redirect: RequestRedirect | undefined }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), key: new Headers(init?.headers).get("x-api-key"), redirect: init?.redirect });
    return Response.json({ contacts: [], count: 0 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

afterEach(() => {
  for (const home of tempHomes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("ContactsV1Client authority normalisation", () => {
  test("keeps a gateway path prefix and normalises /v1 once", async () => {
    for (const baseUrl of [
      "https://api.hasna.com/contacts",
      "https://api.hasna.com/contacts/",
      "https://api.hasna.com/contacts/v1",
      "https://api.hasna.com/contacts/v1/",
      "https://contacts.example.invalid",
      "https://contacts.example.invalid/v1",
    ]) {
      const capture = captureFetch();
      const client = new ContactsV1Client({ baseUrl, apiKey: "pinned-key", fetch: capture.fetchImpl });
      await client.listContacts();
      const origin = new URL(baseUrl).origin;
      const prefix = origin === "https://api.hasna.com" ? "/contacts" : "";
      expect(capture.calls.map((call) => call.url)).toEqual([`${origin}${prefix}/v1/contacts`]);
    }
  });
});

describe("createContactsClient (the @hasna/contracts chain at ./sdk)", () => {
  test("explicit baseUrl + apiKey is a deliberate pin; the ambient chain is never consulted", async () => {
    const capture = captureFetch();
    const client = createContactsClient({
      baseUrl: "https://contacts.example.invalid",
      apiKey: "pinned-key",
      env: env({ HASNA_CONTACTS_API_KEY: "ambient-key", HASNA_CONTACTS_API_URL: "https://other.example.invalid" }),
      fetch: capture.fetchImpl,
    });
    await client.listContacts();
    expect(capture.calls).toEqual([{ url: "https://contacts.example.invalid/v1/contacts", key: "pinned-key", redirect: "manual" }]);
  });

  test("explicit baseUrl without apiKey throws and never attaches the ambient key (#1794)", () => {
    const capture = captureFetch();
    const ambientKey = process.env.HASNA_CONTACTS_API_KEY;
    process.env.HASNA_CONTACTS_API_KEY = "ambient-fleet-key";
    try {
      expect(() => createContactsClient({ baseUrl: "https://contacts.example.invalid", fetch: capture.fetchImpl }))
        .toThrow("CONTACTS_CREDENTIAL_PINNED");
      expect(() => createContactsClient({
        baseUrl: "https://contacts.example.invalid",
        env: env({ HASNA_CONTACTS_API_KEY: "env-key" }),
        fetch: capture.fetchImpl,
      })).toThrow("CONTACTS_CREDENTIAL_PINNED");
    } finally {
      if (ambientKey === undefined) delete process.env.HASNA_CONTACTS_API_KEY;
      else process.env.HASNA_CONTACTS_API_KEY = ambientKey;
    }
    expect(capture.calls).toEqual([]);
  });

  test("resolves the env-tier key and the default fleet gateway authority through the chain", async () => {
    const capture = captureFetch();
    const client = createContactsClient({ env: env({ HASNA_CONTACTS_API_KEY: "env-key" }), fetch: capture.fetchImpl });
    await client.listContacts();
    expect(capture.calls).toEqual([{ url: "https://api.hasna.com/contacts/v1/contacts", key: "env-key", redirect: "manual" }]);
  });

  test("re-resolves the key on every request and pins the authority", async () => {
    const mutable = env({ HASNA_CONTACTS_API_URL: "https://one.example.invalid", HASNA_CONTACTS_API_KEY: "first-key" });
    const capture = captureFetch();
    const client = createContactsClient({ env: mutable, fetch: capture.fetchImpl });
    await client.listContacts();
    mutable.HASNA_CONTACTS_API_KEY = "rotated-key";
    await client.listContacts();
    expect(capture.calls.map((call) => call.key)).toEqual(["first-key", "rotated-key"]);
    expect(capture.calls.every((call) => call.url === "https://one.example.invalid/v1/contacts")).toBe(true);

    // A changed authority is a NEW client, never a key sent to the old server.
    mutable.HASNA_CONTACTS_API_URL = "https://two.example.invalid";
    mutable.HASNA_CONTACTS_API_KEY = "two-key";
    await expect(client.listContacts()).rejects.toThrow("CONTACTS_AUTHORITY_CHANGED");
    expect(capture.calls).toHaveLength(2);
  });

  test("reads the disk tier fresh on every request", async () => {
    const hermetic = env();
    writeCredentialsFile(hermetic.HOME!, ["HASNA_CONTACTS_API_KEY=disk-first"]);
    const capture = captureFetch();
    const client = createContactsClient({ env: hermetic, fetch: capture.fetchImpl });
    await client.listContacts();
    writeCredentialsFile(hermetic.HOME!, ["HASNA_CONTACTS_API_KEY=disk-second"]);
    await client.listContacts();
    expect(capture.calls.map((call) => call.key)).toEqual(["disk-first", "disk-second"]);
    expect(capture.calls[0]?.url).toBe("https://api.hasna.com/contacts/v1/contacts");
  });

  test("resolves the Keychain tier through an injected security runner", async () => {
    const run: KeychainCommandRunner = (argv) => {
      const service = argv.find((arg) => arg.startsWith("hasna.credentials.contacts."));
      return {
        status: 0,
        stdout: service?.endsWith("api-key") ? "keychain-key\n" : "https://keychain.example.invalid\n",
        stderr: "",
      };
    };
    const capture = captureFetch();
    const client = createContactsClient({ env: env(), keychain: { platform: "darwin", run }, fetch: capture.fetchImpl });
    await client.listContacts();
    expect(capture.calls).toEqual([{ url: "https://keychain.example.invalid/v1/contacts", key: "keychain-key", redirect: "manual" }]);
  });

  test("fails closed with no credential: throws, no request, nothing written under HOME", () => {
    const hermetic = env();
    const capture = captureFetch();
    expect(() => createContactsClient({ env: hermetic, fetch: capture.fetchImpl })).toThrow("CONTACTS_API_NOT_CONFIGURED");
    expect(capture.calls).toEqual([]);
    expect(readdirSync(hermetic.HOME!)).toEqual([]);
  });

  test("refuses a plaintext authority from the chain", () => {
    expect(() => createContactsClient({
      env: env({ HASNA_CONTACTS_API_URL: "http://127.0.0.1:54321", HASNA_CONTACTS_API_KEY: "test-key" }),
    })).toThrow("CONTACTS_API_HTTPS_REQUIRED");
  });
});
