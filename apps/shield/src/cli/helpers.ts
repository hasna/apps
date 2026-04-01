import { resolve, basename } from "path";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";
import chalk from "chalk";
import {
  ScannerType,
  ReportFormat,
  Severity,
  SEVERITY_ORDER,
  type Finding,
  type ConfigFile,
} from "../types/index.js";
import { createProject, getProjectByPath } from "../db/index.js";

export function getVersion(): string {
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 4; i++) {
      const candidate = dir + "/package.json";
      if (existsSync(candidate)) {
        const v = JSON.parse(readFileSync(candidate, "utf-8")).version;
        if (v) return v;
      }
      dir = dirname(dir);
    }
  } catch {}
  return "0.0.0";
}

export function getCodeContext(filePath: string, line: number, contextLines = 5): string {
  try {
    if (!existsSync(filePath)) return "";
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const start = Math.max(0, line - contextLines - 1);
    const end = Math.min(lines.length, line + contextLines);
    return lines
      .slice(start, end)
      .map((l, i) => {
        const lineNum = start + i + 1;
        const marker = lineNum === line ? ">" : " ";
        return `${marker} ${lineNum.toString().padStart(4)} | ${l}`;
      })
      .join("\n");
  } catch {
    return "";
  }
}

export function resolveScannerTypes(
  scannerArg: string | undefined,
  quick: boolean,
  config: ConfigFile,
): ScannerType[] {
  if (scannerArg) {
    const type = scannerArg as ScannerType;
    if (!Object.values(ScannerType).includes(type)) {
      console.error(chalk.red(`Unknown scanner type: ${scannerArg}`));
      console.error(chalk.gray(`Available: ${Object.values(ScannerType).join(", ")}`));
      process.exit(1);
    }
    return [type];
  }
  if (quick) return [ScannerType.Secrets, ScannerType.Dependencies];
  return config.enabled_scanners;
}

export function parseSeverity(level: string): Severity {
  const map: Record<string, Severity> = {
    critical: Severity.Critical,
    high: Severity.High,
    medium: Severity.Medium,
    low: Severity.Low,
    info: Severity.Info,
  };
  return map[level.toLowerCase()] ?? Severity.Info;
}

export function parseFormat(format: string): ReportFormat {
  const map: Record<string, ReportFormat> = {
    terminal: ReportFormat.Terminal,
    json: ReportFormat.Json,
    sarif: ReportFormat.Sarif,
  };
  return map[format.toLowerCase()] ?? ReportFormat.Terminal;
}

export function filterBySeverity(findings: Finding[], threshold: Severity): Finding[] {
  const thresholdOrder = SEVERITY_ORDER[threshold];
  return findings.filter((f) => SEVERITY_ORDER[f.severity] <= thresholdOrder);
}

export function ensureProject(scanPath: string) {
  const absPath = resolve(scanPath);
  let project = getProjectByPath(absPath);
  if (!project) {
    const name = basename(absPath);
    project = createProject(name, absPath);
  }
  return project;
}
