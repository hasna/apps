/**
 * The credential tiers through the surfaces that use them (hasna/apps#1720).
 *
 * `transport.test.ts` covers the ENV tier with caller-built dictionaries; this
 * file covers the tiers an env dictionary cannot express — the macOS Keychain
 * and `~/.hasna/messages/config/credentials` — plus the fail-closed arm, where
 * the assertion is not only the throw but that NO SQLite file was created
 * anywhere under the run's home, plus the transport report both arms print.
 *
 * Two seams make that possible without touching the machine's real state:
 *
 *   - the Keychain tier takes an INJECTABLE `security` runner, so "the item
 *     exists" and "the item is missing" are both first-class cases and the
 *     login keychain is never opened. Injecting a runner also switches the
 *     tier on for a caller-built env, which is otherwise ambient-only.
 *   - the disk tier is anchored on HOME (or HASNA_HOME), so a temporary home
 *     is a complete hermetic filesystem for it.
 *
 * Every credential value here is a fixture string. The resolver never logs a
 * value, and neither does this file: assertions are on the SOURCE
 * (`keychain:…`, an absolute path, an env key NAME) and on routing.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createMessagesClient,
  resetMessagesLocalModeNotice,
  resolveMessagesClientTransport,
} from "./index.js";
import type { MessagesKeychainCommandResult } from "./index.js";

const KEYCHAIN_KEY = "fixture-keychain-key";
const DISK_KEY = "fixture-disk-key";
const ENV_KEY = "fixture-env-key";

const tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  resetMessagesLocalModeNotice();
});

function tempHome(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `messages-cred-${label}-`));
  tempRoots.push(root);
  return root;
}

/** Write the credential file the resolver reads, at the mode it demands. */
function writeCredentialsFile(home: string, body: string, mode = 0o600): string {
  const file = join(home, ".hasna", "messages", "config", "credentials");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body, { mode });
  chmodSync(file, mode);
  return file;
}

/**
 * A fake `/usr/bin/security`.
 *
 * `items` maps a service name to its stored value; anything absent answers
 * status 44, which is how the real tool reports item-not-found and how the
 * resolver recognises an absent tier. Calls are recorded so a test can assert
 * the tier was consulted — or, for the isolation cases, that it was not.
 */
function fakeKeychain(items: Record<string, string>) {
  const calls: string[][] = [];
  const run = (argv: readonly string[]): MessagesKeychainCommandResult => {
    calls.push([...argv]);
    const service = argv[argv.indexOf("-s") + 1] ?? "";
    const value = items[service];
    if (value === undefined) return { status: 44, stdout: "", stderr: "" };
    return { status: 0, stdout: `${value}\n`, stderr: "" };
  };
  return { calls, options: { credentials: { keychain: { platform: "darwin", run } } } as const };
}

