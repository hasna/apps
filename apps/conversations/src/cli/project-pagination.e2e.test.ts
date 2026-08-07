import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const TEST_DB = join(tmpdir(), `conversations-project-pagination-${Date.now()}.db`);
const CLI = ["bun", "run", "./src/cli/index.tsx"];

function runCli(args: string[]) {
  const result = Bun.spawnSync({
    cmd: [...CLI, ...args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      CONVERSATIONS_DB_PATH: TEST_DB,
      CONVERSATIONS_AGENT_ID: "project-pagination-test",
      FORCE_COLOR: "0",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
  };
}

beforeAll(() => {
  for (const name of ["Alpha", "Bravo", "Charlie"]) {
    const created = runCli(["project", "create", name, "--json"]);
    expect(created.exitCode).toBe(0);
  }
});

afterAll(() => {
  try { unlinkSync(TEST_DB); } catch {}
  try { unlinkSync(`${TEST_DB}-wal`); } catch {}
  try { unlinkSync(`${TEST_DB}-shm`); } catch {}
});

describe("project list cursor pagination", () => {
  test.each([
    ["--limit", "1.5", "--limit must be a positive integer."],
    ["--offset", "1.5", "--offset must be a non-negative integer."],
    ["--cursor", "1.5", "--cursor must be a non-negative integer."],
    ["--limit", "1abc", "--limit must be a positive integer."],
  ])("rejects invalid raw pagination input %s %s", (flag, value, message) => {
    const result = runCli(["project", "list", "--json", flag, value]);
    expect(result.exitCode).not.toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ error: message });
    expect(result.stderr).toBe("");
  });

  test("legacy --json remains an array and page two returns the third stable project", () => {
    const first = runCli(["project", "list", "--json", "--limit", "2"]);
    expect(first.exitCode).toBe(0);
    const firstRows = JSON.parse(first.stdout);
    expect(Array.isArray(firstRows)).toBe(true);
    expect(firstRows.map((project: any) => project.name)).toEqual(["Alpha", "Bravo"]);
    expect(first.stderr).toContain("More available: rerun with --cursor 2.");

    const second = runCli(["project", "list", "--json", "--limit", "2", "--cursor", "2"]);
    expect(second.exitCode).toBe(0);
    const secondRows = JSON.parse(second.stdout);
    expect(secondRows.map((project: any) => project.name)).toEqual(["Charlie"]);

    const firstIds = firstRows.map((project: any) => project.id);
    const secondIds = secondRows.map((project: any) => project.id);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(3);
    expect(firstIds.filter((id: string) => secondIds.includes(id))).toEqual([]);
  });

  test("--page-json returns a truthful machine-readable continuation envelope", () => {
    const first = runCli(["project", "list", "--page-json", "--limit", "2"]);
    expect(first.exitCode).toBe(0);
    const firstPage = JSON.parse(first.stdout);
    expect(firstPage.projects.map((project: any) => project.name)).toEqual(["Alpha", "Bravo"]);
    expect(firstPage.has_more).toBe(true);
    expect(firstPage.next_cursor).toBe(2);

    const second = runCli([
      "project", "list", "--page-json", "--limit", "2", "--cursor", String(firstPage.next_cursor),
    ]);
    expect(second.exitCode).toBe(0);
    const secondPage = JSON.parse(second.stdout);
    expect(secondPage.projects.map((project: any) => project.name)).toEqual(["Charlie"]);
    expect(secondPage.has_more).toBe(false);
    expect(secondPage.next_cursor).toBeNull();
  });
});
