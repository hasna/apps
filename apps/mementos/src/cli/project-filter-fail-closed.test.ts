import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase, resetDatabase } from "../db/database.js";
import { registerProject } from "../db/projects.js";
import {
  assertLocalStoreBackend,
  isolatedStoreEnv,
} from "../test-support/store-isolation.js";

const DB_PATH = join(tmpdir(), `mementos-project-filter-${Date.now()}.db`);
const CLI_PATH = new URL("./index.tsx", import.meta.url).pathname;
const CLI_ENV = isolatedStoreEnv(DB_PATH);

async function runCli(
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], {
    env: CLI_ENV,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return {
    stdout: stdout.trim(),
    stderr: stderr.trim(),
    exitCode: await proc.exited,
  };
}

beforeAll(async () => {
  await assertLocalStoreBackend(CLI_PATH, CLI_ENV, DB_PATH);
  const db = getDatabase(DB_PATH);
  registerProject("known-project", `/tmp/known-project`, undefined, undefined, db);
  registerProject("second-project", `/tmp/second-project`, undefined, undefined, db);
});

afterAll(() => {
  resetDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = DB_PATH + suffix;
    if (existsSync(file)) unlinkSync(file);
  }
});

describe("memory list project filter", () => {
  test("known project paths filter exactly", async () => {
    const result = await runCli(
      "--json",
      "list",
      "--project",
      "/tmp/known-project",
    );
    expect(result.exitCode).toBe(0);
    const memories = JSON.parse(result.stdout) as unknown[];
    expect(Array.isArray(memories)).toBe(true);
  });

  test("unknown project paths fail closed instead of silently leaking unfiltered rows", async () => {
    const result = await runCli(
      "--json",
      "list",
      "--project",
      "/tmp/does-not-exist",
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toContain("Project not found: /tmp/does-not-exist");
  });
});
