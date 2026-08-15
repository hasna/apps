import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "bun";

import { closeDatabase, resetDatabase } from "../db/database.js";
import { createEnvironment } from "../db/environments.js";

const cleanupPaths: string[] = [];

function setupEnvDb() {
  const baseDir = mkdtempSync(join(tmpdir(), "testers-env-list-"));
  const dbPath = join(baseDir, "testers.db");
  cleanupPaths.push(baseDir);

  process.env.TESTERS_DB_PATH = dbPath;
  resetDatabase();

  createEnvironment({ name: "staging", url: "https://staging.example.com", isDefault: true });
  createEnvironment({ name: "prod", url: "https://app.example.com", isDefault: false });

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

describe("testers env list CLI", () => {
  test("supports --json output", () => {
    const { dbPath } = setupEnvDb();
    const proc = spawnSync({
      cmd: ["bun", "run", "src/cli/index.tsx", "env", "list", "--json"],
      env: { ...process.env, TESTERS_DB_PATH: dbPath },
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.exitCode).toBe(0);
    const output = JSON.parse(proc.stdout.toString());
    expect(output.total).toBe(2);
    expect(output.items).toHaveLength(2);
    expect(output.items.some((item: { name: string }) => item.name === "staging")).toBe(true);
  });
});
