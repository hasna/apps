import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "bun";

import { closeDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";

const cleanupPaths: string[] = [];

function setupProjectsDb() {
  const baseDir = mkdtempSync(join(tmpdir(), "testers-project-list-"));
  const dbPath = join(baseDir, "testers.db");
  cleanupPaths.push(baseDir);

  process.env.TESTERS_DB_PATH = dbPath;
  resetDatabase();

  createProject({ name: "alpha-app", path: "/workspace/alpha" });
  createProject({ name: "beta-service", path: "/workspace/beta" });
  createProject({ name: "gamma-cli", path: "/workspace/gamma" });

  closeDatabase();
  return { dbPath };
}

afterEach(() => {
  closeDatabase();
  for (const dir of cleanupPaths.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.TESTERS_DB_PATH;
});

describe("testers project list CLI", () => {
  test("supports --json --search --limit --offset", () => {
    const { dbPath } = setupProjectsDb();
    const proc = spawnSync({
      cmd: ["bun", "run", "src/cli/index.tsx", "project", "list", "--json", "--search", "a", "--limit", "1", "--offset", "1"],
      env: { ...process.env, TESTERS_DB_PATH: dbPath },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.exitCode).toBe(0);
    const output = JSON.parse(proc.stdout.toString());
    expect(output.total).toBe(3);
    expect(output.limit).toBe(1);
    expect(output.offset).toBe(1);
    expect(output.items).toHaveLength(1);
  });
});
