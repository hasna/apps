import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const remoteEnv = [
  "HASNA_CONTACTS_POSTGRES_URL",
  "OPEN_CONTACTS_POSTGRES_URL",
  "CONTACTS_POSTGRES_URL",
  "HASNA_CONTACTS_DATABASE_URL",
  "CONTACTS_DATABASE_URL",
  "HASNA_CONTACTS_API_URL",
  "HASNA_CONTACTS_API_KEY",
] as const;

let tempHome: string | null = null;

function testEnv(): Record<string, string> {
  tempHome = mkdtempSync(join(tmpdir(), "contacts-cli-home-"));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  env["HOME"] = tempHome;
  delete env["USERPROFILE"];
  delete env["CONTACTS_DB_PATH"];
  delete env["HASNA_CONTACTS_DB_PATH"];
  for (const name of remoteEnv) delete env[name];
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

function parseStdout(result: ReturnType<typeof runContacts>) {
  return JSON.parse(new TextDecoder().decode(result.stdout));
}

function stdoutText(result: ReturnType<typeof runContacts>): string {
  return new TextDecoder().decode(result.stdout);
}

function mode(path: string): number {
  return statSync(path).mode & 0o777;
}

afterEach(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
  tempHome = null;
});

describe("contacts storage CLI runtime", () => {
  test("reports local transport when no client-flip env is set", () => {
    const result = runContacts(["storage", "status", "--json"]);

    expect(result.exitCode).toBe(0);
    const status = parseStdout(result);
    expect(status.transport.transport).toBe("local");
    expect(status.transport.mode).toBe("local");
    expect(status.transport.api_key_present).toBe(false);
    expect(status.local.mode).toBe("local");
  });

  test("does NOT expose any client-side Postgres DSN sync command", () => {
    // The forbidden DSN sync path (storage/cloud push|pull|sync) must be gone.
    const push = runContacts(["storage", "push", "--tables", "contacts", "--json"]);
    expect(push.exitCode).not.toBe(0);
    const cloudPush = runContacts(["cloud", "push", "--tables", "contacts", "--json"]);
    expect(cloudPush.exitCode).not.toBe(0);
  });

  test("cloud status reports cloud-http transport when API_URL + API_KEY are set (no DSN)", () => {
    const env = testEnv();
    env["HASNA_CONTACTS_API_URL"] = "https://contacts.hasna.xyz";
    env["HASNA_CONTACTS_API_KEY"] = "test-key-not-a-real-secret";

    const result = runContacts(["cloud", "status", "--json"], env);

    expect(result.exitCode).toBe(0);
    const status = parseStdout(result);
    expect(status.transport.transport).toBe("cloud-http");
    expect(status.transport.mode).toBe("cloud");
    expect(status.transport.api_key_present).toBe(true);
    // The API key value must NEVER be echoed back.
    expect(JSON.stringify(status)).not.toContain("test-key-not-a-real-secret");
  });

  test("backup checkpoints current SQLite data and writes an owner-only file", () => {
    const env = testEnv();
    const backupPath = join(tempHome!, "contacts-backup.db");

    const create = runContacts(["tags", "add", "--name", "BackupTag"], env);
    expect(create.exitCode).toBe(0);

    const backup = runContacts(["backup", "--output", backupPath], env);
    expect(backup.exitCode).toBe(0);
    expect(mode(backupPath)).toBe(0o600);

    const db = new Database(backupPath, { readonly: true });
    const row = db.query("SELECT name FROM tags WHERE name = ?").get("BackupTag") as { name: string } | null;
    db.close();

    expect(row?.name).toBe("BackupTag");
  });
});
