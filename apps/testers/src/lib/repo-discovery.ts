// Repo-native Playwright test discovery.
// Discovers existing Playwright specs in a repo, detects package manager,
// dev scripts, browser install state, and readiness to run.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { createHash } from "crypto";
import { join, resolve, relative } from "path";
import { getTestersDir } from "./paths.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RepoSpec {
  /** Relative path to the spec file */
  file: string;
  /** Glob pattern that matched this file */
  fromGlob: string;
  /** Number of tests described in the file (approximate, parsed from file text) */
  testCount: number;
  /** File mtime in ms (used for cache invalidation) */
  mtimeMs: number;
  /** File content hash (used for cache invalidation) */
  contentHash: string;
}

export interface PackageManagers {
  npm: boolean;
  yarn: boolean;
  pnpm: boolean;
  bun: boolean;
  /** Detected preferred package manager */
  preferred: "npm" | "yarn" | "pnpm" | "bun";
}

export interface DevScripts {
  /** Script that starts the dev/test server (if found) */
  dev: string | null;
  /** Script for test-only mode (if found) */
  test: string | null;
  /** Script to seed/fill test database */
  seed: string | null;
  /** Script to build the app */
  build: string | null;
}

export interface ReadinessCheck {
  /** Playwright is installed */
  playwrightInstalled: boolean;
  /** Browsers are downloaded */
  browsersInstalled: boolean;
  /** Playwright config file exists */
  configExists: boolean;
  /** Spec files exist and are readable */
  specsFound: boolean;
  /** All checks passed */
  ready: boolean;
  /** Human-readable issues if not ready */
  issues: string[];
}

export interface RepoPrep {
  /** Command to install dependencies */
  installCmd: string | null;
  /** Command to install Playwright browsers */
  installBrowsersCmd: string | null;
  /** Command to start dev server */
  startDevCmd: string | null;
  /** Command to build */
  buildCmd: string | null;
  /** Command to seed database */
  seedCmd: string | null;
}

export interface RepoDiscoverySnapshot {
  /** Absolute path to the repo root */
  repoPath: string;
  /** Playwright config file path (relative to repo) */
  configPath: string | null;
  /** Playwright config content parsed (or null if unparseable) */
  configRaw: string | null;
  /** Spec files discovered */
  specs: RepoSpec[];
  /** Total approximate test count across all specs */
  totalTests: number;
  /** Package manager detection */
  packageManager: PackageManagers;
  /** Dev-related scripts from package.json */
  devScripts: DevScripts;
  /** Readiness assessment */
  readiness: ReadinessCheck;
  /** Prep commands that could be run with --apply */
  prep: RepoPrep;
  /** Suggested base URL for the dev server */
  suggestedUrl: string | null;
  /** Suggested working directory for running tests */
  workingDir: string;
  /** When the snapshot was taken (ISO timestamp) */
  snapshotAt: string;
  /** Cache key for this snapshot (path hash + spec file hashes) */
  cacheKey: string;
}

// ─── Cache ───────────────────────────────────────────────────────────────────

function getCacheDir(): string {
  const testersDir = getTestersDir();
  const cacheDir = join(testersDir, "repo-index");
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
  }
  return cacheDir;
}

function pathHash(repoPath: string): string {
  return createHash("sha256").update(repoPath).digest("hex").slice(0, 16);
}

function getCachePath(repoPath: string): string {
  return join(getCacheDir(), `${pathHash(repoPath)}.json`);
}

function isCacheStale(cached: RepoDiscoverySnapshot, repoPath: string): boolean {
  // If any spec file has changed, the cache is stale
  for (const spec of cached.specs) {
    const fullPath = join(repoPath, spec.file);
    if (!existsSync(fullPath)) return true;
    try {
      const stat = statSync(fullPath);
      if (stat.mtimeMs !== spec.mtimeMs) return true;
    } catch {
      return true;
    }
  }
  // If the Playwright config changed, also stale
  if (cached.configPath) {
    const configFullPath = join(repoPath, cached.configPath);
    if (!existsSync(configFullPath)) return true;
    try {
      const stat = statSync(configFullPath);
      // We don't store config mtime in the cache, so use a simple age heuristic:
      // if cache is older than 1 hour, treat as stale when config exists
      const age = Date.now() - new Date(cached.snapshotAt).getTime();
      if (age > 3600000) return true;
    } catch {
      return true;
    }
  }
  return false;
}

