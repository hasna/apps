import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import {
  type Scanner,
  type FindingInput,
  type ScannerRunOptions,
  ScannerType,
  Severity,
  DEFAULT_CONFIG,
} from "../types/index.js";
import { getCodeSnippet } from "./secrets.js";
import { isVersionAffected, listAdvisories } from "../db/advisories.js";
import { seedAdvisories } from "../data/advisories.js";
import { getDb } from "../db/database.js";

function ensureSeeded(): void {
  try {
    const db = getDb();
    const count = (db.prepare("SELECT COUNT(*) as n FROM advisories").get() as any)?.n ?? 0;
    if (count === 0) seedAdvisories();
  } catch {}
}

// --- Lockfile parsers (extract exact pinned versions) ---

interface LockedDep {
  name: string;
  version: string;
  integrity?: string; // hash from lockfile
}

function parseBunLock(content: string): LockedDep[] {
  const deps: LockedDep[] = [];
  try {
    const stripped = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const parsed = JSON.parse(stripped);
    if (parsed.packages) {
      for (const [_key, val] of Object.entries(parsed.packages)) {
        if (Array.isArray(val)) {
          for (const entry of val) {
            if (typeof entry === "string") {
              const match = entry.match(/^(.+)@([^@]+)$/);
              if (match) deps.push({ name: match[1], version: match[2] });
            } else if (typeof entry === "object" && entry !== null) {
              for (const [k, v] of Object.entries(entry as Record<string, any>)) {
                if (typeof v === "string") {
                  const match = k.match(/^(.+)@/);
                  // v is typically ["pkg@ver", { integrity }]
                }
                if (Array.isArray(v) && v.length >= 1 && typeof v[0] === "string") {
                  const match = v[0].match(/^(.+)@([^@]+)$/);
                  if (match) deps.push({ name: match[1], version: match[2], integrity: v[1] });
                }
              }
            }
          }
        }
      }
    }
  } catch {
    // Fallback line parse
    for (const line of content.split("\n")) {
      const match = line.match(/"([^"]+)@([^"]+)"/);
      if (match) deps.push({ name: match[1], version: match[2] });
    }
  }
  return deps;
}

function parsePackageLockJson(content: string): LockedDep[] {
  const deps: LockedDep[] = [];
  try {
    const lock = JSON.parse(content);
    if (lock.packages) {
      for (const [key, val] of Object.entries(lock.packages)) {
        if (!key) continue;
        const v = val as any;
        const name = key.replace(/^node_modules\//, "");
        if (v.version) deps.push({ name, version: v.version, integrity: v.integrity });
      }
    }
    if (lock.dependencies) {
      for (const [name, val] of Object.entries(lock.dependencies)) {
        const v = val as any;
        if (v.version) deps.push({ name, version: v.version, integrity: v.integrity });
      }
    }
  } catch {}
  return deps;
}

function parseYarnLock(content: string): LockedDep[] {
  const deps: LockedDep[] = [];
  const blocks = content.split(/\n(?=\S)/);
  for (const block of blocks) {
    const nameMatch = block.match(/^"?([^@\s]+)@/);
    const versionMatch = block.match(/\n\s+version\s+"([^"]+)"/);
    const integrityMatch = block.match(/\n\s+integrity\s+(\S+)/);
    if (nameMatch && versionMatch) {
      deps.push({ name: nameMatch[1], version: versionMatch[1], integrity: integrityMatch?.[1] });
    }
  }
  return deps;
}

function parsePnpmLock(content: string): LockedDep[] {
  const deps: LockedDep[] = [];
  const re = /['\/]([^@\s'\/]+)@([^:\s']+)/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    deps.push({ name: match[1], version: match[2] });
  }
  return deps;
}

// --- Package.json range analysis ---

interface DeclaredDep {
  name: string;
  range: string;
  section: string;
  line: number;
}

function parsePackageJsonRanges(content: string): DeclaredDep[] {
  const deps: DeclaredDep[] = [];
  const lines = content.split("\n");
  try {
    const pkg = JSON.parse(content);
    for (const section of ["dependencies", "devDependencies", "peerDependencies"]) {
      const entries = pkg[section];
      if (!entries || typeof entries !== "object") continue;
      for (const [name, range] of Object.entries(entries)) {
        // Find line number
        let lineNum = 1;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(`"${name}"`) && lines[i].includes(String(range))) {
            lineNum = i + 1;
            break;
          }
        }
        deps.push({ name, range: String(range), section, line: lineNum });
      }
    }
  } catch {}
  return deps;
}

// --- Critical packages that should ALWAYS be pinned ---

