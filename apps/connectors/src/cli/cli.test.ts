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
      expect(data.length).toBe(11);
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

  describe("non-TTY default command", () => {
    test("shows help instead of interactive UI", async () => {
      const { stdout, exitCode } = await run("interactive");
      // In non-TTY (piped to test), should show help
      expect(stdout).toContain("Non-interactive environment");
      expect(stdout).toContain("connectors list");
      expect(exitCode).toBe(0);
    });
  });
});
