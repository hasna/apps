/**
 * Deployment-mode removal ratchet (mode-removal rebuild, 0.5.0).
 *
 * There are no deployment modes (doctrine: "deployment modes are removed
 * everywhere; the only server-side switch is the data backend
 * `sqlite | postgresql`"). This test fails while any mode-shaped vocabulary
 * remains in src/, and must pass once the removal lands.
 *
 * Scope: every src tree .ts and .mjs file, excluding:
 *   - node_modules (not under src, guarded anyway)
 *   - src/generated/** (the generated kit is contracts-owned)
 *   - this ratchet file itself (its own cleanliness is asserted by the second
 *     test below)
 *
 * Exemptions (documented classes; everything else is a violation):
 *   1. Absence assertions — a code line asserting output does NOT contain a
 *      token (`.not.toContain(...)` / `.not.toMatch(...)` / `.not.toBe(...)` /
 *      `.not.toEqual(...)`) necessarily names the token; such lines are
 *      exempt (runtime-status.test.ts proves serialized output carries no
 *      deploymentMode/sourceOfTruth/self_hosted).
 *   2. Removal-documentation comments — comment text that documents the
 *      removal/absence of the vocabulary ("removed", "retired", "there is
 *      no ...", "no longer", "pre-mode-removal", ...) is exempt. Comments that
 *      merely describe old behavior WITHOUT removal language are violations.
 *   3. Push-manifest identifiers — `applySelfHostedPush`,
 *      `buildSelfHostedMigrationPlan`, `SelfHostedPlanOptions`,
 *      `planSelfHostedMigration`, `selfHostedControlPlaneSummary`,
 *      `selfHostedMigrationCommand`, and the `selfHosted` commander variable
 *      are plain-English "self-hosted server" usage (a server someone runs),
 *      not mode identifiers. The wire-stable manifest schema id
 *      `open-loops.self-hosted-push-manifest/v1` is hyphenated and matches no
 *      rule; it is allowlisted below for documentation only.
 *
 * The retired `HASNA_LOOPS_STORAGE_MODE` rejection contract was removed with
 * the own env chain (hasna/apps#1720): the shared credential resolver owns the
 * client connection and no source file names the retired variable any more —
 * there is no rejection file exemption left.
 *
 * Deliberate non-catches (documented decisions):
 *   - bare `local` / `cloud` values — ordinary English words, uncatchable;
 *     the mode surfaces around them are caught by the token rules
 *   - "deployment modes" / "storage modes" (plural) — the singular-space-form
 *     rules intentionally do not match the plural
 *   - "self-hosted" (hyphen, plain English) — allowed in comments and prose
 *   - plain "mode" — execution modes, MCP transport modes, dry-run mode
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

// ============================================================================
// RATCHET TABLES — every forbidden-token spelling in this file lives between
// this marker and the matching END marker; that region is exempt from the
// self-clean assertion in the second test.
// ============================================================================

interface ForbiddenRule {
  name: string;
  pattern: RegExp;
  /** Match full identifiers and check them against the allowlist. */
  identifier?: boolean;
  /** Run on the whole file text (spans newlines) instead of per line. */
  multiLine?: boolean;
}

