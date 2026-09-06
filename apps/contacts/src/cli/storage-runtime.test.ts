import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
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

afterEach(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
  tempHome = null;
});

describe("contacts canonical client CLI runtime", () => {
  test("reports unconfigured with local fallback disabled when URL/key are absent", () => {
    const result = runContacts(["connection", "--json"]);
    expect(result.exitCode).toBe(0);
    expect(parseStdout(result)).toMatchObject({
      transport: "unconfigured",
      configured: false,
      misconfigured: true,
      local_fallback: false,
    });
  });

  test("reports HTTPS without exposing the API key", () => {
    const env = testEnv();
    env.HASNA_CONTACTS_API_URL = "https://contacts.example.invalid";
    env.HASNA_CONTACTS_API_KEY = "test-key-not-a-real-secret";
    const result = runContacts(["connection", "--json"], env);
    expect(result.exitCode).toBe(0);
    expect(parseStdout(result)).toMatchObject({ transport: "https", configured: true, api_key_present: true });
    expect(stdoutText(result)).not.toContain("contacts.example.invalid");
    expect(stdoutText(result)).not.toContain("test-key-not-a-real-secret");
  });

  test("rejects a retired storage selector", () => {
    const env = testEnv();
    env.HASNA_CONTACTS_STORAGE_MODE = "cloud";
    const result = runContacts(["connection", "--json"], env);
    expect(result.exitCode).not.toBe(0);
    expect(new TextDecoder().decode(result.stderr)).toContain("RETIRED_CONTACTS_CLIENT_SELECTOR");
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
