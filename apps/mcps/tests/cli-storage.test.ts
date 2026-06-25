import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function runCli(args: string[], dataDir = mkdtempSync(join(tmpdir(), "mcps-cli-storage-"))) {
  const result = Bun.spawnSync({
    cmd: ["bun", "run", "src/cli/index.tsx", ...args],
    cwd: process.cwd(),
    env: {
      ...process.env,
      HASNA_MCPS_DATA_DIR: dataDir,
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    ...result,
    dataDir,
    stdoutText: new TextDecoder().decode(result.stdout),
    stderrText: new TextDecoder().decode(result.stderr),
  };
}

describe("mcps storage command", () => {
  it("advertises storage without a legacy cloud command", () => {
    const result = runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdoutText).toContain("storage");
    expect(result.stdoutText).not.toMatch(/\n\s+cloud(?:\s|$)/);
  });

  it("reports local storage status with canonical env names", () => {
    const compact = runCli(["storage", "status"]);
    expect(compact.exitCode).toBe(0);
    expect(compact.stdoutText).toContain("Storage Status");
    expect(compact.stdoutText).toContain("Mode:");
    expect(compact.stdoutText).toContain("Use --verbose or --json");

    const result = runCli(["storage", "status", "--json"]);
    const status = JSON.parse(result.stdoutText) as {
      configured: boolean;
      mode: string;
      env: string[];
      deprecatedEnv: string[];
      tables: string[];
    };

    expect(result.exitCode).toBe(0);
    expect(status.configured).toBe(false);
    expect(status.mode).toBe("local");
    expect(status.env).toEqual(["HASNA_MCPS_DATABASE_URL", "MCPS_DATABASE_URL"]);
    expect(status.deprecatedEnv).toEqual([]);
    expect(status.tables).toContain("servers");
    expect(status.tables).toContain("tool_cache");
  });
});
