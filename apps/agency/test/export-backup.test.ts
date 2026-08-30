/**
 * Regression tests for O15-05161 (2026-08-30) — @hasna/agency export/backup
 * P1/P2 defects, live-gate verified against published 0.3.3:
 *
 *  - P1: `export --format json` aborts rc=1 on empty tables. sqlite3 -json
 *    emits 0 bytes for a table with no rows, so JSON.parse('') throws; the
 *    CSV fallback is ALSO empty for zero rows (no header line), so the table
 *    is reported FAILED and the whole export exits 1.
 *  - P2: `backup restore --dry-run` rejects every real backup. spawnSafe's
 *    execFileSync carries no maxBuffer; the 1MiB Node default kills `tar
 *    -tzf` listings of real archives with ERR_CHILD_PROCESS_STDIO_MAXBUFFER,
 *    which listTarball misreports as "Invalid or unreadable backup archive".
 *  - P3: `export --format tarball` / `backup create` capture only the XDG
 *    symlink. tar without -h archives the symlink entry, not its target, so
 *    a restored export is a set of broken links with zero data.
 */
import { describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, symlinkSync, lstatSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { listTarball } from "../src/utils.js";

const PKG_ROOT = join(import.meta.dir, "..");
const BIN = join(PKG_ROOT, "dist", "index.js");

function runCli(
  args: string[],
  env: Record<string, string> = {},
  cwd = PKG_ROOT,
): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync("bun", [BIN, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, stdout, stderr: "" };
  } catch (e: unknown) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

/** A hermetic fake $HOME with an empty ~/.hasna. */
function makeFakeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "agency-home-"));
  mkdirSync(join(home, ".hasna"), { recursive: true });
  return home;
}

/** Creates a sqlite db at <dir>/test.db from `ddl`. */
function makeDb(dir: string, ddl: string): void {
  mkdirSync(dir, { recursive: true });
  execFileSync("sqlite3", [join(dir, "test.db"), ddl], { stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Builds a tar.gz whose LISTING exceeds 1 MiB (the Node execFileSync default
 * maxBuffer that kills the pre-fix listing), so the archive is real but the
 * pre-fix verification dies with a buffer error misreported as corruption.
 */
function makeBigArchive(workDir: string): string {
  const big = join(workDir, "big");
  mkdirSync(big, { recursive: true });
  const longName = "x".repeat(200);
  const COUNT = 7000;
  for (let d = 0; d < 90; d++) {
    mkdirSync(join(big, `d${d}`), { recursive: true });
  }
  for (let i = 0; i < COUNT; i++) {
    writeFileSync(join(big, `d${i % 90}`, `${longName}_${i}.txt`), "x");
  }
  const archive = join(workDir, "big-backup.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", big, "."], { stdio: ["ignore", "pipe", "pipe"] });
  return archive;
}

/** Extracts `archive` into <workDir>/extracted and returns that dir. */
function extract(archive: string, workDir: string): string {
  const extractDir = join(workDir, "extracted");
  mkdirSync(extractDir, { recursive: true });
  execFileSync("tar", ["-xzf", archive, "-C", extractDir], { stdio: ["ignore", "pipe", "pipe"] });
  return extractDir;
}

describe("O15-05161 P1: export --format json survives empty tables", () => {
  test(
    "a database with an empty table exports rc=0 with the empty table as []",
    () => {
      const home = makeFakeHome();
      makeDb(
        join(home, ".hasna", "todos"),
        "CREATE TABLE empty_table (id INTEGER PRIMARY KEY, name TEXT);" +
          "CREATE TABLE full_table (id INTEGER PRIMARY KEY, name TEXT);" +
          "INSERT INTO full_table VALUES (1, 'a'), (2, 'b');",
      );
      const out = join(home, "out.tar.gz");
      const res = runCli(["export", "--format", "json", "--output", out], { HOME: home });
      expect(res.code).toBe(0);
      // The empty table must NOT be reported as failed; the export must not abort.
      expect(res.stdout).not.toContain("FAILED to export");
      const extractDir = extract(out, home);
      const emptyJson = JSON.parse(readFileSync(join(extractDir, "todos", "test", "empty_table.json"), "utf8"));
      expect(emptyJson).toEqual([]);
      const fullJson = JSON.parse(readFileSync(join(extractDir, "todos", "test", "full_table.json"), "utf8"));
      expect(fullJson.length).toBe(2);
    },
    120_000,
  );
});

describe("O15-05161 P2: backup restore accepts real backups with >1MiB listings", () => {
  test(
    "listTarball returns a >1MiB listing instead of null (maxBuffer fix)",
    () => {
      const workDir = mkdtempSync(join(tmpdir(), "agency-big-"));
      const archive = makeBigArchive(workDir);
      const listing = listTarball(archive, 30);
      expect(listing).not.toBeNull();
      expect(listing!.split("\n").filter(Boolean).length).toBe(30);
    },
    120_000,
  );

  test(
    "backup restore --dry-run accepts a real archive with a >1MiB listing",
    () => {
      const home = makeFakeHome();
      const workDir = mkdtempSync(join(tmpdir(), "agency-big-"));
      const archive = makeBigArchive(workDir);
      const res = runCli(["backup", "restore", archive, "--dry-run"], { HOME: home });
      expect(res.code).toBe(0);
      expect(res.stdout).not.toContain("Invalid or unreadable backup archive");
      expect(res.stdout).toContain("Dry run — no changes made.");
    },
    120_000,
  );
});

describe("O15-05161 P3: export/backup dereference XDG symlinks", () => {
  test(
    "tarball export contains the symlink target's content, not just the link",
    () => {
      const home = makeFakeHome();
      const xdg = join(home, "xdg-real");
      mkdirSync(join(xdg, "sessions"), { recursive: true });
      writeFileSync(join(xdg, "sessions", "s1.json"), "payload");
      symlinkSync(join(xdg, "sessions"), join(home, ".hasna", "sessions"));
      const out = join(home, "out.tar.gz");
      const res = runCli(["export", "--format", "tarball", "--output", out], { HOME: home });
      expect(res.code).toBe(0);
      const extractDir = extract(out, home);
      // The archive must contain the CONTENT, not the symlink entry: after
      // extraction `sessions` is a real directory (lstat — a link would
      // "resolve" here because its absolute target exists in the test env,
      // masking the defect). Content read pins the dereferenced file.
      expect(lstatSync(join(extractDir, "sessions")).isSymbolicLink()).toBe(false);
      expect(readFileSync(join(extractDir, "sessions", "s1.json"), "utf8")).toBe("payload");
    },
    120_000,
  );

  test(
    "backup create includes the symlink target's content",
    () => {
      const home = makeFakeHome();
      const xdg = join(home, "xdg-real");
      mkdirSync(join(xdg, "sessions"), { recursive: true });
      writeFileSync(join(xdg, "sessions", "s1.json"), "payload");
      symlinkSync(join(xdg, "sessions"), join(home, ".hasna", "sessions"));
      const out = join(home, "backup.tar.gz");
      const res = runCli(["backup", "create", "--output", out], { HOME: home });
      expect(res.code).toBe(0);
      const extractDir = extract(out, home);
      expect(lstatSync(join(extractDir, "sessions")).isSymbolicLink()).toBe(false);
      expect(readFileSync(join(extractDir, "sessions", "s1.json"), "utf8")).toBe("payload");
    },
    120_000,
  );
});
