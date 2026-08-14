import { readFileSync, writeFileSync } from "fs";
import type { FileViolation } from "./health.js";

export interface FixSuggestion {
  line: number;
  rule: string;
  current: string;
  suggestion: string;
  autoFixable: boolean;
  fixedLine?: string;
}

export interface FixResult {
  filePath: string;
  fixes: FixSuggestion[];
  applied: number;
}

// ── Common hex → Tailwind color map ──────────────────────────────────────────

const HEX_TO_TAILWIND: Record<string, string> = {
  "#ffffff": "white",
  "#fff": "white",
  "#000000": "black",
  "#000": "black",
  "#ff0000": "red-500",
  "#ef4444": "red-500",
  "#f87171": "red-400",
  "#dc2626": "red-600",
  "#00ff00": "green-500",
  "#22c55e": "green-500",
  "#16a34a": "green-600",
  "#86efac": "green-300",
  "#0000ff": "blue-600",
  "#3b82f6": "blue-500",
  "#2563eb": "blue-600",
  "#60a5fa": "blue-400",
  "#93c5fd": "blue-300",
  "#6366f1": "indigo-500",
  "#4f46e5": "indigo-600",
  "#8b5cf6": "violet-500",
  "#7c3aed": "violet-600",
  "#a855f7": "purple-500",
  "#f59e0b": "amber-500",
  "#d97706": "amber-600",
  "#fbbf24": "amber-400",
  "#f97316": "orange-500",
  "#ea580c": "orange-600",
  "#ec4899": "pink-500",
  "#db2777": "pink-600",
  "#14b8a6": "teal-500",
  "#0f766e": "teal-700",
  "#06b6d4": "cyan-500",
  "#0891b2": "cyan-600",
  "#6b7280": "gray-500",
  "#9ca3af": "gray-400",
  "#d1d5db": "gray-300",
  "#e5e7eb": "gray-200",
  "#f3f4f6": "gray-100",
  "#111827": "gray-900",
  "#1f2937": "gray-800",
  "#374151": "gray-700",
};

// ── Fix suggestion builders ───────────────────────────────────────────────────

function buildNoInlineStyleFix(lineContent: string, lineNumber: number): FixSuggestion {
  return {
    line: lineNumber,
    rule: "no-inline-styles",
    current: lineContent,
    suggestion:
      "Extract to a Tailwind class or CSS variable. Example: replace `style={{ color: 'red' }}` with `className=\"text-red-500\"`",
    autoFixable: false,
  };
}

function buildNoMagicColorFix(lineContent: string, lineNumber: number): FixSuggestion {
  const colorRegex = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;
  const matches = lineContent.match(colorRegex) ?? [];
  const firstHex = matches[0] ?? "";
  const normalized = firstHex.toLowerCase();
  const tailwindName = HEX_TO_TAILWIND[normalized];

  const autoFixable = true;
  // Build fixed line: add a comment after each hex occurrence
  let fixedLine = lineContent;
  for (const hex of matches) {
    const lower = hex.toLowerCase();
    const tw = HEX_TO_TAILWIND[lower];
    const comment = tw
      ? `/* ${hex} → use var(--color-primary) or Tailwind class '${tw}' */`
      : `/* ${hex} → use var(--color-primary) or Tailwind color class */`;
    fixedLine = fixedLine.replace(hex, comment);
  }

  const suggestionHex = firstHex || "magic color";
  const tailwindHint = tailwindName ? ` (Tailwind: \`${tailwindName}\`)` : "";

  return {
    line: lineNumber,
    rule: "no-magic-colors",
    current: lineContent,
    suggestion: `Replace magic color \`${suggestionHex}\` with a design token or Tailwind color class${tailwindHint}`,
    autoFixable,
    fixedLine,
  };
}

function buildNoCardNestingFix(lineContent: string, lineNumber: number): FixSuggestion {
  return {
    line: lineNumber,
    rule: "no-card-nesting",
    current: lineContent,
    suggestion:
      "Avoid nesting Card inside Card. Use a flat layout with padding/spacing instead, or use a List component.",
    autoFixable: false,
  };
}

function buildNoExcessiveZIndexFix(lineContent: string, lineNumber: number): FixSuggestion {
  return {
    line: lineNumber,
    rule: "no-excessive-zindex",
    current: lineContent,
    suggestion:
      "Use a z-index scale: 10 (dropdown), 20 (sticky), 30 (overlay), 40 (modal), 50 (toast). Avoid arbitrary values.",
    autoFixable: false,
  };
}

function buildNoForbiddenFontsFix(lineContent: string, lineNumber: number): FixSuggestion {
  return {
    line: lineNumber,
    rule: "no-forbidden-fonts",
    current: lineContent,
    suggestion:
      "Replace with a style-appropriate font. See your active style's typography section.",
    autoFixable: false,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getFixSuggestions(
  filePath: string,
  violations: FileViolation[]
): FixSuggestion[] {
  let lines: string[];
  try {
    const content = readFileSync(filePath, "utf-8");
    lines = content.split("\n");
  } catch {
    return [];
  }

  const suggestions: FixSuggestion[] = [];

  for (const violation of violations) {
    const lineNumber = violation.line ?? 1;
    const lineContent = lines[lineNumber - 1] ?? "";

    switch (violation.rule) {
      case "no-inline-styles":
        suggestions.push(buildNoInlineStyleFix(lineContent, lineNumber));
        break;
      case "no-magic-colors":
        suggestions.push(buildNoMagicColorFix(lineContent, lineNumber));
        break;
      case "no-card-nesting":
        suggestions.push(buildNoCardNestingFix(lineContent, lineNumber));
        break;
      case "no-excessive-zindex":
        suggestions.push(buildNoExcessiveZIndexFix(lineContent, lineNumber));
        break;
      case "no-forbidden-fonts":
        suggestions.push(buildNoForbiddenFontsFix(lineContent, lineNumber));
        break;
      default:
        // Unknown rule — produce a generic non-auto-fixable suggestion
        suggestions.push({
          line: lineNumber,
          rule: violation.rule,
          current: lineContent,
          suggestion: violation.message,
          autoFixable: false,
        });
    }
  }

  return suggestions;
}

export function applyFixes(filePath: string, fixes: FixSuggestion[]): number {
  const autoFixes = fixes.filter((f) => f.autoFixable && f.fixedLine !== undefined);
  if (autoFixes.length === 0) return 0;

  let lines: string[];
  try {
    const content = readFileSync(filePath, "utf-8");
    lines = content.split("\n");
  } catch {
    return 0;
  }

  // Apply fixes from bottom to top to preserve line numbers
  const sorted = [...autoFixes].sort((a, b) => b.line - a.line);

  let applied = 0;
  for (const fix of sorted) {
    const idx = fix.line - 1;
    if (idx >= 0 && idx < lines.length && fix.fixedLine !== undefined) {
      lines[idx] = fix.fixedLine;
      applied++;
    }
  }

  try {
    writeFileSync(filePath, lines.join("\n"), "utf-8");
  } catch {
    return 0;
  }

  return applied;
}
