/**
 * The credential tiers behind the economy client, exercised through the
 * @hasna/contracts 1.0.2 resolver seam (`src/lib/cloud-storage.ts`).
 *
 * `cloud-storage.test.ts` covers the ENV tier with caller-built dictionaries;
 * this file covers the tiers an env dictionary cannot express — the macOS
 * Keychain and `~/.hasna/economy/config/credentials` — plus the transport
 * report and the fail-closed arm, where the assertion is that NO SQLite file
 * is created anywhere under the run's home.
 *
 * Two seams make that possible without touching the machine's real state:
 *
 *   - the Keychain tier takes an INJECTABLE `security` runner, so "the item
 *     exists" and "the item is missing" are both first-class cases and the
 *     login keychain is never opened. Injecting a runner also switches the
 *     tier on for a caller-built env, which is otherwise ambient-only.
 *   - the disk tier is anchored on HOME, so a temporary home is a complete
 *     hermetic filesystem for it.
 *
 * Every credential value here is a fixture string. The resolver never logs a
 * value, and neither does this file: assertions are on the SOURCE
 * (`keychain:…`, an absolute path, an env key NAME) and on observable routing.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { KeychainCommandResult } from "@hasna/contracts/client";
import {
  resolveEconomyCloudStorage,
  economyTransportReport,
  ECONOMY_APP,
} from "./cloud-storage.js";

const KEYCHAIN_KEY = "fixture-keychain-key";
const DISK_KEY = "fixture-disk-key";
const ENV_KEY = "fixture-env-key";

/** `~/.hasna/<app>/config/credentials` segments, resolver-derived. */
const CREDENTIALS_SEGMENTS = [".hasna", ECONOMY_APP, "config", "credentials"] as const;

const tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempHome(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `economy-cred-${label}-`));
  tempRoots.push(root);
  return root;
}

/** Write the credential file the resolver reads, at the mode it demands. */
function writeCredentialsFile(home: string, body: string, mode = 0o600): string {
  const file = join(home, ...CREDENTIALS_SEGMENTS);
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
  const run = (argv: readonly string[]): KeychainCommandResult => {
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
  test("an api-key item alone resolves the default fleet gateway", () => {
    const keychain = fakeKeychain({ "hasna.credentials.economy.api-key": KEYCHAIN_KEY });
    const r = resolveEconomyCloudStorage({ HOME: tempHome("kc-only") }, keychain.options);

    expect(r.active).toBe(true);
    expect(r.client!.baseUrl).toBe("https://api.hasna.com/economy/v1");
  });

  test("the api-url item beside it selects the authority", () => {
    const keychain = fakeKeychain({
      "hasna.credentials.economy.api-key": KEYCHAIN_KEY,
      "hasna.credentials.economy.api-url": "https://economy.station.example",
    });
    const report = economyTransportReport({ HOME: tempHome("kc-url") }, keychain.options);

    expect(report.ok).toBe(true);
    expect(report.transport).toBe("http");
    expect(report.authority!.baseUrl).toBe("https://economy.station.example/v1");
    expect(report.authority!.apiUrlSource).toMatch(/^keychain:hasna\.credentials\.economy\.api-url@/);
    expect(report.authority!.apiKeyTier).toBe("keychain");
    // The SOURCE is reported, never the value.
    expect(JSON.stringify(report)).not.toContain(KEYCHAIN_KEY);
  });

  test("a missing item is an absent tier, not a failure — the next tier decides", () => {
    const home = tempHome("kc-missing");
    const keychain = fakeKeychain({});
    const r = resolveEconomyCloudStorage(
      { HOME: home, HASNA_ECONOMY_API_KEY: ENV_KEY },
      keychain.options,
    );
    expect(r.active).toBe(true);
    expect(keychain.calls.length).toBeGreaterThan(0);
  });

  test("an item that exists but cannot be READ is terminal, never resolved around", () => {
    const home = tempHome("kc-locked");
    const run = (): KeychainCommandResult => ({ status: 51, stdout: "", stderr: "User interaction is not allowed." });
    expect(() =>
      resolveEconomyCloudStorage(
        { HOME: home, HASNA_ECONOMY_API_KEY: ENV_KEY },
        { credentials: { keychain: { platform: "darwin", run } } },
      ),
    ).toThrow();
  });

  test("the tier does not exist off darwin", () => {
    const home = tempHome("kc-linux");
    const keychain = fakeKeychain({ "hasna.credentials.economy.api-key": KEYCHAIN_KEY });
    expect(() =>
      resolveEconomyCloudStorage(
        { HOME: home },
        { credentials: { keychain: { ...keychain.options.credentials.keychain, platform: "linux" } } },
      ),
    ).toThrow(/API key/i);
    expect(keychain.calls).toEqual([]);
  });
});

