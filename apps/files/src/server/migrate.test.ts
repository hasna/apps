import { expect, test } from "bun:test";
import { join } from "path";

const repoRoot = join(import.meta.dir, "..", "..");

test("files-migrate help exits before resolving cloud database configuration", async () => {
  const proc = Bun.spawn({
    cmd: ["bun", "run", join(repoRoot, "src", "server", "migrate.ts"), "--help"],
    cwd: repoRoot,
    env: {
      ...process.env,
      HASNA_FILES_DATABASE_URL: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stdout).toContain("Usage: files-migrate");
  expect(stdout).toContain("--check, --dry-run");
  expect(stderr).toBe("");
});
