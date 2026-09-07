import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tempHome: string | null = null;

function testEnv(): Record<string, string> {
  tempHome = mkdtempSync(join(tmpdir(), "contacts-cli-home-"));
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
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

/** A bare `env -i`-style environment: nothing but what the resolver needs. */
function bareEnv(home: string): Record<string, string> {
  return { HOME: home, USER: "tester", PATH: process.env.PATH ?? "/usr/bin:/bin" };
}

function runContacts(args: string[], env = testEnv()) {
  return Bun.spawnSync({
    cmd: ["bun", "run", join(import.meta.dir, "index.tsx"), ...args],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
}

function stdoutText(result: ReturnType<typeof runContacts>): string {
  return new TextDecoder().decode(result.stdout);
}

function parseStdout(result: ReturnType<typeof runContacts>) {
  return JSON.parse(stdoutText(result));
}

function writeCredentialsFile(home: string, url: string, key: string): void {
  const dir = join(home, ".hasna", "contacts", "config");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "credentials");
  writeFileSync(file, `HASNA_CONTACTS_API_URL=${url}\nHASNA_CONTACTS_API_KEY=${key}\n`);
  chmodSync(file, 0o600);
}

afterEach(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
  tempHome = null;
});

describe("contacts client CLI runtime", () => {
  test("reports the local transport when no URL/key resolve, and commands work", () => {
    const env = testEnv();
    const result = runContacts(["connection", "--json"], env);
    expect(result.exitCode).toBe(0);
    expect(parseStdout(result)).toMatchObject({
      transport: "unconfigured",
      configured: false,
      misconfigured: true,
      active_transport: "local",
    });

    // An actual data command works against the local store — no refusal.
    const tags = runContacts(["tags"], env);
    expect(tags.exitCode).toBe(0);
    expect(stdoutText(tags)).toContain("No tags found.");

    const status = runContacts(["status", "--json"], env);
    expect(status.exitCode).toBe(0);
    expect(parseStdout(status)).toMatchObject({ storage: "local (sqlite)" });
  });

  test("resolves the canonical ~/.hasna/contacts/config/credentials file from a bare env", () => {
    // Mirrors a station box exactly: `env -i HOME=...` with no sourced env and
    // a credentials file at the documented location/format, so the CLI must
    // pick the hosted transport up with no other configuration.
    const tempRoot = mkdtempSync(join(tmpdir(), "contacts-bare-home-"));
    tempHome = tempRoot;
    const url = "https://contacts.example.invalid";
    writeCredentialsFile(tempRoot, url, "key-from-credentials-file");
    const env = bareEnv(tempRoot);

    const result = runContacts(["connection", "--json"], env);
    expect(result.exitCode).toBe(0);
    expect(parseStdout(result)).toMatchObject({
      transport: "https",
      configured: true,
      api_key_present: true,
      api_key_tier: "disk",
      active_transport: "api",
    });
    const status = parseStdout(result);
    expect(String(status.api_url_source)).toContain(join(".hasna", "contacts", "config", "credentials"));
    expect(String(status.api_key_source)).toContain(join(".hasna", "contacts", "config", "credentials"));
    expect(stdoutText(result)).not.toContain("key-from-credentials-file");
    expect(stdoutText(result)).not.toContain("https://contacts.example.invalid");
  });

  test("reports HTTPS without exposing the API key", () => {
    const env = testEnv();
    env.HASNA_CONTACTS_API_URL = "https://contacts.example.invalid";
    env.HASNA_CONTACTS_API_KEY = "test-key-not-a-real-secret";
    const result = runContacts(["connection", "--json"], env);
    expect(result.exitCode).toBe(0);
    expect(parseStdout(result)).toMatchObject({ transport: "https", configured: true, api_key_present: true, active_transport: "api" });
    expect(stdoutText(result)).not.toContain("contacts.example.invalid");
    expect(stdoutText(result)).not.toContain("test-key-not-a-real-secret");
  });

  test("ignores retired storage-mode and database selectors", () => {
    const env = testEnv();
    env.HASNA_CONTACTS_STORAGE_MODE = "cloud";
    env.CONTACTS_DATABASE_URL = "postgresql://client-dsn";
    // No API configuration: the switches are inert and the local store is used.
    const result = runContacts(["connection", "--json"], env);
    expect(result.exitCode).toBe(0);
    expect(parseStdout(result)).toMatchObject({ active_transport: "local" });

    // With a canonical URL+key they do not override the hosted transport either.
    const env2 = testEnv();
    env2.HASNA_CONTACTS_STORAGE_MODE = "self_hosted";
    env2.HASNA_CONTACTS_API_URL = "https://contacts.example.invalid";
    env2.HASNA_CONTACTS_API_KEY = "test-key";
    const hosted = runContacts(["connection", "--json"], env2);
    expect(hosted.exitCode).toBe(0);
    expect(parseStdout(hosted)).toMatchObject({ transport: "https", active_transport: "api" });
  });

  test("preserves a legacy database without changing or deleting its source", () => {
    const env = testEnv();
    const source = join(tempHome!, ".local", "share", "hasna", "contacts", "contacts.db");
    const output = join(tempHome!, "contacts.db.pre-https.20260901");
    mkdirSync(join(tempHome!, ".local", "share", "hasna", "contacts"), { recursive: true });
    writeFileSync(source, "legacy-payload");

    const result = runContacts(["legacy", "preserve", "--source", source, "--output", output, "--json"], env);
    expect(result.exitCode).toBe(0);
    expect(existsSync(source)).toBe(true);
    expect(readFileSync(source, "utf8")).toBe("legacy-payload");
    expect(readFileSync(output, "utf8")).toBe("legacy-payload");
    expect(statSync(output).mode & 0o777).toBe(0o600);
  });

  test("refuses a preservation copy while a SQLite sidecar is present", () => {
    const env = testEnv();
    const source = join(tempHome!, "contacts.db");
    const output = join(tempHome!, "contacts.db.preserved");
    writeFileSync(source, "legacy-payload");
    writeFileSync(`${source}-journal`, "pending-transaction");

    const result = runContacts(["legacy", "preserve", "--source", source, "--output", output, "--json"], env);
    expect(result.exitCode).not.toBe(0);
    expect(new TextDecoder().decode(result.stderr)).toContain("Legacy SQLite sidecar");
    expect(existsSync(output)).toBe(false);
    expect(readFileSync(source, "utf8")).toBe("legacy-payload");
  });

  test("refuses a symlink source without creating output", () => {
    const env = testEnv();
    const target = join(tempHome!, "real.db");
    const source = join(tempHome!, "contacts.db");
    const output = join(tempHome!, "contacts.db.preserved");
    writeFileSync(target, "legacy-payload");
    symlinkSync(target, source);
    const result = runContacts(["legacy", "preserve", "--source", source, "--output", output], env);
    expect(result.exitCode).not.toBe(0);
    expect(existsSync(output)).toBe(false);
    expect(readFileSync(target, "utf8")).toBe("legacy-payload");
  });
});