const CRITICAL_PACKAGES = new Set([
  // Popular npm targets
  "axios", "express", "next", "react", "lodash", "chalk", "commander",
  "webpack", "babel", "eslint", "prettier", "typescript",
  // AI/LLM packages
  "openai", "@anthropic-ai/sdk", "langchain", "@langchain/core",
  // Security-sensitive
  "jsonwebtoken", "bcrypt", "bcryptjs", "passport", "helmet", "cors",
  "cookie-parser", "express-session", "crypto-js",
  // Package managers / build tools
  "@modelcontextprotocol/sdk",
  // Python targets
  "litellm", "transformers", "torch", "tensorflow", "requests", "flask", "django",
]);

function checkUnpinnedRanges(declaredDeps: DeclaredDep[], filePath: string, content: string): FindingInput[] {
  const findings: FindingInput[] = [];

  for (const dep of declaredDeps) {
    const range = dep.range;
    const isCritical = CRITICAL_PACKAGES.has(dep.name);

    // Check for caret (^) or tilde (~) ranges
    if (range.startsWith("^") || range.startsWith("~")) {
      // Check if this package has any known advisory
      const hasAdvisory = isVersionAffected(dep.name, "npm", "0.0.0") !== null; // rough check
      const advisories = listAdvisories({ ecosystem: "npm" });
      const packageHasAdvisory = advisories.some((a) => a.package_name === dep.name);

      if (isCritical || packageHasAdvisory) {
        findings.push({
          rule_id: "lockfile-unpinned-critical",
          scanner_type: ScannerType.Lockfile,
          severity: packageHasAdvisory ? Severity.Critical : Severity.High,
          file: filePath,
          line: dep.line,
          message: packageHasAdvisory
            ? `UNPINNED PACKAGE WITH KNOWN ADVISORY: ${dep.name}@"${range}" — this package has been targeted in a supply chain attack. Pin to an exact safe version.`
            : `Unpinned critical package: ${dep.name}@"${range}" — high-value target for supply chain attacks. Consider pinning to exact version.`,
          code_snippet: getCodeSnippet(content, dep.line),
        });
      } else if (range.startsWith("^")) {
        // Caret allows minor bumps — wider attack surface
        findings.push({
          rule_id: "lockfile-unpinned-caret",
          scanner_type: ScannerType.Lockfile,
          severity: Severity.Low,
          file: filePath,
          line: dep.line,
          message: `Caret range ${dep.name}@"${range}" allows minor version bumps — a compromised minor release could be pulled in on next install.`,
          code_snippet: getCodeSnippet(content, dep.line),
        });
      }
    }

    // Wildcard or latest
    if (range === "*" || range === "latest" || range === "") {
      findings.push({
        rule_id: "lockfile-wildcard-range",
        scanner_type: ScannerType.Lockfile,
        severity: Severity.High,
        file: filePath,
        line: dep.line,
        message: `Wildcard/latest range for ${dep.name} — ANY version can be installed, including malicious ones. Pin to exact version.`,
        code_snippet: getCodeSnippet(content, dep.line),
      });
    }
  }

  return findings;
}

// --- Check locked versions against advisory DB ---

function checkLockedVersions(lockedDeps: LockedDep[], lockfilePath: string): FindingInput[] {
  const findings: FindingInput[] = [];

  for (const dep of lockedDeps) {
    const advisory = isVersionAffected(dep.name, "npm", dep.version);
    if (advisory) {
      findings.push({
        rule_id: `lockfile-compromised-${advisory.id.slice(0, 8)}`,
        scanner_type: ScannerType.Lockfile,
        severity: Severity.Critical,
        file: lockfilePath,
        line: 1,
        message: `COMPROMISED VERSION IN LOCKFILE: ${dep.name}@${dep.version} — ${advisory.title}. ` +
          `Safe versions: ${advisory.safe_versions.join(", ") || "remove package"}. ` +
          `Your lockfile pins to a known-malicious version.`,
      });
    }
  }

  return findings;
}

// --- Git history: lockfile changes during attack windows ---

interface AttackWindow {
  name: string;
  start: Date;
  end: Date;
  packages: string[];
}

function getAttackWindows(): AttackWindow[] {
  const advisories = listAdvisories();
  return advisories.map((a) => ({
    name: `${a.package_name} (${a.attack_type})`,
    start: new Date(a.detected_at),
    end: new Date(a.resolved_at || a.detected_at),
    packages: [a.package_name],
  }));
}

