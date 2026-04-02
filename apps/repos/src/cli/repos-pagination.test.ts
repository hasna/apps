import { describe, expect, test } from "bun:test";

describe("repos command pagination flags", () => {
  test("supports --offset with --json output", () => {
    const result = Bun.spawnSync({
      cmd: ["bun", "run", "src/cli/index.tsx", "repos", "--json", "--limit", "1", "--offset", "0"],
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });

    expect(result.exitCode).toBe(0);

    const output = new TextDecoder().decode(result.stdout);
    const parsed = JSON.parse(output) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
  });
});
