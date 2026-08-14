import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { relative, resolve, sep } from "path";
import {
  ScannerType,
  Severity,
  SEVERITY_ORDER,
  type FindingInput,
} from "../types/index.js";

export interface FleetPackageLeakOptions {
  path: string;
  ignore_patterns?: string[];
  max_file_bytes?: number;
}

export interface FleetPackageLeakSummary {
  total: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
}

export interface FleetPackageLeakResult {
  path: string;
  findings: FindingInput[];
  summary: FleetPackageLeakSummary;
  safety: {
    public_package_preset: true;
    scans_source_text: true;
    scans_binary_content: false;
    includes_secret_values: false;
  };
}

interface FleetLeakRule {
  id: string;
  severity: Severity;
  message: string;
  pattern: RegExp;
}

const DEFAULT_MAX_FILE_BYTES = 512 * 1024;
const DEFAULT_IGNORE_PATTERNS = [
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "dashboard/dist",
  "bun.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
];

function privateDotDirPattern(name: string): string {
  return `\\.${name}`;
}

const FLEET_PACKAGE_RULES: FleetLeakRule[] = [
  {
    id: "fleet-private-home-path",
    severity: Severity.High,
    message: "Private user home path found in public package content",
    pattern: /\/(?:home|Users)\/hasna\b/g,
  },
  {
    id: "fleet-private-runtime-db",
    severity: Severity.High,
    message: "Private runtime database or backup path found in public package content",
    pattern: new RegExp(
      String.raw`(?:^|[/"'\`])(?:${privateDotDirPattern("takumi")}|${privateDotDirPattern("hasna")}\/[^"'\`\s]*(?:\.db|\.sqlite|backup|vault|private|fleet|machines\.json))`,
      "g",
    ),
  },
  {
    id: "fleet-raw-machine-hostname",
    severity: Severity.High,
    message: "Raw fleet machine hostname found in public package content",
    pattern: /\b(?:machine00[1-9]|machine01[0-1]|spark0[0-9]|apple0[0-9])\b/g,
  },
  {
    id: "fleet-cloud-account-id",
    severity: Severity.High,
    message: "Cloud account id-like value found in public package content",
    pattern: /\b\d{12}\b/g,
  },
  {
    id: "fleet-access-token",
    severity: Severity.Critical,
    message: "Access token or private key pattern found in public package content",
    pattern: /\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{36,}|sk-(?:proj|svcacct|live|test|org|user)-[A-Za-z0-9_-]{16,}|BEGIN (?:RSA |OPENSSH |EC |)PRIVATE KEY)\b/g,
  },
  {
    id: "fleet-serial-number-field",
    severity: Severity.Medium,
    message: "Serial number field found in public package content; use redacted or synthetic examples",
    pattern: /["']?\b(?:serialNumber|serial_number|hardwareSerial|hardware_serial)\b["']?\s*[:=]/g,
  },
  {
    id: "fleet-sudo-password-field",
    severity: Severity.Critical,
    message: "Sudo password field found in public package content; use a secret reference",
    pattern: /["']?\b(?:sudoPassword|sudo_password|SUDO_PASSWORD|sudo_pass)\b["']?\s*[:=]/g,
  },
];

function shouldIgnore(path: string, ignorePatterns: string[]): boolean {
  const normalized = path.split(sep).join("/");
  return ignorePatterns.some((pattern) => {
    const normalizedPattern = pattern.replaceAll("\\", "/");
    return normalized === normalizedPattern || normalized.includes(`/${normalizedPattern}/`) || normalized.endsWith(`/${normalizedPattern}`);
  });
}

function isProbablyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  return sample.includes(0);
}

function lineAndColumn(content: string, index: number): { line: number; column: number } {
  const before = content.slice(0, index);
  const lines = before.split(/\r?\n/);
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

function summarize(findings: FindingInput[]): FleetPackageLeakSummary {
  const summary: FleetPackageLeakSummary = {
    total: findings.length,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };

  for (const finding of findings) {
    summary[finding.severity]++;
  }

  return summary;
}

function listTextFiles(root: string, ignorePatterns: string[], maxFileBytes: number): string[] {
  const files: string[] = [];

  function visit(path: string): void {
    const rel = relative(root, path) || ".";
    if (rel !== "." && shouldIgnore(rel, ignorePatterns)) return;

    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path)) {
        visit(resolve(path, entry));
      }
      return;
    }

    if (!stat.isFile() || stat.size > maxFileBytes) return;

    const buffer = readFileSync(path);
    if (isProbablyBinary(buffer)) return;
    files.push(path);
  }

  visit(root);
  return files;
}

export function filterFleetPackageLeaksBySeverity(
  findings: FindingInput[],
  threshold: Severity,
): FindingInput[] {
  const thresholdOrder = SEVERITY_ORDER[threshold];
  return findings.filter((finding) => SEVERITY_ORDER[finding.severity] <= thresholdOrder);
}

export function scanFleetPackageLeaks(options: FleetPackageLeakOptions): FleetPackageLeakResult {
  const scanPath = resolve(options.path);
  if (!existsSync(scanPath)) {
    throw new Error(`Path does not exist: ${scanPath}`);
  }

  const ignorePatterns = [...DEFAULT_IGNORE_PATTERNS, ...(options.ignore_patterns ?? [])];
  const maxFileBytes = options.max_file_bytes ?? DEFAULT_MAX_FILE_BYTES;
  const findings: FindingInput[] = [];

  for (const filePath of listTextFiles(scanPath, ignorePatterns, maxFileBytes)) {
    const rel = relative(scanPath, filePath).split(sep).join("/");
    const content = readFileSync(filePath, "utf-8");

    for (const rule of FLEET_PACKAGE_RULES) {
      rule.pattern.lastIndex = 0;
      for (const match of content.matchAll(rule.pattern)) {
        const index = match.index ?? 0;
        const location = lineAndColumn(content, index);
        findings.push({
          rule_id: rule.id,
          scanner_type: ScannerType.Secrets,
          severity: rule.severity,
          file: rel,
          line: location.line,
          column: location.column,
          message: rule.message,
        });
      }
    }
  }

  findings.sort((a, b) => {
    const severityDelta = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (severityDelta !== 0) return severityDelta;
    const fileDelta = a.file.localeCompare(b.file);
    if (fileDelta !== 0) return fileDelta;
    return a.line - b.line;
  });

  return {
    path: scanPath,
    findings,
    summary: summarize(findings),
    safety: {
      public_package_preset: true,
      scans_source_text: true,
      scans_binary_content: false,
      includes_secret_values: false,
    },
  };
}
