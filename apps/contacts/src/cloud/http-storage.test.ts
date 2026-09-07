import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KeychainCommandRunner } from "@hasna/contracts/client";
import {
  ContactsClientConfigurationError,
  resolveContactsClientTransport,
  resolveContactsStorageClient,
} from "./http-storage.js";

const tempHomes: string[] = [];

function env(overrides: Record<string, string> = {}): Record<string, string> {
  const tempHome = mkdtempSync(join(tmpdir(), "contacts-transport-home-"));
  tempHomes.push(tempHome);
  return { HOME: tempHome, ...overrides };
}

function writeCredentialsFile(home: string, lines: string[]): void {
  const dir = join(home, ".hasna", "contacts", "config");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "credentials");
  writeFileSync(file, lines.join("\n"));
  chmodSync(file, 0o600);
}

function captureFetch() {
  const calls: Array<{ url: string; key: string | null }> = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (input, init) => {
    calls.push({
      url: String(input),
      key: new Headers(init?.headers).get("x-api-key"),
    });
    return Response.json([]);
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = previousFetch;
    },
  };
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

  test("resolves a key without an explicit authority to the fleet gateway", () => {
    const resolution = resolveContactsClientTransport("contacts", env({ HASNA_CONTACTS_API_KEY: "test-key" }));
    expect(resolution).toMatchObject({
      transport: "https",
      configured: true,
      baseUrl: "https://api.hasna.com/contacts/v1",
      apiUrlSource: "default",
      apiKeyPresent: true,
      apiKeySource: "HASNA_CONTACTS_API_KEY",
      apiKeyTier: "env",
    });
    expect(resolveContactsStorageClient("contacts", env({ HASNA_CONTACTS_API_KEY: "test-key" })).transport).toBe("https");
  });

  test("does not treat an authority without a key as configured", () => {
    const resolution = resolveContactsClientTransport("contacts", env({ HASNA_CONTACTS_API_URL: "https://contacts.example.invalid" }));
    expect(resolution).toMatchObject({ transport: "unconfigured", configured: false, misconfigured: true });
    expect(resolution.issue).toContain("no API key");
  });

  test("requires HTTPS even for loopback", () => {
    const resolution = resolveContactsClientTransport("contacts", env({
      HASNA_CONTACTS_API_URL: "http://127.0.0.1:54321",
      HASNA_CONTACTS_API_KEY: "test-key",
    }));
    expect(resolution).toMatchObject({ transport: "unconfigured", configured: false });
    expect(resolution.issue).toContain("CONTACTS_API_HTTPS_REQUIRED");
  });

  test("rejects plain HTTP for a non-loopback authority even lazily", () => {
    expect(() => resolveContactsClientTransport("contacts", env({
      HASNA_CONTACTS_API_URL: "http://contacts.example.invalid",
      HASNA_CONTACTS_API_KEY: "test-key",
    }))).toThrow("CONTACTS_CLIENT_CONFIG_INVALID");
  });

  test("accepts one explicit authenticated HTTPS authority", () => {
    const resolved = resolveContactsStorageClient("contacts", env({
      HASNA_CONTACTS_API_URL: "https://contacts.example.invalid",
      HASNA_CONTACTS_API_KEY: "test-key",
    }));
    expect(resolved.transport).toBe("https");
    expect(resolved.client.baseUrl).toBe("https://contacts.example.invalid/v1");
    expect(resolved.resolution).toMatchObject({
      transport: "https",
      configured: true,
      apiUrlSource: "HASNA_CONTACTS_API_URL",
      apiKeySource: "HASNA_CONTACTS_API_KEY",
      apiKeyTier: "env",
    });
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

  test("rejects blank and conflicting canonical aliases", () => {
    expect(() => resolveContactsClientTransport("contacts", env({ HASNA_CONTACTS_API_URL: "" }))).toThrow("CONTACTS_CLIENT_CONFIG_INVALID");
    expect(() => resolveContactsClientTransport("contacts", env({
      HASNA_CONTACTS_API_URL: "https://one.example.invalid",
      CONTACTS_API_URL: "https://two.example.invalid",
      HASNA_CONTACTS_API_KEY: "same-key",
    }))).toThrow("CONTACTS_CLIENT_CONFIG_INVALID");
    expect(() => resolveContactsClientTransport("contacts", env({
      HASNA_CONTACTS_API_URL: "https://one.example.invalid",
      HASNA_CONTACTS_API_KEY: "one-key",
      CONTACTS_API_KEY: "two-key",
    }))).toThrow("CONTACTS_CLIENT_CONFIG_INVALID");
  });

  test("resolves the disk tier from a fake HOME credentials file", () => {
    const home = mkdtempSync(join(tmpdir(), "contacts-disk-home-"));
    tempHomes.push(home);
    writeCredentialsFile(home, ["HASNA_CONTACTS_API_KEY=disk-key"]);
    const resolution = resolveContactsClientTransport("contacts", { HOME: home });
    expect(resolution).toMatchObject({
      transport: "https",
      configured: true,
      baseUrl: "https://api.hasna.com/contacts/v1",
      apiKeyPresent: true,
      apiKeyTier: "disk",
    });
    expect(resolution.apiKeySource).toContain(".hasna/contacts/config/credentials");
  });

  test("refuses an ambient-mode-untrusted credential file loudly", () => {
    const home = mkdtempSync(join(tmpdir(), "contacts-unsafe-home-"));
    tempHomes.push(home);
    const dir = join(home, ".hasna", "contacts", "config");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "credentials"), "HASNA_CONTACTS_API_KEY=world-readable-key\n"); // default 0644
    expect(() => resolveContactsClientTransport("contacts", { HOME: home })).toThrow(/owner-only/);
  });

  test("resolves the Keychain tier through an injected security runner", () => {
    const runner: KeychainCommandRunner = (argv) => {
      const service = argv.find((arg) => arg.startsWith("hasna.credentials.contacts."));
      return {
        status: 0,
        stdout: service?.endsWith("api-key") ? "keychain-key" : "https://keychain.example.invalid",
        stderr: "",
      };
    };
    const resolution = resolveContactsClientTransport("contacts", env(), {
      keychain: { enabled: true, platform: "darwin", run: runner },
    });
    expect(resolution).toMatchObject({
      transport: "https",
      configured: true,
      baseUrl: "https://keychain.example.invalid/v1",
      apiKeyPresent: true,
      apiKeyTier: "keychain",
    });
    expect(resolution.apiUrlSource).toContain("keychain:hasna.credentials.contacts.api-url@");
    expect(resolution.apiKeySource).toContain("keychain:hasna.credentials.contacts.api-key@");
  });

  test("binds a rotating credential to its original authority", async () => {
    const mutable = env({
      HASNA_CONTACTS_API_URL: "https://one.example.invalid",
      HASNA_CONTACTS_API_KEY: "one-key",
    });
    const client = resolveContactsStorageClient("contacts", mutable).client;
    mutable.HASNA_CONTACTS_API_URL = "https://two.example.invalid";
    mutable.HASNA_CONTACTS_API_KEY = "two-key";
    expect(client.list("contacts")).rejects.toThrow("CONTACTS_AUTHORITY_CHANGED");
  });

  test("accepts same-authority key rotation without retaining the previous key", async () => {
    const mutable = env({
      HASNA_CONTACTS_API_URL: "https://one.example.invalid",
      HASNA_CONTACTS_API_KEY: "first-key",
    });
    const client = resolveContactsStorageClient("contacts", mutable).client;
    mutable.HASNA_CONTACTS_API_KEY = "replacement-key";
    const capture = captureFetch();
    try {
      await client.list("contacts");
    } finally {
      capture.restore();
    }
    expect(capture.calls[0]).toEqual({
      url: "https://one.example.invalid/v1/contacts",
      key: "replacement-key",
    });
  });

  test("re-reads the disk credential fresh on every request", async () => {
    const home = mkdtempSync(join(tmpdir(), "contacts-rotation-home-"));
    tempHomes.push(home);
    writeCredentialsFile(home, ["HASNA_CONTACTS_API_KEY=disk-first"]);
    const client = resolveContactsStorageClient("contacts", { HOME: home }).client;
    const capture = captureFetch();
    try {
      await client.list("contacts");
      writeCredentialsFile(home, ["HASNA_CONTACTS_API_KEY=disk-second"]);
      await client.list("contacts");
    } finally {
      capture.restore();
    }
    expect(capture.calls.map((call) => call.key)).toEqual(["disk-first", "disk-second"]);
  });

  test("keeps the Keychain gate ambient across the per-request snapshot", async () => {
    // A caller-built env that @hasna/contracts itself marked ambient (its
    // snapshot symbol) must keep the Keychain tier enabled when the request
    // path copies it — the #1788 regression this package must not ship.
    //
    // Hermetic AND discriminating: the tier is observed through its account
    // derivation. With no HASNA_STATION the resolver asks the injected
    // `hostname` for the account; an empty host and no USER mean no account,
    // so no `security` process ever runs and nothing on this machine is
    // consulted — the tier simply falls through to the env key. A copy that
    // lost the gate never asks. (The station Keychain must not decide this
    // test: on a populated Mac the real api-url item disagreed with the URL
    // below and the real api-key outranked the env key.)
    const marked = env({
      HASNA_CONTACTS_API_URL: "https://one.example.invalid",
      HASNA_CONTACTS_API_KEY: "first-key",
    });
    Object.defineProperty(marked, Symbol.for("hasna:contracts:ambientClientEnvironment"), {
      value: true,
      enumerable: false,
    });
    let accountLookups = 0;
    const keychain = {
      platform: "darwin",
      hostname: () => {
        accountLookups += 1;
        return "";
      },
    };
    const client = resolveContactsStorageClient("contacts", marked, { keychain }).client;
    expect(accountLookups).toBeGreaterThan(0);
    accountLookups = 0;
    marked.HASNA_CONTACTS_API_KEY = "second-key";
    const capture = captureFetch();
    try {
      await client.list("contacts");
    } finally {
      capture.restore();
    }
    expect(capture.calls[0]?.key).toBe("second-key");
    // The request re-resolved on a snapshot COPY of `marked`, and that copy
    // still consulted the tier: the gate travelled with the chain options.
    expect(accountLookups).toBeGreaterThan(0);

    // Control: an unmarked copy of the same env is hermetic — the tier is off
    // and the account is never derived.
    accountLookups = 0;
    resolveContactsStorageClient("contacts", { ...marked }, { keychain });
    expect(accountLookups).toBe(0);
  });

  test("re-reads an injected Keychain runner on every request", async () => {
    // The runner route of #1788: an injected `security` runner counts as an
    // enabled tier and must be consulted fresh through the per-request
    // snapshot, so a Keychain rotation heals a long-lived client.
    let stored = "keychain-first";
    let keyReads = 0;
    const run: KeychainCommandRunner = (argv) => {
      const service = argv.find((arg) => arg.startsWith("hasna.credentials.contacts."));
      if (service?.endsWith("api-url")) return { status: 44, stdout: "", stderr: "" };
      keyReads += 1;
      return { status: 0, stdout: `${stored}\n`, stderr: "" };
    };
    const client = resolveContactsStorageClient("contacts", env(), { keychain: { platform: "darwin", run } }).client;
    expect(client.baseUrl).toBe("https://api.hasna.com/contacts/v1");
    stored = "keychain-second";
    const capture = captureFetch();
    try {
      await client.list("contacts");
    } finally {
      capture.restore();
    }
    expect(capture.calls[0]).toEqual({ url: "https://api.hasna.com/contacts/v1/contacts", key: "keychain-second" });
    expect(keyReads).toBeGreaterThanOrEqual(2);
  });

  test("transport report names sources and tiers without exposing values", () => {
    const resolution = resolveContactsClientTransport("contacts", env({
      HASNA_CONTACTS_API_URL: "https://contacts.example.invalid",
      HASNA_CONTACTS_API_KEY: "super-secret-value",
    }));
    const report = JSON.stringify(resolution);
    expect(resolution.apiKeySource).toBe("HASNA_CONTACTS_API_KEY");
    expect(resolution.apiUrlSource).toBe("HASNA_CONTACTS_API_URL");
    expect(resolution.apiKeyTier).toBe("env");
    expect(resolution.baseUrl).toBe("https://contacts.example.invalid/v1");
    expect(report).not.toContain("super-secret-value");
  });
});