// Pattern Expander — expand @pattern definitions into generated cards

import type { OmpPattern, OmpPatternInstance } from "../types/index.js";

export interface ExpandedCard {
  raw: string;
  patternName: string;
  args: Record<string, string>;
}

// Built-in pattern: @crud-api(entity, fields) → 5 endpoint cards
const CRUD_API_TEMPLATE = `type: endpoint
id: list-{{arg0}}
method: GET
path: /api/{{arg0}}
auth: required
depends: auth

Return a paginated list of all {{arg0}}. Support query parameters for filtering and sorting.

---

type: endpoint
id: create-{{arg0}}
method: POST
path: /api/{{arg0}}
auth: required
body: {{arg1}}
depends: auth

Create a new {{arg0}} record. Validate all required fields. Return the created record with id and timestamps.

accepts: missing required fields returns 422; returns 201 on success

---

type: endpoint
id: get-{{arg0}}
method: GET
path: /api/{{arg0}}/:id
auth: required
depends: auth

Return a single {{arg0}} record by id. Return 404 if not found or not owned by the current user.

---

type: endpoint
id: update-{{arg0}}
method: PUT
path: /api/{{arg0}}/:id
auth: required
body: {{arg1}}
depends: auth

Update a {{arg0}} record. Partial updates allowed. Refresh updated_at timestamp. Return 404 if not found or not owned.

accepts: partial update works; updated_at refreshed

---

type: endpoint
id: delete-{{arg0}}
method: DELETE
path: /api/{{arg0}}/:id
auth: required
depends: auth

Delete a {{arg0}} record and any associated data. Return 404 if not found or not owned.`;

// Built-in pattern: @page-set(entity, features) → 3 page cards
const PAGE_SET_TEMPLATE = `type: page
id: {{arg0}}-list
path: /{{arg0}}
auth: required
depends: root-layout, list-{{arg0}}

Display all {{arg0}} in a responsive grid layout. Include search and filtering based on {{arg1}}.

---

type: page
id: {{arg0}}-editor
path: /{{arg0}}/:id
auth: required
depends: root-layout, get-{{arg0}}, update-{{arg0}}, delete-{{arg0}}

Full editor for a single {{arg0}} record. Show all editable fields. Include save and delete actions with confirmation.

---

type: page
id: {{arg0}}-create
path: /{{arg0}}/new
auth: required
depends: root-layout, create-{{arg0}}

Form to create a new {{arg0}} record. Validate inputs and redirect to the editor on success.`;

const BUILTIN_PATTERNS: Record<string, string> = {
  "crud-api": CRUD_API_TEMPLATE,
  "page-set": PAGE_SET_TEMPLATE,
};

/**
 * Expand a pattern instance into raw card strings.
 *
 * Looks up the pattern (built-in or user-defined), substitutes
 * arguments, and returns the expanded card strings ready to be parsed.
 */
export function expandPattern(
  instance: OmpPatternInstance,
  userPatterns: OmpPattern[],
  additionalContext: string = ""
): ExpandedCard[] {
  // Find the pattern: check user-defined first, then built-in
  const userPattern = userPatterns.find((p) => p.name === instance.patternName);
  const template = userPattern
    ? userPattern.bodyTemplate
    : BUILTIN_PATTERNS[instance.patternName];

  if (!template) {
    return []; // Unknown pattern — validator will catch this
  }

  // Substitute arguments into template
  let expanded = template;
  for (const [key, value] of Object.entries(instance.args)) {
    const re = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    expanded = expanded.replace(re, value);
  }

  // If there's additional context (NL text after the pattern instantiation),
  // append it to each card's body
  if (additionalContext.trim()) {
    expanded = expanded
      .split("\n---\n")
      .map((card) => `${card}\n\n${additionalContext.trim()}`)
      .join("\n---\n");
  }

  // Split into individual card strings
  const cardStrings = expanded.split(/\n---\n/);

  return cardStrings
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => ({
      raw,
      patternName: instance.patternName,
      args: instance.args,
    }));
}

/**
 * Expand all pattern instances in a document.
 */
export function expandAllPatterns(
  instances: OmpPatternInstance[],
  userPatterns: OmpPattern[],
  contextByLine: Map<number, string> = new Map()
): ExpandedCard[] {
  const allExpanded: ExpandedCard[] = [];

  for (const instance of instances) {
    const context = contextByLine.get(instance.lineNumber) ?? "";
    const expanded = expandPattern(instance, userPatterns, context);
    allExpanded.push(...expanded);
  }

  return allExpanded;
}

/**
 * Get list of built-in pattern names.
 */
export function getBuiltinPatternNames(): string[] {
  return Object.keys(BUILTIN_PATTERNS);
}