const FORBIDDEN_PATTERNS: readonly ForbiddenRule[] = [
  {
    name: "deploymentMode field/type/identifier family",
    pattern: /[dD]eploymentMode/g,
  },
  {
    name: "LOOP_DEPLOYMENT_MODES constant",
    pattern: /LOOP_DEPLOYMENT_MODES/g,
  },
  {
    name: "deploymentStatus identifier family",
    pattern: /[dD]eploymentStatus/g,
  },
  {
    name: "LoopModeResolution type",
    pattern: /LoopModeResolution/g,
  },
  {
    name: "MODE_ENV_KEYS mode-env key array",
    pattern: /(?<!\w)MODE_ENV_KEYS(?!\w)/g,
  },
  {
    name: "modeKeys env-key property",
    pattern: /\bmodeKeys\b/g,
  },
  {
    name: "StorageMode camelCase type",
    pattern: /\bStorageMode\b/g,
  },
  {
    name: "STORAGE_MODE env-key family",
    pattern: /STORAGE_MODE/g,
  },
  {
    name: "sourceOfTruth status field",
    pattern: /sourceOfTruth/g,
  },
  {
    name: "cloud-http transport literal",
    pattern: /cloud-http/g,
  },
  {
    name: "cache_and_spool role value",
    pattern: /\bcache_and_spool\b/g,
  },
  {
    name: "self_hosted legacy mode value",
    pattern: /self_hosted/g,
  },
  {
    name: "camelCase self-hosted identifier",
    pattern: /[A-Za-z_$]*[sS]elfHosted[A-Za-z_$]*/g,
    identifier: true,
  },
  {
    name: "deployment mode (space form)",
    pattern: /\bdeployment mode\b/gi,
  },
  {
    name: "storage mode (space form)",
    pattern: /\bstorage mode\b/gi,
  },
  {
    name: "loops mode CLI command",
    pattern: /\.command\("mode"\)/g,
  },
  {
    name: "cloud status CLI command",
    pattern: /\.command\("cloud"\)/g,
  },
  {
    name: "self-hosted status CLI subcommand",
    pattern: /selfHosted[\s\S]{0,200}\.command\("status"\)/g,
    multiLine: true,
  },
  {
    name: "self-hosted status CLI args",
    pattern: /"self-hosted",\s*"status"/g,
  },
  {
    name: "cloud status CLI args",
    pattern: /"cloud",\s*"status"/g,
  },
];

/**
 * Push-manifest feature identifiers: plain-English "self-hosted" (a server
 * someone runs under the user-hosted story), not deployment-mode identifiers.
 * The schema id open-loops.self-hosted-push-manifest/v1 is wire-stable and is
 * not matched by any rule (hyphenated); the identifiers below would be.
 */
const SELF_HOSTED_IDENTIFIER_ALLOWLIST = new Set<string>([
  "applySelfHostedPush",
  "buildSelfHostedMigrationPlan",
  "SelfHostedPlanOptions",
  "planSelfHostedMigration",
  "selfHostedControlPlaneSummary",
  "selfHostedMigrationCommand",
  "selfHosted",
]);

/** Code line asserting a token's ABSENCE; naming the token is the point. */
const ABSENCE_ASSERTION = /\.not\.to(Contain|Match|Be|Equal)\(/;

/**
 * Comment text that documents the removal or absence of the mode vocabulary.
 * A comment merely narrating old mode-era behavior without such language is a
 * violation (e.g. transport.ts's "B2 CORE FIX" history note).
 */
const REMOVAL_DOC_LANGUAGE = /(removed|retired|no longer|never honored|replaced|deleted|there is no|\bno\b|\bwithout\b|removal|pre-)/i;

/** Manifest schema id: wire-stable, must stay; documented, not matched. */
const PUSH_MANIFEST_SCHEMA_ID = "open-loops.self-hosted-push-manifest/v1";

// ============================================================================
// END RATCHET TABLES
// ============================================================================

const srcRoot = fileURLToPath(new URL(".", import.meta.url));
const thisFile = fileURLToPath(import.meta.url);

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "generated") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectSourceFiles(path));
    else if (/\.(ts|mjs)$/.test(entry.name) && path !== thisFile) out.push(path);
  }
  return out.sort();
}

interface LineSegment {
  kind: "code" | "comment";
  text: string;
}

interface ClassifiedLine {
  no: number;
  raw: string;
  segments: LineSegment[];
}

/**
 * Minimal string-aware scanner: classifies a whole file into per-line
 * code/comment segments, carrying block-comment state across lines.
 * Handles slash-slash and slash-star comments, quote/backtick string
 * literals with backslash escapes. Template-literal dollar-brace
 * expressions are treated as string content (a comment inside one would be
 * misread as string — none exist in src).
 */
