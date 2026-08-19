import { describe, expect, test } from "bun:test";
import { callCliAdapter } from "./cli.js";

// Edge cases the base CLI-adapter suites do not reach: the timeout kill path,
// stdin delivery (the only input channel the adapter has), verbatim
// {{input}} substitution, and stderr-only failure output.

describe("CLI adapter — timeout, stdin, and failure edges", () => {
  test("kills a hung command after timeoutMs and reports the failure", async () => {
    const start = Date.now();
    const result = await callCliAdapter(
      { type: "cli", command: "sleep 30", timeoutMs: 300 },
      "x"
    );
    const elapsed = Date.now() - start;

    // Killed mid-run: no successful output, error reflects a non-zero exit
    expect(result.output).toBe("");
    expect(result.error).toBeTruthy();
    // Must have been killed by the timeout, not allowed to finish
    expect(elapsed).toBeLessThan(10_000);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("short timeout on a slow-but-finite command still fails fast", async () => {
    const result = await callCliAdapter(
      { type: "cli", command: "sleep 1 && echo done", timeoutMs: 100 },
      "x"
    );
    expect(result.error).toBeTruthy();
    expect(result.output).not.toContain("done");
  });

  test("delivers input to the command via stdin", async () => {
    const result = await callCliAdapter(
      { type: "cli", command: "read line; printf 'got:%s' \"$line\"" },
      "hello stdin"
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toBe("got:hello stdin");
  });

  test("replaces {{input}} verbatim including spaces and punctuation", async () => {
    const result = await callCliAdapter(
      { type: "cli", command: "printf '%s' '{{input}}'" },
      "a b c!"
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toBe("a b c!");
  });

  test("returns empty output and the exit code when only stderr is produced", async () => {
    const result = await callCliAdapter(
      { type: "cli", command: "echo oops >&2; exit 3" },
      "x"
    );
    // stdout is empty; stderr is captured but not surfaced as output
    expect(result.output).toBe("");
    expect(result.error).toContain("3");
  });

  test("env overrides are visible to the command and do not clobber the parent env", async () => {
    const result = await callCliAdapter(
      {
        type: "cli",
        command: "printf '%s|%s' \"$EVALS_CLI_EDGE\" \"$PATH\"",
        env: { EVALS_CLI_EDGE: "injected" },
      },
      "x"
    );
    expect(result.error).toBeUndefined();
    expect(result.output).toContain("injected");
    // PATH (inherited from process.env) must survive the env merge
    expect(result.output).toContain("/");
  });
});
