import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CWD = join(import.meta.dir, "../..");

let tmpDir: string;
let fakeHome: string;
let dbPath: string;

async function runCli(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: CWD,
    env: {
      ...process.env,
      HOME: fakeHome,
      TODOS_DB_PATH: dbPath,
      TODOS_AUTO_PROJECT: "false",
      TODOS_MODE: "local",
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

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "todos-cloud-migrate-"));
  fakeHome = join(tmpDir, "home");
  dbPath = join(tmpDir, "todos.db");
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("cloud migrate CLI", () => {
  test("dry-runs a copy-only local export without deleting local tasks", async () => {
    const created = await runCli(["--json", "add", "Migration CLI task"]);
    expect(created.exitCode).toBe(0);
    const task = JSON.parse(created.stdout);

    const dryRun = await runCli(["--json", "cloud", "migrate", "--dry-run"]);
    expect(dryRun.exitCode).toBe(0);
    const result = JSON.parse(dryRun.stdout);
    expect(result.dryRun).toBe(true);
    expect(result.manifest.mode).toBe("copy-only");
    expect(result.manifest.safety.deletesLocalData).toBe(false);
    expect(result.manifest.safety.mutatesLocalData).toBe(false);
    expect(result.manifest.counts.tasks).toBe(1);

    const listed = await runCli(["--json", "show", task.id]);
    expect(listed.exitCode).toBe(0);
    expect(JSON.parse(listed.stdout).title).toBe("Migration CLI task");
  });
});
