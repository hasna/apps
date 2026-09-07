import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempHomes: string[] = [];

async function runContacts(args: string[], overrides: Record<string, string>, home?: string) {
  const env = { ...process.env } as Record<string, string>;
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
  ]) delete env[key];
  const tempHome = home ?? mkdtempSync(join(tmpdir(), "contacts-tags-home-"));
  if (!home) tempHomes.push(tempHome);
  env.HOME = tempHome;
  env.HASNA_HOME = tempHome;
  env.HASNA_STATION = "no-such-station";
  Object.assign(env, overrides);

  const child = Bun.spawn([
    process.execPath,
    "run",
    "src/cli/index.tsx",
    ...args,
  ], {
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

describe("contacts retired storage selector inertness", () => {
  test("a self_hosted mode switch never blocks or redirects a tag command", async () => {
    const env: Record<string, string> = {};
    env.HASNA_CONTACTS_STORAGE_MODE = "self_hosted";
    env.CONTACTS_STORAGE_MODE = "cloud";

    // No API key: the switch is inert and the command runs against the local
    // store (the tag is created and the bulk path resolves it by name).
    const sharedHome = mkdtempSync(join(tmpdir(), "contacts-tags-shared-"));
    tempHomes.push(sharedHome);
    const create = await runContacts(["tags", "add", "--name", "monthly-accounting"], env, sharedHome);
    expect(create.exitCode).toBe(0);
    expect(create.stderr).not.toContain("RETIRED_CONTACTS_CLIENT_SELECTOR");
    const local = await runContacts([
      "tags",
      "bulk",
      "add",
      "monthly-accounting",
      "--contact-ids",
      "contact-1",
    ], env, sharedHome);
    expect(local.exitCode).toBe(0);
    expect(local.stderr).toBe("");
    expect(local.stdout).toContain("Tagged");

    // With a canonical URL+key the same switch must leave the https transport
    // in charge (request fails on the reserved .invalid TLD — transport error
    // only, never a selector refusal).
    const hosted = await runContacts(["tags", "bulk", "add", "monthly-accounting", "--contact-ids", "contact-1"], {
      ...env,
      HASNA_CONTACTS_API_URL: "https://contacts.example.invalid",
      HASNA_CONTACTS_API_KEY: "test-key",
    });
    expect(hosted.stderr).not.toContain("RETIRED_CONTACTS_CLIENT_SELECTOR");
    expect(hosted.stderr).not.toContain("CONTACTS_API_NOT_CONFIGURED");
  });

  test("plain tags operations work on the local store with a mode switch set", async () => {
    const result = await runContacts(["tags"], {
      HASNA_CONTACTS_STORAGE_MODE: "self_hosted",
      CONTACTS_STORAGE_MODE: "cloud",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });
});