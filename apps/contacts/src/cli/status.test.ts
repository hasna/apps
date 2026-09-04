import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
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
  ]) delete env[key];
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
      api: "https://contacts.example.invalid",
      error: expect.any(String),
    });
    expect(report.storage).not.toBe("unconfigured");
    expect(report.counts).toBeUndefined();
  });

  test("reports cloud storage and counts when the API responds", async () => {
    const result = runStatus(["status", "--json"], testEnv(), true);

    expect(result.exitCode).toBe(0);
    const report = parseStdout(result);
    expect(report).toMatchObject({
      service: "contacts",
      storage: "cloud (/v1)",
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