describe("tier 4 — ~/.hasna/economy/config/credentials", () => {
  test("a credentials file supplies both the key and the authority", () => {
    const home = tempHome("disk");
    const file = writeCredentialsFile(
      home,
      `HASNA_ECONOMY_API_KEY=${DISK_KEY}\nHASNA_ECONOMY_API_URL=https://economy.disk.example\n`,
    );
    const report = economyTransportReport({ HOME: home });

    expect(report.ok).toBe(true);
    expect(report.authority!.baseUrl).toBe("https://economy.disk.example/v1");
    expect(report.authority!.apiKeyTier).toBe("disk");
    expect(report.authority!.apiKeySource).toBe(file);
  });

  test("HASNA_HOME moves the root, and XDG is never consulted", () => {
    const home = tempHome("disk-home");
    const hasnaHome = tempHome("disk-hasna-home");
    // The credential lives ONLY under HASNA_HOME. A resolver that still read
    // ~/.hasna, or $XDG_CONFIG_HOME/hasna, would find nothing here and fail.
    const file = join(hasnaHome, ECONOMY_APP, "config", "credentials");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `HASNA_ECONOMY_API_KEY=${DISK_KEY}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);

    const r = resolveEconomyCloudStorage({
      HOME: home,
      HASNA_HOME: hasnaHome,
      XDG_CONFIG_HOME: join(home, "xdg-must-not-be-read"),
    });
    expect(r.active).toBe(true);
    expect(economyTransportReport({
      HOME: home,
      HASNA_HOME: hasnaHome,
      XDG_CONFIG_HOME: join(home, "xdg-must-not-be-read"),
    }).authority!.apiKeySource).toBe(file);
  });

  test("disk outranks the environment so a rotation heals an old shell", () => {
    const home = tempHome("disk-beats-env");
    writeCredentialsFile(home, `HASNA_ECONOMY_API_KEY=${DISK_KEY}\n`);
    const report = economyTransportReport({ HOME: home, HASNA_ECONOMY_API_KEY: ENV_KEY });
    expect(report.authority!.apiKeyTier).toBe("disk");
  });

  test("a world-readable credentials file is refused, not silently skipped", () => {
    const home = tempHome("disk-mode");
    writeCredentialsFile(home, `HASNA_ECONOMY_API_KEY=${DISK_KEY}\n`, 0o644);
    expect(() =>
      resolveEconomyCloudStorage({ HOME: home, HASNA_ECONOMY_API_KEY: ENV_KEY }),
    ).toThrow();
  });

  test("no file is an absent tier — the environment still decides", () => {
    const home = tempHome("disk-absent");
    const r = resolveEconomyCloudStorage({ HOME: home, HASNA_ECONOMY_API_KEY: ENV_KEY });
    expect(r.active).toBe(true);
  });
});

describe("tier ordering, end to end", () => {
  test("Keychain beats disk beats env, and each falls through when absent", () => {
    const home = tempHome("ordering");
    writeCredentialsFile(home, `HASNA_ECONOMY_API_KEY=${DISK_KEY}\n`);
    const env = { HOME: home, HASNA_ECONOMY_API_KEY: ENV_KEY };

    const withKeychain = fakeKeychain({ "hasna.credentials.economy.api-key": KEYCHAIN_KEY });
    expect(economyTransportReport(env, withKeychain.options).authority!.apiKeyTier).toBe("keychain");

    const withoutKeychain = fakeKeychain({});
    expect(economyTransportReport(env, withoutKeychain.options).authority!.apiKeyTier).toBe("disk");

    rmSync(join(home, ...CREDENTIALS_SEGMENTS));
    expect(economyTransportReport(env, withoutKeychain.options).authority!.apiKeyTier).toBe("env");
  });

  test("the default gateway applies when a credential resolves with no URL", () => {
    const home = tempHome("gateway");
    const report = economyTransportReport({ HOME: home, HASNA_ECONOMY_API_KEY: ENV_KEY });
    expect(report.ok).toBe(true);
    expect(report.authority!.apiUrlSource).toBe("default");
    expect(report.authority!.baseUrl).toBe("https://api.hasna.com/economy/v1");
  });
});

describe("the ambient gate survives blank normalisation (hasna/apps#1788)", () => {
  test("dropping declared-but-blank vars from process.env never disables the Keychain tier", () => {
    // A station shell that exports a blank alias (`HASNA_ECONOMY_API_URL=""`)
    // is still the machine's environment: the Keychain tier must stay
    // reachable across the normalised copy the resolver receives, or a
    // declared-but-blank variable would silently drop the machine from its
    // Keychain identity to the next tier (the #1788 blocker).
    const saved = {
      url: process.env["HASNA_ECONOMY_API_URL"],
      key: process.env["HASNA_ECONOMY_API_KEY"],
      home: process.env["HOME"],
    };
    try {
      process.env["HASNA_ECONOMY_API_URL"] = "";
      process.env["HASNA_ECONOMY_API_KEY"] = "";
      process.env["HOME"] = tempHome("ambient-gate");
      const keychain = fakeKeychain({ "hasna.credentials.economy.api-key": KEYCHAIN_KEY });

      const r = resolveEconomyCloudStorage(undefined, keychain.options);

      expect(r.active).toBe(true);
      expect(r.client!.baseUrl).toBe("https://api.hasna.com/economy/v1");
      // The tier was consulted across the normalised copy — the run recorded
      // its calls instead of being skipped by an identity test a copy cannot pass.
      expect(keychain.calls.length).toBeGreaterThan(0);
    } finally {
      const restore = (key: string, value: string | undefined) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      };
      restore("HASNA_ECONOMY_API_URL", saved.url);
      restore("HASNA_ECONOMY_API_KEY", saved.key);
      restore("HOME", saved.home);
    }
  });
});

describe("nothing resolves — fail closed, and leave no store behind", () => {
  test("an empty home throws, builds no client, and creates no database", () => {
    const home = tempHome("fail-closed");
    const keychain = fakeKeychain({});

    expect(() => resolveEconomyCloudStorage({ HOME: home }, keychain.options)).toThrow(/API key/i);

    // The seam throws before anything can open SQLite: no store file, and no
    // app directory conjured as a side effect of failing.
    expect(sqliteFilesUnder(home)).toEqual([]);
    expect(existsSync(join(home, ".hasna", "economy", "economy.db"))).toBe(false);
  });

  test("the transport report surfaces the same refusal instead of throwing", () => {
    const home = tempHome("fail-closed-report");
    const report = economyTransportReport({ HOME: home }, fakeKeychain({}).options);
    expect(report.ok).toBe(false);
    expect(report.transport).toBe("http");
    expect(report.authority).toBeNull();
    expect(report.issues.join(" ")).toContain("API key");
    expect(sqliteFilesUnder(home)).toEqual([]);
  });

  test("the unhosted opt-in serves sqlite WITHOUT reading the Keychain or disk", () => {
    // The isolation guarantee, asserted rather than assumed: a resolvable
    // credential exists in both stores and neither is touched.
    const home = tempHome("opt-in");
    writeCredentialsFile(home, `HASNA_ECONOMY_API_KEY=${DISK_KEY}\n`);
    const keychain = fakeKeychain({ "hasna.credentials.economy.api-key": KEYCHAIN_KEY });

    const r = resolveEconomyCloudStorage(
      { HOME: home, HASNA_ECONOMY_LOCAL: "1" },
      keychain.options,
    );
    expect(r.active).toBe(false);
    expect(r.client).toBeNull();
    expect(keychain.calls).toEqual([]);
  });

  test("a configured environment outranks the opt-in", () => {
    const home = tempHome("opt-in-outranked");
    const keychain = fakeKeychain({});
    const r = resolveEconomyCloudStorage(
      { HOME: home, HASNA_ECONOMY_LOCAL: "1", HASNA_ECONOMY_API_KEY: ENV_KEY },
      keychain.options,
    );
    expect(r.active).toBe(true);
  });
});

describe("transport report", () => {
  test("local opt-in reports the sqlite lane", () => {
    const home = tempHome("report-local");
    const report = economyTransportReport({ HOME: home, HASNA_ECONOMY_LOCAL: "1" });
    expect(report.ok).toBe(true);
    expect(report.transport).toBe("sqlite");
    expect(report.source).toBe("local-opt-in");
    expect(report.authority).toBeNull();
  });

  test("a hosted pair reports env sources, never the key value", () => {
    const home = tempHome("report-hosted");
    const report = economyTransportReport({
      HOME: home,
      HASNA_ECONOMY_API_URL: "https://economy.hasna.xyz",
      HASNA_ECONOMY_API_KEY: ENV_KEY,
    });
    expect(report.ok).toBe(true);
    expect(report.transport).toBe("http");
    expect(report.authority!.apiUrlSource).toBe("HASNA_ECONOMY_API_URL");
    expect(report.authority!.apiKeySource).toBe("HASNA_ECONOMY_API_KEY");
    expect(report.authority!.apiKeyTier).toBe("env");
    expect(JSON.stringify(report)).not.toContain(ENV_KEY);
  });

  test("an API URL without a key is reported as a refusal", () => {
    const home = tempHome("report-partial");
    const report = economyTransportReport({ HOME: home, HASNA_ECONOMY_API_URL: "https://economy.hasna.xyz" });
    expect(report.ok).toBe(false);
    expect(report.issues.join(" ")).toMatch(/API key/i);
  });
});