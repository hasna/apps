import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import {
  type Scanner,
  type FindingInput,
  type ScannerRunOptions,
  ScannerType,
  Severity,
  IOCType,
  DEFAULT_CONFIG,
} from "../types/index.js";
import { walkDirectory, getCodeSnippet } from "./secrets.js";
import {
  listAdvisories,
  getAllIOCs,
  isVersionAffected,
} from "../db/advisories.js";
import { seedAdvisories } from "../data/advisories.js";
import { getDb } from "../db/database.js";

// --- Ensure advisory data is loaded ---

let _seeded = false;
function ensureSeeded(): void {
  if (_seeded) return;
  try {
    getDb();
    seedAdvisories();
    _seeded = true;
  } catch {
    // DB not available — degrade gracefully
  }
}

// --- Known-bad package detection in lockfiles/manifests ---

interface ParsedDep {
  name: string;
  version: string;
  sourceFile: string;
}

function parsePackageJsonDeps(filePath: string, content: string): ParsedDep[] {
  const deps: ParsedDep[] = [];
  try {
    const pkg = JSON.parse(content);
    for (const section of ["dependencies", "devDependencies", "peerDependencies"]) {
      const entries = pkg[section];
      if (!entries || typeof entries !== "object") continue;
      for (const [name, versionRaw] of Object.entries(entries)) {
        const version = String(versionRaw).replace(/^[\^~>=<]/, "").replace(/^[\^~>=<]/, "");
        deps.push({ name, version, sourceFile: filePath });
      }
    }
  } catch {}
  return deps;
}

function parseBunLock(filePath: string, content: string): ParsedDep[] {
  const deps: ParsedDep[] = [];
  // bun.lock is a text format with lines like: "package-name@version"
  // or JSONC with "packages" key
  try {
    // Try JSONC parse first (bun.lock v2 format)
    const stripped = content.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const parsed = JSON.parse(stripped);
    if (parsed.packages) {
      for (const [key, val] of Object.entries(parsed.packages)) {
        if (typeof key === "string" && key.includes("@")) {
          // Format: "name@version" or ["name@version", ...]
          const match = key.match(/^(.+)@([^@]+)$/);
          if (match) {
            deps.push({ name: match[1], version: match[2], sourceFile: filePath });
          }
        }
        if (Array.isArray(val)) {
          for (const entry of val) {
            if (typeof entry === "string" && entry.includes("@")) {
              const match = entry.match(/^(.+)@([^@]+)$/);
              if (match) {
                deps.push({ name: match[1], version: match[2], sourceFile: filePath });
              }
            }
          }
        }
      }
    }
  } catch {
    // Fallback: line-by-line parse
    for (const line of content.split("\n")) {
      const match = line.match(/"([^"]+)@([^"]+)"/);
      if (match) {
        deps.push({ name: match[1], version: match[2], sourceFile: filePath });
      }
    }
  }
  return deps;
}

