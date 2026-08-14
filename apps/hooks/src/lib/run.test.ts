/**
 * Regression tests for verified hook execution (P1-1 TOCTOU).
 *
 * The runner must execute the exact bytes it verified. Swapping or tampering
 * the on-disk script after verification must never change what runs, and a
 * script whose hash no longer matches the trusted pin must refuse to run.
 */

import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runHook } from "../index.js";
import { executeVerifiedScript } from "./run.js";
import { closeDb } from "../db/index.js";

const TEST_DIR = mkdtempSync(join(tmpdir(), "hooks-run-test-"));
const HOOKS_DIR = join(TEST_DIR, "hooks");

function installCustomHook(name: string, script: string, scriptPath = "script.ts"): string {
  const dir = join(HOOKS_DIR, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({ name, version: "1.0.0", events: ["PostToolUse"], script: scriptPath }),
  );
  const scriptFile = join(dir, scriptPath);
  writeFileSync(scriptFile, script);
  return scriptFile;
}

const ORIGINAL_SCRIPT = `const marker = "ORIGINAL";
await new Promise((r) => setTimeout(r, 2000));
console.log(JSON.stringify({ marker }));`;

const TAMPERED_SCRIPT = `console.log(JSON.stringify({ marker: "TAMPERED" }));`;

beforeAll(async () => {
  process.env.HASNA_HOOKS_DATA_DIR = TEST_DIR;
  process.env.HASNA_HOOKS_DB_PATH = ":memory:";
  // Pre-warm the dynamic imports runHook performs so the mid-run swap test
  // measures execution timing, not cold module loading.
  await Promise.all([import("../index.js"), import("./manifest.js"), import("./store.js"), import("./run.js")]);
});

afterAll(() => {
  delete process.env.HASNA_HOOKS_DATA_DIR;
  delete process.env.HASNA_HOOKS_DB_PATH;
  closeDb();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("executeVerifiedScript", () => {
  test("executes the provided bytes and never re-opens the source path", async () => {
    const scriptPath = installCustomHook("helper-demo", ORIGINAL_SCRIPT);
    const verified = readFileSync(scriptPath);
    // The on-disk script is replaced BEFORE execution with different bytes.
    writeFileSync(scriptPath, TAMPERED_SCRIPT);
    const { stdout, exitCode } = await executeVerifiedScript({
      name: "helper-demo",
      scriptPath,
      content: verified,
      args: [],
      stdin: "{}",
    });
    expect(exitCode).toBe(0);
    const output = JSON.parse(stdout);
    expect(output.marker).toBe("ORIGINAL");
  });
});

describe("runHook verified execution", () => {
  test("swapping the on-disk script after verification cannot change what runs", async () => {
    const scriptPath = installCustomHook("swap-demo", ORIGINAL_SCRIPT);
    const run = runHook("swap-demo", { session_id: "s1" });
    // Give the runner time to read + verify + spawn from the verified bytes,
    // then swap the on-disk script while the hook is still executing.
    await new Promise((r) => setTimeout(r, 500));
    writeFileSync(scriptPath, TAMPERED_SCRIPT);
    const result = await run;
    expect(result.exitCode).toBe(0);
    expect(result.output.marker).toBe("ORIGINAL");
  });

  test("a tampered script whose hash no longer matches the pin refuses to run", async () => {
    const scriptPath = installCustomHook("tamper-demo", `console.log(JSON.stringify({ marker: "FIRST" }));`);
    const first = await runHook("tamper-demo", { session_id: "s2" });
    expect(first.exitCode).toBe(0);
    expect(first.output.marker).toBe("FIRST");

    writeFileSync(scriptPath, TAMPERED_SCRIPT);
    await expect(runHook("tamper-demo", { session_id: "s3" })).rejects.toThrow(/changed since it was trusted/);
  });
});

describe("CLI run verified execution", () => {
  async function cliRun(name: string, stdin: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "..", "cli", "index.tsx"), "run", name], {
      stdin: new Response(stdin),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, HASNA_HOOKS_DATA_DIR: TEST_DIR, HASNA_HOOKS_DB_PATH: ":memory:", NO_COLOR: "1" },
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { stdout, stderr, exitCode: await proc.exited };
  }

  test("runs a verified hook and refuses a tampered one", async () => {
    const scriptPath = installCustomHook("cli-demo", `console.log(JSON.stringify({ marker: "CLI-OK" }));`);
    const ok = await cliRun("cli-demo", "{}");
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout).toContain("CLI-OK");

    writeFileSync(scriptPath, TAMPERED_SCRIPT);
    const tampered = await cliRun("cli-demo", "{}");
    expect(tampered.exitCode).toBe(1);
    expect(tampered.stderr).toContain("changed since it was trusted");
  });
});
