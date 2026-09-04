import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resetDb } from "../src/db.js";
import { LocalStore } from "../src/store/index.js";

// Large-output regression suite for issue #1586.
//
// `secrets list --json` / `secrets search --json` silently truncated big piped
// payloads: Bun's process.stdout buffers pipe writes internally in 96 KiB
// chunks and schedules the tail asynchronously; when the CLI's top-level
// script ended, the runtime exited without draining the still-queued chunks,
// so a large payload arrived at the consumer cut mid-string (observed as
// 98,304 / 196,608 byte outputs for a 349 KB hosted listing, unparseable by
// jq). The fix writes single-shot machine outputs through `writeStdout()`,
// which awaits every chunk's write callback, and drains `process.stdout`
// before the script ends.
//
// This suite seeds a local vault whose metadata listing serializes to well
// over 1 MB — the corpus size the issue asks to test — then asserts that the
// piped CLI output is complete, well-formed JSON with every seeded entry,
// both for a fast pipe consumer (`cat`) and for a consumer that lags behind
// (which is when the old queued-chunk drop was most visible).

const SEED_COUNT = 2500;

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `secrets-large-json-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.OPEN_SECRETS_DB = join(testDir, "vault.db");
  process.env.HASNA_SECRETS_KEY_DIR = join(testDir, "keys");
  resetDb();

  // Seed in-process (fast, hermetic) so the seeded store is exactly what the
  // spawned CLI reads through the same OPEN_SECRETS_DB.
  const store = new LocalStore();
  for (let i = 0; i < SEED_COUNT; i++) {
    await store.setSecret(
      `corpus/svc/${i}/key`,
      `value-${i}-abcdefghijklmnopqrstuvwxyz0123456789`,
      "api_key",
      `corpus label ${i} ${"L".repeat(300)}`,
    );
  }
}, 120_000);

afterEach(() => {
  resetDb();
  delete process.env.OPEN_SECRETS_DB;
  delete process.env.HASNA_SECRETS_KEY_DIR;
  rmSync(testDir, { recursive: true, force: true });
}, 120_000);

function runSecretsPiped(args: string[], pipelineTail: string): { exitCode: number; stdout: string; stderr: string } {
  // Run the CLI with stdout piped through the given consumer pipeline so the
  // output has to survive the same pipe-flush race a real `| jq` would.
  const cli = ["bun", "src/index.ts", ...args].map((part) => JSON.stringify(part)).join(" ");
  const proc = Bun.spawnSync({
    cmd: ["sh", "-c", `${cli} | ${pipelineTail}`],
    cwd: join(import.meta.dir, ".."),
    env: {
      ...(process.env as Record<string, string>),
      OPEN_SECRETS_DB: process.env.OPEN_SECRETS_DB!,
      HASNA_SECRETS_KEY_DIR: process.env.HASNA_SECRETS_KEY_DIR!,
      NO_COLOR: "1",
      // Strip any hosted-vault routing inherited from the host so the runs are
      // hermetic and deterministic (same guards as the other CLI tests).
      HASNA_SECRETS_API_URL: undefined,
      HASNA_SECRETS_API_KEY: undefined,
      HASNA_SECRETS_STORAGE_MODE: undefined,
      SECRETS_API_URL: undefined,
      SECRETS_API_KEY: undefined,
    },
  });
  return {
    exitCode: proc.exitCode ?? -1,
    stdout: new TextDecoder().decode(proc.stdout),
    stderr: new TextDecoder().decode(proc.stderr),
  };
}

function expectCompleteJson(stdout: string): unknown[] {
  // Must be well-formed (no mid-string cut) and carry every seeded entry.
  const parsed = JSON.parse(stdout) as unknown[];
  expect(Array.isArray(parsed)).toBe(true);
  expect(parsed.length).toBe(SEED_COUNT);
  return parsed;
}

describe("CLI large JSON output (>1 MB corpus, issue #1586)", () => {
  it("secrets list --json piped through cat is complete parsable JSON with all entries", 120_000, () => {
    const res = runSecretsPiped(["list", "--json"], "cat");
    expect(res.exitCode).toBe(0);
    // The corpus serializes to >1 MB: the payload size that used to truncate.
    expect(res.stdout.length).toBeGreaterThan(1_000_000);
    expectCompleteJson(res.stdout);
  });

  it("secrets list --json piped to a lagging consumer is complete (no queued-chunk drop)", 120_000, () => {
    // The consumer refuses to read for 500 ms, forcing the writer to
    // backpressure — the exact situation where the old code lost buffered
    // chunks when the script ended.
    const res = runSecretsPiped(["list", "--json"], "{ sleep 0.5; cat; }");
    expect(res.exitCode).toBe(0);
    const parsed = expectCompleteJson(res.stdout);
    expect(parsed.some((e: any) => e.key === "corpus/svc/0/key")).toBe(true);
    expect(parsed.some((e: any) => e.key === `corpus/svc/${SEED_COUNT - 1}/key`)).toBe(true);
  });

  it("secrets search --json with a broad query is complete parsable JSON with all entries", 120_000, () => {
    const res = runSecretsPiped(["search", "corpus", "--json"], "cat");
    expect(res.exitCode).toBe(0);
    expect(res.stdout.length).toBeGreaterThan(1_000_000);
    expectCompleteJson(res.stdout);
  });
});