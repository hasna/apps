import type { Scenario } from "../types/index.js";

export interface FileMapping {
  /** Glob pattern for source files (supports * and **) */
  glob: string;
  /** Tags of scenarios to run when this glob matches */
  tags: string[];
}

/**
 * Convert a simple glob pattern to a case-insensitive RegExp.
 * Supports * (single path segment) and ** (any depth).
 */
function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\x00DS\x00")
    .replace(/\*/g, "[^/]*")
    .replace(/\x00DS\x00/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

/**
 * Given a set of changed file paths and all scenarios, return the scenarios
 * relevant to those changes.
 *
 * Matching strategies (all applied, union of results):
 * 1. Explicit glob → tag mappings: if a file matches a glob, scenarios with
 *    any of the mapped tags are included.
 * 2. targetPath keyword: path segments of scenario.targetPath matched against
 *    file path components.
 * 3. Tag keywords: scenario tags matched as substrings of file paths (>2 chars).
 * 4. Name keywords: words in the scenario name matched against file paths (>3 chars).
 *
 * If filePaths is empty, all scenarios are returned (run everything).
 */
export function matchFilesToScenarios(
  filePaths: string[],
  scenarios: Scenario[],
  mappings: FileMapping[] = [],
): Scenario[] {
  if (filePaths.length === 0) return scenarios;

  // Pre-compile mapping regexes
  const compiledMappings = mappings.map((m) => ({
    regex: globToRegex(m.glob),
    tags: m.tags,
  }));

  // Normalise file paths for matching
  const normPaths = filePaths.map((p) => p.replace(/\\/g, "/").toLowerCase());

  const matchedIds = new Set<string>();

  for (const scenario of scenarios) {
    let matched = false;

    // Strategy 1: explicit glob → tag mappings
    if (!matched) {
      for (const { regex, tags } of compiledMappings) {
        if (normPaths.some((fp) => regex.test(fp)) && tags.some((tag) => scenario.tags.includes(tag))) {
          matched = true;
          break;
        }
      }
    }

    // Strategy 2: targetPath segments vs file path components
    if (!matched && scenario.targetPath) {
      const segments = scenario.targetPath
        .replace(/^\//, "")
        .split("/")
        .filter((s) => s.length > 2);
      if (segments.some((seg) => normPaths.some((fp) => fp.includes(seg.toLowerCase())))) {
        matched = true;
      }
    }

    // Strategy 3: tag keywords vs file paths (skip short tags)
    if (!matched) {
      for (const tag of scenario.tags) {
        if (tag.length > 2 && normPaths.some((fp) => fp.includes(tag.toLowerCase()))) {
          matched = true;
          break;
        }
      }
    }

    // Strategy 4: scenario name words vs file paths (words > 3 chars)
    if (!matched) {
      const nameWords = scenario.name
        .toLowerCase()
        .split(/[\s\-_/]+/)
        .filter((w) => w.length > 3);
      if (nameWords.some((word) => normPaths.some((fp) => fp.includes(word)))) {
        matched = true;
      }
    }

    if (matched) matchedIds.add(scenario.id);
  }

  return scenarios.filter((s) => matchedIds.has(s.id));
}
