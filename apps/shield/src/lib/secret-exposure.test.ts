import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  scanRunningProcesses,
  scanSecretExposure,
  scanTmuxPanes,
  summarizeSecretExposure,
  type CommandRunner,
} from "./secret-exposure.js";
import { ScannerType } from "../types/index.js";

describe("secret exposure", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "secret-exposure-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("scanSecretExposure combines repo files and git history findings", async () => {
    execFileSync("git", ["init"], { cwd: tempDir, encoding: "utf-8" });
    execFileSync("git", ["config", "user.email", "julia@example.com"], { cwd: tempDir, encoding: "utf-8" });
    execFileSync("git", ["config", "user.name", "Julia"], { cwd: tempDir, encoding: "utf-8" });

    const githubToken = "ghp_" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ab";
    writeFileSync(join(tempDir, ".env"), `CURRENT_TOKEN=${githubToken}\n`, "utf-8");
    writeFileSync(join(tempDir, "history.txt"), `TOKEN=${githubToken}\n`, "utf-8");
    execFileSync("git", ["add", ".env", "history.txt"], { cwd: tempDir, encoding: "utf-8" });
    execFileSync("git", ["commit", "-m", "add secret"], { cwd: tempDir, encoding: "utf-8" });

    writeFileSync(join(tempDir, "history.txt"), "TOKEN=removed\n", "utf-8");
    execFileSync("git", ["add", "history.txt"], { cwd: tempDir, encoding: "utf-8" });
    execFileSync("git", ["commit", "-m", "remove secret"], { cwd: tempDir, encoding: "utf-8" });

    const result = await scanSecretExposure({
      path: tempDir,
      include_processes: false,
      include_tmux: false,
    });

    expect(result.findings.some((finding) => finding.file === ".env")).toBe(true);
    expect(result.findings.some((finding) => finding.scanner_type === ScannerType.GitHistory)).toBe(true);

    const summary = summarizeSecretExposure(result.findings);
    expect(summary.total).toBe(result.findings.length);
    expect(summary.critical).toBeGreaterThan(0);
  });

  test("scanRunningProcesses inspects process environment snapshots", () => {
    const githubToken = "ghp_" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890ab";
    const runner: CommandRunner = (_command, _args) => `123 USER=me GITHUB_TOKEN=${githubToken} node server.js\n`;

    const findings = scanRunningProcesses(runner);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].file).toBe("process:123");
    expect(findings[0].message).toContain("running process 123");
  });

  test("scanTmuxPanes inspects pane metadata and history", () => {
    const awsKey = "AKIAIOSFODNN7EXAMPLE";
    const runner: CommandRunner = (command, args) => {
      if (command !== "tmux") throw new Error("unexpected command");
      if (args[0] === "list-panes") {
        return `%1\tworkspace\tmain\t${awsKey}\tbash\tworkspace:0.0\n`;
      }
      if (args[0] === "capture-pane") {
        return "history is clean\n";
      }
      throw new Error("unexpected tmux args");
    };

    const findings = scanTmuxPanes(runner);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].file).toBe("tmux:workspace:0.0:meta");
    expect(findings[0].message).toContain("tmux pane metadata workspace:0.0");
  });
});
