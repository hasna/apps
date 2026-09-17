/**
 * Fail-closed transport tests for the `files` CLI.
 *
 * A fleet CLI must NEVER silently fall back to the on-box SQLite store when no
 * hosted credential resolves: no `~/.hasna/files/files.db` on first use, no
 * false-green local session, no local mode as a default. Local mode is
 * reachable only through the explicit opt-in (HASNA_FILES_LOCAL=1 /
 * FILES_LOCAL=1) — the retired `HASNA_FILES_LOCAL_MODE` /
 * `FILES_LOCAL_MODE` switches are gone — and every local run prints one
 * "LOCAL mode" line on stderr so an unhosted run is never mistaken for an
 * empty hosted one.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const repoRoot = join(import.meta.dir, "..", "..");
const cliPath = join(repoRoot, "src", "cli", "index.tsx");
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function makeDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "files-cli-failclosed-"));
  tempDirs.push(dir);
  return dir;
}

/** Spawn env with the hosted keys AND the local opt-in stripped, and the
 *  credential stores faked to the temp dir so the disk tier is hermetic. */
function unconfiguredEnv(dataDir: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of [
    "HASNA_FILES_API_URL",
    "FILES_API_URL",
    "HASNA_FILES_API_KEY",
    "FILES_API_KEY",
    "HASNA_FILES_LOCAL",
    "FILES_LOCAL",
    "HASNA_FILES_LOCAL_MODE",
    "FILES_LOCAL_MODE",
    "HASNA_FILES_STORAGE_MODE",
    "HASNA_PROFILE",
    "HASNA_FILES_API_KEY_OVERRIDE",
    "HASNA_FILES_API_KEY_REF",
  ]) {
    delete env[key];
  }
  return {
    ...env,
    HOME: dataDir,
    HASNA_HOME: dataDir,
    HASNA_FILES_DATA_DIR: dataDir,
    HASNA_FILES_DB_PATH: join(dataDir, "files.db"),
  };
}

