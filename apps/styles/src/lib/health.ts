import { readdirSync, readFileSync, statSync, existsSync, writeFileSync } from "fs";
import { join, extname, relative } from "path";
import { getDb } from "./db.js";
import { getProjectDir } from "./fs.js";
import type { StyleProfile } from "./profiles.js";

export interface StyleRule {
  id: string;
  name: string;
  description: string;
  severity: "critical" | "warning" | "info";
  check: (content: string, filePath: string) => string[];
}

export interface FileViolation {
  filePath: string;
  rule: string;
  message: string;
  severity: "critical" | "warning" | "info";
  line?: number;
}

export interface HealthCheckResult {
  id: string;
  projectPath: string;
  runAt: number;
  violations: FileViolation[];
  score: number;
  status: "pass" | "warn" | "fail";
  filesScanned: number;
}

// ── Built-in rules ────────────────────────────────────────────────────────────

const FORBIDDEN_FONTS = [
  "Comic Sans MS",
  "Comic Sans",
  "Papyrus",
  "Curlz MT",
  "Brush Script MT",
  "Jokerman",
  "Kristen ITC",
];

export const BUILTIN_RULES: StyleRule[] = [
  {
    id: "no-inline-styles",
    name: "No Inline Styles",
    description:
      "Inline style objects on JSX elements make styles hard to maintain and override. Use CSS classes or a styling system instead.",
    severity: "warning",
    check(content) {
      const violations: string[] = [];
      const lines = content.split("\n");
      lines.forEach((line, i) => {
        if (/style=\{\{/.test(line)) {
          violations.push(`Line ${i + 1}: Inline style object detected`);
        }
      });
      return violations;
    },
  },
  {
    id: "no-magic-colors",
    name: "No Magic Color Literals",
    description:
      "Hardcoded hex color values should be extracted to design tokens or CSS variables for consistency.",
    severity: "warning",
    check(content) {
      const violations: string[] = [];
      const lines = content.split("\n");
      const colorRegex = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
      lines.forEach((line, i) => {
        const matches = line.match(colorRegex);
        if (matches) {
          violations.push(
            `Line ${i + 1}: Magic color literal(s): ${matches.join(", ")}`
          );
        }
      });
      return violations;
    },
  },
  {
    id: "no-card-nesting",
    name: "No Nested Card Components",
    description:
      "Nesting Card components creates visual ambiguity and breaks elevation hierarchy.",
    severity: "warning",
    check(content) {
      const violations: string[] = [];
      const lines = content.split("\n");
      let cardDepth = 0;
      lines.forEach((line, i) => {
        const opens = (line.match(/<Card[\s>]/g) ?? []).length;
        const closes = (line.match(/<\/Card>/g) ?? []).length;
        if (cardDepth > 0 && opens > 0) {
          violations.push(`Line ${i + 1}: Card component nested inside another Card`);
        }
        cardDepth = Math.max(0, cardDepth + opens - closes);
      });
      return violations;
    },
  },
  {
    id: "no-excessive-zindex",
    name: "No Excessive z-index",
    description:
      "Very high z-index values (50+) indicate stacking context issues. Use a design token z-index scale instead.",
    severity: "info",
    check(content) {
      const violations: string[] = [];
      const lines = content.split("\n");
      const zIndexRegex = /z-?index\s*[=:]\s*([0-9]+)/gi;
      lines.forEach((line, i) => {
        let match: RegExpExecArray | null;
        zIndexRegex.lastIndex = 0;
        while ((match = zIndexRegex.exec(line)) !== null) {
          const val = parseInt(match[1], 10);
          if (val >= 50) {
            violations.push(
              `Line ${i + 1}: Excessive z-index value ${val} (threshold: 50)`
            );
          }
        }
      });
      return violations;
    },
  },
  {
    id: "no-forbidden-fonts",
    name: "No Forbidden Fonts",
    description: `Avoid non-professional font families: ${FORBIDDEN_FONTS.join(", ")}`,
    severity: "warning",
    check(content) {
      const violations: string[] = [];
      const lines = content.split("\n");
      lines.forEach((line, i) => {
        for (const font of FORBIDDEN_FONTS) {
          if (line.toLowerCase().includes(font.toLowerCase())) {
            violations.push(`Line ${i + 1}: Forbidden font family detected: "${font}"`);
          }
        }
      });
      return violations;
    },
  },
];

// ── Rule selection ─────────────────────────────────────────────────────────────

export function getDefaultRules(_profile: StyleProfile | null): StyleRule[] {
  // All built-in rules are always active.
  // In the future, profile-specific rules can be merged here.
  return [...BUILTIN_RULES];
}

// ── File scanning ─────────────────────────────────────────────────────────────

const SCANNABLE_EXTENSIONS = new Set([
  ".tsx",
  ".jsx",
  ".ts",
  ".js",
  ".css",
  ".scss",
  ".html",
  ".vue",
]);

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "out",
  ".cache",
  "coverage",
]);

function collectFiles(dir: string, results: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, results);
    } else if (entry.isFile() && SCANNABLE_EXTENSIONS.has(extname(entry.name))) {
      results.push(fullPath);
    }
  }
  return results;
}

export function checkFile(filePath: string, rules: StyleRule[]): FileViolation[] {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }

  const violations: FileViolation[] = [];

  for (const rule of rules) {
    const messages = rule.check(content, filePath);
    for (const message of messages) {
      // Extract line number if present in the message (format: "Line N: ...")
      const lineMatch = message.match(/^Line (\d+):/);
      const line = lineMatch ? parseInt(lineMatch[1], 10) : undefined;

      violations.push({
        filePath,
        rule: rule.id,
        message,
        severity: rule.severity,
        line,
      });
    }
  }

  return violations;
}

