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

// --- Dependency parsing ---

interface Dependency {
  name: string;
  version: string;
  ecosystem: string;
  sourceFile: string;
}

function parsePackageJson(filePath: string, content: string): Dependency[] {
  const deps: Dependency[] = [];
  try {
    const pkg = JSON.parse(content);
    for (const section of ["dependencies", "devDependencies", "peerDependencies"]) {
      const entries = pkg[section];
      if (entries && typeof entries === "object") {
        for (const [name, versionRaw] of Object.entries(entries)) {
          const version = String(versionRaw).replace(/^[\^~>=<]/, "").replace(/^[\^~>=<]/, "");
          if (version && !version.startsWith("*") && !version.startsWith("workspace:")) {
            deps.push({ name, version, ecosystem: "npm", sourceFile: filePath });
          }
        }
      }
    }
  } catch {
    // Invalid JSON
  }
  return deps;
}

function parseRequirementsTxt(filePath: string, content: string): Dependency[] {
  const deps: Dependency[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
    const match = trimmed.match(/^([A-Za-z0-9_.-]+)\s*(?:==|>=|<=|~=|!=)\s*([^\s;,#]+)/);
    if (match) {
      deps.push({ name: match[1], version: match[2], ecosystem: "PyPI", sourceFile: filePath });
    }
  }
  return deps;
}

function parseGoMod(filePath: string, content: string): Dependency[] {
  const deps: Dependency[] = [];
  const requireBlock = content.match(/require\s*\(([\s\S]*?)\)/g);
  const lines = requireBlock
    ? requireBlock.flatMap((block) => block.replace(/require\s*\(/, "").replace(/\)/, "").split("\n"))
    : content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("module") || trimmed.startsWith("go ")) continue;
    const match = trimmed.match(/^(\S+)\s+v?(\S+)/);
    if (match) {
      deps.push({ name: match[1], version: match[2], ecosystem: "Go", sourceFile: filePath });
    }
  }
  return deps;
}

function parseCargoToml(filePath: string, content: string): Dependency[] {
  const deps: Dependency[] = [];
  const sections = ["dependencies", "dev-dependencies", "build-dependencies"];

  for (const section of sections) {
    const sectionRe = new RegExp(`\\[${section.replace("-", "[-]")}\\]([\\s\\S]*?)(?=\\[|$)`, "g");
    const match = sectionRe.exec(content);
    if (!match) continue;

    for (const line of match[1].split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("[")) continue;
      // name = "version" or name = { version = "..." }
      const simpleMatch = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"/);
      if (simpleMatch) {
        deps.push({ name: simpleMatch[1], version: simpleMatch[2], ecosystem: "crates.io", sourceFile: filePath });
        continue;
      }
      const complexMatch = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*\{.*version\s*=\s*"([^"]+)"/);
      if (complexMatch) {
        deps.push({ name: complexMatch[1], version: complexMatch[2], ecosystem: "crates.io", sourceFile: filePath });
      }
    }
  }
  return deps;
}

// --- Manifest file detection ---

const MANIFEST_FILES: Record<string, (filePath: string, content: string) => Dependency[]> = {
  "package.json": parsePackageJson,
  "requirements.txt": parseRequirementsTxt,
  "go.mod": parseGoMod,
  "Cargo.toml": parseCargoToml,
};

function findManifests(scanPath: string, ignorePatterns: string[]): string[] {
  const manifestNames = Object.keys(MANIFEST_FILES);
  return walkDirectory(scanPath, ignorePatterns, (filePath) =>
    manifestNames.includes(path.basename(filePath)),
  );
}

// --- OSV.dev API ---

interface OsvVulnerability {
  id: string;
  summary?: string;
  details?: string;
  severity?: Array<{ type: string; score: string }>;
  database_specific?: { severity?: string };
  affected?: Array<{
    ranges?: Array<{
      events?: Array<{ introduced?: string; fixed?: string }>;
    }>;
  }>;
}

interface OsvResponse {
  vulns?: OsvVulnerability[];
}

function mapOsvSeverity(vuln: OsvVulnerability): Severity {
  // Check CVSS severity
  if (vuln.severity && vuln.severity.length > 0) {
    const score = parseFloat(vuln.severity[0].score);
    if (!isNaN(score)) {
      if (score >= 9.0) return Severity.Critical;
      if (score >= 7.0) return Severity.High;
      if (score >= 4.0) return Severity.Medium;
      return Severity.Low;
    }
  }

  // Check database-specific severity
  const dbSeverity = vuln.database_specific?.severity?.toLowerCase();
  if (dbSeverity) {
    if (dbSeverity === "critical") return Severity.Critical;
    if (dbSeverity === "high") return Severity.High;
    if (dbSeverity === "moderate" || dbSeverity === "medium") return Severity.Medium;
    if (dbSeverity === "low") return Severity.Low;
  }

  return Severity.Medium;
}

async function queryOsv(dep: Dependency): Promise<FindingInput[]> {
  const findings: FindingInput[] = [];

  try {
    const response = await fetch("https://api.osv.dev/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        package: { name: dep.name, ecosystem: dep.ecosystem },
        version: dep.version,
      }),
    });

    if (!response.ok) return findings;

    const data = (await response.json()) as OsvResponse;
    if (!data.vulns || data.vulns.length === 0) return findings;

    for (const vuln of data.vulns) {
      findings.push({
        rule_id: `dep-vuln-${vuln.id.toLowerCase()}`,
        scanner_type: ScannerType.Dependencies,
        severity: mapOsvSeverity(vuln),
        file: dep.sourceFile,
        line: 1,
        message: `Vulnerable dependency: ${dep.name}@${dep.version} — ${vuln.id}: ${vuln.summary || vuln.details || "No description"}`,
      });
    }
  } catch {
    // Network error — skip gracefully
  }

  return findings;
}

// --- Batch querying ---

async function queryOsvBatch(deps: Dependency[], batchSize: number = 10): Promise<FindingInput[]> {
  const findings: FindingInput[] = [];

  for (let i = 0; i < deps.length; i += batchSize) {
    const batch = deps.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(queryOsv));

    for (const result of results) {
      if (result.status === "fulfilled") {
        findings.push(...result.value);
      }
    }
  }

  return findings;
}

// --- Scanner ---

export const dependenciesScanner: Scanner = {
  name: "Dependency Scanner",
  type: ScannerType.Dependencies,
  description: "Scans project dependencies for known vulnerabilities using the OSV.dev database",

  async scan(scanPath: string, options?: ScannerRunOptions): Promise<FindingInput[]> {
    const ignorePatterns = options?.ignore_patterns ?? DEFAULT_CONFIG.ignore_patterns;
    const manifests = findManifests(scanPath, ignorePatterns);
    const allDeps: Dependency[] = [];

    for (const manifest of manifests) {
      try {
        const content = fs.readFileSync(manifest, "utf-8");
        const basename = path.basename(manifest);
        const parser = MANIFEST_FILES[basename];
        if (parser) {
          const relativePath = path.relative(scanPath, manifest);
          allDeps.push(...parser(relativePath, content));
        }
      } catch {
        // Skip unreadable manifests
      }
    }

    if (allDeps.length === 0) return [];

    return queryOsvBatch(allDeps);
  },
};

export default dependenciesScanner;
