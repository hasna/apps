/**
 * Regression tests for the suite's per-test timeout policy.
 *
 * The defect these lock down: the suite ran on Bun's 5000ms framework default
 * per-test timeout, which nobody chose and which asserted nothing. Tests here
 * drive real CLI subprocesses, so their duration is `N spawns x per-spawn boot
 * cost` and that cost tracks host CPU contention. A full-suite run failed 5-6
 * tests at 5001-5626ms under ordinary station load and blocked the 0.4.31
 * publish, because `prepublishOnly` runs the whole suite.
 *
 * See test-timeout-policy.ts for the measurements and for the two mechanisms
 * that silently do NOT work.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

import {
  BUN_DEFAULT_TIMEOUT_MS,
  CLI_SPAWN_TIMEOUT_MS,
  SUITE_TIMEOUT_MS,
} from "./test-timeout-policy.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A throwaway test file that outlives Bun's default budget on purpose. */
function slowFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "loops-timeout-policy-"));
  const file = join(dir, "slow.test.ts");
  writeFileSync(
    file,
    [
      `import { expect, test } from "bun:test";`,
      `test("outlives the framework default", async () => {`,
      `  await new Promise((resolve) => setTimeout(resolve, ${BUN_DEFAULT_TIMEOUT_MS + 500}));`,
      `  expect(true).toBe(true);`,
      `});`,
      "",
    ].join("\n"),
  );
  return file;
}

function runBunTest(file: string, extraArgs: string[]) {
  return spawnSync(process.execPath, ["test", ...extraArgs, file], {
    cwd: dirname(file),
    encoding: "utf8",
    timeout: CLI_SPAWN_TIMEOUT_MS,
  });
}

