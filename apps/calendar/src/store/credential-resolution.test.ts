/**
 * Hermetic credential-resolution tests for the @hasna/contracts chain behind
 * the calendar seam (hasna/apps#1720, checklist item 6).
 *
 * Every test builds a CALLER-BUILT env (never the live process env), so the
 * machine's ambient stores are outside it by construction; the Keychain tier
 * is exercised through an injected `security` runner, and the disk tier
 * through a fake HOME / HASNA_HOME. Nothing here can reach the developer's
 * real Keychain items or credential files.
 */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { CredentialChainOptions } from "@hasna/contracts/client";
import { resolveStorageClient, resolveClientTransport } from "./http-storage.js";
import {
  calendarResolverInputs,
  type CalendarCredentialChainOptions,
  type CalendarKeychainCommandResult,
} from "./local-opt-in.js";

const KEYCHAIN_ITEM_NOT_FOUND_STATUS = 44;

/** A `security` runner that answers only the items this test planted. */
function fakeSecurity(items: Record<string, string>): (argv: readonly string[]) => CalendarKeychainCommandResult {
  return (argv: readonly string[]): CalendarKeychainCommandResult => {
    const service = argv.find((arg, i) => i > 0 && argv[i - 1] === "-s");
    const value = service ? items[service] : undefined;
    if (value === undefined) return { status: KEYCHAIN_ITEM_NOT_FOUND_STATUS, stdout: "", stderr: "" };
    return { status: 0, stdout: `${value}\n`, stderr: "" };
  };
}

function scratchRoot(): string {
  return mkdtempSync(join(tmpdir(), "calendar-credential-test-"));
}

