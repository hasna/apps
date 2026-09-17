/**
 * output-efficiency — report-only fleet adoption census.
 *
 * The analyzer reads static package/manifest JSON only. It does not execute
 * member CLIs/MCPs or contact hosted authorities. The initial gate reports
 * missing or unsafe declarations while application owners migrate.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { REPO_ROOT } from "./census";
import { assertGate } from "./gate-mode";
import {
  OUTPUT_EFFICIENCY_SAFE_DEFAULTS,
  formatOutputEfficiencyFinding,
  outputEfficiencyCensus,
} from "../../output-efficiency";

export const GATE = "output-efficiency";

function member(root: string, slug: string, declaration?: unknown): void {
  const dir = path.join(root, "apps", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
    name: `@hasna/${slug}`,
    bin: { [slug]: "bin/cli.js", [`${slug}-mcp`]: "bin/mcp.js" },
  }));
  fs.writeFileSync(path.join(dir, "hasna.contract.json"), JSON.stringify({
    metadata: declaration === undefined ? {} : { outputEfficiency: declaration },
  }));
}

describe("standard-adherence: output efficiency declarations", () => {
  test("reports the real fleet without executing applications", () => {
    const census = outputEfficiencyCensus(REPO_ROOT);
    console.info(
      `[output-efficiency] census: ${census.member_count} member(s), `
      + `${census.applicable_member_count} applicable, ${census.declared_member_count} declared, `
      + `${census.finding_count} finding(s)`,
    );
    assertGate(
      GATE,
      census.findings.map(formatOutputEfficiencyFinding),
      "declare bounded compact CLI/MCP defaults in hasna.contract.json metadata.outputEfficiency after measuring the real surface",
    );
  });

  test("self-test fires on unsafe defaults and stays silent at the boundary", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "output-efficiency-standard-"));
    try {
      fs.mkdirSync(path.join(root, "apps"), { recursive: true });
      fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ workspaces: ["apps/*"] }));
      member(root, "good", {
        version: 1,
        cli: {
          defaultMaxItems: OUTPUT_EFFICIENCY_SAFE_DEFAULTS.cliDefaultMaxItems,
          defaultMaxBytes: OUTPUT_EFFICIENCY_SAFE_DEFAULTS.cliDefaultMaxBytes,
          machineJson: "compact",
          exhaustiveRequiresExplicit: true,
        },
        mcp: {
          defaultProfile: "minimal",
          toolsListMaxBytes: OUTPUT_EFFICIENCY_SAFE_DEFAULTS.mcpToolsListMaxBytes,
          defaultResponseMaxBytes: OUTPUT_EFFICIENCY_SAFE_DEFAULTS.mcpDefaultResponseMaxBytes,
          machineJson: "compact",
        },
      });
      member(root, "missing");
      member(root, "unsafe", {
        version: 1,
        cli: { defaultMaxItems: 26, defaultMaxBytes: 32769, machineJson: "pretty", exhaustiveRequiresExplicit: false },
        mcp: { defaultProfile: "full", toolsListMaxBytes: 16385, defaultResponseMaxBytes: 32769, machineJson: "pretty" },
      });
      const census = outputEfficiencyCensus(root);
      expect(census.findings.filter((finding) => finding.member === "good")).toEqual([]);
      expect(census.findings.some((finding) => finding.member === "missing" && finding.rule === "declaration-missing")).toBe(true);
      expect(census.findings.filter((finding) => finding.member === "unsafe").map((finding) => finding.rule).sort()).toEqual([
        "cli-default-max-bytes",
        "cli-default-max-items",
        "cli-exhaustive-read",
        "cli-machine-json",
        "mcp-default-profile",
        "mcp-default-response-max-bytes",
        "mcp-machine-json",
        "mcp-tools-list-max-bytes",
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("standalone gate self-test proves report and hard-preview exit semantics", () => {
    const result = Bun.spawnSync([process.execPath, `${REPO_ROOT}/tooling/ci/check-output-efficiency.ts`, "--self-test"], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
    expect(result.exitCode, output).toBe(0);
    expect(output).toContain("self-test: PASS");
  }, 60_000);
});
