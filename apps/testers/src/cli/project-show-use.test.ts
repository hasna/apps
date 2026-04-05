import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "bun";

import { closeDatabase, resetDatabase } from "../db/database.js";
import { createProject } from "../db/projects.js";

const cleanupPaths: string[] = [];

function setupProjectDb() {
  const baseDir = mkdtempSync(join(tmpdir(), "testers-project-show-use-"));
  const dbPath = join(baseDir, "testers.db");
  const testersDir = join(baseDir, ".hasna", "testers");
  cleanupPaths.push(baseDir);

  process.env.TESTERS_DB_PATH = dbPath;
  process.env.HASNA_TESTERS_DIR = testersDir;
  resetDatabase();

  const project = createProject({ name: "json-project", path: "/workspace/json-project" });

  closeDatabase();
  return { dbPath, testersDir, project };
}

afterEach(() => {
  closeDatabase();
  for (const dir of cleanupPaths.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  delete process.env.TESTERS_DB_PATH;
  delete process.env.HASNA_TESTERS_DIR;
});

describe("testers project show/use CLI", () => {
  test("supports --json for project show", () => {
    const { dbPath, testersDir, project } = setupProjectDb();
    const proc = spawnSync({
      cmd: ["bun", "run", "src/cli/index.tsx", "project", "show", project.name, "--json"],
      env: { ...process.env, TESTERS_DB_PATH: dbPath, HASNA_TESTERS_DIR: testersDir },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.exitCode).toBe(0);
    const output = JSON.parse(proc.stdout.toString());
    expect(output.id).toBe(project.id);
    expect(output.name).toBe("json-project");
  });

  test("supports --json for project use and writes activeProject", () => {
    const { dbPath, testersDir, project } = setupProjectDb();
    const proc = spawnSync({
      cmd: ["bun", "run", "src/cli/index.tsx", "project", "use", project.name, "--json"],
      env: { ...process.env, TESTERS_DB_PATH: dbPath, HASNA_TESTERS_DIR: testersDir },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.exitCode).toBe(0);
    const output = JSON.parse(proc.stdout.toString());
    expect(output.activeProject).toBe(project.id);
    expect(output.project.name).toBe("json-project");

    const configPath = join(testersDir, "config.json");
    expect(existsSync(configPath)).toBe(true);
    const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
    expect(cfg.activeProject).toBe(project.id);
  });
});
