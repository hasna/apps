process.env.TESTERS_DB_PATH = ":memory:";

import { describe, expect, test } from "bun:test";
import { spawnSync } from "bun";

describe("testers-serve CLI", () => {
  test("--help exits cleanly without starting the HTTP server", () => {
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
    expect(proc.exitCode).toBe(0);
    expect(stdout).toContain("Usage: testers-serve [options]");
    expect(stdout).not.toContain("Open Testers server running at");
  });
});
