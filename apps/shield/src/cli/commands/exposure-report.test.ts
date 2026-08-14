import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import {
  buildExposureReport,
  formatExposureReportJson,
  formatExposureReportMarkdown,
  registerExposureReportCommand,
} from "./exposure-report.js";

const fixturePath = join(import.meta.dir, "fixtures", "report-workspace");
const plantedCredential = ["ghp", "fixtureCredentialMustNeverAppear1234567890"].join("_");

describe("exposure report", () => {
  let workspace = "";

  afterEach(() => {
    if (workspace) rmSync(workspace, { recursive: true, force: true });
  });

  function createWorkspace(): string {
    workspace = mkdtempSync(join(tmpdir(), "shield-exposure-report-"));
    cpSync(fixturePath, workspace, { recursive: true });
    return workspace;
  }

  test("reports filesystem and removed history findings deterministically", async () => {
    const path = createWorkspace();
    execFileSync("git", ["init", "-q"], { cwd: path });
    execFileSync("git", ["config", "user.email", "fixture@example.test"], { cwd: path });
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: path });
    writeFileSync(join(path, "history.env"), `TOKEN=${plantedCredential}\n`);
    execFileSync("git", ["add", "."], { cwd: path });
    execFileSync("git", ["commit", "-qm", "plant fixture"], { cwd: path });
    rmSync(join(path, "history.env"));
    writeFileSync(join(path, "current.env"), `TOKEN=${plantedCredential}\n`);
    execFileSync("git", ["add", "-A"], { cwd: path });
    execFileSync("git", ["commit", "-qm", "move fixture"], { cwd: path });

    const first = await buildExposureReport({ workspace: path, history: true, githubAlerts: true });
    const second = await buildExposureReport({ workspace: path, history: true, githubAlerts: true });
    const json = formatExposureReportJson(first);
    const markdown = formatExposureReportMarkdown(first);
    const allOutput = `${json}\n${markdown}`;

    expect(second).toEqual(first);
    expect(first.sources).toEqual({
      filesystem: "available",
      gitHistory: "available",
      githubAlerts: "unavailable",
    });
    expect(first.findings.some((finding) => finding.location.source === "filesystem")).toBe(true);
    expect(first.findings.some((finding) => finding.location.source === "git-history")).toBe(true);
    expect(first.findings.every((finding) => finding.kind && finding.location.path && finding.maskedExcerpt)).toBe(true);
    expect(first.findings.every((finding) => !finding.maskedExcerpt.includes(plantedCredential))).toBe(true);
    expect(allOutput).not.toContain(plantedCredential);
    expect(markdown).toContain("GitHub alerts | unavailable");
  });

  test("never writes a planted credential to stdout or stderr", async () => {
    const path = createWorkspace();
    writeFileSync(join(path, "credential.env"), `TOKEN=${plantedCredential}\n`);
    const stdout: string[] = [];
    const stderr: string[] = [];

    const program = new Command();
    program.exitOverride();
    program.configureOutput({
      writeOut: (value) => stdout.push(value),
      writeErr: (value) => stderr.push(value),
    });
    registerExposureReportCommand(program, {
      stdout: (value) => stdout.push(value),
      stderr: (value) => stderr.push(value),
    });
    await program.parseAsync([
      "node", "shield", "exposure-report", "--workspace", path, "--redact", "--json",
    ]);

    const allOutput = [...stdout, ...stderr].join("");
    expect(allOutput).not.toContain(plantedCredential);
    expect(JSON.parse(stdout.join(""))).toMatchObject({ report: "shield-exposure-report" });
  });
});