function loadCache(repoPath: string): RepoDiscoverySnapshot | null {
  const cachePath = getCachePath(repoPath);
  if (!existsSync(cachePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(cachePath, "utf-8"));
    return raw as RepoDiscoverySnapshot;
  } catch {
    return null;
  }
}

function saveCache(snapshot: RepoDiscoverySnapshot): void {
  const cachePath = getCachePath(snapshot.repoPath);
  writeFileSync(cachePath, JSON.stringify(snapshot, null, 2), "utf-8");
}

// ─── Detection Helpers ───────────────────────────────────────────────────────

function detectPackageManager(repoPath: string): PackageManagers {
  const result: PackageManagers = {
    npm: existsSync(join(repoPath, "package-lock.json")),
    yarn: existsSync(join(repoPath, "yarn.lock")),
    pnpm: existsSync(join(repoPath, "pnpm-lock.yaml")),
    bun: existsSync(join(repoPath, "bun.lockb")) || existsSync(join(repoPath, "bun.lock")),
    preferred: "npm",
  };

  // Priority: bun > pnpm > yarn > npm (order of specificity)
  if (result.bun) result.preferred = "bun";
  else if (result.pnpm) result.preferred = "pnpm";
  else if (result.yarn) result.preferred = "yarn";
  else result.preferred = "npm";

  return result;
}

function detectDevScripts(repoPath: string): DevScripts {
  const pkgPath = join(repoPath, "package.json");
  if (!existsSync(pkgPath)) {
    return { dev: null, test: null, seed: null, build: null };
  }

  let scripts: Record<string, string>;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    scripts = pkg.scripts ?? {};
  } catch {
    return { dev: null, test: null, seed: null, build: null };
  }

  // Heuristic: find the dev server script
  const dev = scripts.dev ?? scripts.start ?? scripts["dev:server"] ?? null;
  const test = scripts.test ?? scripts["test:e2e"] ?? scripts["test:playwright"] ?? scripts.e2e ?? null;
  const seed = scripts.seed ?? scripts["db:seed"] ?? scripts.seedDb ?? null;
  const build = scripts.build ?? scripts["build:test"] ?? null;

  return { dev, test, seed, build };
}

function findPlaywrightConfig(repoPath: string): string | null {
  const candidates = [
    "playwright.config.ts",
    "playwright.config.js",
    "playwright.config.mjs",
    "playwright.config.cjs",
    "playwright-ct.config.ts",
    "playwright-ct.config.js",
  ];
  for (const name of candidates) {
    if (existsSync(join(repoPath, name))) return name;
  }
  return null;
}

