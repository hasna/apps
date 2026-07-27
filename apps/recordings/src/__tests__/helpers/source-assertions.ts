import { expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Shared assertions for contract tests that read source text.
 *
 * These live here rather than inside one suite because the defect they exist to prevent is
 * repo-wide: a sweep of every `*.test.ts` found 40 ordering assertions written as
 * `indexOf(a) < indexOf(b)`, across 11 files. `indexOf` answers -1 when the needle is absent and
 * `-1 < anything` is true, so such an assertion PASSES when the thing being ordered is DELETED.
 * The same hole exists in `.slice(indexOf(...), indexOf(...))` region bounds, where a -1 silently
 * slices from the end of the file or to its start — a region assertion over the wrong text, or over
 * none of it, reads exactly like a satisfied one.
 */

/**
 * Assert `first` appears before `second`, requiring BOTH to exist.
 *
 * Use this instead of comparing two `indexOf` results directly. `firstMatch: "last"` selects
 * `lastIndexOf` for the first operand, which has the identical -1 hole.
 */
export function expectOrder(
  haystack: string,
  first: string,
  second: string,
  options: { firstMatch?: "first" | "last" } = {},
): void {
  const firstIndex =
    options.firstMatch === "last" ? haystack.lastIndexOf(first) : haystack.indexOf(first);
  const secondIndex = haystack.indexOf(second);
  expect(firstIndex, `ordering operand is missing entirely: ${first}`).toBeGreaterThan(-1);
  expect(secondIndex, `ordering operand is missing entirely: ${second}`).toBeGreaterThan(-1);
  expect(firstIndex).toBeLessThan(secondIndex);
}

/**
 * Slice between two markers, requiring both to exist and the region to be non-trivial.
 *
 * The length floor matters as much as the -1 checks: `slice(-1)` yields a ONE-CHARACTER string, not
 * an empty one, so a `expect(region.length).toBeGreaterThan(0)` control passes on a region that
 * contains nothing worth asserting about. Any `not.toContain` over such a region is vacuous.
 */
export function sliceBetween(
  source: string,
  open: string,
  close: string,
  options: { minimumLength?: number } = {},
): string {
  const from = source.indexOf(open);
  const to = source.indexOf(close, from + 1);
  expect(from, `slice start marker is missing: ${open}`).toBeGreaterThan(-1);
  expect(to, `slice end marker is missing: ${close}`).toBeGreaterThan(from);
  const region = source.slice(from, to);
  expect(
    region.length,
    `slice between ${open} and ${close} is too small to assert anything about`,
  ).toBeGreaterThanOrEqual(options.minimumLength ?? open.length + 1);
  return region;
}

/**
 * Assert a marker occurs exactly once before slicing on it.
 *
 * A duplicated end marker silently extends a region: `let myPID = ProcessInfo…` occurs twice in
 * `RecordingEngine.swift`, so a region bounded by it could stretch ~127 KB and be satisfied by
 * copies of the needle from an unrelated function.
 */
export function sliceBetweenUnique(source: string, open: string, close: string): string {
  for (const [label, marker] of [["start", open], ["end", close]] as const) {
    const occurrences = source.split(marker).length - 1;
    expect(occurrences, `${label} marker is not unique (${occurrences}x): ${marker}`).toBe(1);
  }
  return sliceBetween(source, open, close);
}

/** Strip Swift line comments so an assertion about code is not defeated by prose. */
export function withoutComments(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

type SwiftStringLiteral = { readonly hashes: number; readonly delimiter: string };

/** The string literal opening at `index`, if any — including its kind and raw-delimiter count. */
function stringLiteralAt(source: string, index: number): SwiftStringLiteral | null {
  let at = index;
  let hashes = 0;
  while (source[at] === "#") {
    hashes += 1;
    at += 1;
  }
  if (source.startsWith('"""', at)) return { hashes, delimiter: '"""' };
  if (source[at] === '"') return { hashes, delimiter: '"' };
  return null;
}

/**
 * Index just past the comment or string literal starting at `index`, or null if neither starts here.
 *
 * Both halves were missing from the copy of this scanner that lived in
 * `native-paste-delivery-verification-contract.test.ts`, and each omission hid a real leak:
 *
 *   - No comment handling at all. An unmatched `)` inside a `//` comment truncated the scanned
 *     region to 45 characters, and inside a `/* *\/` comment to 35 — in both cases the
 *     `\(field.value)` interpolation that followed fell outside every scanned region, so the
 *     focused field's text (password fields included) reached `Recordings.log` unseen.
 *   - `inString` was ONE BOOLEAN, so it could not tell `"` from `"""`. A lone `"` inside a
 *     multiline literal flipped parity, after which a `)` inside the literal closed the region.
 *
 * The asymmetry is why this has to be right rather than approximately right: a spurious
 * "still inside a string" over-reads to end of file, which is fail-safe, but a spurious "back in
 * code" ends the region early and HIDES leaks. Swift block comments nest, and raw literals move
 * both the terminator and the escape introducer, so all three are tracked rather than assumed.
 */
function skipCommentOrString(source: string, index: number): number | null {
  if (source.startsWith("//", index)) {
    const newline = source.indexOf("\n", index);
    return newline === -1 ? source.length : newline;
  }
  if (source.startsWith("/*", index)) {
    let depth = 1;
    let at = index + 2;
    while (at < source.length && depth > 0) {
      if (source.startsWith("/*", at)) {
        depth += 1;
        at += 2;
      } else if (source.startsWith("*/", at)) {
        depth -= 1;
        at += 2;
      } else at += 1;
    }
    return at;
  }
  const literal = stringLiteralAt(source, index);
  if (literal === null) return null;
  const hashes = "#".repeat(literal.hashes);
  const terminator = literal.delimiter + hashes;
  const escape = `\\${hashes}`;
  let at = index + literal.hashes + literal.delimiter.length;
  while (at < source.length) {
    // An interpolation is code, and may itself contain literals and parentheses. Skipping it as a
    // balanced group is what stops `\(f("a"))` from ending the literal at the inner quote and
    // dropping the scanner back into code mode inside the interpolation.
    if (source.startsWith(`${escape}(`, at)) {
      at = skipBalanced(source, at + escape.length, "(", ")");
      continue;
    }
    if (source.startsWith(escape, at)) {
      at += escape.length + 1;
      continue;
    }
    if (source.startsWith(terminator, at)) return at + terminator.length;
    at += 1;
  }
  return source.length;
}

/** Index just past the delimiter matching the `open` at `index`, skipping comments and literals. */
function skipBalanced(source: string, index: number, open: string, close: string): number {
  let depth = 0;
  let at = index;
  while (at < source.length) {
    const skipped = skipCommentOrString(source, at);
    if (skipped !== null && skipped > at) {
      at = skipped;
      continue;
    }
    if (source[at] === open) depth += 1;
    else if (source[at] === close) {
      depth -= 1;
      if (depth === 0) return at + 1;
    }
    at += 1;
  }
  return source.length;
}

/**
 * Region from the first `open` at or after `start` to its matching `close`.
 *
 * Structural where a marker literal is not: a region bounded by a neighbouring statement inherits
 * every edit to that statement. `sliceBetween(engineSource, ..., "if shouldRestore {")` pinned the
 * exact spelling of a guard two lines away, so parenthesising the condition failed a test about the
 * decision TABLE. Brace matching has no such coupling.
 *
 * Returns "" when `open` does not occur, so callers can filter rather than assert on a phantom.
 */
export function balancedRegion(source: string, start: number, open: string, close: string): string {
  const from = source.indexOf(open, start);
  if (from === -1) return "";
  return source.slice(from, skipBalanced(source, from, open, close));
}

/**
 * Every Swift interpolation in `region`, as its inner expression text.
 *
 * Balance-matched, not `/\\\(([^)]*)\)/`. That regex stopped at the FIRST `)`, so for
 * `\(String(describing: readBackAttempts) + field.value)` it captured
 * `"String(describing: readBackAttempts"` and `field.value` fell entirely outside the capture —
 * the tainted-identifier check never saw the leak. Same bug class as the truncation above, one
 * line away from it.
 */
export function interpolationsIn(region: string): string[] {
  const interpolations: string[] = [];
  for (const match of region.matchAll(/\\#*\(/g)) {
    const openParen = (match.index ?? 0) + match[0].length - 1;
    const end = skipBalanced(region, openParen, "(", ")");
    interpolations.push(region.slice(openParen + 1, end - 1));
  }
  return interpolations;
}

/**
 * Evaluate a Swift boolean condition for a given binding of its identifiers.
 *
 * Folded in from PR #43, which pinned the clipboard-restore guard by evaluating it for BOTH values
 * of the decision rather than by comparing its text. That is the half worth keeping: an exact
 * `toBe("shouldRestore")` on the captured condition kills the inversion, but it also fails on
 * `(shouldRestore)`, on a trailing comment, and on any other semantics-preserving rewrite — so it
 * reports refactors as defects while proving nothing about behaviour.
 *
 * Deliberately narrow and fail-CLOSED: `true`, `false`, `!x`, parentheses, and identifiers present
 * in `env`. Anything else throws. An added disjunct (`shouldRestore || stillOwnsChangeCount`) is an
 * unevaluatable expression, not a passing one — which is the behaviour that matters, because that
 * disjunct is exactly how the transcript-destroying defect gets reintroduced. Extend the evaluator
 * when a new shape is legitimate; do not loosen the assertion.
 */
export function evaluateSwiftCondition(condition: string, env: Record<string, boolean>): boolean {
  // Block and line comments carry no truth value; #43's version threw on `if x /* why */ {`.
  const text = condition
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .trim();
  if (text === "true") return true;
  if (text === "false") return false;
  if (text.startsWith("!")) return !evaluateSwiftCondition(text.slice(1), env);
  // Only strip parens that wrap the WHOLE expression, so `(a) || (b)` is not silently reduced.
  if (text.startsWith("(") && text.endsWith(")")) {
    let depth = 0;
    let wrapsAll = true;
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] === "(") depth += 1;
      else if (text[i] === ")") {
        depth -= 1;
        if (depth === 0 && i < text.length - 1) wrapsAll = false;
      }
    }
    if (wrapsAll) return evaluateSwiftCondition(text.slice(1, -1), env);
  }
  if (text in env) return env[text]!;
  throw new Error(
    `condition contains an expression this evaluator cannot decide: ${JSON.stringify(text)} — ` +
      "extend the evaluator, do not loosen the assertion",
  );
}

/**
 * Every Swift source under a root, so an absence claim can be made about the app rather than about
 * whichever files were on the reviewer's mind.
 */
export function swiftSourcesUnder(root: string): Array<[path: string, source: string]> {
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".swift"))
    .map((entry) => [entry, readFileSync(join(root, entry), "utf8")] as [string, string]);
}
