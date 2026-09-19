import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDatabase, resetDatabase } from "../db/database.js";
import { registerAgent } from "../db/agents.js";
import {
  assertLocalStoreBackend,
  isolatedStoreEnv,
} from "../test-support/store-isolation.js";

const DB_PATH = join(tmpdir(), `mementos-agents-pagination-${Date.now()}.db`);
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
  for (let i = 0; i < 501; i++) {
    registerAgent(`pagination-agent-${String(i).padStart(3, "0")}`, undefined, undefined, undefined, undefined, db);
  }
});

afterAll(() => {
  resetDatabase();
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = DB_PATH + suffix;
    if (existsSync(file)) unlinkSync(file);
  }
});

describe("agents pagination", () => {
  test("JSON output is compact, byte-bounded, and continuation-bearing", async () => {
    const first = await runCli("--json", "agents", "--limit", "500", "--cursor", "0");
    expect(first.exitCode).toBe(0);
    const firstPage = JSON.parse(first.stdout) as { agents: Array<{ id: string; metadata?: unknown }>; _meta: { count: number; next_cursor: number; has_more: boolean; truncation_reason: string; max_bytes: number } };
    expect(firstPage.agents.length).toBeGreaterThan(0);
    expect(firstPage.agents.length).toBeLessThan(500);
    expect(firstPage.agents.every((agent) => agent.metadata === undefined)).toBe(true);
    expect(firstPage._meta).toMatchObject({ has_more: true, truncation_reason: "max_bytes", max_bytes: 32768 });
    expect(Buffer.byteLength(`${first.stdout}
`)).toBeLessThanOrEqual(firstPage._meta.max_bytes);

    const second = await runCli("--json", "agents", "--limit", "500", "--cursor", String(firstPage._meta.next_cursor));
    expect(second.exitCode).toBe(0);
    const secondPage = JSON.parse(second.stdout) as typeof firstPage;
    const firstIds = new Set(firstPage.agents.map((agent) => agent.id));
    expect(secondPage.agents.some((agent) => firstIds.has(agent.id))).toBe(false);

    const exhaustive = await runCli("--json", "agents", "--all", "--full");
    expect(exhaustive.exitCode).toBe(0);
    const allPage = JSON.parse(exhaustive.stdout) as { agents: Array<{ metadata: unknown }>; _meta: Record<string, unknown> };
    expect(allPage.agents).toHaveLength(501);
    expect(allPage.agents[0]?.metadata).toBeDefined();
    expect(allPage._meta).toMatchObject({ all: true, complete: true, detail: "full" });
  });
});