function checkLockfileGitHistory(scanPath: string): FindingInput[] {
  const findings: FindingInput[] = [];
  const lockfileNames = ["bun.lock", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"];

  // Check if this is a git repo
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: scanPath, encoding: "utf-8" });
  } catch {
    return findings;
  }

  const attackWindows = getAttackWindows();
  if (attackWindows.length === 0) return findings;

  for (const lockfile of lockfileNames) {
    const lockfilePath = path.join(scanPath, lockfile);
    if (!fs.existsSync(lockfilePath)) continue;

    try {
      // Get lockfile modification commits
      const logOutput = execFileSync(
        "git",
        ["log", "--format=%H %ai", "--follow", "--", lockfile],
        { cwd: scanPath, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 },
      ).trim();

      if (!logOutput) continue;

      for (const line of logOutput.split("\n")) {
        const parts = line.split(" ");
        const commitHash = parts[0];
        const commitDate = new Date(parts.slice(1).join(" "));

        for (const window of attackWindows) {
          if (commitDate >= window.start && commitDate <= window.end) {
            findings.push({
              rule_id: "lockfile-modified-during-attack",
              scanner_type: ScannerType.Lockfile,
              severity: Severity.High,
              file: lockfile,
              line: 1,
              message: `LOCKFILE MODIFIED DURING ATTACK WINDOW: ${lockfile} was changed in commit ${commitHash.slice(0, 8)} ` +
                `at ${commitDate.toISOString()} during the ${window.name} attack window ` +
                `(${window.start.toISOString()} — ${window.end.toISOString()}). ` +
                `Verify this change didn't pull in compromised packages.`,
            });
          }
        }
      }

      // Check for install/revert patterns (lockfile modified then reverted within 24h)
      const commits = logOutput.split("\n").map((line) => {
        const parts = line.split(" ");
        return { hash: parts[0], date: new Date(parts.slice(1).join(" ")) };
      });

      for (let i = 0; i < commits.length - 1; i++) {
        const current = commits[i];
        const next = commits[i + 1];
        const diffMs = current.date.getTime() - next.date.getTime();

        // If lockfile was modified twice within 1 hour — suspicious install/revert
        if (diffMs > 0 && diffMs < 3600000) {
          findings.push({
            rule_id: "lockfile-rapid-change",
            scanner_type: ScannerType.Lockfile,
            severity: Severity.Medium,
            file: lockfile,
            line: 1,
            message: `Rapid lockfile changes detected: ${lockfile} modified twice within ${Math.round(diffMs / 60000)} minutes ` +
              `(commits ${next.hash.slice(0, 8)} → ${current.hash.slice(0, 8)}). ` +
              `This could indicate an install/revert pattern from a supply chain attack.`,
          });
        }
      }
    } catch {}
  }

  return findings;
}

// --- Missing lockfile check ---

function checkMissingLockfile(scanPath: string): FindingInput[] {
  const findings: FindingInput[] = [];
  const pkgPath = path.join(scanPath, "package.json");
  if (!fs.existsSync(pkgPath)) return findings;

  const hasLockfile =
    fs.existsSync(path.join(scanPath, "package-lock.json")) ||
    fs.existsSync(path.join(scanPath, "yarn.lock")) ||
    fs.existsSync(path.join(scanPath, "pnpm-lock.yaml")) ||
    fs.existsSync(path.join(scanPath, "bun.lockb")) ||
    fs.existsSync(path.join(scanPath, "bun.lock"));

  if (!hasLockfile) {
    findings.push({
      rule_id: "lockfile-missing",
      scanner_type: ScannerType.Lockfile,
      severity: Severity.High,
      file: "package.json",
      line: 1,
      message: "NO LOCKFILE FOUND — dependency versions are not pinned. " +
        "Any `npm install` or `bun install` could pull in a compromised version. " +
        "This is exactly how supply chain attacks like axios@1.14.1 spread. " +
        "Run your package manager to generate a lockfile and commit it.",
    });
  }

  return findings;
}

// --- Scanner ---

export const lockfileScanner: Scanner = {
  name: "Lockfile Forensics Scanner",
  type: ScannerType.Lockfile,
  description:
    "Analyzes lockfiles for supply chain risks: compromised locked versions, " +
    "unpinned ranges on critical packages, lockfile changes during attack windows, " +
    "install/revert patterns, and missing lockfiles",

  async scan(scanPath: string, _options?: ScannerRunOptions): Promise<FindingInput[]> {
    ensureSeeded();
    const findings: FindingInput[] = [];

    // 1. Check for missing lockfile
    findings.push(...checkMissingLockfile(scanPath));

    // 2. Parse and check locked versions against advisory DB
    const lockfiles: Record<string, (content: string) => LockedDep[]> = {
      "bun.lock": parseBunLock,
      "package-lock.json": parsePackageLockJson,
      "yarn.lock": parseYarnLock,
      "pnpm-lock.yaml": parsePnpmLock,
    };

    for (const [filename, parser] of Object.entries(lockfiles)) {
      const filePath = path.join(scanPath, filename);
      if (!fs.existsSync(filePath)) continue;
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const lockedDeps = parser(content);
        findings.push(...checkLockedVersions(lockedDeps, filename));
      } catch {}
    }

    // 3. Check package.json ranges
    const pkgPath = path.join(scanPath, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const content = fs.readFileSync(pkgPath, "utf-8");
        const ranges = parsePackageJsonRanges(content);
        findings.push(...checkUnpinnedRanges(ranges, "package.json", content));
      } catch {}
    }

    // 4. Git history analysis
    findings.push(...checkLockfileGitHistory(scanPath));

    return findings;
  },
};

export default lockfileScanner;