function removeRoot(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

/** Write the single disk-tier credentials file at 0600 under a fake HOME. */
function writeCredentialsFile(home: string, contents: string): string {
  const dir = join(home, ".hasna", "calendar", "config");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "credentials");
  writeFileSync(file, contents, { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

// The local spellings of the crossing credential types must stay assignable to
// the contracts declarations — a drift fails this cast at compile time
// (hasna/apps#1782: the published .d.ts must not import @hasna/contracts).
const _conformance: CredentialChainOptions = {} as CalendarCredentialChainOptions;

describe("calendar credential resolution (@hasna/contracts chain, hermetic)", () => {
  test("env tier: HASNA_CALENDAR_API_KEY resolves with its env-key source", () => {
    const r = resolveStorageClient("calendar", {
      HASNA_CALENDAR_API_URL: "https://calendar.example.test",
      HASNA_CALENDAR_API_KEY: "env-key",
    });
    expect(r.resolution.apiKeyPresent).toBe(true);
    expect(r.resolution.apiKeySource).toBe("HASNA_CALENDAR_API_KEY");
    expect(r.resolution.apiKeyTier).toBe("env");
    expect(r.client.baseUrl).toBe("https://calendar.example.test/v1");
  });

  test("disk tier: the credentials file outranks the env variable", () => {
    const home = scratchRoot();
    try {
      const file = writeCredentialsFile(home, "HASNA_CALENDAR_API_KEY=disk-key\n");
      const r = resolveStorageClient("calendar", {
        HOME: home,
        HASNA_CALENDAR_API_URL: "https://calendar.example.test",
        HASNA_CALENDAR_API_KEY: "env-key",
      });
      expect(r.resolution.apiKeySource).toBe(file);
      expect(r.resolution.apiKeyTier).toBe("disk");
    } finally {
      removeRoot(home);
    }
  });

  test("disk tier: a URL in the credentials file selects the authority", () => {
    const home = scratchRoot();
    try {
      const file = writeCredentialsFile(
        home,
        "HASNA_CALENDAR_API_KEY=disk-key\nHASNA_CALENDAR_API_URL=https://disk.example.test\n",
      );
      const r = resolveStorageClient("calendar", { HOME: home });
      expect(r.resolution.apiKeyTier).toBe("disk");
      expect(r.resolution.apiKeySource).toBe(file);
      expect(r.resolution.apiUrlSource).toBe(file);
      expect(r.client.baseUrl).toBe("https://disk.example.test/v1");
    } finally {
      removeRoot(home);
    }
  });

  test("disk tier: an unsafe permissions file fails loudly, never resolves around", () => {
    const home = scratchRoot();
    try {
      const dir = join(home, ".hasna", "calendar", "config");
      mkdirSync(dir, { recursive: true });
      const file = join(dir, "credentials");
      writeFileSync(file, "HASNA_CALENDAR_API_KEY=disk-key\n", { mode: 0o644 });
      chmodSync(file, 0o644);
      expect(() =>
        resolveStorageClient("calendar", { HOME: home, HASNA_CALENDAR_API_KEY: "env-key" }),
      ).toThrow(/unsafe|permission/);
    } finally {
      removeRoot(home);
    }
  });

  test("keychain tier: an injected runner's api-key item resolves with its item source", () => {
    const run = fakeSecurity({ "hasna.credentials.calendar.api-key": "keychain-key" });
    const env = {
      HASNA_STATION: "calendar-test-fixture-no-such-station",
      HASNA_CALENDAR_API_URL: "https://calendar.example.test",
      HASNA_CALENDAR_API_KEY: "env-key", // below the Keychain tier
    };
    const r = resolveStorageClient("calendar", env, {
      credentials: { keychain: { run, platform: "darwin" } },
    });
    expect(r.resolution.apiKeyTier).toBe("keychain");
    expect(r.resolution.apiKeySource).toBe(
      "keychain:hasna.credentials.calendar.api-key@calendar-test-fixture-no-such-station",
    );
  });

  test("keychain tier: the api-url item selects the authority (env silent)", () => {
    const run = fakeSecurity({
      "hasna.credentials.calendar.api-key": "keychain-key",
      "hasna.credentials.calendar.api-url": "https://keychain.example.test",
    });
    const r = resolveClientTransport(
      "calendar",
      { HASNA_STATION: "calendar-test-fixture-no-such-station" },
      { credentials: { keychain: { run, platform: "darwin" } } },
    );
    expect(r.transport).toBe("http-api");
    expect(r.apiUrlSource).toBe("keychain:hasna.credentials.calendar.api-url@calendar-test-fixture-no-such-station");
    expect(r.baseUrl).toBe("https://keychain.example.test/v1");
  });

  test("keychain tier: absent api-key item (exit 44) falls through to the env tier", () => {
    const run = fakeSecurity({});
    const r = resolveStorageClient(
      "calendar",
      { HASNA_CALENDAR_API_URL: "https://calendar.example.test", HASNA_CALENDAR_API_KEY: "env-key" },
      { credentials: { keychain: { run, platform: "darwin" } } },
    );
    expect(r.resolution.apiKeyTier).toBe("env");
    expect(r.resolution.apiKeySource).toBe("HASNA_CALENDAR_API_KEY");
  });

  test("a locked keychain (security exits non-44) is terminal, never resolved around", () => {
    const run = () => ({ status: 10, stdout: "", stderr: "User interaction is not allowed." });
    expect(() =>
      resolveStorageClient("calendar", { HASNA_CALENDAR_API_KEY: "env-key" }, { credentials: { keychain: { run, platform: "darwin" } } }),
    ).toThrow(/keychain|Keychain/i);
  });

  test("pointer tier is refused loudly: calendar cannot complete a vault pointer per request", () => {
    expect(() =>
      resolveStorageClient("calendar", {
        HASNA_CALENDAR_API_KEY_REF: "namespace/app/live/api_key",
      }),
    ).toThrow(/pointer|vault/i);
  });

  test("blank normalisation carries the ambient gate as an explicit decision (#1788)", () => {
    // A caller-built env with a declared-but-blank variable forces a copy; the
    // Keychain tier is off for caller-built worlds, and the gate must travel
    // with the copy as keychain.enabled=false rather than being silently lost
    // OR mis-flipped on.
    const env = { HASNA_CALENDAR_API_URL: "", HASNA_CALENDAR_API_KEY: "env-key" };
    const inputs = calendarResolverInputs(env);
    expect(inputs.env["HASNA_CALENDAR_API_URL"]).toBeUndefined();
    expect(inputs.credentials.keychain?.enabled).toBe(false);
    // And the full resolution still works through the surviving env tier.
    const r = resolveStorageClient("calendar", env);
    expect(r.resolution.apiKeyTier).toBe("env");
  });

  test("the live process env is ambient: blank normalisation pins keychain.enabled true", () => {
    const savedUrl = process.env.HASNA_CALENDAR_API_URL;
    const savedKey = process.env.HASNA_CALENDAR_API_KEY;
    try {
      process.env.HASNA_CALENDAR_API_URL = "";
      process.env.HASNA_CALENDAR_API_KEY = "live-key";
      const inputs = calendarResolverInputs(process.env);
      expect(inputs.env["HASNA_CALENDAR_API_URL"]).toBeUndefined();
      expect(inputs.credentials.keychain?.enabled).toBe(true);
    } finally {
      if (savedUrl === undefined) delete process.env.HASNA_CALENDAR_API_URL; else process.env.HASNA_CALENDAR_API_URL = savedUrl;
      if (savedKey === undefined) delete process.env.HASNA_CALENDAR_API_KEY; else process.env.HASNA_CALENDAR_API_KEY = savedKey;
    }
  });
});