describe("files CLI transport gate (fail closed)", () => {
  test("refuses to run a data-plane command without a resolvable credential or a local opt-in", async () => {
    const dataDir = makeDataDir();
    const proc = Bun.spawn({
      cmd: ["bun", "run", cliPath, "sources", "list"],
      cwd: repoRoot,
      env: unconfiguredEnv(dataDir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stdout).toBe("");
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("REMOTE_API_CONFIG_MISSING");
    expect(stderr).toContain("HASNA_FILES_API_URL");
    expect(stderr).toContain("no local fallback");
    // Fail closed BEFORE any local store opens: no on-disk SQLite, no false green.
    await expect(Bun.file(join(dataDir, "files.db")).exists()).resolves.toBe(false);
  });

  test("keeps --help available when unconfigured", async () => {
    const dataDir = makeDataDir();
    const proc = Bun.spawn({
      cmd: ["bun", "run", cliPath, "--help"],
      cwd: repoRoot,
      env: unconfiguredEnv(dataDir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage:");
    expect(stderr).toBe("");
  });

  test("serves the local store when the explicit opt-in is set (alias form), announcing it on stderr", async () => {
    const dataDir = makeDataDir();
    const env = unconfiguredEnv(dataDir);
    env.FILES_LOCAL = "1";

    const proc = Bun.spawn({
      cmd: ["bun", "run", cliPath, "sources", "list"],
      cwd: repoRoot,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    // An unhosted run must say it is local on stderr (never a false green).
    expect(stderr).toContain("LOCAL mode");
    // Opted-in local mode opens the on-box SQLite index as before.
    expect(stdout).toContain("No sources configured");
    await expect(Bun.file(join(dataDir, "files.db")).exists()).resolves.toBe(true);
  });

  test("explicit local mode refuses before creating a canonical database beside stranded XDG data", async () => {
    const home = makeDataDir();
    const env = { ...process.env };
    for (const key of [
      "HASNA_FILES_API_URL",
      "FILES_API_URL",
      "HASNA_FILES_API_KEY",
      "FILES_API_KEY",
      "HASNA_FILES_API_KEY_OVERRIDE",
      "HASNA_FILES_API_KEY_REF",
      "HASNA_PROFILE",
      "HASNA_HOME",
      "HASNA_DATA_HOME",
      "HASNA_FILES_DATA_DIR",
      "FILES_DATA_DIR",
      "HASNA_FILES_HOME",
      "FILES_HOME",
      "HASNA_FILES_DB_PATH",
      "FILES_DB_PATH",
      "FILES_LOCAL",
    ]) {
      delete env[key];
    }
    env.HOME = home;
    env.HASNA_FILES_LOCAL = "1";
    const retired = join(home, ".local", "share", "hasna", "files");
    mkdirSync(retired, { recursive: true });
    writeFileSync(join(retired, "files.db"), "existing-store");

    const proc = Bun.spawn({
      cmd: ["bun", "run", cliPath, "sources", "list"],
      cwd: repoRoot,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("FILES_STRANDED_XDG_DATA");
    expect(stderr).toContain("HASNA_FILES_DATA_DIR");
    await expect(Bun.file(join(home, ".hasna", "files", "files.db")).exists()).resolves.toBe(false);
  });

  test("an explicit DB path cannot bypass the canonical stranded-data interlock", async () => {
    const home = makeDataDir();
    const env = { ...process.env };
    for (const key of [
      "HASNA_FILES_API_URL",
      "FILES_API_URL",
      "HASNA_FILES_API_KEY",
      "FILES_API_KEY",
      "HASNA_FILES_API_KEY_OVERRIDE",
      "HASNA_FILES_API_KEY_REF",
      "HASNA_PROFILE",
      "HASNA_HOME",
      "HASNA_DATA_HOME",
      "HASNA_FILES_DATA_DIR",
      "FILES_DATA_DIR",
      "HASNA_FILES_HOME",
      "FILES_HOME",
      "FILES_DB_PATH",
      "FILES_LOCAL",
    ]) {
      delete env[key];
    }
    env.HOME = home;
    env.HASNA_FILES_LOCAL = "1";
    env.HASNA_FILES_DB_PATH = join(home, ".hasna", "files", "files.db");
    // This unrelated root selection must not disable the guard for the final,
    // explicitly selected canonical DB path.
    env.HASNA_FILES_DATA_DIR = join(home, "irrelevant-selected-root");
    const retired = join(home, ".local", "share", "hasna", "files");
    mkdirSync(retired, { recursive: true });
    writeFileSync(join(retired, "files.db"), "existing-store");

    const proc = Bun.spawn({
      cmd: ["bun", "run", cliPath, "sources", "list"],
      cwd: repoRoot,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("FILES_STRANDED_XDG_DATA");
    await expect(Bun.file(env.HASNA_FILES_DB_PATH).exists()).resolves.toBe(false);
  });

  test("stranded local data cannot block an explicitly hosted command", async () => {
    const home = makeDataDir();
    const retired = join(home, ".local", "share", "hasna", "files");
    mkdirSync(retired, { recursive: true });
    writeFileSync(join(retired, "files.db"), "existing-store");
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        expect(url.pathname).toBe("/v1/sources");
        expect(request.headers.get("authorization")).toBe("Bearer hosted-fixture-key");
        return Response.json([]);
      },
    });
    try {
      const env = { ...process.env };
      for (const key of [
        "HASNA_FILES_LOCAL",
        "FILES_LOCAL",
        "HASNA_HOME",
        "HASNA_DATA_HOME",
        "HASNA_FILES_DATA_DIR",
        "FILES_DATA_DIR",
        "HASNA_FILES_HOME",
        "FILES_HOME",
        "HASNA_FILES_DB_PATH",
        "FILES_DB_PATH",
        "HASNA_FILES_API_KEY_OVERRIDE",
        "HASNA_FILES_API_KEY_REF",
        "HASNA_PROFILE",
      ]) {
        delete env[key];
      }
      env.HOME = home;
      env.HASNA_FILES_API_URL = `http://127.0.0.1:${server.port}`;
      env.HASNA_FILES_API_KEY = "hosted-fixture-key";

      const proc = Bun.spawn({
        cmd: ["bun", "run", cliPath, "sources", "list"],
        cwd: repoRoot,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("No sources configured");
      expect(stderr).not.toContain("FILES_STRANDED_XDG_DATA");
      await expect(Bun.file(join(home, ".hasna", "files", "files.db")).exists()).resolves.toBe(false);
    } finally {
      server.stop(true);
    }
  });

  test("S3 evidence configuration stays pure when retired local data exists", async () => {
    const home = makeDataDir();
    const retired = join(home, ".local", "share", "hasna", "files");
    mkdirSync(retired, { recursive: true });
    writeFileSync(join(retired, "files.db"), "existing-store");
    const env = { ...process.env };
    for (const key of [
      "HASNA_FILES_API_URL",
      "FILES_API_URL",
      "HASNA_FILES_API_KEY",
      "FILES_API_KEY",
      "HASNA_FILES_LOCAL",
      "FILES_LOCAL",
      "HASNA_HOME",
      "HASNA_DATA_HOME",
      "HASNA_FILES_DATA_DIR",
      "FILES_DATA_DIR",
      "HASNA_FILES_HOME",
      "FILES_HOME",
      "HASNA_FILES_DB_PATH",
      "FILES_DB_PATH",
    ]) {
      delete env[key];
    }
    env.HOME = home;
    env.HASNA_FILES_API_URL = "https://api.hasna.com/files";
    env.HASNA_FILES_API_KEY = "hosted-evidence-fixture-key";

    const proc = Bun.spawn({
      cmd: ["bun", "run", cliPath, "evidence", "configure-prod", "--json"],
      cwd: repoRoot,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ provider: "s3" });
    expect(stderr).not.toContain("FILES_STRANDED_XDG_DATA");
    await expect(Bun.file(join(home, ".hasna", "files", "files.db")).exists()).resolves.toBe(false);
  });

  test("refuses when the local opt-in is explicitly falsy", async () => {
    const dataDir = makeDataDir();
    const env = unconfiguredEnv(dataDir);
    env.HASNA_FILES_LOCAL = "0";

    const proc = Bun.spawn({
      cmd: ["bun", "run", cliPath, "sources", "list"],
      cwd: repoRoot,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("HASNA_FILES_API_URL");
    await expect(Bun.file(join(dataDir, "files.db")).exists()).resolves.toBe(false);
  });

  test("refuses the retired *_MODE opt-in spells (stripped, not accepted)", async () => {
    const dataDir = makeDataDir();
    const env = unconfiguredEnv(dataDir);
    env.HASNA_FILES_LOCAL_MODE = "1";

    const proc = Bun.spawn({
      cmd: ["bun", "run", cliPath, "sources", "list"],
      cwd: repoRoot,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("HASNA_FILES_API_URL");
    await expect(Bun.file(join(dataDir, "files.db")).exists()).resolves.toBe(false);
  });
});
