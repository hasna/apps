import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import {
  buildSupplyChainReport,
  formatSupplyChainReportJson,
  registerSupplyChainReportCommand,
} from "./supply-chain-report.js";

const fixturePath = join(import.meta.dir, "fixtures", "report-workspace");
const bunFixturePath = join(import.meta.dir, "fixtures", "bun-report-workspace");

describe("supply-chain report", () => {
  let workspace = "";

  afterEach(() => {
    if (workspace) rmSync(workspace, { recursive: true, force: true });
  });

  test("summarizes lockfiles and dependencies deterministically", async () => {
    workspace = mkdtempSync(join(tmpdir(), "shield-supply-report-"));
    cpSync(fixturePath, workspace, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: workspace });
    execFileSync("git", ["config", "user.email", "fixture.test"], { cwd: workspace });
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: workspace });
    execFileSync("git", ["add", "."], { cwd: workspace });
    execFileSync("git", ["commit", "-qm", "add lockfile"], { cwd: workspace });

    const first = await buildSupplyChainReport({ workspace, since: "24h" });
    const second = await buildSupplyChainReport({ workspace, since: "24h" });
    const output = formatSupplyChainReportJson(first);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      report: "shield-supply-chain-report",
      since: "24h",
      summary: { lockfiles: 1, dependencies: 2, changes: 1 },
    });
    expect(first.changes).toEqual([{
      commit: expect.stringMatching(/^[a-f0-9]{12}$/),
      lockfile: "package-lock.json",
    }]);
    expect(first.dependencies.map((dependency) => `${dependency.name}@${dependency.version}`)).toEqual([
      "axios@1.14.1",
      "chalk@5.4.1",
    ]);
    expect(output).toBe(`${JSON.stringify(first, null, 2)}\n`);
  });

  test("parses text-based bun.lock files offline", async () => {
    workspace = mkdtempSync(join(tmpdir(), "shield-bun-supply-report-"));
    cpSync(bunFixturePath, workspace, { recursive: true });

    const report = await buildSupplyChainReport({ workspace, since: "24h" });

    expect(report.summary).toMatchObject({ lockfiles: 1, dependencies: 2 });
    expect(report.dependencies.map((dependency) => `${dependency.name}@${dependency.version}`)).toEqual([
      "axios@1.14.1",
      "chalk@5.4.1",
    ]);
  });

  test("registers shield supply-chain report --since 24h --json", () => {
    const program = new Command();
    registerSupplyChainReportCommand(program);
    const supplyChain = program.commands.find((command) => command.name() === "supply-chain");
    const report = supplyChain?.commands.find((command) => command.name() === "report");

    expect(report).toBeDefined();
    expect(report?.options.some((option) => option.long === "--since")).toBe(true);
    expect(report?.options.some((option) => option.long === "--json")).toBe(true);
  });
});
