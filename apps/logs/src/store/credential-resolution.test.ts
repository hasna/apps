/**
 * @hasna/logs — credential-resolution: the tiers an env dictionary cannot
 * express.
 *
 * The env tier is exercised in `index.test.ts`; this file covers the macOS
 * Keychain and `~/.hasna/logs/config/credentials` disk tier through the same
 * @hasna/contracts resolver every surface calls, plus the fail-closed arm —
 * the assertion is not only the refusal but that NO SQLite file was created
 * anywhere under the run's home.
 *
 * Two seams make that possible without touching the machine's real state:
 *
 *   - the Keychain tier takes an INJECTABLE `security` runner, so "the item
 *     exists" and "the item is missing" are both first-class cases and the
 *     login keychain is never opened. Injecting a runner also switches the
 *     tier on for a caller-built env.
 *   - the disk tier is anchored on HOME (HASNA_HOME moves the root), so a
 *     temporary home is a complete hermetic filesystem for it.
 *
 * Every credential value here is a fixture string. The resolver never logs a
 * value, and neither does this file: assertions are on the SOURCE
 * (`keychain:…`, an absolute path, an env key NAME) and on observable routing.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { KeychainCommandResult } from "@hasna/contracts/client";
import {
  LOGS_APP_SLUG,
  resolveLogsTransport,
  resolveStore,
} from "./index.ts";
import { LocalStore } from "./local.ts";

const KEYCHAIN_KEY = "fixture-keychain-key";
const DISK_KEY = "fixture-disk-key";
const ENV_KEY = "fixture-env-key";
/** Deterministic Keychain account for the fixtures (station override). */
const STATION = "fixture-station";

const tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempHome(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `logs-cred-${label}-`));
  tempRoots.push(root);
  return root;
}

/** The credential file the resolver reads, at the mode it demands. */
function writeCredentialsFile(home: string, body: string, mode = 0o600): string {
  const file = join(home, ".hasna", LOGS_APP_SLUG, "config", "credentials");
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
  return {
    calls,
    options: { credentials: { keychain: { platform: "darwin", run } } } as const,
  };
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
    const keychain = fakeKeychain({ "hasna.credentials.logs.api-key": KEYCHAIN_KEY });
    const report = resolveLogsTransport(
      { HOME: tempHome("kc-only"), HASNA_STATION: STATION, USER: "tester" },
      keychain.options,
    );

    expect(report.transport).toBe("http");
    expect(report.source).toBe("default");
    expect(report.base_url).toBe("https://api.hasna.com/logs/v1");
    expect(report.api_url_present).toBe(false);
    expect(report.api_url_source).toBe("default");
    expect(report.api_key_present).toBe(true);
    expect(report.api_key_source).toBe(
      `keychain:hasna.credentials.logs.api-key@${STATION}`,
    );
    expect(report.api_key_tier).toBe("keychain");
    expect(report.local_opt_in).toBe(false);
    // Values never leak into the report.
    expect(JSON.stringify(report)).not.toContain(KEYCHAIN_KEY);
    // The tier was truly consulted.
    expect(keychain.calls.length).toBeGreaterThan(0);
  });

  test("an api-url item alongside the key pins the authority", () => {
    const keychain = fakeKeychain({
      "hasna.credentials.logs.api-key": KEYCHAIN_KEY,
      "hasna.credentials.logs.api-url": "https://logs.example.com",
    });
    const report = resolveLogsTransport(
      { HOME: tempHome("kc-url"), HASNA_STATION: STATION },
      keychain.options,
    );

    expect(report.transport).toBe("http");
    expect(report.base_url).toBe("https://logs.example.com/v1");
    expect(report.api_url_present).toBe(true);
    expect(report.api_url_source).toBe(
      `keychain:hasna.credentials.logs.api-url@${STATION}`,
    );
    expect(report.api_key_source).toBe(
      `keychain:hasna.credentials.logs.api-key@${STATION}`,
    );
  });

  test("an absent item leaves the run host-mode-unresolvable (no local fallback without opt-in)", () => {
    const keychain = fakeKeychain({});
    const home = tempHome("kc-miss");
    expect(() =>
      resolveLogsTransport({ HOME: home, HASNA_STATION: STATION }, keychain.options),
    ).toThrow(/no API key could be resolved/);
    expect(sqliteFilesUnder(home)).toEqual([]);
  });

  test("a failing security invocation is a REFUSAL, never a fallthrough", () => {
    const run = (): KeychainCommandResult => ({
      status: 1,
      stdout: "",
      stderr: "security: item is locked",
    });
    const home = tempHome("kc-locked");
    expect(() =>
      resolveLogsTransport(
        { HOME: home, HASNA_STATION: STATION },
        { credentials: { keychain: { platform: "darwin", run } } },
      ),
    ).toThrow(/could not be read|failed/);
    expect(sqliteFilesUnder(home)).toEqual([]);
  });
});

