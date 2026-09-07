/**
 * Fleet storage doctrine (docs/fleet-local-storage.md) — calendar api-mode
 * behavior locks.
 *
 * In api mode (`HASNA_CALENDAR_API_URL` + `HASNA_CALENDAR_API_KEY`
 * configured) a fleet CLI must NOT create, open, or migrate any local
 * database: the hosted API is the only write path. These tests lock:
 *
 *  1. `db-migrate` (the only CLI path into the legacy SQLite layer) refuses
 *     to run in api mode and loads no local database.
 *  2. A normal api-mode command fails closed on network failure — no local
 *     fallback database is created under `~/.hasna`.
 *  3. `db-migrate` still works in LOCAL-ONLY mode (no API env) — the
 *     documented legacy migration keeps its semantics off the harness.
 *  4. The package no longer ships a `postinstall` that pre-creates
 *     `~/.hasna/calendar` on every install.
 *
 * Fail-closed without env (fleet doctrine — never a silent local fallback):
 *
 *  5. With NO credential or authority configured at all, a store-backed command
 *     fails closed (non-zero exit, error naming `HASNA_CALENDAR_API_URL`) and
 *     creates no local database — local mode is never the default.
 *  6. A URL without a key fails closed naming the missing member — never
 *     defaults to local mode. A KEY without a URL is no longer half-configured:
 *     per the 2026-09-04 resolver ruling (hasna/apps#1720) the fleet gateway
 *     `https://api.hasna.com/calendar` is the default authority once a
 *     credential resolves, so a key alone is a COMPLETE configuration.
 *  7. `--json` mode reports the same refusal as a parseable JSON error with a
 *     non-zero exit (never a false-green `exit 0` local fallback event).
 *
 * NOTE: unlike `cli/index.test.ts` these tests deliberately do NOT use the
 * `cli-domain.preload.ts` fixture (which rewrites `fetch` to a LocalStore-
 * backed server and forces the api env on). We spawn the real binary against
 * a scratch `HOME` and assert on what it leaves on disk.
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { resolveStorageClient } from "../store/http-storage.js";

const repoRoot = join(dirname(new URL(import.meta.url).pathname), "..", "..");

interface SpawnResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCalendar(args: string[], env: Record<string, string>): Promise<SpawnResult> {
  const proc = Bun.spawn({
    cmd: ["bun", "run", "src/cli/index.tsx", ...args],
    cwd: repoRoot,
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function scratchHome(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "calendar-api-mode-"));
}

test("db-migrate refuses in api mode and creates no local database", async () => {
  const home = await scratchHome();
  try {
    const result = await runCalendar(
      ["db-migrate"],
      {
        HOME: home,
        BUN_TEST: "",
        HASNA_CALENDAR_API_URL: "https://calendar.example.test",
        HASNA_CALENDAR_API_KEY: "fixture-key",
      },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toMatch(/LOCAL-ONLY|api mode|hosted API/);
    // The api mode run must leave nothing under ~/.hasna at all.
    const hasna = join(home, ".hasna");
    expect(await exists(hasna)).toBe(false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("api-mode command fails closed on network failure — no local fallback database", async () => {
  const home = await scratchHome();
  try {
    const result = await runCalendar(
      ["org-list", "--json"],
      {
        HOME: home,
        BUN_TEST: "",
        // Explicit HTTPS authority that cannot be reached: connection refused.
        HASNA_CALENDAR_API_URL: "https://127.0.0.1:1",
        HASNA_CALENDAR_API_KEY: "fixture-key",
      },
    );
    expect(result.exitCode).not.toBe(0);
    // Network/authentication failures never fall back to a domain database.
    const hasna = join(home, ".hasna");
    expect(await exists(hasna)).toBe(false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("db-migrate keeps its LOCAL-ONLY legacy semantics when no API env is configured", async () => {
  const home = await scratchHome();
  try {
    // Create the legacy home database that the one-time migration copies.
    const legacyDir = join(home, ".calendar");
    await mkdir(legacyDir, { recursive: true });
    const legacyDb = join(legacyDir, "calendar.db");
    const db = new Database(legacyDb, { create: true });
    db.run("CREATE TABLE legacy_items (id TEXT PRIMARY KEY, title TEXT)");
    db.run("INSERT INTO legacy_items VALUES ('x1', 'legacy event')");
    db.close();

    const result = await runCalendar(
      ["db-migrate"],
      { HOME: home, BUN_TEST: "" }, // no HASNA_CALENDAR_API_URL / KEY
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/Migrated/);
    // The canonical target exists and carries the source data.
    const migrated = join(home, ".hasna", "calendar", "calendar.db");
    expect(await exists(migrated)).toBe(true);
    const readback = new Database(migrated, { readonly: true });
    try {
      const rows = readback.query("SELECT title FROM legacy_items").all() as { title: string }[];
      expect(rows.map((r) => r.title)).toEqual(["legacy event"]);
    } finally {
      readback.close();
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("no API env: a store-backed command fails closed and creates no local database", async () => {
  const home = await scratchHome();
  try {
    const result = await runCalendar(
      ["org-list"],
      { HOME: home, BUN_TEST: "" }, // no HASNA_CALENDAR_API_URL / KEY
    );
    expect(result.exitCode).toBe(1);
    // Actionable error names the required fleet API env — never a silent
    // local fallback, never a false-green exit 0.
    expect(result.stdout + result.stderr).toMatch(/HASNA_CALENDAR_API_URL is required/);
    expect(result.stdout + result.stderr).not.toMatch(/local-fallback/);
    // The no-env run must leave nothing under ~/.hasna at all: local SQLite
    // (~/.hasna/calendar/calendar.db) is never opened or created by default.
    const hasna = join(home, ".hasna");
    expect(await exists(hasna)).toBe(false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("no API env: --json mode fails closed with a parseable error naming the required env", async () => {
  const home = await scratchHome();
  try {
    const result = await runCalendar(
      ["--json", "org-list"],
      { HOME: home, BUN_TEST: "" }, // no HASNA_CALENDAR_API_URL / KEY
    );
    expect(result.exitCode).toBe(1);
    const payload = JSON.parse(result.stdout) as { error: string };
    expect(payload.error).toContain("HASNA_CALENDAR_API_URL is required");
    const hasna = join(home, ".hasna");
    expect(await exists(hasna)).toBe(false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("partial API env fails closed naming the missing member — never defaults to local mode", async () => {
  const home = await scratchHome();
  try {
    // URL without key: the pair is incomplete, so the CLI must not open local
    // mode or guess a credential.
    const urlOnly = await runCalendar(
      ["org-list"],
      { HOME: home, BUN_TEST: "", HASNA_CALENDAR_API_URL: "https://calendar.example.test" },
    );
    expect(urlOnly.exitCode).toBe(1);
    expect(urlOnly.stdout + urlOnly.stderr).toMatch(/HASNA_CALENDAR_API_KEY is required/);
    expect(urlOnly.stdout + urlOnly.stderr).not.toMatch(/local-fallback/);

    // Key without URL is no longer a refusal: the fleet gateway is the default
    // authority once a credential resolves (hasna/apps#1720), so a key alone
    // is a COMPLETE configuration. The seam resolves it to the gateway; the
    // CLI then fails loudly only when the authority is unreachable — never by
    // reading local data.
    const viaGateway = resolveStorageClient("calendar", { HASNA_CALENDAR_API_KEY: "fixture-key" });
    expect(viaGateway.client.baseUrl).toBe("https://api.hasna.com/calendar/v1");
    expect(viaGateway.resolution.apiUrlSource).toBe("default");

    // The URL-only run may not create local storage.
    const hasna = join(home, ".hasna");
    expect(await exists(hasna)).toBe(false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("package has no postinstall that pre-creates ~/.hasna/calendar", async () => {
  const pkg = JSON.parse(await Bun.file(join(repoRoot, "package.json")).text()) as {
    scripts?: Record<string, string>;
  };
  // Fleet doctrine: installing in api mode must not create local storage.
  expect(pkg.scripts?.postinstall).toBeUndefined();
});

async function exists(path: string): Promise<boolean> {
  try {
    await Bun.file(path).stat();
    return true;
  } catch {
    return false;
  }
}