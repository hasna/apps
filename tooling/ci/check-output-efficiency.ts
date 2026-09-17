/**
 * Report-only output-efficiency declaration census.
 *
 * Usage:
 *   bun tooling/ci/check-output-efficiency.ts [--report] [--json] [--root DIR]
 *   bun tooling/ci/check-output-efficiency.ts --hard [--root DIR] # local enforcement preview
 *   bun tooling/ci/check-output-efficiency.ts --self-test
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { formatOutputEfficiencyFinding, outputEfficiencyCensus } from "./output-efficiency";

function run(root: string, hard: boolean, json: boolean): number {
  let census;
  try {
    census = outputEfficiencyCensus(root);
  } catch (error) {
    console.error(`[output-efficiency] measurement failed: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  if (json) {
    console.log(JSON.stringify(census));
  } else {
    const label = hard ? "gate" : "report";
    console.log(
      `[${label} output-efficiency] ${census.finding_count} finding(s) across `
      + `${census.applicable_member_count} applicable member(s); `
      + `${census.declared_member_count} declaration(s) (contract v${census.contract_version})`,
    );
    const lines = census.findings.map(formatOutputEfficiencyFinding);
    const shown = lines.slice(0, 200);
    for (const line of shown) console.log(`  ${line}`);
    if (lines.length > shown.length) console.log(`  … ${lines.length - shown.length} more finding(s)`);
  }
  return hard && census.finding_count > 0 ? 1 : 0;
}

function writeFixtureMember(root: string, slug: string, manifest: unknown): void {
  const dir = path.join(root, "apps", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({
    name: `@hasna/${slug}`,
    version: "1.0.0",
    bin: { [slug]: "bin/cli.js", [`${slug}-mcp`]: "bin/mcp.js" },
    scripts: { postinstall: "touch SHOULD_NOT_EXIST" },
  }));
  fs.writeFileSync(path.join(dir, "hasna.contract.json"), JSON.stringify(manifest));
}

function selfTest(): number {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "output-efficiency-self-test-"));
  try {
    fs.mkdirSync(path.join(temp, "apps"), { recursive: true });
    fs.writeFileSync(path.join(temp, "package.json"), JSON.stringify({ private: true, workspaces: ["apps/*"] }));
    writeFixtureMember(temp, "good", {
      metadata: {
        outputEfficiency: {
          version: 1,
          cli: { defaultMaxItems: 25, defaultMaxBytes: 32768, machineJson: "compact", exhaustiveRequiresExplicit: true },
          mcp: { defaultProfile: "standard", toolsListMaxBytes: 16384, defaultResponseMaxBytes: 32768, machineJson: "compact" },
        },
      },
    });
    writeFixtureMember(temp, "bad", {
      metadata: {
        outputEfficiency: {
          version: 2,
          cli: { defaultMaxItems: 100, defaultMaxBytes: 1000000, machineJson: "pretty", exhaustiveRequiresExplicit: false },
          mcp: { defaultProfile: "full", toolsListMaxBytes: 1000000, defaultResponseMaxBytes: 1000000, machineJson: "pretty" },
        },
      },
    });
    const census = outputEfficiencyCensus(temp);
    const badRules = census.findings.filter((finding) => finding.member === "bad").map((finding) => finding.rule);
    const expected = [
      "cli-default-max-bytes",
      "cli-default-max-items",
      "cli-exhaustive-read",
      "cli-machine-json",
      "declaration-version",
      "mcp-default-profile",
      "mcp-default-response-max-bytes",
      "mcp-machine-json",
      "mcp-tools-list-max-bytes",
    ].sort();
    const symlinkRoot = path.join(temp, "symlink-root");
    fs.mkdirSync(path.join(symlinkRoot, "apps", "linked"), { recursive: true });
    fs.writeFileSync(path.join(symlinkRoot, "package.json"), JSON.stringify({ private: true, workspaces: ["apps/*"] }));
    fs.writeFileSync(path.join(symlinkRoot, "apps", "linked", "package.json"), JSON.stringify({
      name: "@hasna/linked",
      bin: { linked: "bin/cli.js" },
    }));
    const outside = path.join(temp, "outside.json");
    fs.writeFileSync(outside, JSON.stringify({ marker: "must-not-be-read" }));
    fs.symlinkSync(outside, path.join(symlinkRoot, "apps", "linked", "hasna.contract.json"));
    let symlinkRefused = false;
    try {
      outputEfficiencyCensus(symlinkRoot);
    } catch (error) {
      symlinkRefused = error instanceof Error && error.message.includes("non-symlink");
    }

    const checks: Array<[string, boolean]> = [
      ["clean declaration stays silent", census.findings.every((finding) => finding.member !== "good")],
      ["unsafe declaration fires every rule", JSON.stringify(badRules.sort()) === JSON.stringify(expected)],
      ["member ordering is deterministic", census.members.map((member) => member.member).join(",") === "bad,good"],
      ["package scripts are never executed", !fs.existsSync(path.join(temp, "apps", "good", "SHOULD_NOT_EXIST"))],
      ["symlinked metadata refuses before reading outside the root", symlinkRefused],
      ["report mode exits zero on findings", run(temp, false, false) === 0],
      ["hard preview exits one on findings", run(temp, true, false) === 1],
    ];
    let failed = false;
    for (const [name, ok] of checks) {
      console.log(`  ${ok ? "PASS" : "FAIL"} — ${name}`);
      if (!ok) failed = true;
    }
    if (failed) return 1;
    console.log("self-test: PASS (fires, stays silent, and executes no member code)");
    return 0;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
if (args.includes("--self-test")) process.exit(selfTest());
const rootIndex = args.indexOf("--root");
if (rootIndex >= 0 && !args[rootIndex + 1]) {
  console.error("--root requires a directory");
  process.exit(2);
}
const root = rootIndex >= 0 ? path.resolve(args[rootIndex + 1]!) : process.cwd();
const hard = args.includes("--hard");
if (hard && args.includes("--report")) {
  console.error("--hard and --report are mutually exclusive");
  process.exit(2);
}
process.exit(run(root, hard, args.includes("--json")));