/** Recursively list every *.db / *.sqlite / *.sqlite3 file under a root. */
function sqliteFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sqliteFilesUnder(full));
    else if (/\.(?:db|sqlite3?)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("tier 3 — the macOS Keychain", () => {
  test("an api-key item alone resolves the fleet gateway", () => {
    const keychain = fakeKeychain({ "hasna.credentials.messages.api-key": KEYCHAIN_KEY });
    const report = resolveMessagesClientTransport({ HOME: tempHome("kc-only") }, keychain.options);

    expect(report.transport).toBe("http");
    expect(report.baseUrl).toBe("https://api.hasna.com/messages/v1");
    expect(report.apiUrlSource).toBe("default");
    expect(report.apiKeyTier).toBe("keychain");
    // The SOURCE is reported, never the value.
    expect(report.apiKeySource).toMatch(/^keychain:hasna\.credentials\.messages\.api-key@/);
    expect(JSON.stringify(report)).not.toContain(KEYCHAIN_KEY);
  });

  test("the api-url item beside it selects the authority", () => {
    const keychain = fakeKeychain({
      "hasna.credentials.messages.api-key": KEYCHAIN_KEY,
      "hasna.credentials.messages.api-url": "https://messages.station.example",
    });
    const report = resolveMessagesClientTransport({ HOME: tempHome("kc-url") }, keychain.options);

    expect(report.transport).toBe("http");
    expect(report.baseUrl).toBe("https://messages.station.example/v1");
    expect(report.apiUrlPresent).toBe(true);
    expect(report.apiUrlSource).toMatch(/^keychain:hasna\.credentials\.messages\.api-url@/);
    expect(report.apiKeyTier).toBe("keychain");
  });

  test("a missing item is an absent tier, not a failure — the next tier decides", () => {
    const home = tempHome("kc-missing");
    const keychain = fakeKeychain({});
    const report = resolveMessagesClientTransport({ HOME: home, HASNA_MESSAGES_API_KEY: ENV_KEY }, keychain.options);
    expect(report.apiKeyTier).toBe("env");
    expect(keychain.calls.length).toBeGreaterThan(0);
  });

  test("an item that exists but cannot be READ is terminal, never resolved around", () => {
    // The dangerous shape: a locked keychain answering non-zero. Falling
    // through to the environment here would silently act as a different
    // principal than the machine's own item names.
    const home = tempHome("kc-locked");
    const run = (): MessagesKeychainCommandResult => ({ status: 51, stdout: "", stderr: "User interaction is not allowed." });
    expect(() =>
      resolveMessagesClientTransport(
        { HOME: home, HASNA_MESSAGES_API_KEY: ENV_KEY },
        { credentials: { keychain: { platform: "darwin", run } } },
      ),
    ).toThrow(/never resolved around/);
  });
});

describe("tier 4 — ~/.hasna/messages/config/credentials", () => {
  test("a credentials file supplies both the key and the authority", () => {
    const home = tempHome("disk");
    const file = writeCredentialsFile(
      home,
      `HASNA_MESSAGES_API_KEY=${DISK_KEY}\nHASNA_MESSAGES_API_URL=https://messages.disk.example\n`,
    );
    const report = resolveMessagesClientTransport({ HOME: home });

    expect(report.transport).toBe("http");
    expect(report.baseUrl).toBe("https://messages.disk.example/v1");
    expect(report.apiKeyTier).toBe("disk");
    expect(report.apiKeySource).toBe(file);
  });

  test("HASNA_HOME moves the root, and XDG is never consulted", () => {
    // The credential lives ONLY under HASNA_HOME. A resolver that still read
    // ~/.hasna, or $XDG_CONFIG_HOME/hasna, would find nothing here and fail.
    const home = tempHome("disk-home");
    const hasnaHome = tempHome("disk-hasna-home");
    const file = join(hasnaHome, "messages", "config", "credentials");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `HASNA_MESSAGES_API_KEY=${DISK_KEY}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);

    const report = resolveMessagesClientTransport({
      HOME: home,
      HASNA_HOME: hasnaHome,
      XDG_CONFIG_HOME: join(home, "xdg-must-not-be-read"),
    });
    expect(report.apiKeyTier).toBe("disk");
    expect(report.apiKeySource).toBe(file);
  });

  test("a world-readable credentials file is refused, not silently skipped", () => {
    const home = tempHome("disk-mode");
    writeCredentialsFile(home, `HASNA_MESSAGES_API_KEY=${DISK_KEY}\n`, 0o644);
    expect(() => resolveMessagesClientTransport({ HOME: home, HASNA_MESSAGES_API_KEY: ENV_KEY })).toThrow(
      /Refusing unsafe credential|not owner-only/,
    );
  });

  test("no file is an absent tier — the environment still decides", () => {
    const home = tempHome("disk-absent");
    const report = resolveMessagesClientTransport({ HOME: home, HASNA_MESSAGES_API_KEY: ENV_KEY });
    expect(report.apiKeyTier).toBe("env");
  });
});

describe("tier ordering, end to end", () => {
  test("Keychain beats disk beats env, and each falls through when absent", () => {
    const home = tempHome("ordering");
    writeCredentialsFile(home, `HASNA_MESSAGES_API_KEY=${DISK_KEY}\n`);
    const env = { HOME: home, HASNA_MESSAGES_API_KEY: ENV_KEY };

    const withKeychain = fakeKeychain({ "hasna.credentials.messages.api-key": KEYCHAIN_KEY });
    expect(resolveMessagesClientTransport(env, withKeychain.options).apiKeyTier).toBe("keychain");

    const withoutKeychain = fakeKeychain({});
    expect(resolveMessagesClientTransport(env, withoutKeychain.options).apiKeyTier).toBe("disk");

    rmSync(join(home, ".hasna", "messages", "config", "credentials"));
    expect(resolveMessagesClientTransport(env, withoutKeychain.options).apiKeyTier).toBe("env");
  });
});

describe("the transport report names sources, never values", () => {
  test("a chain-resolved run reports the tier, the source and the authority", () => {
    const home = tempHome("report");
    const report = resolveMessagesClientTransport({ HOME: home, HASNA_MESSAGES_API_KEY: ENV_KEY });
    expect(report).toMatchObject({
      transport: "http",
      source: "HASNA_MESSAGES_API_KEY",
      baseUrl: "https://api.hasna.com/messages/v1",
      configuredApiBase: null,
      apiUrlPresent: false,
      apiUrlSource: "default",
      apiKeyPresent: true,
      apiKeySource: "HASNA_MESSAGES_API_KEY",
      apiKeyTier: "env",
      localOptIn: false,
      authorityPinned: false,
    });
    expect(report.warning).toBeNull();
    expect(JSON.stringify(report)).not.toContain(ENV_KEY);
  });

  test("a local opt-in run reports the on-box store and no authority", () => {
    const home = tempHome("report-local");
    const report = resolveMessagesClientTransport({ HOME: home, HASNA_MESSAGES_LOCAL: "1" });
    expect(report).toMatchObject({
      transport: "local",
      source: "local-opt-in",
      baseUrl: null,
      apiUrlPresent: false,
      apiKeyPresent: false,
      localOptIn: true,
      authorityPinned: false,
    });
  });
});

describe("nothing resolves — fail closed, and leave no store behind", () => {
  test("an empty home throws, builds no client, and creates no database", () => {
    const home = tempHome("fail-closed");
    const keychain = fakeKeychain({});

    expect(() => resolveMessagesClientTransport({ HOME: home }, keychain.options)).toThrow(
      /HASNA_MESSAGES_API_URL/,
    );
    expect(() =>
      createMessagesClient({ HOME: home }, { keychain: keychain.options.credentials.keychain }),
    ).toThrow(/HASNA_MESSAGES_API_URL/);

    // The seam throws before anything can open SQLite: no store file, and no
    // app directory conjured as a side effect of failing.
    expect(sqliteFilesUnder(home)).toEqual([]);
    expect(existsSync(join(home, ".hasna", "messages"))).toBe(false);
  });

  test("an explicit --api-key argument is tier 1 and never falls through", () => {
    const home = tempHome("explicit");
    writeCredentialsFile(home, `HASNA_MESSAGES_API_KEY=${DISK_KEY}\n`);
    const keychain = fakeKeychain({ "hasna.credentials.messages.api-key": KEYCHAIN_KEY });
    const report = resolveMessagesClientTransport(
      { HOME: home, HASNA_MESSAGES_API_KEY: ENV_KEY },
      { credentials: { ...keychain.options.credentials, apiKey: "fixture-explicit-key" } },
    );
    expect(report.apiKeyTier).toBe("argument");
  });

  test("the unhosted opt-in serves sqlite WITHOUT reading the Keychain or disk", () => {
    // The isolation guarantee, asserted rather than assumed: a resolvable
    // credential exists in both stores and neither is touched.
    const home = tempHome("opt-in");
    writeCredentialsFile(home, `HASNA_MESSAGES_API_KEY=${DISK_KEY}\n`);
    const keychain = fakeKeychain({ "hasna.credentials.messages.api-key": KEYCHAIN_KEY });

    const report = resolveMessagesClientTransport({ HOME: home, HASNA_MESSAGES_LOCAL: "1" }, keychain.options);
    expect(report.transport).toBe("local");
    expect(report.localOptIn).toBe(true);
    expect(keychain.calls).toEqual([]);
    expect(sqliteFilesUnder(home)).toEqual([]); // closed the store BEFORE any file could appear
  });
});