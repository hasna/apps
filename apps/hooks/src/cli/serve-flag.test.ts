/**
 * Regression tests for P1-8: `hooks serve --api-key <value>` is removed —
 * the publish API key resolves from the environment only. A secret on a CLI
 * flag is visible in process listings and shell history; the vault-key-NAME
 * reference option on `hooks init` is a name, not a value, and stays.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resolveHooksServePublishKey } from "../lib/transport.js";

const CLI = join(import.meta.dir, "index.tsx");
const TEST_HOME = mkdtempSync(join(tmpdir(), "hooks-serve-flag-test-"));

const originalHome = process.env.HOME;
const originalApiKey = process.env.HASNA_HOOKS_API_KEY;
const originalBareKey = process.env.HOOKS_API_KEY;

beforeAll(() => {
  process.env.HOME = TEST_HOME;
  delete process.env.HASNA_HOOKS_API_KEY;
  delete process.env.HOOKS_API_KEY;
});

afterAll(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalApiKey === undefined) delete process.env.HASNA_HOOKS_API_KEY;
  else process.env.HASNA_HOOKS_API_KEY = originalApiKey;
  if (originalBareKey === undefined) delete process.env.HOOKS_API_KEY;
  else process.env.HOOKS_API_KEY = originalBareKey;
  rmSync(TEST_HOME, { recursive: true, force: true });
});

async function run(...args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe("hooks serve --api-key flag removal (P1-8)", () => {
  test("--api-key is rejected as an unknown option (no secret-valued flag exists)", async () => {
    const res = await run("serve", "--api-key", "some-secret-value");
    expect(res.exitCode).not.toBe(0);
    expect(res.stderr).toMatch(/unknown option/i);
  });

  test("--help no longer advertises an --api-key flag", async () => {
    const res = await run("serve", "--help");
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toMatch(/HASNA_HOOKS_API_KEY/);
    expect(res.stdout).not.toMatch(/--api-key <key>/);
  });

  test("hooks init keeps the vault-key-NAME reference option (a name, not a value)", async () => {
    const res = await run("init", "--help");
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toMatch(/--api-key/);
    expect(res.stdout).toMatch(/vault key NAME/i);
  });
});

describe("publish key resolution — the @hasna/contracts chain, not env-only (P1-8, hasna/apps#1720)", () => {
  test("HASNA_HOOKS_API_KEY resolves the publish key", () => {
    expect(resolveHooksServePublishKey({ HOME: TEST_HOME, HASNA_HOOKS_API_KEY: "env-key-a" })).toBe("env-key-a");
  });

  test("the unprefixed HOOKS_API_KEY alias is still read (silent resolver fallback)", () => {
    expect(resolveHooksServePublishKey({ HOME: TEST_HOME, HOOKS_API_KEY: "env-key-b" })).toBe("env-key-b");
  });

  test("returns undefined when nothing resolves — no flag fallback exists", () => {
    expect(resolveHooksServePublishKey({ HOME: TEST_HOME })).toBeUndefined();
  });
});