// ── Score calculation ─────────────────────────────────────────────────────────

function calculateScore(violations: FileViolation[]): number {
  let penalty = 0;
  for (const v of violations) {
    if (v.severity === "critical") penalty += 10;
    else if (v.severity === "warning") penalty += 3;
    else penalty += 1;
  }
  return Math.max(0, 100 - penalty);
}

function getStatus(score: number): "pass" | "warn" | "fail" {
  if (score >= 80) return "pass";
  if (score >= 50) return "warn";
  return "fail";
}

// ── File cache ────────────────────────────────────────────────────────────────

export interface FileCacheEntry {
  mtime: number;
  violations: FileViolation[];
}

interface FileCacheMeta {
  profileName: string;
  builtAt: number;
}

interface FileCache {
  _meta: FileCacheMeta;
  [filePath: string]: FileCacheEntry | FileCacheMeta;
}

function loadFileCache(cachePath: string): FileCache {
  if (!existsSync(cachePath)) {
    return { _meta: { profileName: "", builtAt: 0 } };
  }
  try {
    return JSON.parse(readFileSync(cachePath, "utf-8")) as FileCache;
  } catch {
    return { _meta: { profileName: "", builtAt: 0 } };
  }
}

function saveFileCache(cachePath: string, cache: FileCache): void {
  try {
    writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf-8");
  } catch {
    // Non-fatal — caching is best-effort
  }
}

// ── Health check options ───────────────────────────────────────────────────────

export interface HealthCheckOptions {
  noCache?: boolean;
  sinceLast?: boolean;
}

// ── Health check runner ───────────────────────────────────────────────────────

export async function runHealthCheck(
  projectPath: string,
  options: HealthCheckOptions = {}
): Promise<HealthCheckResult> {
  const db = getDb();

  // Lazily import to avoid circular deps
  const { getActiveProfile } = await import("./profiles.js");
  const profile = getActiveProfile(projectPath);
  const rules = getDefaultRules(profile);
  const profileName = profile?.name ?? "";

  // Determine last run time for --since-last
  let lastRunAt = 0;
  if (options.sinceLast) {
    const lastRow = db
      .prepare(
        `SELECT run_at FROM health_checks WHERE project_path = ? ORDER BY run_at DESC LIMIT 1`
      )
      .get(projectPath) as { run_at: number } | null;
    lastRunAt = lastRow?.run_at ?? 0;
  }

  // Load file cache
  const projectDir = getProjectDir(projectPath);
  const cachePath = join(projectDir, "file-cache.json");
  let cache = loadFileCache(cachePath);

  // Invalidate cache if profile changed
  const cacheMeta = cache._meta as FileCacheMeta;
  if (cacheMeta.profileName !== profileName) {
    cache = { _meta: { profileName, builtAt: Date.now() } };
  }

  const files = collectFiles(projectPath);
  const allViolations: FileViolation[] = [];
  let cacheUpdated = false;

  for (const file of files) {
    // --since-last: only scan files modified since last run
    if (options.sinceLast && lastRunAt > 0) {
      let mtime = 0;
      try {
        mtime = statSync(file).mtimeMs;
      } catch {
        // file disappeared, skip
        continue;
      }
      if (mtime <= lastRunAt) {
        // Use cached violations if available, else skip file (assume clean)
        const cached = cache[file] as FileCacheEntry | undefined;
        if (cached) {
          allViolations.push(...cached.violations);
        }
        continue;
      }
    }

    // --no-cache: always scan
    if (!options.noCache) {
      let mtime = 0;
      try {
        mtime = statSync(file).mtimeMs;
      } catch {
        // skip unreadable files
      }

      const cached = cache[file] as FileCacheEntry | undefined;
      if (cached && cached.mtime === mtime && mtime > 0) {
        // Cache hit — use stored violations
        allViolations.push(...cached.violations);
        continue;
      }

      // Cache miss — scan and update cache
      const fileViolations = checkFile(file, rules);
      allViolations.push(...fileViolations);

      if (mtime > 0) {
        (cache as Record<string, FileCacheEntry | FileCacheMeta>)[file] = {
          mtime,
          violations: fileViolations,
        };
        cacheUpdated = true;
      }
    } else {
      // noCache mode — scan without reading or writing cache
      const fileViolations = checkFile(file, rules);
      allViolations.push(...fileViolations);
    }
  }

  // Persist updated cache to disk (skip in noCache mode)
  if (!options.noCache && cacheUpdated) {
    (cache._meta as FileCacheMeta).builtAt = Date.now();
    (cache._meta as FileCacheMeta).profileName = profileName;
    saveFileCache(cachePath, cache);
  }

  const score = calculateScore(allViolations);
  const status = getStatus(score);
  const id = crypto.randomUUID();
  const runAt = Date.now();

  // Persist to DB
  db.run(
    `INSERT INTO health_checks (id, project_path, run_at, violations, score, status, cerebras_used)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, projectPath, runAt, JSON.stringify(allViolations), score, status, 0]
  );

  // Persist individual violations
  for (const v of allViolations) {
    db.run(
      `INSERT INTO health_violations (id, check_id, file_path, rule, message, severity)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), id, v.filePath, v.rule, v.message, v.severity]
    );
  }

  return {
    id,
    projectPath,
    runAt,
    violations: allViolations,
    score,
    status,
    filesScanned: files.length,
  };
}
