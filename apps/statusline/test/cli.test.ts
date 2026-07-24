import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installClaude } from "../src/install";
import { statuslineVersion } from "../src/index";
import { defaultConfig } from "../src/config";
import { segments } from "../src/segments";

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

  test("list prints a compact enabled-first summary", () => {
    const result = runCli(["list"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Segments: ${defaultConfig().segments.length} enabled / ${segments.length} total`);
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

describe("cli list", () => {
  test("default output is compact and capped", () => {
    const out = runCli(["list"]);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain(`Segments: ${defaultConfig().segments.length} enabled / ${segments.length} total`);
    expect(out.stdout).toContain(`showing ${Math.min(12, segments.length)} of ${segments.length}`);
    expect(out.stdout).not.toContain("Machine hostname (short)");
    expect(out.stdout).toContain("cost");
    expect(out.stdout).not.toContain("used-tokens");
    expect(out.stdout).toContain("statusline show <id>");
  });

  test("verbose output includes descriptions", () => {
    const out = runCli(["list", "--verbose"]);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain(`showing ${Math.min(12, segments.length)} of ${segments.length}`);
    expect(out.stdout).toContain("description");
    expect(out.stdout).toContain("Machine hostname (short)");
  });

  test("explicit limit is honored with verbose output", () => {
    const out = runCli(["list", "--verbose", "--limit", "3"]);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("showing 3 of");
    expect(out.stdout).toContain("commit-age");
    expect(out.stdout).not.toContain("loc");
  });

  test("all shows every row", () => {
    const out = runCli(["list", "--all"]);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain(`showing ${segments.length} of ${segments.length}`);
    expect(out.stdout).toContain("used-tokens");
    expect(out.stdout).toContain("session-id");
  });

  test("json output returns full structured data by default", () => {
    const out = runCli(["list", "--json"]);
    expect(out.exitCode).toBe(0);
    const parsed = JSON.parse(out.stdout);
    expect(parsed.total).toBe(segments.length);
    expect(parsed.showing).toBe(segments.length);
    expect(parsed.segments[0]).toEqual({
      id: "machine",
      description: "Machine hostname (short)",
      enabled: true,
      defaultEnabled: true,
    });
  });

  test("limit and search reduce human rows", () => {
    const out = runCli(["list", "--search", "percentage", "--limit", "2"]);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("showing 2 of");
    expect(out.stdout).toContain("context-used");
    expect(out.stdout).toContain("context-remaining");
    expect(out.stdout).not.toContain("used-tokens");
  });

  test("search alias forwards list flags", () => {
    const out = runCli(["search", "token", "--json"]);
    expect(out.exitCode).toBe(0);
    const parsed = JSON.parse(out.stdout);
    expect(parsed.matching).toBe(1);
    expect(parsed.segments[0].id).toBe("used-tokens");
  });

  test("list help exposes disclosure options", () => {
    const out = runCli(["list", "--help"]);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("--limit <n>");
    expect(out.stdout).toContain("--enabled");
    expect(out.stdout).toContain("--disabled");
  });

  test("search requires a non-flag value", () => {
    const out = runCli(["list", "--search", "--json"]);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("missing value for --search");
  });
});

describe("cli show", () => {
  test("shows one segment in detail", () => {
    const out = runCli(["show", "model-context"]);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("Segment: model-context");
    expect(out.stdout).toContain("State: enabled");
    expect(out.stdout).toContain("Description: Model name with context-size tag");
  });

  test("supports json detail output", () => {
    const out = runCli(["inspect", "used-tokens", "--json"]);
    expect(out.exitCode).toBe(0);
    const parsed = JSON.parse(out.stdout);
    expect(parsed).toEqual({
      id: "used-tokens",
      description: "Total tokens in the context window (omitted when unknown)",
      enabled: false,
      defaultEnabled: false,
    });
  });

  test("unknown segment fails with discovery hint", () => {
    const out = runCli(["show", "not-a-segment"]);
    expect(out.exitCode).toBe(1);
    expect(out.stderr).toContain("unknown segment: not-a-segment");
    expect(out.stderr).toContain("statusline list --all");
  });
});
