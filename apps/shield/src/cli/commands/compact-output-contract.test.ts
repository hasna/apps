import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function runCli(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "open-security-compact-cli-"));
  const proc = Bun.spawnSync(["bun", "run", "src/cli/index.tsx", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: dir,
      SECURITY_DB: join(dir, "shield.db"),
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

describe("CLI compact output contracts", () => {
  test("scan/findings/secrets expose limit and verbose disclosure flags", () => {
    const scan = source("src/cli/commands/scan.ts");
    const findings = source("src/cli/commands/findings.ts");
    const secrets = source("src/cli/commands/secrets.ts");

    for (const command of [scan, findings, secrets]) {
      expect(command).toContain("--limit <n>");
      expect(command).toContain("--verbose");
      expect(command).toContain("parseLimitOption");
    }

    expect(findings).toContain("--offset <n>");
    expect(secrets).toContain("function printTerminalSummary");
    expect(secrets).toContain("limit: displayLimit");
  });

  test("supply-chain lists are compact by default with detail paths", () => {
    const supplyChain = source("src/cli/commands/supply-chain.ts");

    expect(supplyChain).toContain("DEFAULT_ADVISORY_LIMIT");
    expect(supplyChain).toContain("--verbose");
    expect(supplyChain).toContain("--json");
    expect(supplyChain).toContain('command("advisory")');
    expect(supplyChain).toContain("printAdvisoryDetails");
    expect(supplyChain).toContain("more hidden. Use --verbose");
  });

  test("storage status keeps a compact default and verbose detail mode", () => {
    const storage = source("src/cli/commands/storage.ts");

    expect(storage).toContain('command("status")');
    expect(storage).toContain("--verbose");
    expect(storage).toContain("Tables:");
    expect(storage).toContain("Use --verbose for all table counts or --json for the full status object.");
  });

  test("advisories JSON remains full records while terminal output is compact", () => {
    const json = runCli(["advisories", "--json", "--limit", "1"]);
    expect(json.exitCode).toBe(0);
    expect(json.stderr).toBe("");
    const parsed = JSON.parse(json.stdout);
    expect(parsed.advisories).toBeArray();
    expect(parsed.advisories).toHaveLength(1);
    expect(parsed.advisories[0].affected_versions).toBeArray();
    expect(parsed.advisories[0].description).toBeString();

    const terminal = runCli(["advisories", "--limit", "1"]);
    expect(terminal.exitCode).toBe(0);
    expect(terminal.stdout).toContain("Supply Chain Advisories (showing 1+)");
    expect(terminal.stdout).toContain("More advisories available. Use --offset 1");
    expect(terminal.stdout).not.toContain("Affected:");
    expect(terminal.stdout).not.toContain("Description:");
  });
});
