import { expect, test } from "bun:test";
import { createRequire } from "module";
import { join } from "path";

const repoRoot = join(import.meta.dir, "..", "..");
const migrateEntry = join(repoRoot, "src", "server", "migrate.ts");
const pkg = createRequire(import.meta.url)("../../package.json") as { version: string };

/** A spawn env with no cloud database configured at all. */
function unconfiguredEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.HASNA_FILES_DATABASE_URL;
  delete env.FILES_DATABASE_URL;
  return env;
}

async function runMigrate(args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn({
    cmd: ["bun", "run", migrateEntry, ...args],
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
  return { stdout, stderr, exitCode };
}

test("files-migrate help exits before resolving cloud database configuration", async () => {
  const result = await runMigrate(["--help"], { ...process.env, HASNA_FILES_DATABASE_URL: "" });

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Usage: files-migrate");
  expect(result.stdout).toContain("--check, --dry-run");
  expect(result.stdout).toContain("-V, --version");
  expect(result.stderr).toBe("");
});

test("files-migrate --version prints the package version without resolving cloud database configuration", async () => {
  // The published 0.4.0 exited 1 here: it read HASNA_FILES_DATABASE_URL first.
  const result = await runMigrate(["--version"], unconfiguredEnv());

  expect(result.exitCode).toBe(0);
  expect(result.stdout.trim()).toBe(pkg.version);
  expect(result.stderr).toBe("");
});