function parsePackageLockJson(filePath: string, content: string): ParsedDep[] {
  const deps: ParsedDep[] = [];
  try {
    const lock = JSON.parse(content);
    // v3 format (lockfileVersion 3)
    if (lock.packages) {
      for (const [key, val] of Object.entries(lock.packages)) {
        if (!key || key === "") continue;
        const pkgVal = val as any;
        const name = key.replace(/^node_modules\//, "");
        if (pkgVal.version) {
          deps.push({ name, version: pkgVal.version, sourceFile: filePath });
        }
      }
    }
    // v1/v2 format
    if (lock.dependencies) {
      for (const [name, val] of Object.entries(lock.dependencies)) {
        const depVal = val as any;
        if (depVal.version) {
          deps.push({ name, version: depVal.version, sourceFile: filePath });
        }
      }
    }
  } catch {}
  return deps;
}

function parseYarnLock(filePath: string, content: string): ParsedDep[] {
  const deps: ParsedDep[] = [];
  // yarn.lock format: "name@range":\n  version "x.y.z"
  const versionRe = /^"?([^@\s]+)@[^"]*"?:\s*\n\s+version\s+"([^"]+)"/gm;
  let match;
  while ((match = versionRe.exec(content)) !== null) {
    deps.push({ name: match[1], version: match[2], sourceFile: filePath });
  }
  return deps;
}

function parsePnpmLock(filePath: string, content: string): ParsedDep[] {
  const deps: ParsedDep[] = [];
  // pnpm-lock.yaml: /package@version: or 'package@version':
  const re = /['\/]([^@\s'\/]+)@([^:\s']+)/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    deps.push({ name: match[1], version: match[2], sourceFile: filePath });
  }
  return deps;
}

function parseRequirementsTxt(filePath: string, content: string): ParsedDep[] {
  const deps: ParsedDep[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
    const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*==\s*([^\s;,#]+)/);
    if (match) {
      deps.push({ name: match[1], version: match[2], sourceFile: filePath });
    }
  }
  return deps;
}

function collectAllDeps(scanPath: string): ParsedDep[] {
  const deps: ParsedDep[] = [];
  const lockfiles: Record<string, (path: string, content: string) => ParsedDep[]> = {
    "package.json": parsePackageJsonDeps,
    "bun.lock": parseBunLock,
    "package-lock.json": parsePackageLockJson,
    "yarn.lock": parseYarnLock,
    "pnpm-lock.yaml": parsePnpmLock,
    "requirements.txt": parseRequirementsTxt,
  };

  for (const [filename, parser] of Object.entries(lockfiles)) {
    const filePath = path.join(scanPath, filename);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const relativePath = path.relative(scanPath, filePath);
        deps.push(...parser(relativePath, content));
      } catch {}
    }
  }

  // Also scan nested package.json files (monorepos)
  const nestedManifests = walkDirectory(scanPath, [...DEFAULT_CONFIG.ignore_patterns], (fp) =>
    path.basename(fp) === "package.json",
  );
  for (const manifest of nestedManifests) {
    const rel = path.relative(scanPath, manifest);
    if (rel === "package.json") continue; // Already handled
    try {
      const content = fs.readFileSync(manifest, "utf-8");
      deps.push(...parsePackageJsonDeps(rel, content));
    } catch {}
  }

  return deps;
}

function checkDepsAgainstAdvisories(deps: ParsedDep[]): FindingInput[] {
  const findings: FindingInput[] = [];

  for (const dep of deps) {
    // Map ecosystem
    const ecosystem = dep.sourceFile.endsWith(".txt") ? "pypi" : "npm";
    const advisory = isVersionAffected(dep.name, ecosystem, dep.version);

    if (advisory) {
      findings.push({
        rule_id: `ioc-known-bad-${advisory.id.slice(0, 8)}`,
        scanner_type: ScannerType.IOC,
        severity: Severity.Critical,
        file: dep.sourceFile,
        line: 1,
        message: `COMPROMISED PACKAGE: ${dep.name}@${dep.version} — ${advisory.title}. ` +
          `Safe versions: ${advisory.safe_versions.join(", ") || "none (remove package)"}. ` +
          `Attack type: ${advisory.attack_type}` +
          (advisory.threat_actor ? `. Threat actor: ${advisory.threat_actor}` : ""),
      });
    }
  }

  return findings;
}

// --- C2 domain/IP detection in source code ---

function scanForC2Indicators(scanPath: string, ignorePatterns: string[]): FindingInput[] {
  const findings: FindingInput[] = [];
  const allIOCs = getAllIOCs();

  if (allIOCs.length === 0) return findings;

  // Build lookup sets
  const domainIOCs = allIOCs.filter((ioc) => ioc.type === "domain");
  const ipIOCs = allIOCs.filter((ioc) => ioc.type === "ip");

  if (domainIOCs.length === 0 && ipIOCs.length === 0) return findings;

  const codeExtensions = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rb", ".rs",
    ".json", ".yml", ".yaml", ".toml", ".env", ".sh", ".bash",
    ".conf", ".cfg", ".ini",
  ]);

  const files = walkDirectory(scanPath, ignorePatterns, (fp) => {
    // Skip our own advisory seed data (contains IOC values as reference)
    if (fp.includes("/data/advisories") || fp.includes("/scanners/ioc")) return false;
    return codeExtensions.has(path.extname(fp).toLowerCase());
  });

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, "utf-8");
      const lines = content.split("\n");
      const relativePath = path.relative(scanPath, file);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        for (const ioc of domainIOCs) {
          if (line.includes(ioc.value)) {
            findings.push({
              rule_id: `ioc-c2-domain-${ioc.value.replace(/\./g, "-")}`,
              scanner_type: ScannerType.IOC,
              severity: Severity.Critical,
              file: relativePath,
              line: lineNum,
              message: `C2 DOMAIN DETECTED: ${ioc.value} — ${ioc.context || "known malicious domain"}`,
              code_snippet: getCodeSnippet(content, lineNum),
            });
          }
        }

        for (const ioc of ipIOCs) {
          if (line.includes(ioc.value)) {
            findings.push({
              rule_id: `ioc-c2-ip-${ioc.value.replace(/\./g, "-")}`,
              scanner_type: ScannerType.IOC,
              severity: Severity.Critical,
              file: relativePath,
              line: lineNum,
              message: `C2 IP DETECTED: ${ioc.value} — ${ioc.context || "known malicious IP"}`,
              code_snippet: getCodeSnippet(content, lineNum),
            });
          }
        }
      }
    } catch {}
  }

  return findings;
}

