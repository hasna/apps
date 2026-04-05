process.env.TESTERS_DB_PATH = ":memory:";

import { describe, expect, test } from "bun:test";
import { spawnSync } from "bun";

describe("testers-mcp CLI", () => {
  test("--help exits cleanly without booting MCP runtime", () => {
    const entry = new URL("./index.ts", import.meta.url).pathname;
    const proc = spawnSync({
      cmd: ["bun", "run", entry, "--help"],
      env: {
        ...process.env,
        TESTERS_DB_PATH: ":memory:",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const stdout = proc.stdout.toString();
    const stderr = proc.stderr.toString();
    expect(proc.exitCode).toBe(0);
    expect(stdout).toContain("Usage: testers-mcp [options]");
    expect(stderr).not.toContain("Tool wait_for_run is already registered");
  });
});
