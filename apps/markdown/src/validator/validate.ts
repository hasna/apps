// Validator — check OMP document against spec rules

import type { OmpCard, OmpError, OmpDocument } from "../types/index.js";
import { CARD_TYPES } from "../types/index.js";

const REQUIRED_KEYS: Record<string, string[]> = {
  endpoint: ["method", "path"],
  table: ["db"],
  page: ["path"],
  deploy: ["provider"],
  cron: ["schedule"],
  email: ["to", "subject"],
  call: ["action"],
  database: ["engine"],
};

const VALID_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

/**
 * Validate a parsed OMP document. Returns errors and warnings.
 */
export function validateDocument(doc: OmpDocument): OmpError[] {
  const errors: OmpError[] = [];

  // Check for duplicate IDs
  const idCounts = new Map<string, number>();
  for (const card of doc.cards) {
    idCounts.set(card.id, (idCounts.get(card.id) ?? 0) + 1);
  }
  for (const [id, count] of idCounts) {
    if (count > 1) {
      const dupes = doc.cards.filter((c) => c.id === id);
      for (const card of dupes.slice(1)) {
        errors.push({
          level: "error",
          message: `Duplicate card id "${id}"`,
          card: card.id,
          line: card.lineNumber,
          file: card.sourceFile,
        });
      }
    }
  }

  const validIds = new Set(doc.cards.map((c) => c.id));

  for (const card of doc.cards) {
    // Every card must have an id
    if (!card.id) {
      errors.push({
        level: "error",
        message: "Card is missing required 'id' field",
        line: card.lineNumber,
        file: card.sourceFile,
      });
    }

    // Check depends references
    for (const dep of card.depends) {
      if (!validIds.has(dep)) {
        errors.push({
          level: "warning",
          message: `Card "${card.id}" depends on "${dep}" which does not exist`,
          card: card.id,
          line: card.lineNumber,
          file: card.sourceFile,
        });
      }
    }

    // Check required keys for known card types
    const requiredKeys = REQUIRED_KEYS[card.type];
    if (requiredKeys) {
      for (const key of requiredKeys) {
        if (!(key in card.headers)) {
          errors.push({
            level: "error",
            message: `Card "${card.id}" (type: ${card.type}) is missing required key "${key}"`,
            card: card.id,
            line: card.lineNumber,
            file: card.sourceFile,
          });
        }
      }
    }

    // Validate endpoint method
    if (card.type === "endpoint" && card.headers["method"]) {
      const method = String(card.headers["method"]).toUpperCase();
      if (!VALID_METHODS.has(method)) {
        errors.push({
          level: "error",
          message: `Card "${card.id}" has invalid HTTP method "${method}"`,
          card: card.id,
          line: card.lineNumber,
          file: card.sourceFile,
        });
      }
    }

    // Check for malformed {{}} directives
    for (const dir of card.body.inlineDirectives) {
      if (!dir.content || dir.content.trim() === "") {
        errors.push({
          level: "error",
          message: `Card "${card.id}" has empty {{}} directive`,
          card: card.id,
          line: card.lineNumber,
          file: card.sourceFile,
        });
      }
    }

    // Warn if no body text (might be intentional for migration/emit cards)
    if (!card.body.raw.trim() && !["migration", "custom"].includes(card.type)) {
      errors.push({
        level: "info",
        message: `Card "${card.id}" has no body text — the LLM executor will have limited context`,
        card: card.id,
        line: card.lineNumber,
        file: card.sourceFile,
      });
    }
  }

  return errors;
}

/**
 * Lint an OMP document for best practices (beyond strict validation).
 */
export function lintDocument(doc: OmpDocument): OmpError[] {
  const warnings: OmpError[] = [];

  // Check for cards without accepts
  for (const card of doc.cards) {
    if (card.accepts.length === 0 && ["endpoint", "page", "auth"].includes(card.type)) {
      warnings.push({
        level: "warning",
        message: `Card "${card.id}" (type: ${card.type}) has no accepts: criteria — consider adding testable requirements`,
        card: card.id,
        line: card.lineNumber,
        file: card.sourceFile,
      });
    }
  }

  // Check for unreferenced cards (no other card depends on them, and they depend on nothing)
  const referencedIds = new Set<string>();
  for (const card of doc.cards) {
    for (const dep of card.depends) {
      referencedIds.add(dep);
    }
  }
  for (const card of doc.cards) {
    if (card.depends.length === 0 && !referencedIds.has(card.id) && doc.cards.length > 1) {
      warnings.push({
        level: "info",
        message: `Card "${card.id}" is isolated — it has no dependencies and nothing depends on it`,
        card: card.id,
        line: card.lineNumber,
        file: card.sourceFile,
      });
    }
  }

  // Check for very long bodies (might indicate the card should be split)
  for (const card of doc.cards) {
    const lineCount = card.body.raw.split("\n").length;
    if (lineCount > 50) {
      warnings.push({
        level: "info",
        message: `Card "${card.id}" body is ${lineCount} lines — consider splitting into smaller cards`,
        card: card.id,
        line: card.lineNumber,
        file: card.sourceFile,
      });
    }
  }

  return warnings;
}

/**
 * Validate and lint together.
 */
export function validateAndLint(doc: OmpDocument): OmpError[] {
  return [...validateDocument(doc), ...lintDocument(doc)];
}