// --- RAT artifact detection on disk ---

function checkRATArtifacts(): FindingInput[] {
  const findings: FindingInput[] = [];
  const allIOCs = getAllIOCs();
  const filePathIOCs = allIOCs.filter((ioc) => ioc.type === "file-path");

  const platform = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux";

  for (const ioc of filePathIOCs) {
    // Filter by platform
    if (ioc.platform && ioc.platform !== platform) continue;

    // Resolve environment variables
    let filePath = ioc.value;
    if (filePath.includes("%PROGRAMDATA%")) {
      filePath = filePath.replace("%PROGRAMDATA%", process.env.PROGRAMDATA || "C:\\ProgramData");
    }

    // Skip non-filesystem IOCs (like repo names, archive names)
    if (!filePath.startsWith("/") && !filePath.startsWith("C:") && !filePath.includes("\\")) continue;

    try {
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        findings.push({
          rule_id: `ioc-rat-artifact-${path.basename(filePath).replace(/\./g, "-")}`,
          scanner_type: ScannerType.IOC,
          severity: Severity.Critical,
          file: filePath,
          line: 1,
          message: `RAT ARTIFACT FOUND ON DISK: ${filePath} — ${ioc.context || "known malicious file"}. ` +
            `Size: ${stat.size} bytes, Modified: ${stat.mtime.toISOString()}. ` +
            `THIS MACHINE MAY BE COMPROMISED. Investigate immediately.`,
        });
      }
    } catch {}
  }

  return findings;
}

// --- Python .pth file detection ---

function checkPthFiles(): FindingInput[] {
  const findings: FindingInput[] = [];

  // Find Python site-packages directories
  const sitePackagesPaths: string[] = [];
  try {
    const output = execFileSync("python3", ["-c", "import site; print('\\n'.join(site.getsitepackages()))"], {
      encoding: "utf-8",
      timeout: 5000,
    });
    sitePackagesPaths.push(...output.trim().split("\n").filter(Boolean));
  } catch {}

  try {
    const output = execFileSync("python3", ["-c", "import site; print(site.getusersitepackages())"], {
      encoding: "utf-8",
      timeout: 5000,
    });
    sitePackagesPaths.push(output.trim());
  } catch {}

  for (const siteDir of sitePackagesPaths) {
    if (!fs.existsSync(siteDir)) continue;

    try {
      const entries = fs.readdirSync(siteDir);
      for (const entry of entries) {
        if (!entry.endsWith(".pth")) continue;

        const pthPath = path.join(siteDir, entry);
        try {
          const content = fs.readFileSync(pthPath, "utf-8");

          // .pth files with executable code (lines starting with "import")
          const executableLines = content.split("\n").filter((line) => {
            const trimmed = line.trim();
            return (
              trimmed.startsWith("import ") ||
              trimmed.includes("exec(") ||
              trimmed.includes("eval(") ||
              trimmed.includes("subprocess") ||
              trimmed.includes("os.system") ||
              trimmed.includes("__import__")
            );
          });

          if (executableLines.length > 0) {
            // Check against known malicious .pth files
            const isKnownMalicious = entry === "litellm_init.pth" ||
              content.includes("subprocess.Popen") ||
              content.includes("base64.b64decode");

            findings.push({
              rule_id: `ioc-pth-executable-${entry.replace(/\./g, "-")}`,
              scanner_type: ScannerType.IOC,
              severity: isKnownMalicious ? Severity.Critical : Severity.High,
              file: pthPath,
              line: 1,
              message: isKnownMalicious
                ? `MALICIOUS .pth FILE: ${entry} — executes on every Python startup. Known supply chain attack artifact.`
                : `SUSPICIOUS .pth FILE: ${entry} — contains executable code that runs on every Python startup: ${executableLines[0].trim().slice(0, 80)}`,
              code_snippet: executableLines.join("\n"),
            });
          }
        } catch {}
      }
    } catch {}
  }

  return findings;
}

