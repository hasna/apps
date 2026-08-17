import { describe, test, expect, afterAll, beforeAll } from "bun:test";
import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  assertLocalStoreBackend,
  blankLlmProviderEnv,
  isolatedStoreEnv,
} from "../test-support/store-isolation.js";

// ============================================================================
// Regression test: pinned-but-never-accessed memories were invisible to the
// stale check — `mementos stale` hardcoded pinned = 0, so the pin surface kept
// promoting stale rows with no flag for curation. `stale --pinned` must
// surface never-accessed pins (accessed_at null, 0 accesses) so they can be
// reviewed; the default `stale` view must keep excluding pinned rows.
// ============================================================================

const DB_PATH = join(tmpdir(), `mementos-stale-pinned-test-${Date.now()}.db`);
const CLI_PATH = new URL("./index.tsx", import.meta.url).pathname;

const CLI_ENV = isolatedStoreEnv(DB_PATH, { extra: blankLlmProviderEnv() });

beforeAll(async () => {
  await assertLocalStoreBackend(CLI_PATH, CLI_ENV, DB_PATH);
});

afterAll(() => {
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = DB_PATH + suffix;
    if (existsSync(f)) try { unlinkSync(f); } catch {}
  }
});

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
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

describe("mementos stale --pinned surfaces never-accessed pins", () => {
  test("a saved-and-pinned memory is stale-visible only with --pinned", async () => {
    const key = "pinned-never-touched-stale-test";

    const saved = await runCli("save", key, "regression seed value");
    expect(saved.exitCode).toBe(0);
    const pinned = await runCli("pin", key);
    expect(pinned.exitCode).toBe(0);

    // Default stale view: pinned rows excluded (existing contract).
    const plain = await runCli("stale", "--json");
    expect(plain.exitCode).toBe(0);
    const plainParsed = JSON.parse(plain.stdout) as {
      memories: Array<{ key: string }>;
    };
    expect(plainParsed.memories.some((m) => m.key === key)).toBe(false);

    // --pinned view: the never-accessed pin is flagged with its access stats.
    const scoped = await runCli("stale", "--pinned", "--json");
    expect(scoped.exitCode).toBe(0);
    const scopedParsed = JSON.parse(scoped.stdout) as {
      memories: Array<{ key: string; accessed_at: string | null; access_count: number }>;
    };
    const row = scopedParsed.memories.find((m) => m.key === key);
    expect(row).toBeDefined();
    expect(row!.accessed_at).toBeNull();
    expect(row!.access_count).toBe(0);
  });

  test("human stale --pinned output marks the never-accessed pin as never", async () => {
    const key = "pinned-never-touched-human-view";
    const saved = await runCli("save", key, "regression seed value");
    expect(saved.exitCode).toBe(0);
    const pinned = await runCli("pin", key);
    expect(pinned.exitCode).toBe(0);

    const out = await runCli("stale", "--pinned");
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain(key);
    expect(out.stdout).toContain("never");
  });
});
