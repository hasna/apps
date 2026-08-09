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

const DB_PATH = join(tmpdir(), `mementos-projects-pagination-${Date.now()}.db`);
const CLI_PATH = new URL("./index.tsx", import.meta.url).pathname;
const CLI_ENV = isolatedStoreEnv(DB_PATH);
const PROJECT_NAMES = Array.from(
  { length: 5 },
  (_, index) => `pagination-project-${index}`,
);

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
  for (const [index, name] of PROJECT_NAMES.entries()) {
    const project = registerProject(
      name,
      `/tmp/${name}`,
      undefined,
      undefined,
      db,
    );
    db.run("UPDATE projects SET updated_at = ? WHERE id = ?", [
      `2026-08-09T12:00:0${index}.000Z`,
      project.id,
    ]);
  }
});

afterAll(() => {
  resetDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = DB_PATH + suffix;
    if (existsSync(file)) unlinkSync(file);
  }
});

describe("projects pagination", () => {
  test("JSON output honors explicit limit and cursor while no flags remain unbounded", async () => {
    const unbounded = await runCli("--json", "projects");
    const limited = await runCli("--json", "projects", "--limit", "2");
    const first = await runCli(
      "--json",
      "projects",
      "--limit",
      "2",
      "--cursor",
      "0",
    );
    const second = await runCli(
      "--json",
      "projects",
      "--limit",
      "2",
      "--cursor",
      "2",
    );
    const shortTerminal = await runCli(
      "--json",
      "projects",
      "--limit",
      "2",
      "--cursor",
      "4",
    );
    const emptyTerminal = await runCli(
      "--json",
      "projects",
      "--limit",
      "2",
      "--cursor",
      "5",
    );

    for (const result of [
      unbounded,
      limited,
      first,
      second,
      shortTerminal,
      emptyTerminal,
    ]) {
      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain("error:");
    }

    const unboundedProjects = JSON.parse(unbounded.stdout) as Array<{
      id: string;
      name: string;
    }>;
    const limitedProjects = JSON.parse(limited.stdout) as Array<{
      id: string;
      name: string;
    }>;
    const firstPage = JSON.parse(first.stdout) as Array<{
      id: string;
      name: string;
    }>;
    const secondPage = JSON.parse(second.stdout) as Array<{
      id: string;
      name: string;
    }>;
    const shortTerminalPage = JSON.parse(shortTerminal.stdout) as Array<{
      id: string;
      name: string;
    }>;
    const emptyTerminalPage = JSON.parse(emptyTerminal.stdout) as Array<{
      id: string;
      name: string;
    }>;

    expect(unboundedProjects).toHaveLength(5);
    expect(limitedProjects).toHaveLength(2);
    expect(limitedProjects).toEqual(firstPage);
    expect(firstPage.map((project) => project.name)).toEqual([
      PROJECT_NAMES[4],
      PROJECT_NAMES[3],
    ]);
    expect(secondPage.map((project) => project.name)).toEqual([
      PROJECT_NAMES[2],
      PROJECT_NAMES[1],
    ]);
    expect(
      firstPage.some((project) =>
        secondPage.some((other) => other.id === project.id),
      ),
    ).toBe(false);
    expect(shortTerminalPage.map((project) => project.name)).toEqual([
      PROJECT_NAMES[0],
    ]);
    expect(emptyTerminalPage).toEqual([]);
  });

  test("human output applies the same limit and cursor window", async () => {
    const first = await runCli(
      "projects",
      "--limit",
      "2",
      "--cursor",
      "0",
    );
    const second = await runCli(
      "projects",
      "--limit",
      "2",
      "--cursor",
      "2",
    );
    const shortTerminal = await runCli(
      "projects",
      "--limit",
      "2",
      "--cursor",
      "4",
    );
    const emptyTerminal = await runCli(
      "projects",
      "--limit",
      "2",
      "--cursor",
      "5",
    );

    for (const result of [first, second, shortTerminal, emptyTerminal]) {
      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain("error:");
    }

    expect(first.stdout).toContain("2+ projects:");
    expect(first.stdout).toContain(PROJECT_NAMES[4]!);
    expect(first.stdout).toContain(PROJECT_NAMES[3]!);
    expect(first.stdout).not.toContain(PROJECT_NAMES[2]!);

    expect(second.stdout).toContain("2+ projects:");
    expect(second.stdout).toContain(PROJECT_NAMES[2]!);
    expect(second.stdout).toContain(PROJECT_NAMES[1]!);
    expect(second.stdout).not.toContain(PROJECT_NAMES[4]!);

    expect(shortTerminal.stdout).toContain("1 project:");
    expect(shortTerminal.stdout).toContain(PROJECT_NAMES[0]!);
    expect(emptyTerminal.stdout).toBe("No projects registered.");
  });
});
