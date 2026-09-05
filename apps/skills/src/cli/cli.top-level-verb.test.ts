import { describe, expect, test } from "bun:test";
import { runCli, stderrWithoutLocalNotice } from "./cli.test-utils.js";
import { useDefaultTestTimeout } from "../test-preload.js";

useDefaultTestTimeout();

/**
 * Regression tests for BUG e3997558 RESIDUAL: `skills <unknown top-level
 * verb>` exited rc=0 with 1556 bytes of compact discovery JSON on stdout and
 * empty stderr — byte-identical to the default `interactive` command's
 * non-TTY render — so an agent following docs that name a phantom verb
 * (or a skill name used as a top-level verb, e.g. `skills blog-article`)
 * concluded the command ran.
 *
 * The contract: an unrecognised TOP-LEVEL verb is rejected loudly, naming
 * the valid verbs, while every real verb from `skills --help` keeps
 * dispatching unchanged, and a bare `skills` (no args) keeps its default
 * discovery output.
 */

describe("skills top-level verb handling (e3997558 residual)", () => {
  test("an unknown top-level verb exits non-zero with valid verbs on stderr", async () => {
    const { stdout, stderr, exitCode } = await runCli(["zzz-unknown-verb-4471"]);
    expect(exitCode).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("unknown command");
    expect(stderr).toContain("zzz-unknown-verb-4471");
    // The message names at least the verbs the contract names as real.
    expect(stderr).toContain("list");
    expect(stderr).toContain("run");
    expect(stderr).toContain("mcp");
  });

  test("a real skill name used as a top-level verb is rejected, not silently swallowed", async () => {
    const { stdout, stderr, exitCode } = await runCli(["blog-article"]);
    expect(exitCode).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("unknown command");
    expect(stderr).toContain("blog-article");
    expect(stderr).toContain("run");
  });

  test("bare `skills` keeps the default compact discovery output", async () => {
    const { stdout, stderr, exitCode } = await runCli([]);
    expect(exitCode).toBe(0);
    expect(stderrWithoutLocalNotice(stderr)).toBe("");
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });

  test("real verbs still dispatch: list", async () => {
    const { stdout, stderr, exitCode } = await runCli(["list", "--json"]);
    expect(exitCode).toBe(0);
    expect(stderrWithoutLocalNotice(stderr)).toBe("");
    const parsed = JSON.parse(stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
  });

  test("real verbs still dispatch: mcp", async () => {
    const { stdout, exitCode } = await runCli(["mcp", "--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Usage: skills mcp");
  });

  test("`skills run <unknown-skill>` errors non-zero instead of silent success", async () => {
    const { stdout, stderr, exitCode } = await runCli(["run", "zzz-no-such-skill-4471"]);
    expect(exitCode).not.toBe(0);
    expect(stdout).toBe("");
    expect(stderr).toContain("not found");
  });
});
