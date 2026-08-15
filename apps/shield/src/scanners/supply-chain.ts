import * as fs from "fs";
import * as path from "path";
import {
  type Scanner,
  type FindingInput,
  type ScannerRunOptions,
  ScannerType,
  Severity,
  DEFAULT_CONFIG,
} from "../types/index.js";
import { walkDirectory } from "./secrets.js";

// --- Typosquatting detection ---

const TOP_PACKAGES = [
  // npm top packages (high-value targets)
  "lodash", "chalk", "express", "react", "axios", "commander", "moment",
  "debug", "uuid", "semver", "yargs", "glob", "minimist", "mkdirp",
  "rimraf", "webpack", "babel", "eslint", "prettier", "typescript",
  "next", "vue", "angular", "svelte", "jquery", "underscore",
  "request", "bluebird", "async", "inquirer", "ora", "execa",
  "got", "node-fetch", "cross-env", "dotenv", "cors", "helmet",
  "jsonwebtoken", "bcrypt", "passport", "mongoose", "sequelize", "prisma",
  "openai", "langchain", "anthropic", "litellm", "transformers",
  // PyPI top packages
  "requests", "flask", "django", "numpy", "pandas", "scipy",
  "tensorflow", "torch", "scikit-learn", "beautifulsoup4",
  "boto3", "celery", "redis", "sqlalchemy", "pydantic", "fastapi",
];

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}

function detectTyposquatting(packageName: string): { target: string; distance: number } | null {
  // Skip scoped packages (they have their own namespace protection)
  if (packageName.startsWith("@")) return null;

  const normalized = packageName.toLowerCase().replace(/-/g, "");

  for (const top of TOP_PACKAGES) {
    if (packageName === top) continue; // Exact match, not typosquatting

    const topNormalized = top.toLowerCase().replace(/-/g, "");
    const dist = levenshtein(normalized, topNormalized);

    // Distance 1-2 is suspicious for names > 4 chars
    if (dist > 0 && dist <= 2 && normalized.length > 4) {
      return { target: top, distance: dist };
    }

    // Common typosquatting patterns
    if (
      normalized === topNormalized + "s" || // plural: "expresss"
      normalized === topNormalized + "js" || // suffix: "expressjs" (if not the real one)
      normalized === topNormalized.replace(/[aeiou]/g, "") || // vowel removal
      normalized === topNormalized.split("").reverse().join("") // reversal
    ) {
      return { target: top, distance: 1 };
    }
  }

  return null;
}

// --- Postinstall script analysis ---

interface PostinstallAnalysis {
  packageName: string;
  version: string;
  scriptName: string;
  script: string;
  risks: string[];
  severity: Severity;
}

