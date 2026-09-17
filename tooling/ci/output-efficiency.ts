/**
 * Static output-efficiency adoption census.
 *
 * This analyzer reads only root/member package.json and hasna.contract.json.
 * It never imports or executes member code, starts a process, reads a home
 * directory, follows a URL, or contacts a hosted service.
 */
import * as fs from "node:fs";
import { constants as fsConstants } from "node:fs";
import * as path from "node:path";

export const OUTPUT_EFFICIENCY_DECLARATION_VERSION = 1 as const;
export const OUTPUT_EFFICIENCY_SAFE_DEFAULTS = Object.freeze({
  cliDefaultMaxItems: 25,
  cliDefaultMaxBytes: 32 * 1024,
  mcpToolsListMaxBytes: 16 * 1024,
  mcpDefaultResponseMaxBytes: 32 * 1024,
});

export type OutputEfficiencyRule =
  | "declaration-missing"
  | "declaration-version"
  | "cli-declaration-missing"
  | "cli-default-max-items"
  | "cli-default-max-bytes"
  | "cli-machine-json"
  | "cli-exhaustive-read"
  | "mcp-declaration-missing"
  | "mcp-default-profile"
  | "mcp-tools-list-max-bytes"
  | "mcp-default-response-max-bytes"
  | "mcp-machine-json";

export interface OutputEfficiencyFinding {
  member: string;
  rule: OutputEfficiencyRule;
  message: string;
}

export interface OutputEfficiencyMember {
  member: string;
  packageName: string;
  hasCli: boolean;
  hasMcp: boolean;
  declarationPresent: boolean;
  findingCount: number;
}