function extractTestGlobPatterns(configPath: string | null, repoPath: string): string[] {
  if (!configPath) {
    // Default: common Playwright test patterns
    return ["**/*.spec.ts", "**/*.spec.js", "**/*.test.ts", "**/*.test.js", "**/e2e/**/*.ts", "**/e2e/**/*.js", "**/tests/**/*.ts", "**/tests/**/*.js"];
  }

  const fullPath = join(repoPath, configPath);
  let content: string;
  try {
    content = readFileSync(fullPath, "utf-8");
  } catch {
    // Config exists but unreadable, fall back to defaults
    return ["**/*.spec.ts", "**/*.test.ts"];
  }

  // Simple regex extraction of testDir and testMatch patterns
  // This is NOT a full parser — just a best-effort extraction
  const patterns: string[] = [];

  // testDir: 'tests' or testDir: './e2e'
  const testDirMatch = content.match(/testDir\s*[:=]\s*['"`]([^'"`]+)['"`]/);
  const testDir = testDirMatch?.[1];

  // testMatch: '**\/*.spec.ts' or testMatch: ['**\/*.spec.ts']
  const testMatchArray = content.match(/testMatch\s*[:=]\s*\[([^\]]+)\]/);
  if (testMatchArray) {
    const items = testMatchArray[1].match(/['"`]([^'"`]+)['"`]/g);
    if (items) {
      for (const item of items) {
        patterns.push(item.replace(/['"`]/g, ""));
      }
    }
  }

  const testMatchSingle = content.match(/testMatch\s*[:=]\s*['"`]([^'"`]+)['"`]/);
  if (testMatchSingle) {
    patterns.push(testMatchSingle[1]);
  }

  // If we extracted a testDir but no testMatch, append common patterns
  if (testDir && patterns.length === 0) {
    patterns.push(
      `${testDir}/**/*.spec.ts`,
      `${testDir}/**/*.test.ts`,
      `${testDir}/**/*.spec.js`,
      `${testDir}/**/*.test.js`,
    );
  }

  // If we still have nothing, fall back to defaults
  if (patterns.length === 0) {
    patterns.push("**/*.spec.ts", "**/*.test.ts", "**/*.spec.js", "**/*.test.js");
  }

  return patterns;
}

function approximateTestCount(filePath: string): number {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return 0;
  }

  // Count test() and test.describe() calls as approximate test count
  // This is intentionally loose — we're not parsing AST
  const testCalls = (content.match(/(?:^|\n)\s*(?:test|it)\(/gm) || []).length;
  return testCalls || 0;
}

function findSpecFiles(repoPath: string, globPatterns: string[]): RepoSpec[] {
  const specs: RepoSpec[] = [];
  const seen = new Set<string>();

  for (const pattern of globPatterns) {
    // Convert glob pattern to a directory walk
    // Simplified: we check common directories
    const dirsToSearch = ["", ".", "tests", "e2e", "test", "__tests__", "specs", "src"];

    for (const dir of dirsToSearch) {
      const searchDir = dir ? join(repoPath, dir) : repoPath;
      if (!existsSync(searchDir)) continue;

      try {
        const files = walkDir(searchDir);
        for (const file of files) {
          const relativePath = relative(repoPath, file);
          if (seen.has(relativePath)) continue;
          if (matchesGlob(relativePath, pattern)) {
            seen.add(relativePath);
            const content = readFileSync(file, "utf-8");
            const contentHash = createHash("sha256").update(content).digest("hex").slice(0, 16);
            const stat = statSync(file);
            specs.push({
              file: relativePath,
              fromGlob: pattern,
              testCount: approximateTestCount(file),
              mtimeMs: stat.mtimeMs,
              contentHash,
            });
          }
        }
      } catch {
        // Skip directories we can't read
      }
    }
  }

  // Sort by file path for consistent output
  specs.sort((a, b) => a.file.localeCompare(b.file));
  return specs;
}

function walkDir(dir: string): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules and .git
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        results.push(...walkDir(fullPath));
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  } catch {
    // Skip unreadable directories
  }
  return results;
}

// Simplified glob matching — handles **/*.ext, dir/**/*.ext, *.ext
function matchesGlob(filePath: string, pattern: string): boolean {
  // Convert glob pattern to regex
  let regex = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*\//g, "(.+/)?")  // **/ = any path prefix (or empty)
    .replace(/\*/g, "[^/]*")       // * = any non-slash chars
    .replace(/\?/g, "[^/]");       // ? = single non-slash char
  regex = "^" + regex + "$";
  return new RegExp(regex).test(filePath);
}

function detectSuggestedUrl(repoPath: string): string | null {
  // Check for framework-specific defaults via package.json
  const pkgPath = join(repoPath, "package.json");
  if (!existsSync(pkgPath)) return null;

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if ("next" in deps) return "http://localhost:3000";
    if ("vite" in deps) return "http://localhost:5173";
    if (Object.keys(deps).some((d) => d.startsWith("@remix-run"))) return "http://localhost:3000";
    if ("nuxt" in deps) return "http://localhost:3000";
    if (Object.keys(deps).some((d) => d.startsWith("@angular"))) return "http://localhost:4200";
  } catch {
    // ignore
  }

  return null;
}

function checkPlaywrightBrowserInstalled(repoPath: string): boolean {
  // Check for .cache/ms-playwright or playwright/.cache directory
  const cacheDir = join(repoPath, "node_modules", ".cache", "ms-playwright");
  if (existsSync(cacheDir)) return true;

  // Global playwright install
  const globalCache = join(repoPath, ".cache", "ms-playwright");
  if (existsSync(globalCache)) return true;

  return false;
}

function getInstallCommand(pm: PackageManagers): string {
  switch (pm.preferred) {
    case "npm": return "npm install";
    case "yarn": return "yarn install";
    case "pnpm": return "pnpm install";
    case "bun": return "bun install";
  }
}

function getPlaywrightInstallCommand(pm: PackageManagers): string | null {
  // npx playwright install works regardless of package manager
  return "npx playwright install";
}

// ─── Main Discovery ─────────────────────────────────────────────────────────

export interface DiscoveryOptions {
  /** Absolute path to the repo root */
  repoPath: string;
  /** Force a fresh scan, ignoring cache */
  refresh?: boolean;
  /** Override the working directory for running tests */
  workingDir?: string;
  /** Override base URL */
  baseUrl?: string;
}

export function discoverRepo(opts: DiscoveryOptions): RepoDiscoverySnapshot {
  const repoPath = resolve(opts.repoPath);

  // Check cache
  if (!opts.refresh) {
    const cached = loadCache(repoPath);
    if (cached && !isCacheStale(cached, repoPath)) {
      return cached;
    }
  }

  // Config
  const configPath = findPlaywrightConfig(repoPath);
  let configRaw: string | null = null;
  if (configPath) {
    try {
      configRaw = readFileSync(join(repoPath, configPath), "utf-8");
    } catch {
      configRaw = null;
    }
  }

  // Spec discovery
  const globPatterns = extractTestGlobPatterns(configPath, repoPath);
  const specs = findSpecFiles(repoPath, globPatterns);

  // Package manager
  const packageManager = detectPackageManager(repoPath);

  // Scripts
  const devScripts = detectDevScripts(repoPath);

  // Readiness
  const playwrightInstalled = existsSync(join(repoPath, "node_modules", "playwright"))
    || existsSync(join(repoPath, "node_modules", "@playwright", "test"));
  const browsersInstalled = checkPlaywrightBrowserInstalled(repoPath);
  const configExists = configPath !== null;
  const specsFound = specs.length > 0;

  const issues: string[] = [];
  if (!configExists) issues.push("No Playwright config file found");
  if (!playwrightInstalled) issues.push("Playwright is not installed (node_modules/playwright missing)");
  if (!browsersInstalled) issues.push("Playwright browsers not installed (run `npx playwright install`)");
  if (!specsFound) issues.push("No spec files found");

  const ready = issues.length === 0;

  // Prep commands
  const runPm = (script: string): string => {
    const name = script.split(" ")[0];
    const pm = packageManager.preferred;
    if (pm === "npm") return `npm run ${name}`;
    return `${pm} run ${name}`;
  };

  const prep: RepoPrep = {
    installCmd: playwrightInstalled ? null : getInstallCommand(packageManager),
    installBrowsersCmd: browsersInstalled ? null : getPlaywrightInstallCommand(packageManager),
    startDevCmd: devScripts.dev ? runPm(devScripts.dev) : null,
    buildCmd: devScripts.build ? runPm(devScripts.build) : null,
    seedCmd: devScripts.seed ? runPm(devScripts.seed) : null,
  };

  // Suggested URL
  const suggestedUrl = opts.baseUrl ?? detectSuggestedUrl(repoPath);

  // Working dir
  const workingDir = opts.workingDir ?? repoPath;

  // Cache key
  const specHashes = specs.map((s) => s.contentHash).join(",");
  const cacheKey = createHash("sha256").update(`${repoPath}:${specHashes}:${configRaw ?? ""}`).digest("hex").slice(0, 16);

  const snapshot: RepoDiscoverySnapshot = {
    repoPath,
    configPath,
    configRaw,
    specs,
    totalTests: specs.reduce((sum, s) => sum + s.testCount, 0),
    packageManager,
    devScripts,
    readiness: {
      playwrightInstalled,
      browsersInstalled,
      configExists,
      specsFound,
      ready,
      issues,
    },
    prep,
    suggestedUrl,
    workingDir,
    snapshotAt: new Date().toISOString(),
    cacheKey,
  };

  // Persist to cache
  saveCache(snapshot);

  return snapshot;
}

// ─── Cache Management ────────────────────────────────────────────────────────

export function clearDiscoveryCache(repoPath?: string): void {
  const cacheDir = getCacheDir();
  if (!existsSync(cacheDir)) return;

  if (repoPath) {
    const cachePath = getCachePath(repoPath);
    if (existsSync(cachePath)) {
      unlinkSync(cachePath);
    }
  } else {
    for (const file of readdirSync(cacheDir)) {
      if (file.endsWith(".json")) {
        unlinkSync(join(cacheDir, file));
      }
    }
  }
}

export function getDiscoveryCacheInfo(repoPath: string): { cached: boolean; stale: boolean; path: string } | null {
  const cachePath = getCachePath(repoPath);
  if (!existsSync(cachePath)) return null;

  const cached = loadCache(repoPath);
  if (!cached) return null;

  return {
    cached: true,
    stale: isCacheStale(cached, repoPath),
    path: cachePath,
  };
}
