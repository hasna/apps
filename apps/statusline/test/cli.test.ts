import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runCli(args: string[]): { exitCode: number | null; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "statusline-cli-"));
  try {
    const proc = Bun.spawnSync(["bun", "src/cli.ts", ...args], {
      env: {
        ...process.env,
        STATUSLINE_CONFIG: join(dir, "config.json"),
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      exitCode: proc.exitCode,
      stdout: proc.stdout.toString(),
      stderr: proc.stderr.toString(),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("CLI compatibility", () => {
  test("unknown segment keeps list hint", () => {
    const result = runCli(["enable", "not-a-segment"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("unknown segment(s): not-a-segment");
    expect(result.stderr).toContain("run `statusline list`");
  });

  test("order without segments keeps usage message", () => {
    const result = runCli(["order"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("usage: statusline order <segment> [segment...]");
  });
});
