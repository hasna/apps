// Command validator — catch invalid commands BEFORE executing
// Prevents shell errors from hallucinated flags, wrong paths, bad syntax

import { existsSync } from "fs";
import { join } from "path";

export interface ValidationResult {
  valid: boolean;
  issues: string[];
  fixedCommand?: string;
}

/** Extract file paths referenced in a command */
function extractPaths(command: string): string[] {
  const paths: string[] = [];
  // Match quoted paths
  const quoted = command.match(/["']([^"']+\.\w+)["']/g);
  if (quoted) paths.push(...quoted.map(q => q.replace(/["']/g, "")));
  // Match unquoted paths with extensions or directory separators
  const tokens = command.split(/\s+/);
  for (const t of tokens) {
    if (t.includes("/") && !t.startsWith("-") && !t.startsWith("|") && !t.startsWith("&")) {
      // Clean shell operators from end
      const clean = t.replace(/[;|&>]+$/, "");
      if (clean && !clean.startsWith("-")) paths.push(clean);
    }
  }
  return [...new Set(paths)];
}

/** Check for obviously broken shell syntax */
function checkSyntax(command: string): string[] {
  const issues: string[] = [];

  // Unmatched quotes
  const singleQuotes = (command.match(/'/g) || []).length;
  const doubleQuotes = (command.match(/"/g) || []).length;
  if (singleQuotes % 2 !== 0) issues.push("unmatched single quote");
  if (doubleQuotes % 2 !== 0) issues.push("unmatched double quote");

  // Unmatched parentheses
  const openParens = (command.match(/\(/g) || []).length;
  const closeParens = (command.match(/\)/g) || []).length;
  if (openParens !== closeParens) issues.push("unmatched parentheses");

  // Empty pipe targets
  if (/\|\s*$/.test(command)) issues.push("pipe with no target");
  if (/^\s*\|/.test(command)) issues.push("pipe with no source");

  return issues;
}

/** Validate a command before execution */
export function validateCommand(command: string, cwd: string): ValidationResult {
  const issues: string[] = [];

  // Check syntax
  issues.push(...checkSyntax(command));

  // Check file paths exist
  const paths = extractPaths(command);
  for (const p of paths) {
    const fullPath = p.startsWith("/") ? p : join(cwd, p);
    if (p.includes("*") || p.includes("?")) continue; // skip globs
    if (p.startsWith("-")) continue; // skip flags
    if ([".", "..", "/", "~"].includes(p)) continue; // skip special
    if (!existsSync(fullPath) && !existsSync(p)) {
      // Only flag source file paths, not output paths
      if (/\.(ts|tsx|js|jsx|json|md|yaml|yml|py|go|rs)$/.test(p)) {
        issues.push(`file not found: ${p}`);
      }
    }
  }

  // Check for common GNU flags on macOS
  const gnuFlags = command.match(/--max-depth|--color=|--sort=|--field-type|--no-deps/g);
  if (gnuFlags) {
    issues.push(`GNU flag on macOS: ${gnuFlags.join(", ")}`);
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
