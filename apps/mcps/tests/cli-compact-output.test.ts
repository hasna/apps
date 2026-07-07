import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function runCli(args: string[], dataDir = mkdtempSync(join(tmpdir(), "mcps-cli-compact-"))) {
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

describe("compact CLI output", () => {
  it("keeps list compact by default and discloses details explicitly", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "mcps-cli-compact-"));
    const add = runCli([
      "add",
      "--yes",
      "--name",
      "Noisy Server",
      "--description",
      "This description is intentionally long enough to exercise compact truncation in the default server list output.",
      "npx",
      "-y",
      "@example/noisy-mcp",
    ], dataDir);
    expect(add.exitCode).toBe(0);

    const compact = runCli(["list"], dataDir);
    expect(compact.exitCode).toBe(0);
    expect(compact.stdoutText).toContain("Noisy Server");
    expect(compact.stdoutText).not.toContain("npx -y @example/noisy-mcp");
    expect(compact.stdoutText).toContain("Use --verbose");

    const verbose = runCli(["list", "--verbose"], dataDir);
    expect(verbose.exitCode).toBe(0);
    expect(verbose.stdoutText).toContain("Command:");
    expect(verbose.stdoutText).toContain("npx -y @example/noisy-mcp");

    const json = runCli(["list", "--json"], dataDir);
    expect(json.exitCode).toBe(0);
    const servers = JSON.parse(json.stdoutText);
    expect(servers[0].args).toEqual(["-y", "@example/noisy-mcp"]);
  });

  it("keeps tools --json parseable while default tools output is compact", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "mcps-cli-compact-"));
    const compact = runCli(["tools"], dataDir);
    expect(compact.exitCode).toBe(0);
    expect(compact.stdoutText).toContain("No cached tools");

    const json = runCli(["tools", "--json"], dataDir);
    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdoutText)).toEqual([]);
  });
});
