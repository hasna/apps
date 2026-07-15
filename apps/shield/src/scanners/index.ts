import {
  type Scanner,
  type FindingInput,
  type ScannerRunOptions,
  ScannerType,
  DEFAULT_FILE_SCANNERS,
} from "../types/index.js";
import { secretsScanner } from "./secrets.js";
import { dependenciesScanner } from "./dependencies.js";
import { codeScanner } from "./code.js";
import { gitHistoryScanner } from "./git-history.js";
import { configScanner } from "./config.js";
import { aiSafetyScanner } from "./ai-safety.js";
import { iocScanner } from "./ioc.js";
import { lockfileScanner } from "./lockfile.js";
import { supplyChainScanner } from "./supply-chain.js";

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

/** Resolve an API/MCP scanner request. Git history is filtered unless the
 * request carries the dedicated per-invocation opt-in. Unknown scanners fail. */
export function resolvePublicScannerTypes(
  requested?: readonly string[],
  includeGitHistory = false,
): ScannerType[] {
  const source = !requested || requested.length === 0 ? DEFAULT_FILE_SCANNERS : requested;
  const resolved = source.map((value) => {
    if (!Object.values(ScannerType).includes(value as ScannerType) || !getScanner(value as ScannerType)) {
      throw new Error("Unknown or unavailable scanner requested");
    }
    return value as ScannerType;
  }).filter((value) => value !== ScannerType.GitHistory || includeGitHistory);
  if (includeGitHistory) resolved.push(ScannerType.GitHistory);
  return [...new Set(resolved)];
}

export async function runAllScanners(
  scanPath: string,
  options?: ScannerRunOptions,
): Promise<FindingInput[]> {
  // This public convenience API is intentionally file-only. Sensitive source
  // scanners (currently git history) remain available through runScanner,
  // where naming the scanner is the explicit opt-in.
  const scannerTypes = options?.include_git_history
    ? [...DEFAULT_FILE_SCANNERS, ScannerType.GitHistory]
    : DEFAULT_FILE_SCANNERS;
  const scanners = scannerTypes.map((type) => {
    const scanner = getScanner(type);
    if (!scanner) throw new Error("Default scanner unavailable");
    return scanner;
  });
  const results = await Promise.all(scanners.map((scanner) => scanner.scan(scanPath, options)));
  return results.flat();
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
registerScanner(iocScanner);
registerScanner(lockfileScanner);
registerScanner(supplyChainScanner);

// --- Re-exports ---

export { secretsScanner } from "./secrets.js";
export { dependenciesScanner } from "./dependencies.js";
export { codeScanner } from "./code.js";
export { gitHistoryScanner } from "./git-history.js";
export { configScanner } from "./config.js";
export { aiSafetyScanner } from "./ai-safety.js";
export { iocScanner } from "./ioc.js";
export { lockfileScanner } from "./lockfile.js";
export { supplyChainScanner } from "./supply-chain.js";
export { SECRET_PATTERNS, shannonEntropy, walkDirectory, isBinaryFile, getCodeSnippet } from "./secrets.js";
export { CODE_PATTERNS } from "./code.js";
