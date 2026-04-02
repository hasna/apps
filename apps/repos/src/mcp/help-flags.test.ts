import { describe, expect, test } from "bun:test";

function runScript(script: string, ...args: string[]) {
  return Bun.spawnSync({
    cmd: ["bun", "run", script, ...args],
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
}

describe("entrypoint help/version flags", () => {
  test("mcp help exits cleanly and prints usage", () => {
    const result = runScript("src/mcp/index.ts", "--help");
    const out = new TextDecoder().decode(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(out).toContain("Usage: repos-mcp [options]");
  });

  test("server help exits cleanly without starting server", () => {
    const result = runScript("src/server/index.ts", "--help");
    const out = new TextDecoder().decode(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(out).toContain("Usage: repos-serve [options]");
    expect(out).not.toContain("repos server running");
  });

  test("mcp version returns semver", () => {
    const result = runScript("src/mcp/index.ts", "--version");
    const out = new TextDecoder().decode(result.stdout).trim();

    expect(result.exitCode).toBe(0);
    expect(out).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("server version returns semver", () => {
    const result = runScript("src/server/index.ts", "--version");
    const out = new TextDecoder().decode(result.stdout).trim();

    expect(result.exitCode).toBe(0);
    expect(out).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
