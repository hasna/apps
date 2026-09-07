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
  // tiers must be pinned away or they configure the child. An account that
  // cannot exist makes `security` exit 44 (tier absent) and an empty HASNA_HOME
  // holds no credentials file, so only the overrides configure the child.
  const tempHome = mkdtempSync(join(tmpdir(), "contacts-projects-home-"));
  tempHomes.push(tempHome);
  env.HOME = tempHome;
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
  test("works over the local SQLite store when no API configuration resolves", async () => {
    const result = await runContacts(["projects", "list", "contact-1", "--json"], {});
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain('"project_ids"');
  });

  test("uses the hosted /v1 transport when an HTTPS authority and key resolve", async () => {
    const result = await runContacts(["projects", "list", "contact-1", "--json"], {
      HASNA_CONTACTS_API_URL: "https://contacts.example.invalid",
      HASNA_CONTACTS_API_KEY: "test-key",
    });
    // The request fails (reserved .invalid TLD) but the transport itself is
    // the configured https API: the failure is a transport error, never a
    // local-store fallback or a selector refusal.
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).not.toContain("RETIRED_CONTACTS_CLIENT_SELECTOR");
    expect(result.stderr).not.toContain("CONTACTS_API_NOT_CONFIGURED");
  });

  test("ignores retired mode switches and proceeds on the local store", async () => {
    const result = await runContacts(["projects", "list", "contact-1", "--json"], {
      HASNA_CONTACTS_STORAGE_MODE: "cloud",
      CONTACTS_STORAGE_MODE: "self_hosted",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain('"project_ids"');
    // The local store lives under the temp home — nothing leaked elsewhere.
    expect(readdirSync(result.tempHome)).not.toEqual([]);
  });
});