// --- Postinstall script analysis in node_modules ---

function checkPostinstallScripts(scanPath: string): FindingInput[] {
  const findings: FindingInput[] = [];
  const nodeModulesPath = path.join(scanPath, "node_modules");
  if (!fs.existsSync(nodeModulesPath)) return findings;

  const suspiciousPatterns = [
    { pattern: /\b(?:fetch|https?\.get|https?\.request|XMLHttpRequest)\b/i, desc: "network call" },
    { pattern: /\b(?:exec|execSync|spawn|spawnSync|child_process)\b/i, desc: "process execution" },
    { pattern: /\beval\s*\(/i, desc: "eval()" },
    { pattern: /\b(?:Buffer\.from|atob|btoa|base64)\b/i, desc: "base64 encoding" },
    { pattern: /\b(?:writeFileSync|createWriteStream)\b/i, desc: "file write" },
    { pattern: /(?:\/Library\/Caches|%PROGRAMDATA%|\/tmp\/)/i, desc: "suspicious system path" },
  ];

  // Check top-level packages for postinstall scripts
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
      // Scoped packages
      try {
        const scopeEntries = fs.readdirSync(path.join(nodeModulesPath, entry.name), { withFileTypes: true });
        for (const scopeEntry of scopeEntries) {
          if (scopeEntry.isDirectory()) {
            packagesToCheck.push(path.join(entry.name, scopeEntry.name));
          }
        }
      } catch {}
    } else if (entry.isDirectory()) {
      packagesToCheck.push(entry.name);
    }
  }

  for (const pkgName of packagesToCheck) {
    const pkgJsonPath = path.join(nodeModulesPath, pkgName, "package.json");
    try {
      const pkgContent = fs.readFileSync(pkgJsonPath, "utf-8");
      const pkg = JSON.parse(pkgContent);
      const scripts = pkg.scripts || {};

      for (const scriptName of ["preinstall", "install", "postinstall"]) {
        const script = scripts[scriptName];
        if (!script) continue;

        // Check if this is a known-bad package
        const advisory = isVersionAffected(pkgName, "npm", pkg.version || "0.0.0");
        if (advisory) {
          findings.push({
            rule_id: `ioc-postinstall-known-bad-${pkgName.replace(/[/@]/g, "-")}`,
            scanner_type: ScannerType.IOC,
            severity: Severity.Critical,
            file: path.relative(scanPath, pkgJsonPath),
            line: 1,
            message: `KNOWN MALICIOUS PACKAGE with ${scriptName} script: ${pkgName}@${pkg.version} — ${advisory.title}`,
          });
          continue;
        }

        // Check script content for suspicious patterns
        for (const { pattern, desc } of suspiciousPatterns) {
          if (pattern.test(script)) {
            findings.push({
              rule_id: `ioc-postinstall-suspicious-${desc.replace(/\s+/g, "-")}`,
              scanner_type: ScannerType.IOC,
              severity: Severity.Medium,
              file: path.relative(scanPath, pkgJsonPath),
              line: 1,
              message: `Suspicious ${scriptName} script in ${pkgName}: contains ${desc} — "${script.slice(0, 100)}"`,
            });
          }
        }
      }
    } catch {}
  }

  return findings;
}

// --- Scanner ---

export const iocScanner: Scanner = {
  name: "IOC Scanner",
  type: ScannerType.IOC,
  description:
    "Detects indicators of compromise from known supply chain attacks: " +
    "malicious packages in lockfiles, C2 domains/IPs in code, RAT artifacts on disk, " +
    "malicious .pth files, suspicious postinstall scripts",

  async scan(scanPath: string, options?: ScannerRunOptions): Promise<FindingInput[]> {
    ensureSeeded();
    const ignorePatterns = options?.ignore_patterns ?? DEFAULT_CONFIG.ignore_patterns;
    const findings: FindingInput[] = [];

    // 1. Check dependencies against advisory database
    const deps = collectAllDeps(scanPath);
    findings.push(...checkDepsAgainstAdvisories(deps));

    // 2. Scan source code for C2 domains/IPs
    findings.push(...scanForC2Indicators(scanPath, ignorePatterns));

    // 3. Check for RAT artifacts on disk
    findings.push(...checkRATArtifacts());

    // 4. Check for malicious .pth files (Python)
    findings.push(...checkPthFiles());

    // 5. Check postinstall scripts in node_modules
    findings.push(...checkPostinstallScripts(scanPath));

    return findings;
  },
};

export default iocScanner;