function classifyFile(text: string): ClassifiedLine[] {
  const rawLines = text.split("\n");
  const lines: ClassifiedLine[] = [];
  let state: "code" | "lineComment" | "blockComment" | "dquote" | "squote" | "tick" = "code";

  for (let ln = 0; ln < rawLines.length; ln += 1) {
    const raw = rawLines[ln];
    const segments: LineSegment[] = [];
    let i = 0;
    let current: string = "";
    const push = (kind: "code" | "comment") => {
      if (current.length === 0) return;
      if (segments.length > 0 && segments[segments.length - 1].kind === kind) {
        segments[segments.length - 1].text += current;
      } else {
        segments.push({ kind, text: current });
      }
      current = "";
    };

    while (i < raw.length) {
      const ch = raw[i];
      const next = raw[i + 1];
      if (state === "code") {
        if (ch === "/" && next === "/") {
          push("code");
          state = "lineComment";
          i += 2;
          continue;
        }
        if (ch === "/" && next === "*") {
          push("code");
          state = "blockComment";
          i += 2;
          continue;
        }
        if (ch === '"') {
          state = "dquote";
          current += ch;
          i += 1;
          continue;
        }
        if (ch === "'") {
          state = "squote";
          current += ch;
          i += 1;
          continue;
        }
        if (ch === "`") {
          state = "tick";
          current += ch;
          i += 1;
          continue;
        }
        current += ch;
        i += 1;
        continue;
      }
      if (state === "lineComment") {
        current += ch;
        i += 1;
        continue;
      }
      if (state === "blockComment") {
        if (ch === "*" && next === "/") {
          current += "*/";
          push("comment");
          state = "code";
          i += 2;
          continue;
        }
        current += ch;
        i += 1;
        continue;
      }
      if (state === "dquote" || state === "squote" || state === "tick") {
        if (ch === "\\") {
          current += ch;
          current += raw[i + 1] ?? "";
          i += 2;
          continue;
        }
        const closer = state === "dquote" ? '"' : state === "squote" ? "'" : "`";
        if (ch === closer) {
          current += ch;
          state = "code";
          i += 1;
          continue;
        }
        current += ch;
        i += 1;
        continue;
      }
    }
    if (state === "lineComment") {
      push("comment");
      state = "code";
    } else if (state === "blockComment") {
      push("comment");
    } else {
      push("code");
    }
    lines.push({ no: ln + 1, raw, segments });
  }
  return lines;
}

interface Finding {
  file: string;
  line: number;
  rule: string;
  match: string;
}

