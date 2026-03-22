// Import Resolver — recursive @import resolution with cycle detection

import { splitCards } from "./splitter.js";
import { parseHeader } from "./header-parser.js";
import { parseBody } from "./body-parser.js";
import { parseDirectives } from "./directive-parser.js";
import type { OmpCard, OmpImport, OmpPattern } from "../types/index.js";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";

export interface ResolvedDocument {
  cards: OmpCard[];
  patterns: OmpPattern[];
  errors: string[];
}

/**
 * Resolve all @import directives in a raw OMP document.
 * Reads imported files, parses them, merges their cards into the parent.
 * Detects circular imports via a visited set.
 */
export function resolveImports(
  raw: string,
  filePath: string,
  visited: Set<string> = new Set()
): ResolvedDocument {
  const absolutePath = resolve(filePath);
  const errors: string[] = [];

  // Cycle detection
  if (visited.has(absolutePath)) {
    return {
      cards: [],
      patterns: [],
      errors: [`Circular import detected: ${absolutePath} (chain: ${[...visited].join(" → ")} → ${absolutePath})`],
    };
  }
  visited.add(absolutePath);

  const { title, cards: rawCards } = splitCards(raw);
  const allCards: OmpCard[] = [];
  const allPatterns: OmpPattern[] = [];
  const baseDir = dirname(absolutePath);

  // If the title section looks like a card (has type: or id:), treat it as one
  if (title && hasCardHeaders(title)) {
    const { directives, patterns } = parseDirectives(title, 1);
    allPatterns.push(...patterns);
    const card = parseRawCard(title, 1, absolutePath);
    if (card) allCards.push(card);
  }
  // Also check title section for @import and @pattern directives
  if (title && title.includes("@")) {
    const { directives, patterns } = parseDirectives(title, 1);
    allPatterns.push(...patterns);
    const imports = directives.filter((d) => d.kind === "import") as OmpImport[];
    for (const imp of imports) {
      const importPath = resolve(baseDir, imp.path);
      if (!existsSync(importPath)) {
        errors.push(`Import not found: ${imp.path} (resolved to ${importPath}) at line ${imp.lineNumber}`);
        continue;
      }
      const importedRaw = readFileSync(importPath, "utf-8");
      const resolved = resolveImports(importedRaw, importPath, new Set(visited));
      errors.push(...resolved.errors);
      allCards.push(...resolved.cards);
      allPatterns.push(...resolved.patterns);
    }
  }

  for (const rawCard of rawCards) {
    // Check for @import directives in the raw card
    const { directives, patterns } = parseDirectives(rawCard.raw, rawCard.lineNumber);
    allPatterns.push(...patterns);

    const imports = directives.filter((d) => d.kind === "import") as OmpImport[];

    if (imports.length > 0) {
      // Process each import
      for (const imp of imports) {
        const importPath = resolve(baseDir, imp.path);

        if (!existsSync(importPath)) {
          errors.push(`Import not found: ${imp.path} (resolved to ${importPath}) at line ${imp.lineNumber}`);
          continue;
        }

        const importedRaw = readFileSync(importPath, "utf-8");
        const resolved = resolveImports(importedRaw, importPath, new Set(visited));

        errors.push(...resolved.errors);
        allCards.push(...resolved.cards);
        allPatterns.push(...resolved.patterns);
      }

      // Also parse the non-import parts of this card as a regular card
      const nonImportLines = rawCard.raw
        .split("\n")
        .filter((line) => !line.trim().startsWith("@import"))
        .join("\n")
        .trim();

      if (nonImportLines && hasCardHeaders(nonImportLines)) {
        const card = parseRawCard(nonImportLines, rawCard.lineNumber, filePath);
        if (card) allCards.push(card);
      }
    } else {
      // No imports — parse as regular card
      const card = parseRawCard(rawCard.raw, rawCard.lineNumber, filePath);
      if (card) allCards.push(card);
    }
  }

  return { cards: allCards, patterns: allPatterns, errors };
}

/**
 * Check if a raw text has card header keys (type: or id:).
 */
function hasCardHeaders(raw: string): boolean {
  return /^(type|id)\s*:/m.test(raw);
}

/**
 * Parse a single raw card string into an OmpCard.
 */
function parseRawCard(raw: string, lineNumber: number, sourceFile: string): OmpCard | null {
  const header = parseHeader(raw, lineNumber);

  if (!header.id) return null;

  const body = parseBody(header.bodyRaw, header.bodyStartLine);
  const accepts = extractAcceptsFromBody(header.bodyRaw);

  return {
    type: header.type as any,
    id: header.id,
    depends: header.depends,
    headers: header.headers,
    body,
    accepts,
    sourceFile,
    lineNumber,
  };
}

/**
 * Extract accepts: lines from body.
 */
function extractAcceptsFromBody(bodyRaw: string): string[] {
  const accepts: string[] = [];
  for (const line of bodyRaw.split("\n")) {
    const match = line.trim().match(/^accepts:\s*(.+)$/);
    if (match) {
      accepts.push(
        ...match[1]
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean)
      );
    }
  }
  return accepts;
}