describe("tier 4 — the on-disk credential file", () => {
  test("a key in ~/.hasna/logs/config/credentials resolves the fleet gateway", () => {
    const home = tempHome("disk-key");
    const file = writeCredentialsFile(
      home,
      `HASNA_LOGS_API_KEY=${DISK_KEY}\n`,
    );
    const report = resolveLogsTransport({ HOME: home });

    expect(report.transport).toBe("http");
    expect(report.base_url).toBe("https://api.hasna.com/logs/v1");
    expect(report.api_key_present).toBe(true);
    expect(report.api_key_source).toBe(file);
    expect(report.api_key_tier).toBe("disk");
    expect(JSON.stringify(report)).not.toContain(DISK_KEY);
  });

  test("a file-supplied URL wins over the default gateway", () => {
    const home = tempHome("disk-url");
    const file = writeCredentialsFile(
      home,
      `HASNA_LOGS_API_URL=https://logs.disk.example\nHASNA_LOGS_API_KEY=${DISK_KEY}\n`,
    );
    const report = resolveLogsTransport({ HOME: home });

    expect(report.base_url).toBe("https://logs.disk.example/v1");
    expect(report.api_url_source).toBe(file);
    expect(report.api_url_present).toBe(true);
  });

  test("HASNA_HOME moves the disk tier root", () => {
    const home = tempHome("disk-hh");
    // HASNA_HOME REPLACES the `~/.hasna` root, so the file sits directly
    // under it (no `.hasna` segment).
    const file = join(home, "logs", "config", "credentials");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `HASNA_LOGS_API_KEY=${DISK_KEY}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
    const report = resolveLogsTransport({ HOME: tempHome("disk-other"), HASNA_HOME: home });

    expect(report.api_key_source).toBe(file);
    expect(report.api_key_tier).toBe("disk");
  });

  test("an unreadable-mode file is a REFUSAL, never an absence", () => {
    const home = tempHome("disk-mode");
    writeCredentialsFile(home, `HASNA_LOGS_API_KEY=${DISK_KEY}\n`, 0o644);
    expect(() => resolveLogsTransport({ HOME: home })).toThrow(/owner-only|permissions/i);
  });
});

describe("precedence between the tiers", () => {
  test("Keychain beats disk beats env (a higher tier wins a dispute)", () => {
    const home = tempHome("prec");
    writeCredentialsFile(home, `HASNA_LOGS_API_KEY=${DISK_KEY}\n`);
    const keychain = fakeKeychain({
      "hasna.credentials.logs.api-key": KEYCHAIN_KEY,
    });
    const report = resolveLogsTransport(
      { HOME: home, HASNA_STATION: STATION, HASNA_LOGS_API_KEY: ENV_KEY },
      keychain.options,
    );

    expect(report.transport).toBe("http");
    expect(report.api_key_source).toBe(
      `keychain:hasna.credentials.logs.api-key@${STATION}`,
    );
    expect(report.api_key_tier).toBe("keychain");
  });

  test("disk beats env; the disk source is the absolute path", () => {
    const home = tempHome("prec-disk");
    const file = writeCredentialsFile(
      home,
      `HASNA_LOGS_API_KEY=${DISK_KEY}\n`,
    );
    const report = resolveLogsTransport({ HOME: home, HASNA_LOGS_API_KEY: ENV_KEY });

    expect(report.api_key_source).toBe(file);
    expect(report.api_key_tier).toBe("disk");
  });
});

describe("fail-closed through the store, on the tiers", () => {
  test("no credential from ANY tier + no opt-in: refusal, no SQLite anywhere", () => {
    const home = tempHome("failclosed");
    expect(() => resolveStore({ HOME: home })).toThrow(/HASNA_LOGS_API_KEY/);
    expect(sqliteFilesUnder(home)).toEqual([]);
  });

  test("hosted with a resolved credential: the store is never local, no local db", () => {
    const home = tempHome("hosted-local");
    // The explicit opt-in is present, but the credential still resolves — a
    // station that holds a hosted key stays hosted; the opt-in never overrides
    // a configured run.
    const store = resolveStore({
      HOME: home,
      HASNA_LOGS_LOCAL: "1",
      HASNA_LOGS_API_KEY: ENV_KEY,
    });
    expect(store).not.toBeInstanceOf(LocalStore);
    expect(sqliteFilesUnder(home)).toEqual([]);
  });
});