import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// `contacts status` is the drift-observability surface for the fleet bin-naming
// wave (hasna/apps#1602): it must report "unconfigured" ONLY when no API
// configuration exists, and must never crash at startup from a bundled
// package.json require. These tests run the real CLI entry (src/cli/index.tsx)
// in a child process, exactly as the published artifact would run it.

const PRELOAD = join(import.meta.dir, "status-domain.preload.ts");

let tempHome: string | null = null;

function testEnv(): Record<string, string> {
  tempHome = mkdtempSync(join(tmpdir(), "contacts-status-home-"));
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  env.HOME = tempHome;
  delete env.USERPROFILE;
  for (const key of [
    "HASNA_CONTACTS_API_URL",
    "CONTACTS_API_URL",
    "HASNA_CONTACTS_API_KEY",
    "CONTACTS_API_KEY",
    "HASNA_CONTACTS_STORAGE_MODE",
    "CONTACTS_STORAGE_MODE",
    "HASNA_CONTACTS_DB_PATH",
    "CONTACTS_DB_PATH",
    "HASNA_CONTACTS_DATABASE_URL",
    "CONTACTS_DATABASE_URL",
    "HASNA_CONTACTS_API_KEY_OVERRIDE",
    "HASNA_CONTACTS_API_KEY_REF",
    "HASNA_PROFILE",
    "HASNA_CONFIG_HOME",
  ]) delete env[key];
  // Hermetic against the station's ambient tiers: an absent Keychain account
  // (`security` exits 44 → tier absent) and an empty HASNA_HOME with no
  // credentials file, so only what a test sets configures the child.
  env.HASNA_HOME = tempHome;
  env.HASNA_STATION = "no-such-station";
  return env;
}

function runStatus(args: string[], env: Record<string, string>, useFixture: boolean): ReturnType<typeof Bun.spawnSync> {
  const cmd = useFixture
    ? ["bun", "run", "--preload", PRELOAD, join(import.meta.dir, "index.tsx"), ...args]
    : ["bun", "run", join(import.meta.dir, "index.tsx"), ...args];
  return Bun.spawnSync({ cmd, env, stdout: "pipe", stderr: "pipe" });
}

function stdoutText(result: ReturnType<typeof runStatus>): string {
  return new TextDecoder().decode(result.stdout);
}

function parseStdout(result: ReturnType<typeof runStatus>): Record<string, unknown> {
  return JSON.parse(stdoutText(result)) as Record<string, unknown>;
}

afterEach(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
  tempHome = null;
});

describe("contacts status CLI", () => {
  test("answers cleanly (never crashes) when the box is unconfigured", () => {
    const result = runStatus(["status", "--json"], testEnv(), false);

    expect(result.exitCode).toBe(0);
    const report = parseStdout(result);
    expect(report).toMatchObject({
      service: "contacts",
      version: expect.any(String),
      storage: "unconfigured",
      api: expect.stringContaining("(not configured"),
      api_url_source: null,
      api_key_source: null,
      api_key_tier: null,
    });
    expect(report.counts).toBeUndefined();
    expect(report.error).toBeUndefined();

    const text = runStatus(["status"], testEnv(), false);
    expect(text.exitCode).toBe(0);
    expect(stdoutText(text)).toContain("Storage:  unconfigured");
  });

  test("reports a transport error, not unconfigured, when a configured request fails", () => {
    const env = testEnv();
    // RFC 2606 reserved .invalid TLD: DNS can never resolve it, so the request
    // fails fast and deterministically on an otherwise fully configured box.
    env.HASNA_CONTACTS_API_URL = "https://contacts.example.invalid";
    env.HASNA_CONTACTS_API_KEY = "status-fixture-key";

    const result = runStatus(["status", "--json"], env, false);

    expect(result.exitCode).toBe(0);
    const report = parseStdout(result);
    expect(report).toMatchObject({
      service: "contacts",
      version: expect.any(String),
      storage: "error",
      // The RESOLVED /v1 base URL the client sends to, plus where each half
      // came from — names only, never a value.
      api: "https://contacts.example.invalid/v1",
      api_url_source: "HASNA_CONTACTS_API_URL",
      api_key_source: "HASNA_CONTACTS_API_KEY",
      api_key_tier: "env",
      error: expect.any(String),
    });
    expect(report.storage).not.toBe("unconfigured");
    expect(report.counts).toBeUndefined();
    expect(stdoutText(result)).not.toContain("status-fixture-key");
  });

  test("reports the resolved authority and the disk tier under HASNA_HOME by source, never by value", () => {
    const env = testEnv();
    env.HASNA_CONTACTS_API_URL = "https://contacts.example.invalid";
    const dir = join(env.HASNA_HOME!, "contacts", "config");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "credentials"), "HASNA_CONTACTS_API_KEY=disk-key-not-a-real-secret\n");
    chmodSync(join(dir, "credentials"), 0o600);

    const result = runStatus(["status", "--json"], env, false);
    expect(result.exitCode).toBe(0);
    const report = parseStdout(result);
    expect(report).toMatchObject({
      storage: "error",
      api: "https://contacts.example.invalid/v1",
      api_url_source: "HASNA_CONTACTS_API_URL",
      api_key_tier: "disk",
    });
    expect(String(report.api_key_source)).toContain(join("contacts", "config", "credentials"));
    expect(stdoutText(result)).not.toContain("disk-key-not-a-real-secret");

    const text = runStatus(["status"], env, false);
    expect(text.exitCode).toBe(0);
    expect(stdoutText(text)).toContain("API:      https://contacts.example.invalid/v1");
    expect(stdoutText(text)).toContain("API key source: ");
    expect(stdoutText(text)).toContain("(disk)");
    expect(stdoutText(text)).not.toContain("disk-key-not-a-real-secret");
  });

  test("reports cloud storage and counts when the API responds", async () => {
    const result = runStatus(["status", "--json"], testEnv(), true);

    expect(result.exitCode).toBe(0);
    const report = parseStdout(result);
    expect(report).toMatchObject({
      service: "contacts",
      storage: "cloud (/v1)",
      api: "https://contacts.example.test/v1",
      api_url_source: "HASNA_CONTACTS_API_URL",
      api_key_source: "HASNA_CONTACTS_API_KEY",
      counts: { contacts: 2, companies: 1 },
    });
    expect(report.error).toBeUndefined();
    // The reported version comes from src/cli/index.tsx reading
    // apps/contacts/package.json (../../package.json at CLI depth) — the
    // bundle-safe depth the artifact ships with.
    const packageJson = (await Bun.file(join(import.meta.dir, "..", "..", "package.json")).json()) as { version: string };
    expect(report.version).toBe(packageJson.version);
  });
});
