import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempHomes: string[] = [];

async function runContacts(args: string[], overrides: Record<string, string>) {
  const env = { ...process.env } as Record<string, string>;
  for (const key of [
    "HASNA_CONTACTS_API_URL",
    "CONTACTS_API_URL",
    "HASNA_CONTACTS_API_KEY",
    "CONTACTS_API_KEY",
    "HASNA_CONTACTS_API_KEY_OVERRIDE",
    "HASNA_CONTACTS_API_KEY_REF",
    "HASNA_PROFILE",
    "HASNA_CONFIG_HOME",
    "HASNA_CONTACTS_STORAGE_MODE",
    "CONTACTS_STORAGE_MODE",
    "HASNA_CONTACTS_DB_PATH",
    "CONTACTS_DB_PATH",
    "HASNA_CONTACTS_DATABASE_URL",
    "CONTACTS_DATABASE_URL",
  ]) delete env[key];
  // The child resolves on its own live process.env, so the station's ambient
  // tiers must be pinned away or they configure the child: a populated Mac
  // Keychain api-url disagreed with the loopback URL below and the shared
  // resolver refused (CONTACTS_API_NOT_CONFIGURED, "select different service
  // authorities") before the HTTPS check ever ran. An account that cannot
  // exist makes `security` exit 44 (tier absent) and an empty HASNA_HOME
  // holds no credentials file, so only the overrides configure the child.
  const tempHome = mkdtempSync(join(tmpdir(), "contacts-projects-home-"));
  tempHomes.push(tempHome);
  env.HASNA_HOME = tempHome;
  env.HASNA_STATION = "no-such-station";
  Object.assign(env, overrides);
  const child = Bun.spawn([process.execPath, "run", "src/cli/index.tsx", ...args], {
    cwd: import.meta.dir + "/../..",
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr, tempHome };
}

afterEach(() => {
  for (const tempHome of tempHomes.splice(0)) rmSync(tempHome, { recursive: true, force: true });
});

describe("contacts project client transport", () => {
  test("refuses plaintext loopback instead of falling back to local state", async () => {
    const result = await runContacts(["projects", "list", "contact-1", "--json"], {
      HASNA_CONTACTS_API_URL: "http://127.0.0.1:54321",
      HASNA_CONTACTS_API_KEY: "test-key",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("CONTACTS_API_HTTPS_REQUIRED");
    expect(result.stdout).toBe("");
  });

  test("fails closed with no credential: non-zero exit, no data, nothing written under HASNA_HOME", async () => {
    const result = await runContacts(["projects", "list", "contact-1", "--json"], {});
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("CONTACTS_API_NOT_CONFIGURED");
    expect(result.stderr).not.toContain("local-fallback");
    expect(result.stdout).toBe("");
    expect(readdirSync(result.tempHome)).toEqual([]);
  });
});
