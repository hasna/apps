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
  test("reports local-first storage and unconfigured repo-owned remote sync", () => {
    const result = runContacts(["storage", "status", "--json"]);

    expect(result.exitCode).toBe(0);
    const status = parseStdout(result);
    expect(status.mode).toBe("local-first");
    expect(status.local.mode).toBe("local");
    expect(status.remote.configured).toBe(false);
    expect(status.remote.env).toContain("HASNA_CONTACTS_POSTGRES_URL");
  });

  test("storage push fails closed with a JSON missing-remote error", () => {
    const result = runContacts(["storage", "push", "--tables", "contacts", "--json"]);

    expect(result.exitCode).toBe(1);
    const payload = parseStdout(result);
    expect(payload.ok).toBe(false);
    expect(payload.mode).toBe("local-first");
    expect(payload.error).toContain("Missing contacts remote database URL");
  });

  test("cloud push compatibility alias uses the same repo-owned missing-remote path", () => {
    const result = runContacts(["cloud", "push", "--tables", "contacts", "--json"]);

    expect(result.exitCode).toBe(1);
    const payload = parseStdout(result);
    expect(payload.ok).toBe(false);
    expect(payload.error).toContain("Missing contacts remote database URL");
  });

  test("cloud status human output reports configured remote sync when an env URL is present", () => {
    const env = testEnv();
    env["HASNA_CONTACTS_POSTGRES_URL"] = "postgres://user:pass@db.example.com:5432/contacts";

    const result = runContacts(["cloud", "status"], env);

    expect(result.exitCode).toBe(0);
    const output = stdoutText(result);
    expect(output).toContain("Remote sync: configured");
    expect(output).not.toContain("Remote sync: not configured");
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