describe("test timeout policy", () => {
  /**
   * THE regression test for the publish-gating defect, with its own negative
   * control so it cannot silently become a check that always passes.
   *
   * Run as a child process rather than inline because an inline test would be
   * governed by whatever budget the *outer* invocation happens to carry, and
   * would therefore assert nothing about the configured policy.
   */
  test("the configured --timeout lets a test outlive bun's 5000ms default", () => {
    const file = slowFixture();
    // NOTE: this test carries its own explicit budget (third argument below).
    // It drives two child runs that each outlive the framework default, so it
    // is structurally ~11s and could never pass on a 5000ms budget however
    // idle the host. Depending on the caller to pass a flag would give this
    // probe the same shape as the defect it guards, so it states its own.

    // NEGATIVE CONTROL: without the flag the fixture must die at the default.
    // If this ever passes, bun's default changed and the test below is vacuous.
    const unguarded = runBunTest(file, []);
    expect(unguarded.status).not.toBe(0);
    expect(`${unguarded.stdout}${unguarded.stderr}`).toContain(
      `timed out after ${BUN_DEFAULT_TIMEOUT_MS}ms`,
    );

    // The configured policy must rescue exactly that fixture.
    const guarded = runBunTest(file, ["--timeout", String(SUITE_TIMEOUT_MS)]);
    expect(`${guarded.stdout}${guarded.stderr}`).not.toContain("timed out after");
    expect(guarded.status).toBe(0);
  }, SUITE_TIMEOUT_MS);

  /**
   * The flag is the only mechanism measured to survive a multi-file run, so it
   * has to be on the scripts that actually gate a publish. `prepublishOnly`
   * calls `bun test` directly, not `bun run test`, so putting it only on the
   * `test` script would leave the publish gate on the old default.
   */
  test("every `bun test` invocation in package.json carries an explicit --timeout", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    const scripts: Record<string, string> = packageJson.scripts;

    // Asserted as a rule over ALL scripts rather than against a list of script
    // names, because naming them is what let one slip: `check:supply-chain`
    // reaches `bun test` indirectly via `check:branding`, so a two-name check
    // passed while a third invocation on the publish path still ran on the
    // 5000ms default with subprocess-spawning tests under it.
    const invocations = Object.entries(scripts).filter(([, body]) => /\bbun test\b/.test(body));
    expect(invocations.length).toBeGreaterThan(0);

    for (const [name, body] of invocations) {
      for (const invocation of body.split("&&").filter((part) => /\bbun test\b/.test(part))) {
        const match = /\bbun test\s+--timeout\s+(\d+)/.exec(invocation);
        expect(match, `script "${name}" must invoke: bun test --timeout <ms> — got: ${invocation.trim()}`)
          .not.toBeNull();
        expect(Number(match![1])).toBe(SUITE_TIMEOUT_MS);
        expect(Number(match![1])).toBeGreaterThan(BUN_DEFAULT_TIMEOUT_MS);
      }
    }
  });

  /**
   * `prepublishOnly` is the gate that actually blocks a publish, and it calls
   * `bun test` directly rather than `bun run test`. A timeout on the `test`
   * script alone would therefore not have reached it.
   */
  test("the publish gate itself runs the suite with the policy applied", () => {
    const packageJson = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
    expect(packageJson.scripts.prepublishOnly).toContain(`bun test --timeout ${SUITE_TIMEOUT_MS}`);
  });

  /**
   * CI is the merge gate, so it has to run the suite through the same policy.
   * This is asserted over every workflow rather than a known line, because a
   * fixed-name check is exactly what missed it: the fix originally covered the
   * `test`, `check:branding` and `prepublishOnly` scripts while
   * `.github/workflows/ci.yml` invoked bare `bun test` and inherited the
   * 5000ms default — so CI failed on the very PR that removed the defect.
   */
  test("no workflow invokes bare `bun test`", () => {
    const workflowDir = join(repoRoot, ".github", "workflows");
    const files = readdirSync(workflowDir).filter((name) => /\.ya?ml$/.test(name));
    expect(files.length).toBeGreaterThan(0);

    const invocations: string[] = [];
    for (const name of files) {
      for (const line of readFileSync(join(workflowDir, name), "utf8").split("\n")) {
        if (!/\bbun\s+test\b/.test(line)) continue;
        invocations.push(`${name}: ${line.trim()}`);

        // `bun run test` resolves to the `test` script, which the assertion
        // above already proves carries the budget.
        if (/\bbun\s+run\s+test\b/.test(line)) continue;

        const match = /\bbun\s+test\b[^&|]*?--timeout\s+(\d+)/.exec(line);
        expect(
          match,
          `${name} must use \`bun run test\` or pass --timeout explicitly — got: ${line.trim()}`,
        ).not.toBeNull();
        expect(Number(match![1])).toBeGreaterThan(BUN_DEFAULT_TIMEOUT_MS);
      }
    }

    // Positive control: if this ever reads zero, the scan found nothing and
    // the assertions above were vacuous.
    expect(invocations.length).toBeGreaterThan(0);
  });

  /**
   * The budget above is only safe to raise because hang detection moved to the
   * spawn boundary. If that guard is finite and enforced, a raised per-test
   * budget is a backstop rather than a licence for a hung CLI to stall the
   * suite.
   */
  test("CLI subprocesses carry a finite spawn timeout", () => {
    expect(Number.isFinite(CLI_SPAWN_TIMEOUT_MS)).toBe(true);
    // Far enough above the worst legitimate invocation measured (3.01s) that
    // host load cannot reach it, and below the suite backstop so a hung child
    // is reported as a hung child rather than as a timed-out test.
    expect(CLI_SPAWN_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
    expect(CLI_SPAWN_TIMEOUT_MS).toBeLessThan(SUITE_TIMEOUT_MS);
  });

  /**
   * ...and prove the mechanism actually fires. A guard that is configured but
   * inert is worse than none, because it is trusted. Uses a short local budget
   * so the positive control costs a second rather than a minute.
   */
  test("spawnSync timeout kills a hung child with ETIMEDOUT", () => {
    const probeTimeoutMs = 1_000;
    const started = Date.now();
    const result = spawnSync(process.execPath, ["-e", "await new Promise(() => {})"], {
      timeout: probeTimeoutMs,
      encoding: "utf8",
    });

    expect((result.error as NodeJS.ErrnoException | undefined)?.code).toBe("ETIMEDOUT");
    expect(result.signal).toBe("SIGTERM");
    expect(Date.now() - started).toBeGreaterThanOrEqual(probeTimeoutMs);
  });
});
