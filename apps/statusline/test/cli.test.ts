import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installClaude } from "../src/install";
import { statuslineVersion } from "../src/index";

function runCli(
  args: string[],
  options: { stdin?: string; home?: string } = {},
): { exitCode: number | null; stdout: string; stderr: string; home?: string } {
  const dir = mkdtempSync(join(tmpdir(), "statusline-cli-"));
  const env: Record<string, string | undefined> = {
    ...process.env,
    STATUSLINE_CONFIG: join(dir, "config.json"),
  };
  if (options.home) env.HOME = options.home;
  const proc = Bun.spawnSync(["bun", "src/cli.ts", ...args], {
    cwd: join(import.meta.dir, ".."),
    env,
    stdin: options.stdin ? new Blob([options.stdin]) : undefined,
    stdout: "pipe",
    stderr: "pipe",
  });
  rmSync(dir, { recursive: true, force: true });
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    home: options.home,
  };
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

  test("list prints enabled segments with padded ids", () => {
    const result = runCli(["list"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("[x]");
    expect(result.stdout).toContain("machine");
    expect(result.stdout).toContain("model-context");
  });

  test("render reads stdin JSON and prints statusline", () => {
    const stdin = JSON.stringify({
      cwd: process.cwd(),
      model: { id: "claude-fable-5[1m]", display_name: "Fable" },
      cost: { total_cost_usd: 0.04 },
    });
    const result = runCli(["render"], { stdin });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toContain("$0.04");
  });

  test("enable, disable, separator, preview, reset, and version", () => {
    expect(runCli(["enable", "duration"]).exitCode).toBe(0);
    expect(runCli(["disable", "duration"]).exitCode).toBe(0);
    const sep = runCli(["separator", " | "]);
    expect(sep.exitCode).toBe(0);
    expect(sep.stdout).toContain('separator: " | "');
    expect(runCli(["preview"]).exitCode).toBe(0);
    expect(runCli(["reset"]).exitCode).toBe(0);
    const version = runCli(["version"]);
    expect(version.exitCode).toBe(0);
    expect(version.stdout.trim()).toBe(statuslineVersion);
  });

  test("help and unknown command print usage", () => {
    const help = runCli(["help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("statusline render");
    const unknown = runCli(["not-a-command"]);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stdout).toContain("usage:");
  });

  test("unsupported install target errors", () => {
    const result = runCli(["install", "opencode"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('unsupported target "opencode"');
  });

  test("install claude writes settings via CLI with temp HOME", () => {
    const home = mkdtempSync(join(tmpdir(), "statusline-home-"));
    mkdirSync(join(home, ".claude"), { recursive: true });
    try {
      const result = runCli(["install", "claude"], { home });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("installed into");
      const settingsPath = join(home, ".claude", "settings.json");
      expect(existsSync(settingsPath)).toBe(true);
      const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
      expect(settings.statusLine).toEqual({ type: "command", command: expect.stringContaining("render") });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("installClaude backs up existing settings and wires command", () => {
    const dir = mkdtempSync(join(tmpdir(), "statusline-install-"));
    const settingsPath = join(dir, "settings.json");
    writeFileSync(settingsPath, JSON.stringify({ theme: "dark" }) + "\n");
    const written = installClaude(settingsPath);
    expect(written).toBe(settingsPath);
    expect(readFileSync(`${settingsPath}.bak-statusline`, "utf8")).toContain("theme");
    const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect(settings.theme).toBe("dark");
    expect(settings.statusLine.command).toMatch(/render$/);
    rmSync(dir, { recursive: true, force: true });
  });
});
