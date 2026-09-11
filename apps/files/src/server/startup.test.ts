/**
 * Startup contract of the `files-serve` bin, checked as a spawned process:
 * `--version` / `--help` answer from argv alone and exit BEFORE any port is
 * probed or bound. The published 0.4.0 bound 127.0.0.1:19432 on
 * `files-serve --version` (hasna/apps#1720, station03 release verification).
 */
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { createRequire } from "module";
import { tmpdir } from "os";
import { join } from "path";

const repoRoot = join(import.meta.dir, "..", "..");
const serveEntry = join(repoRoot, "src", "server", "index.ts");
const pkg = createRequire(import.meta.url)("../../package.json") as { version: string };
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

function makeDataDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "files-serve-startup-"));
  tempDirs.push(dir);
  return dir;
}

/**
 * Hold a loopback port open while `fn` runs. `files-serve` probes its port by
 * binding it: a probe against a held port steps to the next one, announces
 * that on stdout, and then serves forever — none of which may happen for an
 * informational flag.
 */
async function withHeldPort<T>(fn: (port: number) => Promise<T>): Promise<T> {
  const holder = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
  try {
    return await fn(holder.port);
  } finally {
    holder.stop(true);
  }
}

/** Run the serve entry to completion; a process still alive after 15s is killed (a non-zero exit). */
async function runServe(args: string[], dataDir: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HASNA_FILES_DATA_DIR: dataDir,
    HASNA_FILES_DB_PATH: join(dataDir, "files.db"),
  };
  delete env.HASNA_FILES_DATABASE_URL;
  delete env.FILES_DATABASE_URL;
  const proc = Bun.spawn({
    cmd: ["bun", "run", serveEntry, ...args],
    cwd: repoRoot,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const timer = setTimeout(() => proc.kill(), 15_000);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { stdout, stderr, exitCode };
  } finally {
    clearTimeout(timer);
  }
}

test("files-serve --version prints the package version and exits before probing or binding a port", async () => {
  const dataDir = makeDataDir();
  await withHeldPort(async (port) => {
    const result = await runServe(["--version", "--port", String(port)], dataDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
    expect(result.stderr).toBe("");
  });
  expect(existsSync(join(dataDir, "files.db"))).toBe(false);
});

test("files-serve --help exits before probing or binding a port", async () => {
  const dataDir = makeDataDir();
  await withHeldPort(async (port) => {
    const result = await runServe(["--help", "--port", String(port)], dataDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: files-serve");
    expect(result.stdout).toContain("-V, --version");
    expect(result.stdout).not.toContain("in use");
    expect(result.stderr).toBe("");
  });
  expect(existsSync(join(dataDir, "files.db"))).toBe(false);
});
