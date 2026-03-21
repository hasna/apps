import {
  type Scanner,
  type FindingInput,
  type ScannerRunOptions,
  ScannerType,
} from "../types/index.js";
import { secretsScanner } from "./secrets.js";
import { dependenciesScanner } from "./dependencies.js";
import { codeScanner } from "./code.js";
import { gitHistoryScanner } from "./git-history.js";
import { configScanner } from "./config.js";
import { aiSafetyScanner } from "./ai-safety.js";

// --- Scanner registry ---

const scannerRegistry = new Map<ScannerType, Scanner>();

export function registerScanner(scanner: Scanner): void {
  scannerRegistry.set(scanner.type, scanner);
}

export function getScanner(type: ScannerType): Scanner | undefined {
  return scannerRegistry.get(type);
}

export function listScanners(): Scanner[] {
  return Array.from(scannerRegistry.values());
}

export async function runAllScanners(
  scanPath: string,
  options?: ScannerRunOptions,
): Promise<FindingInput[]> {
  const findings: FindingInput[] = [];
  const scanners = listScanners();

  const results = await Promise.allSettled(
    scanners.map((scanner) => scanner.scan(scanPath, options)),
  );

  for (const result of results) {
    if (result.status === "fulfilled") {
      findings.push(...result.value);
    }
  }

  return findings;
}

export async function runScanner(
  type: ScannerType,
  scanPath: string,
  options?: ScannerRunOptions,
): Promise<FindingInput[]> {
  const scanner = getScanner(type);
  if (!scanner) {
    throw new Error(`Scanner not found: ${type}`);
  }
  return scanner.scan(scanPath, options);
}

// --- Auto-register built-in scanners ---

registerScanner(secretsScanner);
registerScanner(dependenciesScanner);
registerScanner(codeScanner);
registerScanner(gitHistoryScanner);
registerScanner(configScanner);
registerScanner(aiSafetyScanner);

// --- Re-exports ---

export { secretsScanner } from "./secrets.js";
export { dependenciesScanner } from "./dependencies.js";
export { codeScanner } from "./code.js";
export { gitHistoryScanner } from "./git-history.js";
export { configScanner } from "./config.js";
export { aiSafetyScanner } from "./ai-safety.js";
export { SECRET_PATTERNS, shannonEntropy, walkDirectory, isBinaryFile, getCodeSnippet } from "./secrets.js";
export { CODE_PATTERNS } from "./code.js";