export interface OutputEfficiencyCensus {
  contract_version: typeof OUTPUT_EFFICIENCY_DECLARATION_VERSION;
  report_only: true;
  member_count: number;
  applicable_member_count: number;
  declared_member_count: number;
  finding_count: number;
  members: OutputEfficiencyMember[];
  findings: OutputEfficiencyFinding[];
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_MEMBERS = 10_000;

function withinRoot(rootReal: string, candidateReal: string): boolean {
  const relative = path.relative(rootReal, candidateReal);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function readJsonRecord(file: string, rootReal: string): JsonRecord {
  let descriptor: number | undefined;
  try {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("path is not a regular non-symlink file");
    const resolved = fs.realpathSync(file);
    if (!withinRoot(rootReal, resolved)) throw new Error("path escapes the repository root");
    if (stat.size > MAX_JSON_BYTES) throw new Error(`file exceeds ${MAX_JSON_BYTES} bytes`);
    descriptor = fs.openSync(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.size > MAX_JSON_BYTES) throw new Error("opened file is not a bounded regular file");
    const text = fs.readFileSync(descriptor, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("required JSON is malformed");
    }
    if (!isRecord(parsed)) throw new Error("required JSON is not an object");
    return parsed;
  } catch (error) {
    throw new Error(`unable to read required JSON ${path.relative(rootReal, file)}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function optionalJsonRecord(file: string, rootReal: string): JsonRecord | null {
  if (!fs.existsSync(file)) return null;
  return readJsonRecord(file, rootReal);
}

function binNames(pkg: JsonRecord, slug: string): string[] {
  const bin = pkg.bin;
  if (typeof bin === "string") return [slug];
  if (!isRecord(bin)) return [];
  return Object.keys(bin).sort();
}

function positiveIntegerAtMost(value: unknown, max: number): boolean {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= max;
}

function addFinding(findings: OutputEfficiencyFinding[], member: string, rule: OutputEfficiencyRule, message: string): void {
  findings.push({ member, rule, message });
}

function evaluateDeclaration(
  member: string,
  hasCli: boolean,
  hasMcp: boolean,
  declaration: unknown,
  findings: OutputEfficiencyFinding[],
): boolean {
  if (!isRecord(declaration)) {
    addFinding(findings, member, "declaration-missing", "metadata.outputEfficiency is not declared");
    return false;
  }
  if (declaration.version !== OUTPUT_EFFICIENCY_DECLARATION_VERSION) {
    addFinding(findings, member, "declaration-version", "metadata.outputEfficiency.version must equal 1");
  }

  if (hasCli) {
    const cli = declaration.cli;
    if (!isRecord(cli)) {
      addFinding(findings, member, "cli-declaration-missing", "CLI surface has no outputEfficiency.cli declaration");
    } else {
      if (!positiveIntegerAtMost(cli.defaultMaxItems, OUTPUT_EFFICIENCY_SAFE_DEFAULTS.cliDefaultMaxItems)) {
        addFinding(findings, member, "cli-default-max-items", `CLI defaultMaxItems must be 1..${OUTPUT_EFFICIENCY_SAFE_DEFAULTS.cliDefaultMaxItems}`);
      }
      if (!positiveIntegerAtMost(cli.defaultMaxBytes, OUTPUT_EFFICIENCY_SAFE_DEFAULTS.cliDefaultMaxBytes)) {
        addFinding(findings, member, "cli-default-max-bytes", `CLI defaultMaxBytes must be 1..${OUTPUT_EFFICIENCY_SAFE_DEFAULTS.cliDefaultMaxBytes}`);
      }
      if (cli.machineJson !== "compact") {
        addFinding(findings, member, "cli-machine-json", "CLI machineJson must be compact by default");
      }
      if (cli.exhaustiveRequiresExplicit !== true) {
        addFinding(findings, member, "cli-exhaustive-read", "CLI exhaustive reads must require explicit caller intent");
      }
    }
  }

  if (hasMcp) {
    const mcp = declaration.mcp;
    if (!isRecord(mcp)) {
      addFinding(findings, member, "mcp-declaration-missing", "MCP surface has no outputEfficiency.mcp declaration");
    } else {
      if (typeof mcp.defaultProfile !== "string" || mcp.defaultProfile.trim().length === 0 || mcp.defaultProfile === "full") {
        addFinding(findings, member, "mcp-default-profile", "MCP defaultProfile must be a non-full named profile");
      }
      if (!positiveIntegerAtMost(mcp.toolsListMaxBytes, OUTPUT_EFFICIENCY_SAFE_DEFAULTS.mcpToolsListMaxBytes)) {
        addFinding(findings, member, "mcp-tools-list-max-bytes", `MCP toolsListMaxBytes must be 1..${OUTPUT_EFFICIENCY_SAFE_DEFAULTS.mcpToolsListMaxBytes}`);
      }
      if (!positiveIntegerAtMost(mcp.defaultResponseMaxBytes, OUTPUT_EFFICIENCY_SAFE_DEFAULTS.mcpDefaultResponseMaxBytes)) {
        addFinding(findings, member, "mcp-default-response-max-bytes", `MCP defaultResponseMaxBytes must be 1..${OUTPUT_EFFICIENCY_SAFE_DEFAULTS.mcpDefaultResponseMaxBytes}`);
      }
      if (mcp.machineJson !== "compact") {
        addFinding(findings, member, "mcp-machine-json", "MCP machineJson must be compact by default");
      }
    }
  }
  return true;
}

/** Discover package-bearing apps/* members in deterministic order. */
export function outputEfficiencyCensus(root: string): OutputEfficiencyCensus {
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("scan root must be a regular directory, not a symlink");
  const rootReal = fs.realpathSync(root);
  const rootPackage = readJsonRecord(path.join(rootReal, "package.json"), rootReal);
  const workspaces = Array.isArray(rootPackage.workspaces) ? rootPackage.workspaces : [];
  if (!workspaces.includes("apps/*")) throw new Error("root package.json does not declare the apps/* workspace");
  const appsDir = path.join(rootReal, "apps");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(appsDir, { withFileTypes: true });
  } catch (error) {
    throw new Error(`unable to enumerate apps workspace: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (entries.length > MAX_MEMBERS) throw new Error(`apps workspace exceeds ${MAX_MEMBERS} entries`);
  const findings: OutputEfficiencyFinding[] = [];
  const members: OutputEfficiencyMember[] = [];
  for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (entry.isSymbolicLink()) throw new Error(`apps/${JSON.stringify(entry.name)} is a symlink`);
    if (!entry.isDirectory()) continue;
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(entry.name)) {
      throw new Error(`apps member name is not canonical kebab-case: ${JSON.stringify(entry.name)}`);
    }
    const memberDir = path.join(appsDir, entry.name);
    const packageFile = path.join(memberDir, "package.json");
    if (!fs.existsSync(packageFile)) continue;
    const pkg = readJsonRecord(packageFile, rootReal);
    if (pkg.private === true) continue;
    const packageName = typeof pkg.name === "string" ? pkg.name : "";
    if (!packageName.startsWith("@hasna/")) continue;
    const bins = binNames(pkg, entry.name);
    const hasCli = bins.includes(entry.name);
    const hasMcp = bins.includes(`${entry.name}-mcp`);
    const before = findings.length;
    let declarationPresent = false;
    if (hasCli || hasMcp) {
      const manifest = optionalJsonRecord(path.join(memberDir, "hasna.contract.json"), rootReal);
      const metadata = manifest && isRecord(manifest.metadata) ? manifest.metadata : null;
      declarationPresent = evaluateDeclaration(entry.name, hasCli, hasMcp, metadata?.outputEfficiency, findings);
    }
    members.push({
      member: entry.name,
      packageName,
      hasCli,
      hasMcp,
      declarationPresent,
      findingCount: findings.length - before,
    });
  }

  findings.sort((a, b) => (a.member < b.member ? -1 : a.member > b.member ? 1 : 0) || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0) || (a.message < b.message ? -1 : a.message > b.message ? 1 : 0));
  members.sort((a, b) => a.member < b.member ? -1 : a.member > b.member ? 1 : 0);
  return {
    contract_version: OUTPUT_EFFICIENCY_DECLARATION_VERSION,
    report_only: true,
    member_count: members.length,
    applicable_member_count: members.filter((member) => member.hasCli || member.hasMcp).length,
    declared_member_count: members.filter((member) => member.declarationPresent).length,
    finding_count: findings.length,
    members,
    findings,
  };
}

export function formatOutputEfficiencyFinding(finding: OutputEfficiencyFinding): string {
  return `${finding.member}: ${finding.rule}: ${finding.message}`;
}
