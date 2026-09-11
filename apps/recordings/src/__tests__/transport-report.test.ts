/**
 * The transport REPORT surface (`recordings check` reads it): which store is
 * live, WHERE the credential and authority came from — env key NAMES, Keychain
 * item references, file PATHS, never values — and the fail-closed refusal when
 * nothing resolves.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KeychainCommandResult } from "@hasna/contracts/client";
import {
  activeStoreFailClosed,
  describeActiveStore,
  describeActiveStoreLine,
} from "../lib/persistence-probe.js";
import type { RecordingsConfig } from "../types/index.js";
import type { RecordsClientResolveOptions, RecordsKeychainTierOptions } from "../http/client.js";

const FAKE_KEY = "fixture-report-key-dont-log";

const tempRoots: string[] = [];
afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempHome(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `recordings-report-${label}-`));
  tempRoots.push(root);
  return root;
}

function configFor(home: string): RecordingsConfig {
  return { db_path: join(home, ".hasna", "recordings", "recordings.db") } as unknown as RecordingsConfig;
}

function writeCredentialsFile(home: string, body: string): string {
  const file = join(home, ".hasna", "recordings", "config", "credentials");
  mkdirSync(join(home, ".hasna", "recordings", "config"), { recursive: true });
  writeFileSync(file, body, { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

function fakeKeychain(items: Record<string, string>): RecordsClientResolveOptions {
  const run = (argv: readonly string[]): KeychainCommandResult => {
    const service = argv[argv.indexOf("-s") + 1] ?? "";
    const value = items[service];
    if (value === undefined) return { status: 44, stdout: "", stderr: "" };
    return { status: 0, stdout: `${value}\n`, stderr: "" };
  };
  return { credentials: { keychain: { platform: "darwin", run } as RecordsKeychainTierOptions } };
}

describe("describeActiveStore — the transport report", () => {
  test("an env-tier credential reports the env key NAMES and the snapshot warning", async () => {
    const home = tempHome("env");
    const description = await describeActiveStore(configFor(home), {
      HOME: home,
      HASNA_RECORDINGS_API_URL: "https://recordings.report.example",
      HASNA_RECORDINGS_API_KEY: FAKE_KEY,
    });

    expect(description.transport).toBe("http");
    expect(description.mode_source).toContain("HASNA_RECORDINGS_API_KEY");
    expect(description.mode_source).toContain("HASNA_RECORDINGS_API_URL");
    expect(description.base_url).toBe("https://recordings.report.example/v1");
    // An env credential is a shell snapshot: the report says so and points at
    // the stores that are re-read on every call.
    expect(description.warning).toContain("snapshot");
    expect(description.warning).toContain("hasna.credentials.recordings.api-key");
    expect(description.warning).toContain("config/credentials");
  });

  test("a disk-tier credential reports the file PATH, and it resolves the authority from the same file", async () => {
    const home = tempHome("disk");
    const file = writeCredentialsFile(
      home,
      `HASNA_RECORDINGS_API_KEY=${FAKE_KEY}\nHASNA_RECORDINGS_API_URL=https://recordings.disk.example\n`,
    );
    const description = await describeActiveStore(configFor(home), { HOME: home });

    expect(description.transport).toBe("http");
    expect(description.mode_source).toBe(`${file}+${file}`);
    expect(description.base_url).toBe("https://recordings.disk.example/v1");
    // No snapshot warning for a disk credential: it is re-read per call, and
    // with no legacy local DB there is nothing else to warn about.
    expect(description.warning).toBeNull();
  });

  test("a Keychain-tier credential reports the item reference", async () => {
    const home = tempHome("keychain");
    const description = await describeActiveStore(configFor(home), {
      HOME: home,
      HASNA_RECORDINGS_API_KEY: FAKE_KEY,
    }, fakeKeychain({ "hasna.credentials.recordings.api-key": "fixture-kc-value" }));

    // Keychain outranks env, so the report names the item.
    expect(description.transport).toBe("http");
    expect(description.mode_source).toMatch(/^keychain:hasna\.credentials\.recordings\.api-key@/);
  });

  test("the local opt-in reports 'local-opt-in' and no refusal", async () => {
    const home = tempHome("opt-in");
    const description = await describeActiveStore(configFor(home), {
      HOME: home,
      HASNA_RECORDINGS_LOCAL: "1",
    });

    expect(description.transport).toBe("sqlite");
    expect(description.mode_source).toBe("local-opt-in");
    expect(description.base_url).toBeNull();
    expect(description.warning).toBeNull();
  });

  test("nothing resolves -> 'unresolved' with the fail-closed refusal naming the opt-in", async () => {
    const home = tempHome("unresolved");
    const description = await describeActiveStore(configFor(home), { HOME: home });

    expect(description.transport).toBe("none");
    expect(description.mode_source).toBe("unresolved");
    expect(description.warning).toContain("REMOTE_API_CONFIG_MISSING");
    expect(description.warning).toContain("HASNA_RECORDINGS_LOCAL=1");
    // A fail-closed refusal has no active store at all, and its report must
    // not have opened the on-box file to count it.
    expect(description.base_url).toBeNull();
    expect(description.local_db_recordings).toBeNull();
    // No database file is conjured by reporting.
    expect(existsSync(join(home, ".hasna", "recordings", "recordings.db"))).toBe(false);
  });

  test("the fail-closed refusal renders a FAIL line that names the unopened file", async () => {
    const paint = { pass: (t: string) => t, warn: (t: string) => t, fail: (t: string) => t };
    const home = tempHome("fail-line");

    const absent = await describeActiveStore(configFor(home), { HOME: home });
    expect(activeStoreFailClosed(absent)).toBe(true);
    expect(describeActiveStoreLine(absent, paint)).toContain(
      "✗ Active store: none — fail-closed"
    );
    expect(describeActiveStoreLine(absent, paint)).toContain("absent");
    expect(describeActiveStoreLine(absent, paint)).toContain("REMOTE_API_CONFIG_MISSING");

    // With an existing on-box file the line says it is present but NOT opened.
    const dbPath = join(home, ".hasna", "recordings", "recordings.db");
    mkdirSync(join(home, ".hasna", "recordings"), { recursive: true });
    writeFileSync(dbPath, "stale");
    const present = await describeActiveStore(configFor(home), { HOME: home });
    expect(describeActiveStoreLine(present, paint)).toContain("is present but NOT opened");
  });

  test("the hosted resolution renders a PASS line naming the resolver sources", async () => {
    const paint = { pass: (t: string) => t, warn: (t: string) => t, fail: (t: string) => t };
    const home = tempHome("hosted-line");
    const description = await describeActiveStore(configFor(home), {
      HOME: home,
      HASNA_RECORDINGS_API_URL: "https://recordings.line.example",
      HASNA_RECORDINGS_API_KEY: FAKE_KEY,
    });

    expect(activeStoreFailClosed(description)).toBe(false);
    const line = describeActiveStoreLine(description, paint);
    expect(line).toContain("✓ Active store: http → https://recordings.line.example/v1");
    expect(line).toContain("HASNA_RECORDINGS_API_KEY");
  });

  test("the local opt-in renders a PASS line naming the on-box file", async () => {
    const paint = { pass: (t: string) => t, warn: (t: string) => t, fail: (t: string) => t };
    const home = tempHome("opt-in-line");
    const description = await describeActiveStore(configFor(home), {
      HOME: home,
      HASNA_RECORDINGS_LOCAL: "1",
    });

    expect(activeStoreFailClosed(description)).toBe(false);
    const line = describeActiveStoreLine(description, paint);
    expect(line).toContain("✓ Active store: sqlite →");
    expect(line).toContain("local-opt-in");
  });

  test("never puts the key value anywhere in the report", async () => {
    const home = tempHome("redaction");
    const description = await describeActiveStore(configFor(home), {
      HOME: home,
      HASNA_RECORDINGS_API_URL: "https://recordings.report.example",
      HASNA_RECORDINGS_API_KEY: FAKE_KEY,
    });
    expect(JSON.stringify(description)).not.toContain(FAKE_KEY);
  });
});