const SCRIPT_RISK_PATTERNS: Array<{ pattern: RegExp; risk: string; severity: Severity }> = [
  // Network activity
  { pattern: /\bcurl\b|\bwget\b|\bfetch\b/i, risk: "downloads external resources", severity: Severity.High },
  { pattern: /\bhttps?:\/\/(?!registry\.npmjs|github\.com|nodejs\.org)/i, risk: "contacts non-standard URL", severity: Severity.High },

  // Code execution
  { pattern: /\beval\b|\bFunction\s*\(/i, risk: "dynamic code execution", severity: Severity.Critical },
  { pattern: /\bexec\b|\bspawn\b|\bchild_process/i, risk: "spawns child process", severity: Severity.High },
  { pattern: /\bpowershell\b|\bcmd\s+\/c\b/i, risk: "invokes system shell", severity: Severity.Critical },

  // File system (suspicious paths)
  { pattern: /\/Library\/Caches|%PROGRAMDATA%|%APPDATA%|\/tmp\//i, risk: "writes to system directory", severity: Severity.Critical },
  { pattern: /\bwriteFileSync\b|\bfs\.write/i, risk: "writes files", severity: Severity.Medium },

  // Environment harvesting
  { pattern: /process\.env\b.*(?:KEY|TOKEN|SECRET|PASS|CRED)/i, risk: "reads sensitive environment variables", severity: Severity.High },
  { pattern: /\.env\b|dotenv/i, risk: "accesses .env files", severity: Severity.Medium },

  // Obfuscation
  { pattern: /\\x[0-9a-f]{2}/i, risk: "contains hex-encoded strings", severity: Severity.High },
  { pattern: /Buffer\.from\s*\([^)]*,\s*['"]base64['"]\)/i, risk: "decodes base64 content", severity: Severity.High },
  { pattern: /atob\s*\(|btoa\s*\(/i, risk: "base64 encoding/decoding", severity: Severity.Medium },

  // Persistence mechanisms
  { pattern: /\bcrontab\b|\bsystemctl\b|\blaunchctl\b/i, risk: "installs persistence mechanism", severity: Severity.Critical },
  { pattern: /\bsystemd\b|\.service\b|\.plist\b/i, risk: "creates system service", severity: Severity.Critical },
  { pattern: /\bchmod\s+[0-7]*[75][0-7]*\b/i, risk: "sets executable permissions", severity: Severity.Medium },
];

function analyzePostinstallScripts(scanPath: string): FindingInput[] {
  const findings: FindingInput[] = [];
  const nodeModulesPath = path.join(scanPath, "node_modules");
  if (!fs.existsSync(nodeModulesPath)) return findings;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(nodeModulesPath, { withFileTypes: true });
  } catch {
    return findings;
  }

  const packagesToCheck: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name.startsWith("@")) {
      try {
        const scopeEntries = fs.readdirSync(path.join(nodeModulesPath, entry.name), { withFileTypes: true });
        for (const se of scopeEntries) {
          if (se.isDirectory()) packagesToCheck.push(path.join(entry.name, se.name));
        }
      } catch {}
    } else if (entry.isDirectory()) {
      packagesToCheck.push(entry.name);
    }
  }

  for (const pkgName of packagesToCheck) {
    const pkgJsonPath = path.join(nodeModulesPath, pkgName, "package.json");
    try {
      const content = fs.readFileSync(pkgJsonPath, "utf-8");
      const pkg = JSON.parse(content);
      const scripts = pkg.scripts || {};

      for (const scriptName of ["preinstall", "install", "postinstall", "prepare"]) {
        const script = scripts[scriptName];
        if (!script) continue;

        // Skip common legitimate scripts
        if (
          script === "node-gyp rebuild" ||
          script === "node install.js" ||
          script.startsWith("husky") ||
          script.startsWith("patch-package") ||
          script.startsWith("mkdir -p") ||
          script === "ngcc" ||
          script === "opencollective-postinstall" ||
          script === "node scripts/postinstall" ||
          /^node\s+[\w./-]+\.js$/.test(script)
        ) continue;

        const risks: string[] = [];
        let maxSeverity = Severity.Info;

        for (const { pattern, risk, severity } of SCRIPT_RISK_PATTERNS) {
          if (pattern.test(script)) {
            risks.push(risk);
            if (severity === Severity.Critical || (severity === Severity.High && maxSeverity !== Severity.Critical)) {
              maxSeverity = severity;
            } else if (severity === Severity.High && maxSeverity === Severity.Info) {
              maxSeverity = severity;
            } else if (maxSeverity === Severity.Info) {
              maxSeverity = severity;
            }
          }
        }

        if (risks.length > 0) {
          findings.push({
            rule_id: `supply-chain-postinstall-${scriptName}`,
            scanner_type: ScannerType.SupplyChain,
            severity: maxSeverity,
            file: path.relative(scanPath, pkgJsonPath),
            line: 1,
            message: `Suspicious ${scriptName} script in ${pkgName}@${pkg.version || "unknown"}: ${risks.join(", ")}. Script: "${script.slice(0, 150)}"`,
          });
        }
      }
    } catch {}
  }

  return findings;
}

// --- GitHub Actions tag pinning analysis ---

function checkGitHubActionsTagPinning(scanPath: string): FindingInput[] {
  const findings: FindingInput[] = [];
  const workflowsDir = path.join(scanPath, ".github", "workflows");
  if (!fs.existsSync(workflowsDir)) return findings;

  let entries: string[];
  try {
    entries = fs.readdirSync(workflowsDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  } catch {
    return findings;
  }

  // Known compromised actions
  const compromisedActions = new Set([
    "aquasecurity/trivy-action",
    "aquasecurity/setup-trivy",
    "checkmarx/kics-github-action",
    "checkmarx/ast-github-action",
  ]);

  for (const file of entries) {
    const filePath = path.join(workflowsDir, file);
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      const relativePath = path.relative(scanPath, filePath);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        // Match: uses: owner/action@ref
        const usesMatch = line.match(/uses:\s*([^@\s]+)@(\S+)/);
        if (!usesMatch) continue;

        const action = usesMatch[1].toLowerCase();
        const ref = usesMatch[2];

        // Check for known compromised actions
        if (compromisedActions.has(action)) {
          findings.push({
            rule_id: "supply-chain-compromised-action",
            scanner_type: ScannerType.SupplyChain,
            severity: Severity.Critical,
            file: relativePath,
            line: lineNum,
            message: `KNOWN COMPROMISED ACTION: ${usesMatch[1]}@${ref} — this action was hijacked by TeamPCP in March 2026. ` +
              `Remove or replace with a verified alternative. Pin to a commit SHA if you must use it.`,
          });
          continue;
        }

        // Check if pinned to tag vs commit SHA
        const isSHA = /^[0-9a-f]{40}$/.test(ref);
        const isShortSHA = /^[0-9a-f]{7,12}$/.test(ref);

        if (!isSHA && !isShortSHA) {
          // Pinned to tag or branch — vulnerable to tag hijacking
          const isVersion = /^v?\d/.test(ref);
          findings.push({
            rule_id: "supply-chain-action-tag-pin",
            scanner_type: ScannerType.SupplyChain,
            severity: isVersion ? Severity.Medium : Severity.High,
            file: relativePath,
            line: lineNum,
            message: `GitHub Action pinned to ${isVersion ? "version tag" : "branch"}: ${usesMatch[1]}@${ref} — ` +
              `tags can be force-pushed (as TeamPCP did with Trivy/Checkmarx). Pin to full commit SHA instead.`,
          });
        }
      }
    } catch {}
  }

  return findings;
}

// --- Dependency typosquatting check ---

function checkDependencyTyposquatting(scanPath: string): FindingInput[] {
  const findings: FindingInput[] = [];
  const pkgPath = path.join(scanPath, "package.json");
  if (!fs.existsSync(pkgPath)) return findings;

  try {
    const content = fs.readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(content);
    const lines = content.split("\n");

    for (const section of ["dependencies", "devDependencies", "peerDependencies"]) {
      const entries = pkg[section];
      if (!entries || typeof entries !== "object") continue;

      for (const name of Object.keys(entries)) {
        const typo = detectTyposquatting(name);
        if (typo) {
          let lineNum = 1;
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(`"${name}"`)) { lineNum = i + 1; break; }
          }

          findings.push({
            rule_id: "supply-chain-typosquatting",
            scanner_type: ScannerType.SupplyChain,
            severity: Severity.High,
            file: "package.json",
            line: lineNum,
            message: `POSSIBLE TYPOSQUATTING: "${name}" is very similar to popular package "${typo.target}" ` +
              `(edit distance: ${typo.distance}). Verify this is the intended package.`,
          });
        }
      }
    }
  } catch {}

  // Also check requirements.txt
  const reqPath = path.join(scanPath, "requirements.txt");
  if (fs.existsSync(reqPath)) {
    try {
      const content = fs.readFileSync(reqPath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.startsWith("#") || line.startsWith("-")) continue;
        const match = line.match(/^([A-Za-z0-9_.-]+)/);
        if (!match) continue;

        const name = match[1];
        const typo = detectTyposquatting(name);
        if (typo) {
          findings.push({
            rule_id: "supply-chain-typosquatting",
            scanner_type: ScannerType.SupplyChain,
            severity: Severity.High,
            file: "requirements.txt",
            line: i + 1,
            message: `POSSIBLE TYPOSQUATTING: "${name}" is very similar to popular package "${typo.target}" ` +
              `(edit distance: ${typo.distance}). Verify this is the intended package.`,
          });
        }
      }
    } catch {}
  }

  return findings;
}

