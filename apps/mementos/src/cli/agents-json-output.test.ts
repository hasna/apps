import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase, resetDatabase } from "../db/database.js";
import { registerAgent } from "../db/agents.js";
import { assertLocalStoreBackend, isolatedStoreEnv } from "../test-support/store-isolation.js";

const DB_PATH = join(mkdtempSync(join(tmpdir(), "mementos-agents-json-output-")), "store.db");
const CLI_PATH = new URL("./index.tsx", import.meta.url).pathname;
const HELPERS_PATH = new URL("./helpers.ts", import.meta.url).href;
const CLI_ENV = isolatedStoreEnv(DB_PATH);
const AGENT_COUNT = 1_000;
const DESCRIPTION = "fixture-agent-description-" + "x".repeat(700);

async function runCli(...args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, "--json", ...(args.length > 0 ? args : ["agents"])], {
    env: CLI_ENV,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { stdout, stderr, exitCode: await proc.exited };
}

async function runLargeJsonWithExplicitExit(): Promise<{ stdout: string; exitCode: number }> {
  const script = `import { outputJsonAndExit } from ${JSON.stringify(HELPERS_PATH)}; await outputJsonAndExit(Array.from({ length: 12000 }, (_, i) => ({ id: i, value: "x".repeat(700) })), 23);`;
  const proc = Bun.spawn(["bun", "-e", script], { stdout: "pipe", stderr: "pipe" });
  const stdout = await new Response(proc.stdout).text();
  return { stdout, exitCode: await proc.exited };
}

beforeAll(async () => {
  await assertLocalStoreBackend(CLI_PATH, CLI_ENV, DB_PATH);
  const db = getDatabase(DB_PATH);
  for (let i = 0; i < AGENT_COUNT; i += 1) {
    registerAgent(`json-output-agent-${String(i).padStart(4, "0")}`, undefined, DESCRIPTION, "fixture", undefined, db);
  }
  db.run("UPDATE agents SET session_id = ?", ["session-" + "s".repeat(700)]);
});

afterAll(() => {
  resetDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = DB_PATH + suffix;
    if (existsSync(file)) unlinkSync(file);
  }
});

describe("agents JSON output", () => {
  test("emits complete parseable JSON for a large listing", async () => {
    const result = await runCli("agents", "--limit", String(AGENT_COUNT));
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("error:");
    expect(Buffer.byteLength(result.stdout)).toBeGreaterThan(327_680);
    const rows = JSON.parse(result.stdout) as Array<{ name: string }>;
    expect(rows).toHaveLength(AGENT_COUNT);
    expect(rows[0]?.name).toBe("json-output-agent-0000");
    expect(rows.at(-1)?.name).toBe("json-output-agent-0999");
  }, 60_000);

  test("preserves a real CLI nonzero status with complete JSON error output", async () => {
    const result = await runCli("agent-update", "missing-agent-id", "--name", "updated-name");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain("error:");
    expect(JSON.parse(result.stdout)).toEqual({ error: "Agent not found: missing-agent-id" });
  }, 60_000);

  test("completes a large JSON write before an explicit nonzero exit", async () => {
    const result = await runLargeJsonWithExplicitExit();
    expect(result.exitCode).toBe(23);
    expect(Buffer.byteLength(result.stdout)).toBeGreaterThan(8_000_000);
    const rows = JSON.parse(result.stdout) as Array<{ id: number }>;
    expect(rows).toHaveLength(12_000);
    expect(rows.at(-1)?.id).toBe(11_999);
  }, 60_000);
});
