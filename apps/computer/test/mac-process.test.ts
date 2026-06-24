import { describe, expect, test } from "bun:test";
import { runMacProcess } from "../src/drivers/mac/process.js";

describe("mac process runner", () => {
  test("captures stdout and successful exit codes", async () => {
    const result = await runMacProcess(
      [process.execPath, "-e", "console.log('process-ok')"],
      { timeoutMs: 1_000 }
    );

    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.stdout.trim()).toBe("process-ok");
  });

  test("kills commands that exceed the controlled timeout", async () => {
    const result = await runMacProcess(
      [process.execPath, "-e", "setTimeout(() => {}, 10_000)"],
      { timeoutMs: 50 }
    );

    expect(result.exitCode).toBe(124);
    expect(result.timedOut).toBe(true);
    expect(result.aborted).toBe(false);
  });

  test("kills commands when the abort signal fires", async () => {
    const controller = new AbortController();
    const resultPromise = runMacProcess(
      [process.execPath, "-e", "setTimeout(() => {}, 10_000)"],
      { timeoutMs: 10_000, signal: controller.signal }
    );

    setTimeout(() => controller.abort("operator cancelled"), 50);
    const result = await resultPromise;

    expect(result.exitCode).toBe(130);
    expect(result.timedOut).toBe(false);
    expect(result.aborted).toBe(true);
    expect(result.stderr).toContain("operator cancelled");
  });
});
