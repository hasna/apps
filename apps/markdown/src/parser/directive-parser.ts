// Directive Parser — parse @ directives from card content

import type {
  OmpDirective,
  OmpImport,
  OmpPattern,
  OmpPatternInstance,
  OmpRepeat,
  OmpConditional,
  OmpUse,
  OmpEmit,
  OmpHook,
} from "../types/index.js";

const RESERVED_DIRECTIVES = new Set([
  "import", "pattern", "repeat", "if", "use", "emit", "hook",
]);

const IMPORT_RE = /^@import\s+(.+)$/;
const PATTERN_DEF_RE = /^@pattern\s+(\w[\w-]*)\(([^)]*)\)$/;
const PATTERN_INST_RE = /^@(\w[\w-]*)\(([^)]*)\)$/;
const REPEAT_RE = /^@repeat\s+(\d+)$/;
const IF_RE = /^@if\s+(.+)$/;
const USE_RE = /^@use\s+(.+)$/;
const EMIT_RE = /^@emit\s+(.+)$/;
const HOOK_RE = /^@hook\s+(before|after)\s+(.+)$/;

export type ParsedDirective =
  | OmpImport
  | OmpPatternInstance
  | OmpRepeat
  | OmpConditional
  | OmpUse
  | OmpEmit
  | OmpHook;

/**
 * Parse all @ directives from a raw card or document text.
 * Returns directives found and any pattern definitions.
 */
export function parseDirectives(
  raw: string,
  baseLineNumber: number = 1
): { directives: ParsedDirective[]; patterns: OmpPattern[] } {
  const lines = raw.split("\n");
  const directives: ParsedDirective[] = [];
  const patterns: OmpPattern[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = baseLineNumber + i;

    if (!line.startsWith("@")) continue;

    // @import
    const importMatch = line.match(IMPORT_RE);
    if (importMatch) {
      directives.push({
        kind: "import",
        path: importMatch[1].trim(),
        raw: line,
        lineNumber: lineNum,
      } as OmpImport);
      continue;
    }

    // @pattern definition
    const patternDefMatch = line.match(PATTERN_DEF_RE);
    if (patternDefMatch) {
      const name = patternDefMatch[1];
      const params = patternDefMatch[2]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      // Collect body until next @ directive or end
      const bodyLines: string[] = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].trim().startsWith("@") && lines[j].trim() !== "---") {
        bodyLines.push(lines[j]);
        j++;
      }

      patterns.push({
        name,
        params,
        bodyTemplate: bodyLines.join("\n").trim(),
        lineNumber: lineNum,
      });
      i = j - 1; // skip consumed lines
      continue;
    }

    // @repeat
    const repeatMatch = line.match(REPEAT_RE);
    if (repeatMatch) {
      directives.push({
        kind: "repeat",
        count: parseInt(repeatMatch[1], 10),
        raw: line,
        lineNumber: lineNum,
      } as OmpRepeat);
      continue;
    }

    // @if
    const ifMatch = line.match(IF_RE);
    if (ifMatch) {
      directives.push({
        kind: "if",
        condition: ifMatch[1].trim(),
        raw: line,
        lineNumber: lineNum,
      } as OmpConditional);
      continue;
    }

    // @use
    const useMatch = line.match(USE_RE);
    if (useMatch) {
      directives.push({
        kind: "use",
        tool: useMatch[1].trim(),
        raw: line,
        lineNumber: lineNum,
      } as OmpUse);
      continue;
    }

    // @emit
    const emitMatch = line.match(EMIT_RE);
    if (emitMatch) {
      directives.push({
        kind: "emit",
        event: emitMatch[1].trim(),
        raw: line,
        lineNumber: lineNum,
      } as OmpEmit);
      continue;
    }

    // @hook
    const hookMatch = line.match(HOOK_RE);
    if (hookMatch) {
      directives.push({
        kind: "hook",
        timing: hookMatch[1] as "before" | "after",
        targetId: hookMatch[2].trim(),
        raw: line,
        lineNumber: lineNum,
      } as OmpHook);
      continue;
    }

    // Pattern instantiation: @name(args) — must not be a reserved directive
    const instMatch = line.match(PATTERN_INST_RE);
    if (instMatch && !RESERVED_DIRECTIVES.has(instMatch[1])) {
      const patternName = instMatch[1];
      const argsRaw = instMatch[2];
      const args = parsePatternArgs(argsRaw);

      directives.push({
        kind: "instantiate",
        patternName,
        args,
        raw: line,
        lineNumber: lineNum,
      } as OmpPatternInstance);
      continue;
    }
  }

  return { directives, patterns };
}

/**
 * Parse pattern instantiation arguments.
 * Supports: @crud-api(notes, { title: string, content: string })
 */
function parsePatternArgs(raw: string): Record<string, string> {
  const args: Record<string, string> = {};

  // Simple case: positional args
  // Split carefully — don't split inside { }
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (const ch of raw) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());

  // Assign as positional: arg0, arg1, ... or named if contains =
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const eqIdx = part.indexOf("=");
    if (eqIdx > 0 && !part.startsWith("{")) {
      args[part.slice(0, eqIdx).trim()] = part.slice(eqIdx + 1).trim();
    } else {
      args[`arg${i}`] = part;
    }
  }

  return args;
}