// --- CI/CD --ignore-scripts detection ---

function checkCiIgnoreScripts(scanPath: string): FindingInput[] {
  const findings: FindingInput[] = [];
  const workflowsDir = path.join(scanPath, ".github", "workflows");
  if (!fs.existsSync(workflowsDir)) return findings;

  let entries: string[];
  try {
    entries = fs.readdirSync(workflowsDir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  } catch {
    return findings;
  }

  for (const file of entries) {
    const filePath = path.join(workflowsDir, file);
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      const relativePath = path.relative(scanPath, filePath);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        // Check for npm/bun/yarn install without --ignore-scripts
        if (/\b(?:npm|bun|yarn|pnpm)\s+install\b/i.test(line) && !/--ignore-scripts/i.test(line)) {
          findings.push({
            rule_id: "supply-chain-ci-no-ignore-scripts",
            scanner_type: ScannerType.SupplyChain,
            severity: Severity.Medium,
            file: relativePath,
            line: lineNum,
            message: `CI install command without --ignore-scripts: "${line.trim().slice(0, 100)}". ` +
              `Postinstall scripts from compromised packages will execute in CI. ` +
              `Add --ignore-scripts to harden against supply chain attacks.`,
          });
        }
      }
    } catch {}
  }

  return findings;
}

// --- Scanner ---

export const supplyChainScanner: Scanner = {
  name: "Supply Chain Scanner",
  type: ScannerType.SupplyChain,
  description:
    "Detects supply chain attack vectors: typosquatting, suspicious postinstall scripts, " +
    "GitHub Actions tag hijack risk, unpinned CI installs, and compromised actions",

  async scan(scanPath: string, _options?: ScannerRunOptions): Promise<FindingInput[]> {
    const findings: FindingInput[] = [];

    // 1. Typosquatting detection
    findings.push(...checkDependencyTyposquatting(scanPath));

    // 2. Postinstall script analysis
    findings.push(...analyzePostinstallScripts(scanPath));

    // 3. GitHub Actions tag pinning
    findings.push(...checkGitHubActionsTagPinning(scanPath));

    // 4. CI install hardening
    findings.push(...checkCiIgnoreScripts(scanPath));

    return findings;
  },
};

export default supplyChainScanner;
