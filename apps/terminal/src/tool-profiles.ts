// Tool profiles — config-driven AI enhancement for specific command categories
// Profiles are loaded from profiles/ under the effective data home (getTerminalDir()) (user-customizable)
// Each profile tells the AI how to handle a specific tool's output

import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { getTerminalDir } from "./paths.js";

export interface ToolProfile {
  name: string;
  /** Regex pattern to detect this tool in a command */
  detect: string;
  /** Hints injected into the AI output processor prompt */
  hints: {
    compress?: string;   // How to compress this tool's output
    errors?: string;     // How to extract errors from this tool
    success?: string;    // What success looks like
  };
  /** Output handling */
  output?: {
    maxLines?: number;        // Cap output before AI processing
    preservePatterns?: string[]; // Regex patterns to always keep
    stripPatterns?: string[];    // Regex patterns to always remove
  };
}

const PROFILES_DIR = join(getTerminalDir(), "profiles");

/** Built-in profiles — sensible defaults, user can override */
const BUILTIN_PROFILES: ToolProfile[] = [
  {
    name: "git",
    detect: "^git\\b",
    hints: {
      compress: "For git output: show branch, file counts, insertions/deletions summary. Collapse individual diffs to file-level stats.",
      errors: "Git errors often include a suggested fix (e.g., 'did you mean X?'). Extract the suggestion.",
      success: "Clean working tree, successful push/pull, merge complete.",
    },
    output: { preservePatterns: ["conflict", "CONFLICT", "fatal", "error", "diverged"] },
  },
  {
    name: "test",
    detect: "\\b(bun|npm|yarn|pnpm)\\s+(test|run\\s+test)|\\bpytest\\b|\\bcargo\\s+test\\b|\\bgo\\s+test\\b",
    hints: {
      compress: "For test output: show pass/fail counts FIRST, then list ONLY failing test names with error snippets. Skip passing tests entirely.",
      errors: "Test failures have: test name, expected vs actual, stack trace. Extract all three.",
      success: "All tests passing = one line: '✓ N tests pass, 0 fail'",
    },
    output: { preservePatterns: ["FAIL", "fail", "Error", "✗", "expected", "received"] },
  },
  {
    name: "build",
    detect: "\\b(tsc|bun\\s+run\\s+build|npm\\s+run\\s+build|cargo\\s+build|go\\s+build|make)\\b",
    hints: {
      compress: "For build output: if success with no errors, say '✓ Build succeeded'. If errors, list each error with file:line and message.",
      errors: "Build errors have file:line:column format. Group by file.",
      success: "Empty output or exit 0 = build succeeded.",
    },
  },
  {
    name: "lint",
    detect: "\\b(eslint|biome|ruff|clippy|golangci-lint|prettier|tsc\\s+--noEmit)\\b",
    hints: {
      compress: "For lint output: group violations by rule name, show count per rule, one example per rule. Skip clean files.",
      errors: "Lint violations: file:line rule-name message. Group by rule.",
    },
    output: { maxLines: 100 },
  },
  {
    name: "install",
    detect: "\\b(npm\\s+install|bun\\s+install|yarn|pip\\s+install|cargo\\s+build|go\\s+mod)\\b",
    hints: {
      compress: "For install output: show only errors and final summary (packages added/removed/updated). Strip progress bars, funding notices, deprecation warnings.",
    },
    output: { stripPatterns: ["npm warn", "packages are looking for funding", "run `npm fund`"] },
  },
  {
    name: "find",
    detect: "^find\\b",
    hints: {
      compress: "For find output: if >50 results, group by top-level directory with counts. Show first 10 results as examples.",
    },
  },
  {
    name: "docker",
    detect: "\\b(docker|kubectl|helm)\\b",
    hints: {
      compress: "For container output: show container status, image, ports. Strip pull progress and layer hashes.",
      errors: "Docker errors: extract the error message after 'Error response from daemon:'",
    },
  },
];

/** Load user profiles from profiles/ under the effective data home (getTerminalDir()) */
function loadUserProfiles(): ToolProfile[] {
  if (!existsSync(PROFILES_DIR)) return [];

  const profiles: ToolProfile[] = [];
  try {
    for (const file of readdirSync(PROFILES_DIR)) {
      if (!file.endsWith(".json")) continue;
      try {
        const content = JSON.parse(readFileSync(join(PROFILES_DIR, file), "utf8"));
        if (content.name && content.detect) profiles.push(content as ToolProfile);
      } catch {}
    }
  } catch {}
  return profiles;
}

/** Get all profiles — user profiles override builtins by name (cached 30s) */
let _cachedProfiles: ToolProfile[] | null = null;
let _cachedProfilesAt = 0;

export function getProfiles(): ToolProfile[] {
  const now = Date.now();
  if (_cachedProfiles && now - _cachedProfilesAt < 30_000) return _cachedProfiles;
  const user = loadUserProfiles();
  const userNames = new Set(user.map(p => p.name));
  const builtins = BUILTIN_PROFILES.filter(p => !userNames.has(p.name));
  _cachedProfiles = [...user, ...builtins];
  _cachedProfilesAt = now;
  return _cachedProfiles;
}

/** Find the matching profile for a command */
export function matchProfile(command: string): ToolProfile | null {
  for (const profile of getProfiles()) {
    try {
      if (new RegExp(profile.detect).test(command)) return profile;
    } catch {}
  }
  return null;
}

/** Format profile hints for injection into AI prompt */
export function formatProfileHints(command: string): string {
  const profile = matchProfile(command);
  if (!profile) return "";

  const lines: string[] = [`TOOL PROFILE (${profile.name}):`];
  if (profile.hints.compress) lines.push(`  Compression: ${profile.hints.compress}`);
  if (profile.hints.errors) lines.push(`  Errors: ${profile.hints.errors}`);
  if (profile.hints.success) lines.push(`  Success: ${profile.hints.success}`);

  return lines.join("\n");
}
