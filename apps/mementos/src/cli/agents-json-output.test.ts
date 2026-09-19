import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase, resetDatabase } from "../db/database.js";
import { registerAgent } from "../db/agents.js";
import { assertLocalStoreBackend, isolatedStoreEnv } from "../test-support/store-isolation.js";

const DB_PATH = join(tmpdir(), `mementos-agents-json-output-${Date.now()}.db`);
const CLI_PATH = new URL("./index.tsx", import.meta.url).pathname;
const CLI_ENV = isolatedStoreEnv(DB_PATH);
const AGENT_COUNT = 1_200;
const DESCRIPTION = "fixture-agent-description-" + "x".repeat(700);

async function runCli(): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, "--json", "agents"], {
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

beforeAll(async () => {
  await assertLocalStoreBackend(CLI_PATH, CLI_ENV, DB_PATH);
  const db = getDatabase(DB_PATH);
  for (let i = 0; i < AGENT_COUNT; i += 1) {
    registerAgent(`json-output-agent-${String(i).padStart(4, "0")}`, undefined, DESCRIPTION, "fixture", undefined, db);
  }
});

afterAll(() => {
  resetDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = DB_PATH + suffix;
    if (existsSync(file)) unlinkSync(file);
  }
});

describe("agents JSON output", () => {
  test("emits complete parseable JSON for a large unbounded listing", async () => {
    const result = await runCli();
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("error:");
    expect(Buffer.byteLength(result.stdout)).toBeGreaterThan(327_680);
    const rows = JSON.parse(result.stdout) as Array<{ name: string }>;
    expect(rows).toHaveLength(AGENT_COUNT);
    expect(rows[0]?.name).toBe("json-output-agent-0000");
    expect(rows.at(-1)?.name).toBe("json-output-agent-1199");
  }, 60_000);
});