function scanFile(relPath: string, absPath: string, findings: Finding[]): void {
  const text = readFileSync(absPath, "utf8");
  const lines = classifyFile(text);

  const codePerLine: string[] = [];
  const originalLineForCodeIndex: number[] = [];
  for (const line of lines) {
    const code = line.segments
      .filter((s) => s.kind === "code")
      .map((s) => s.text)
      .join(" ");
    const hasCode = line.segments.some((s) => s.kind === "code" && s.text.trim().length > 0);
    if (hasCode) {
      codePerLine.push(code);
      originalLineForCodeIndex.push(line.no);
    }
  }
  const wholeCode = codePerLine.join("\n");

  const lineIsAbsenceAssertion = (lineNo: number): boolean => {
    const line = lines.find((l) => l.no === lineNo);
    return line ? ABSENCE_ASSERTION.test(line.raw) : false;
  };

  const matchOnCodeLine = (rule: ForbiddenRule, lineNo: number, code: string): void => {
    for (const m of code.matchAll(rule.pattern)) {
      const matched = m[0];
      if (rule.identifier && SELF_HOSTED_IDENTIFIER_ALLOWLIST.has(matched)) continue;
      if (lineIsAbsenceAssertion(lineNo)) continue;
      findings.push({ file: relPath, line: lineNo, rule: rule.name, match: matched });
    }
  };

  for (const rule of FORBIDDEN_PATTERNS) {
    if (rule.multiLine) {
      for (const m of wholeCode.matchAll(rule.pattern)) {
        const lineNo = wholeCode.slice(0, m.index).split("\n").length;
        const originalLine = originalLineForCodeIndex[lineNo - 1] ?? lineNo;
        if (lineIsAbsenceAssertion(originalLine)) continue;
        findings.push({ file: relPath, line: originalLine, rule: rule.name, match: m[0] });
      }
      continue;
    }
    for (let i = 0; i < codePerLine.length; i += 1) {
      matchOnCodeLine(rule, originalLineForCodeIndex[i], codePerLine[i]);
    }
  }

  for (const line of lines) {
    const commentText = line.segments
      .filter((s) => s.kind === "comment")
      .map((s) => s.text)
      .join(" ");
    if (commentText.trim().length === 0) continue;
    if (REMOVAL_DOC_LANGUAGE.test(commentText)) continue;
    for (const rule of FORBIDDEN_PATTERNS) {
      for (const m of commentText.matchAll(rule.pattern)) {
        const matched = m[0];
        if (rule.identifier && SELF_HOSTED_IDENTIFIER_ALLOWLIST.has(matched)) continue;
        findings.push({ file: relPath, line: line.no, rule: rule.name, match: matched });
      }
    }
  }
}

function scanSrc(): Finding[] {
  const findings: Finding[] = [];
  for (const absPath of collectSourceFiles(srcRoot)) {
    const relPath = "src/" + absPath.slice(srcRoot.length);
    scanFile(relPath, absPath, findings);
  }
  return findings.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1,
  );
}

function renderFindings(findings: readonly Finding[]): string[] {
  const width = Math.max(...findings.map((f) => f.rule.length), 0);
  return findings.map(
    (f) => `  ${f.file}:${f.line}  ${f.rule.padEnd(width)}  ${f.match}`,
  );
}

describe("deployment-mode removal ratchet", () => {
  test("no deployment-mode vocabulary remains in src", () => {
    const findings = scanSrc();
    const files = collectSourceFiles(srcRoot);
    const message = [
      "Deployment-mode vocabulary must be removed from src/ (mode-removal ratchet).",
      `Files scanned: ${files.length}; violations: ${findings.length}.`,
      "",
      ...renderFindings(findings),
      "",
      "Exemptions: absence assertions, removal-documentation comments, push-manifest identifiers, and the " +
        "wire-stable manifest schema id " + PUSH_MANIFEST_SCHEMA_ID + ".",
    ].join("\n");
    expect(findings, message).toHaveLength(0);
  });

  test("ratchet itself is clean", () => {
    const self = readFileSync(thisFile, "utf8");
    const classified = classifyFile(self);
    const lines = self.split("\n");
    let inTables = false;
    const codeLines: string[] = [];
    for (let i = 0; i < classified.length; i += 1) {
      if (lines[i].includes("RATCHET TABLES")) inTables = !inTables;
      if (inTables) continue;
      const code = classified[i].segments
        .filter((s) => s.kind === "code")
        .map((s) => s.text)
        .join(" ");
      if (code.trim().length > 0) codeLines.push(code);
    }
    const code = codeLines.join("\n");
    const selfFindings: Finding[] = [];
    for (const rule of FORBIDDEN_PATTERNS) {
      for (const m of code.matchAll(rule.pattern)) {
        const matched = m[0];
        if (rule.identifier && SELF_HOSTED_IDENTIFIER_ALLOWLIST.has(matched)) continue;
        selfFindings.push({ file: thisFile, line: 0, rule: rule.name, match: matched });
      }
    }
    const message = [
      "The ratchet file itself must not carry deployment-mode vocabulary outside",
      "its documented pattern tables or comment blocks.",
      ...renderFindings(selfFindings),
    ].join("\n");
    expect(selfFindings, message).toHaveLength(0);
  });
});
