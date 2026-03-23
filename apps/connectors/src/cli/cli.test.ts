import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

const CLI = join(import.meta.dir, "..", "..", "bin", "index.js");
const TEST_DIR = join(import.meta.dir, "..", "..", ".test-cli-tmp");

function cleanup() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true });
  }
}

async function run(args: string | string[], cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const argv = Array.isArray(args) ? args : args.split(" ").filter(Boolean);
  const proc = Bun.spawn(["bun", CLI, ...argv], {
    cwd: cwd || TEST_DIR,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NO_COLOR: "1" },
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

beforeEach(() => {
  cleanup();
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  cleanup();
});

describe("CLI", () => {
  describe("--help", () => {
    test("shows help text", async () => {
      const { stdout } = await run("--help");
      expect(stdout).toContain("connectors");
      expect(stdout).toContain("install");
      expect(stdout).toContain("list");
      expect(stdout).toContain("search");
      expect(stdout).toContain("remove");
      expect(stdout).toContain("info");
      expect(stdout).toContain("categories");
    });
  });

  describe("--version", () => {
    test("shows version", async () => {
      const { stdout } = await run("--version");
      expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  describe("categories", () => {
    test("lists all categories", async () => {
      const { stdout } = await run("categories");
      expect(stdout).toContain("AI & ML");
      expect(stdout).toContain("Developer Tools");
      expect(stdout).toContain("Commerce & Finance");
    });

    test("--json outputs valid JSON array", async () => {
      const { stdout } = await run("categories --json");
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(11);
      expect(data[0]).toHaveProperty("name");
      expect(data[0]).toHaveProperty("count");
      expect(data[0].count).toBeGreaterThan(0);
    });
  });

  describe("list", () => {
    test("lists all connectors", async () => {
      const { stdout } = await run("list");
      expect(stdout).toContain("AI & ML");
      expect(stdout).toContain("anthropic");
      expect(stdout).toContain("stripe");
    });

    test("--category filters by category", async () => {
      const { stdout } = await run(["list", "--category", "AI & ML"]);
      expect(stdout).toContain("anthropic");
      expect(stdout).toContain("openai");
      expect(stdout).not.toContain("stripe");
    });

    test("--category with invalid category shows error", async () => {
      const { stdout } = await run("list --category Nonexistent");
      expect(stdout).toContain("Unknown category");
    });

    test("--json outputs valid JSON array", async () => {
      const { stdout } = await run("list --json");
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(50);
      expect(data[0]).toHaveProperty("name");
      expect(data[0]).toHaveProperty("version");
      expect(data[0]).toHaveProperty("category");
    });

    test("--category --json outputs filtered JSON", async () => {
      const { stdout } = await run(["list", "--category", "AI & ML", "--json"]);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      for (const item of data) {
        expect(item.category).toBe("AI & ML");
      }
    });

    test("--category invalid --json outputs error JSON", async () => {
      const { stdout, exitCode } = await run("list --category Nonexistent --json");
      const data = JSON.parse(stdout);
      expect(data).toHaveProperty("error");
      expect(exitCode).toBe(1);
    });

    test("--installed shows no connectors initially", async () => {
      const { stdout } = await run("list --installed");
      expect(stdout).toContain("No connectors installed");
    });

    test("--installed --json outputs empty array initially", async () => {
      const { stdout } = await run("list --installed --json");
      const data = JSON.parse(stdout);
      expect(data).toEqual([]);
    });

    test("--installed shows installed connectors after install", async () => {
      await run("install anthropic");
      const { stdout } = await run("list --installed");
      expect(stdout).toContain("anthropic");
    });
  });

  describe("search", () => {
    test("finds connectors by name", async () => {
      const { stdout } = await run("search figma");
      expect(stdout).toContain("figma");
      expect(stdout).toContain("Design");
    });

    test("finds connectors by keyword", async () => {
      const { stdout } = await run("search payment");
      expect(stdout).toContain("stripe");
    });

    test("shows message when no results", async () => {
      const { stdout } = await run("search zzzznonexistent");
      expect(stdout).toContain("No connectors found");
    });

    test("--json outputs valid JSON array", async () => {
      const { stdout } = await run("search ai --json");
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
    });

    test("--json returns empty array for no results", async () => {
      const { stdout } = await run("search zzzznonexistent --json");
      const data = JSON.parse(stdout);
      expect(data).toEqual([]);
    });
  });

  describe("info", () => {
    test("shows connector info", async () => {
      const { stdout } = await run("info stripe");
      expect(stdout).toContain("Stripe");
      expect(stdout).toContain("Commerce & Finance");
      expect(stdout).toContain("payments");
      expect(stdout).toContain("@hasna/connect-stripe");
    });

    test("shows installed status", async () => {
      const { stdout: before } = await run("info anthropic");
      expect(before).toContain("Installed:");

      await run("install anthropic");
      const { stdout: after } = await run("info anthropic");
      expect(after).toContain("yes");
    });

    test("--json outputs valid JSON", async () => {
      const { stdout } = await run("info stripe --json");
      const data = JSON.parse(stdout);
      expect(data.name).toBe("stripe");
      expect(data.category).toBe("Commerce & Finance");
      expect(data).toHaveProperty("version");
      expect(data).toHaveProperty("installed");
    });

    test("errors for non-existent connector", async () => {
      const { stdout, exitCode } = await run("info nonexistent");
      expect(stdout).toContain("not found");
      expect(exitCode).toBe(1);
    });

    test("--json errors for non-existent connector", async () => {
      const { stdout, exitCode } = await run("info nonexistent --json");
      const data = JSON.parse(stdout);
      expect(data).toHaveProperty("error");
      expect(exitCode).toBe(1);
    });
  });

  describe("install", () => {
    test("installs a single connector", async () => {
      const { stdout, exitCode } = await run("install anthropic");
      expect(stdout).toContain("✓");
      expect(stdout).toContain("anthropic");
      expect(exitCode).toBe(0);

      const dest = join(TEST_DIR, ".connectors", "connect-anthropic");
      expect(existsSync(dest)).toBe(true);
    });

    test("installs multiple connectors", async () => {
      const { stdout, exitCode } = await run("install anthropic figma");
      expect(stdout).toContain("anthropic");
      expect(stdout).toContain("figma");
      expect(exitCode).toBe(0);
    });

    test("errors for non-existent connector", async () => {
      const { stdout, exitCode } = await run("install nonexistent-xyz");
      expect(stdout).toContain("✗");
      expect(exitCode).toBe(1);
    });

    test("errors when already installed without overwrite", async () => {
      await run("install anthropic");
      const { stdout, exitCode } = await run("install anthropic");
      expect(stdout).toContain("Already installed");
      expect(exitCode).toBe(1);
    });

    test("succeeds with --overwrite", async () => {
      await run("install anthropic");
      const { stdout, exitCode } = await run("install anthropic --overwrite");
      expect(stdout).toContain("✓");
      expect(exitCode).toBe(0);
    });

    test("--json outputs valid JSON array", async () => {
      const { stdout, exitCode } = await run("install anthropic --json");
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data[0].connector).toBe("anthropic");
      expect(data[0].success).toBe(true);
      expect(data[0].path).toBeDefined();
      expect(exitCode).toBe(0);
    });

    test("--json with failure returns exit code 1", async () => {
      const { stdout, exitCode } = await run("install nonexistent-xyz --json");
      const data = JSON.parse(stdout);
      expect(data[0].success).toBe(false);
      expect(exitCode).toBe(1);
    });

    test("errors with no args in non-TTY", async () => {
      const { stderr, exitCode } = await run("install");
      expect(stderr).toContain("specify connectors");
      expect(exitCode).toBe(1);
    });
  });

  describe("remove", () => {
    test("removes an installed connector", async () => {
      await run("install anthropic");
      const { stdout, exitCode } = await run("remove anthropic");
      expect(stdout).toContain("✓");
      expect(stdout).toContain("Removed");
      expect(exitCode).toBe(0);

      const dest = join(TEST_DIR, ".connectors", "connect-anthropic");
      expect(existsSync(dest)).toBe(false);
    });

    test("errors for non-installed connector", async () => {
      const { stdout, exitCode } = await run("remove nonexistent");
      expect(stdout).toContain("✗");
      expect(exitCode).toBe(1);
    });

    test("--json outputs valid JSON", async () => {
      await run("install anthropic");
      const { stdout, exitCode } = await run("remove anthropic --json");
      const data = JSON.parse(stdout);
      expect(data.connector).toBe("anthropic");
      expect(data.removed).toBe(true);
      expect(exitCode).toBe(0);
    });

    test("--json with failure", async () => {
      const { stdout, exitCode } = await run("remove nonexistent --json");
      const data = JSON.parse(stdout);
      expect(data.removed).toBe(false);
      expect(exitCode).toBe(1);
    });
  });

  describe("docs", () => {
    test("shows connector documentation", async () => {
      const { stdout, exitCode } = await run("docs stripe");
      expect(stdout).toContain("Stripe");
      expect(stdout).toContain("Authentication");
      expect(stdout).toContain("STRIPE_API_KEY");
      expect(stdout).toContain("Environment Variables");
      expect(exitCode).toBe(0);
    });

    test("shows CLI commands when available", async () => {
      const { stdout } = await run("docs stripe");
      expect(stdout).toContain("CLI Commands");
      expect(stdout).toContain("connect-stripe");
    });

    test("--json outputs structured documentation", async () => {
      const { stdout, exitCode } = await run("docs stripe --json");
      const data = JSON.parse(stdout);
      expect(data.name).toBe("stripe");
      expect(data.overview).toContain("Stripe");
      expect(data.auth).toContain("Bearer");
      expect(Array.isArray(data.envVars)).toBe(true);
      expect(data.envVars.length).toBeGreaterThan(0);
      expect(data.envVars[0]).toHaveProperty("variable");
      expect(data.envVars[0]).toHaveProperty("description");
      expect(data.cliCommands).toBeTruthy();
      expect(data).toHaveProperty("version");
      expect(data).toHaveProperty("category");
      expect(exitCode).toBe(0);
    });

    test("--raw outputs full markdown", async () => {
      const { stdout, exitCode } = await run("docs stripe --raw");
      expect(stdout).toContain("# CLAUDE.md");
      expect(stdout).toContain("## Project Overview");
      expect(stdout).toContain("## Environment Variables");
      expect(exitCode).toBe(0);
    });

    test("errors for non-existent connector", async () => {
      const { stdout, exitCode } = await run("docs nonexistent");
      expect(stdout).toContain("not found");
      expect(exitCode).toBe(1);
    });

    test("--json errors for non-existent connector", async () => {
      const { stdout, exitCode } = await run("docs nonexistent --json");
      const data = JSON.parse(stdout);
      expect(data).toHaveProperty("error");
      expect(exitCode).toBe(1);
    });

    test("shows env vars for gmail connector", async () => {
      const { stdout } = await run("docs gmail --json");
      const data = JSON.parse(stdout);
      expect(data.envVars.some((v: any) => v.variable === "GMAIL_CLIENT_ID")).toBe(true);
      expect(data.auth).toContain("OAuth");
    });
  });

  describe("docs edge cases", () => {
    test("--raw returns raw markdown for anthropic", async () => {
      const { stdout } = await run("docs anthropic --raw");
      expect(stdout).toContain("# CLAUDE.md");
      expect(stdout).toContain("ANTHROPIC_API_KEY");
    });

    test("shows data storage section", async () => {
      const { stdout } = await run("docs gmail");
      expect(stdout).toContain("Data Storage");
      expect(stdout).toContain(".connectors/connect-gmail");
    });

    test("shows overview section", async () => {
      const { stdout } = await run("docs figma");
      expect(stdout).toContain("Overview");
      expect(stdout).toContain("Figma");
    });
  });

  describe("list edge cases", () => {
    test("--category case-insensitive matching", async () => {
      const { stdout } = await run(["list", "--category", "ai & ml"]);
      expect(stdout).toContain("anthropic");
    });

    test("list shows version column", async () => {
      const { stdout } = await run("list");
      expect(stdout).toContain("Version");
      // Check a known version shows up
      expect(stdout).toMatch(/\d+\.\d+\.\d+/);
    });

    test("list --installed --json after install", async () => {
      await run("install anthropic figma");
      const { stdout } = await run("list --installed --json");
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      const names = data.map((s: { name: string }) => s.name);
      expect(names).toContain("anthropic");
      expect(names).toContain("figma");
      // Each entry should have auth status fields
      for (const entry of data) {
        expect(entry).toHaveProperty("name");
        expect(entry).toHaveProperty("category");
        expect(entry).toHaveProperty("authType");
        expect(entry).toHaveProperty("configured");
      }
    });
  });

  describe("search edge cases", () => {
    test("search finds by tag 'llm'", async () => {
      const { stdout } = await run("search llm");
      expect(stdout).toContain("anthropic");
      expect(stdout).toContain("openai");
    });

    test("search --json returns proper structure", async () => {
      const { stdout } = await run("search stripe --json");
      const data = JSON.parse(stdout);
      expect(data[0]).toHaveProperty("name");
      expect(data[0]).toHaveProperty("version");
      expect(data[0]).toHaveProperty("category");
      expect(data[0]).toHaveProperty("description");
    });
  });

  describe("info edge cases", () => {
    test("shows tags in info output", async () => {
      const { stdout } = await run("info anthropic");
      expect(stdout).toContain("Tags:");
      expect(stdout).toContain("ai");
      expect(stdout).toContain("llm");
    });

    test("shows package name", async () => {
      const { stdout } = await run("info figma");
      expect(stdout).toContain("@hasna/connect-figma");
    });

    test("--json includes all metadata fields", async () => {
      const { stdout } = await run("info gmail --json");
      const data = JSON.parse(stdout);
      expect(data).toHaveProperty("name");
      expect(data).toHaveProperty("displayName");
      expect(data).toHaveProperty("version");
      expect(data).toHaveProperty("category");
      expect(data).toHaveProperty("description");
      expect(data).toHaveProperty("tags");
      expect(data).toHaveProperty("installed");
    });
  });

  describe("install edge cases", () => {
    test("install updates index.ts correctly", async () => {
      await run("install anthropic stripe");
      const indexPath = join(TEST_DIR, ".connectors", "index.ts");
      const { readFileSync } = await import("fs");
      const content = readFileSync(indexPath, "utf-8");
      expect(content).toContain("export * as anthropic");
      expect(content).toContain("export * as stripe");
    });

    test("--json with mixed success/failure", async () => {
      const { stdout, exitCode } = await run("install anthropic nonexistent-xyz --json");
      const data = JSON.parse(stdout);
      expect(data).toHaveLength(2);
      expect(data[0].success).toBe(true);
      expect(data[1].success).toBe(false);
      expect(exitCode).toBe(1);
    });
  });

  describe("non-TTY default command", () => {
    test("shows help instead of interactive UI", async () => {
      const { stdout, exitCode } = await run("interactive");
      expect(stdout).toContain("Non-interactive environment");
      expect(stdout).toContain("connectors list");
      expect(stdout).toContain("connectors info");
      expect(exitCode).toBe(0);
    });
  });

  // ── --brief flag ──

  describe("list --brief", () => {
    test("outputs only names as JSON array", async () => {
      const { stdout, exitCode } = await run("list --brief --json");
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(50);
      expect(typeof data[0]).toBe("string");
      expect(data).toContain("stripe");
    });

    test("outputs names one per line without --json", async () => {
      const { stdout, exitCode } = await run("list --brief");
      expect(exitCode).toBe(0);
      const lines = stdout.trim().split("\n");
      expect(lines.length).toBeGreaterThan(50);
      expect(lines).toContain("stripe");
      expect(lines).toContain("anthropic");
    });

    test("works with --category filter", async () => {
      const { stdout, exitCode } = await run(["list", "--brief", "--json", "--category", "AI & ML"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data).toContain("anthropic");
      expect(data).toContain("openai");
      expect(data).not.toContain("stripe");
    });

    test("works with --installed", async () => {
      const { stdout, exitCode } = await run("list --brief --installed --json");
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
    });
  });

  // ── install --category ──

  describe("install --category", () => {
    test("installs all connectors in a category", async () => {
      const { stdout, exitCode } = await run(["install", "--category", "Patents & IP", "--json"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0].success).toBe(true);
      expect(data[0].connector).toBe("uspto");
    });

    test("errors for unknown category", async () => {
      const { stdout, exitCode } = await run(["install", "--category", "Nonexistent", "--json"]);
      expect(exitCode).toBe(1);
      const data = JSON.parse(stdout);
      expect(data.error).toContain("Unknown category");
    });
  });

  // ── export ──

  describe("export", () => {
    test("outputs valid JSON with connectors and exportedAt", async () => {
      const { stdout, exitCode } = await run("export");
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data).toHaveProperty("connectors");
      expect(data).toHaveProperty("exportedAt");
      expect(typeof data.connectors).toBe("object");
    });
  });

  // ── import ──

  describe("import", () => {
    test("errors for non-existent file", async () => {
      const { exitCode } = await run("import nonexistent.json");
      expect(exitCode).toBe(1);
    });

    test("imports valid backup file", async () => {
      const { writeFileSync } = await import("fs");
      const backupFile = join(TEST_DIR, "backup.json");
      writeFileSync(backupFile, JSON.stringify({
        connectors: {
          [`zzztest${process.pid}imp`]: {
            profiles: { default: { apiKey: "test-key" } },
          },
        },
      }));

      const { stdout, exitCode } = await run(["import", backupFile, "--json"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.success).toBe(true);
      expect(data.imported).toBe(1);

      // Cleanup
      const { homedir } = await import("os");
      const dir = join(homedir(), ".hasna", "connectors", `connect-zzztest${process.pid}imp`);
      if (existsSync(dir)) rmSync(dir, { recursive: true });
    });
  });

  // ── upgrade ──

  describe("upgrade", () => {
    test("--check --json returns version info", async () => {
      const { stdout, exitCode } = await run("upgrade --check --json");
      const data = JSON.parse(stdout);
      expect(data).toHaveProperty("current");
      expect(data).toHaveProperty("latest");
      expect(data).toHaveProperty("upToDate");
      expect(typeof data.current).toBe("string");
      expect(typeof data.latest).toBe("string");
      // exitCode 0 if up to date, 1 if not
      expect([0, 1]).toContain(exitCode);
    });
  });

  // ── completions ──

  describe("completions", () => {
    test("outputs zsh completions", async () => {
      const { stdout, exitCode } = await run("completions zsh");
      expect(exitCode).toBe(0);
      expect(stdout).toContain("#compdef connectors");
      expect(stdout).toContain("stripe");
      expect(stdout).toContain("install");
    });

    test("outputs bash completions", async () => {
      const { stdout, exitCode } = await run("completions bash");
      expect(exitCode).toBe(0);
      expect(stdout).toContain("complete -F _connectors connectors");
      expect(stdout).toContain("stripe");
    });

    test("outputs fish completions", async () => {
      const { stdout, exitCode } = await run("completions fish");
      expect(exitCode).toBe(0);
      expect(stdout).toContain("complete -c connectors");
      expect(stdout).toContain("stripe");
    });

    test("errors for unknown shell", async () => {
      const { exitCode } = await run("completions powershell");
      expect(exitCode).toBe(1);
    });
  });

  // ── env ──

  describe("env", () => {
    test("outputs env vars as JSON when connectors installed", async () => {
      // Install a connector first
      await run("install anthropic");
      const { stdout, exitCode } = await run("env --json");
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data).toHaveProperty("vars");
      expect(data).toHaveProperty("connectors");
      expect(Array.isArray(data.vars)).toBe(true);
      expect(data.vars.some((v: any) => v.variable === "ANTHROPIC_API_KEY")).toBe(true);
    });

    test("outputs .env format to stdout", async () => {
      await run("install anthropic");
      const { stdout, exitCode } = await run("env");
      expect(exitCode).toBe(0);
      expect(stdout).toContain("ANTHROPIC_API_KEY=");
      expect(stdout).toContain("# anthropic");
    });

    test("writes to file with -o flag", async () => {
      await run("install anthropic");
      const outFile = join(TEST_DIR, ".env.example");
      const { exitCode } = await run(["env", "-o", outFile]);
      expect(exitCode).toBe(0);
      expect(existsSync(outFile)).toBe(true);
      const { readFileSync: readFile } = await import("fs");
      const content = readFile(outFile, "utf-8");
      expect(content).toContain("ANTHROPIC_API_KEY=");
    });
  });

  // ── presets ──

  describe("presets", () => {
    test("lists all presets as JSON", async () => {
      const { stdout, exitCode } = await run("presets --json");
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(6);
      const ai = data.find((p: any) => p.name === "ai");
      expect(ai).toBeDefined();
      expect(ai.connectors).toContain("anthropic");
      expect(ai.connectors).toContain("openai");
    });

    test("lists presets in human format", async () => {
      const { stdout, exitCode } = await run("presets");
      expect(exitCode).toBe(0);
      expect(stdout).toContain("fullstack");
      expect(stdout).toContain("ai");
      expect(stdout).toContain("google");
      expect(stdout).toContain("social");
    });
  });

  // ── install --preset ──

  describe("install --preset", () => {
    test("installs preset connectors", async () => {
      const { stdout, exitCode } = await run(["install", "--preset", "commerce", "--json"]);
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThanOrEqual(4);
      expect(data.every((r: any) => r.success)).toBe(true);
    });

    test("errors for unknown preset", async () => {
      const { stdout, exitCode } = await run(["install", "--preset", "nonexistent", "--json"]);
      expect(exitCode).toBe(1);
      const data = JSON.parse(stdout);
      expect(data.error).toContain("Unknown preset");
    });
  });

  // ── whoami ──

  describe("whoami", () => {
    test("returns setup summary as JSON", async () => {
      const { stdout, exitCode } = await run("whoami --json");
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data).toHaveProperty("version");
      expect(data).toHaveProperty("configDir");
      expect(data).toHaveProperty("installed");
      expect(data).toHaveProperty("configured");
      expect(data).toHaveProperty("unconfigured");
      expect(typeof data.version).toBe("string");
      expect(typeof data.installed).toBe("number");
    });

    test("shows human-readable output", async () => {
      const { stdout, exitCode } = await run("whoami");
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Connectors Setup");
      expect(stdout).toContain("Version");
      expect(stdout).toContain("Config");
    });
  });

  // ── test command ──

  describe("test", () => {
    test("returns JSON with results for non-existent connector", async () => {
      const { stdout, exitCode } = await run("test nonexistent-xyz --json");
      expect(exitCode).toBe(1);
      const data = JSON.parse(stdout);
      expect(data.error).toContain("not found");
    });

    test("returns empty results when nothing installed", async () => {
      const { stdout, exitCode } = await run("test --json");
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.results).toEqual([]);
      expect(data.tested).toBe(0);
    });

    test("skips connectors without test endpoints", async () => {
      await run("install shopify");
      const { stdout, exitCode } = await run("test --json");
      const data = JSON.parse(stdout);
      const shopify = data.results.find((r: any) => r.name === "shopify");
      if (shopify) {
        expect(["skip", "no-key"]).toContain(shopify.status);
      }
    });
  });

  describe("ops", () => {
    test("lists operations for a connector", async () => {
      const { stdout, exitCode } = await run("ops stripe");
      expect(exitCode).toBe(0);
      expect(stdout).toContain("Stripe operations:");
      expect(stdout).toContain("products");
      expect(stdout).toContain("customers");
    });

    test("shows JSON output with --json", async () => {
      const { stdout, exitCode } = await run("ops stripe --json");
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.connector).toBe("stripe");
      expect(data.commands).toContain("products");
    });

    test("shows subcommand help", async () => {
      const { stdout, exitCode } = await run("ops stripe products");
      expect(exitCode).toBe(0);
      expect(stdout).toContain("products");
      expect(stdout).toContain("list");
      expect(stdout).toContain("create");
    });

    test("errors on unknown connector", async () => {
      const { exitCode } = await run("ops zzzznonexistent");
      expect(exitCode).not.toBe(0);
    });

    test("lists operations for gmail", async () => {
      const { stdout, exitCode } = await run("ops gmail --json");
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.connector).toBe("gmail");
      expect(data.commands).toContain("messages");
    });

    test("lists operations for anthropic", async () => {
      const { stdout, exitCode } = await run("ops anthropic --json");
      expect(exitCode).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.commands).toContain("messages");
      expect(data.commands).toContain("models");
    });

    test("lists operations for all 62 connectors", async () => {
      const connectors = [
        "anthropic", "aws", "brandsight", "cloudflare", "discord", "docker",
        "e2b", "elevenlabs", "exa", "figma", "firecrawl", "github",
        "gmail", "google", "googlecalendar", "googlecloud", "googlecontacts",
        "googledocs", "googledrive", "googlegemini", "googlemaps", "googlesheets",
        "googletasks", "hedra", "heygen", "huggingface", "icons8", "maropost",
        "mercury", "meta", "midjourney", "mistral", "mixpanel", "notion",
        "openai", "openweathermap", "pandadoc", "quo", "reddit", "reducto",
        "resend", "revolut", "sedo", "sentry", "shadcn", "shopify",
        "snap", "stabilityai", "stripe", "stripeatlas", "substack", "tiktok",
        "tinker", "twilio", "uspto", "webflow", "wix", "x", "xads", "xai",
        "youtube", "zoom",
      ];

      for (const name of connectors) {
        const { stdout, exitCode } = await run(`ops ${name} --json`);
        expect(exitCode).toBe(0);
        const data = JSON.parse(stdout);
        expect(data.connector).toBe(name);
        expect(data.commands.length).toBeGreaterThan(0);
      }
    }, 120000);
  });

  describe("run", () => {
    test("runs connector operation", async () => {
      const { stdout, exitCode } = await run("run anthropic models");
      expect(exitCode).toBe(0);
      expect(stdout).toContain("claude");
    });

    test("errors on unknown connector", async () => {
      const { exitCode } = await run("run zzzznonexistent test");
      expect(exitCode).not.toBe(0);
    });

    test("errors with no command", async () => {
      const { exitCode } = await run("run stripe");
      expect(exitCode).not.toBe(0);
    });

    test("shows help text from --help", async () => {
      const { stdout, exitCode } = await run("--help");
      expect(stdout).toContain("ops");
      expect(stdout).toContain("run");
    });
  });
});
