import { describe, expect, test } from "bun:test";
import { getPackageVersion } from "../lib/package-info.js";

function runScript(script: string, ...args: string[]) {
  return Bun.spawnSync({
    cmd: ["bun", script, ...args],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PROMPTS_PORT: "0", MCP_HTTP_PORT: "0" },
  });
}

describe("entrypoint help/version flags", () => {
  test("mcp version exits without starting HTTP", () => {
    const result = runScript("src/mcp/index.ts", "--version");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe(getPackageVersion());
    expect(result.stderr.toString()).not.toContain("HTTP listening");
  });

  test("mcp help exits without starting HTTP", () => {
    const result = runScript("src/mcp/index.ts", "--help");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Usage: prompts-mcp");
    expect(result.stderr.toString()).not.toContain("HTTP listening");
  });

  test("server version exits without starting HTTP", () => {
    const result = runScript("src/server/index.ts", "--version");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString().trim()).toBe(getPackageVersion());
    expect(result.stderr.toString()).toBe("");
  });

  test("server help exits without starting HTTP", () => {
    const result = runScript("src/server/index.ts", "--help");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("Usage: prompts-serve");
    expect(result.stderr.toString()).toBe("");
  });

  test("server rejects invalid port values before startup", () => {
    const result = runScript("src/server/index.ts", "--port", "not-a-port");
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("Invalid --port value");
  });

  test("server help and version bypass invalid port validation", () => {
    const help = runScript("src/server/index.ts", "--help", "--port", "not-a-port");
    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString()).toContain("Usage: prompts-serve");
    expect(help.stderr.toString()).toBe("");

    const version = runScript("src/server/index.ts", "--version", "--port", "not-a-port");
    expect(version.exitCode).toBe(0);
    expect(version.stdout.toString().trim()).toBe(getPackageVersion());
    expect(version.stderr.toString()).toBe("");
  });
});
