/**
 * Closed-vocabulary (enum) value validation for CLI flags and API query params.
 *
 * Why this module exists
 * ----------------------
 * An unrecognised enum value used to flow straight into the storage filter, where
 * it matched no rows. The command then printed "No tasks found." and exited 0 — a
 * silent empty result set that reads as "there is no work here". `todos list
 * --status open` (`open` is not in the vocabulary) reported zero tasks on a project
 * that had 27, and that empty set was relayed to a human as fact.
 *
 * The rule this module enforces: an out-of-vocabulary value is an ERROR, never an
 * empty result. Callers surface it non-zero (CLI) or as HTTP 400 (API).
 *
 * The vocabulary is ALWAYS supplied by the caller from the single exported source
 * of truth (`TASK_STATUSES`, `TASK_PRIORITIES`, `PLAN_STATUSES`, `DISPATCH_STATUSES`
 * in src/types/index.ts, or a subsystem's own exported constant). Nothing in this
 * file re-types a vocabulary, so a value added to a constant is accepted here with
 * no further edit.
 */

/** Levenshtein edit distance, used only to offer a "did you mean" hint. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length]!;
}

/**
 * Vocabulary members plausibly meant by `value`, nearest first.
 *
 * Deliberately conservative: a substring/prefix relation, or an edit distance
 * within a third of the word's length. A wrong suggestion is worse than none,
 * because the error already lists every valid value.
 */
export function suggestVocabularyMatches(
  value: string,
  vocabulary: readonly string[],
  limit = 3,
): string[] {
  const needle = value.trim().toLowerCase();
  if (!needle) return [];
  const scored: Array<{ member: string; score: number }> = [];
  for (const member of vocabulary) {
    const candidate = member.toLowerCase();
    if (candidate.startsWith(needle) || needle.startsWith(candidate)) {
      scored.push({ member, score: 0 });
      continue;
    }
    if (candidate.includes(needle) || needle.includes(candidate)) {
      scored.push({ member, score: 1 });
      continue;
    }
    const distance = editDistance(needle, candidate);
    if (distance <= Math.max(1, Math.floor(candidate.length / 3))) {
      scored.push({ member, score: 1 + distance });
    }
  }
  return scored
    .sort((a, b) => a.score - b.score || a.member.localeCompare(b.member))
    .slice(0, limit)
    .map((entry) => entry.member);
}

export interface EnumVocabularySpec<T extends string> {
  /** Flag or query-param name as the user typed it, e.g. "--status" or "status". */
  readonly name: string;
  /** The single source of truth for this vocabulary. Never re-typed locally. */
  readonly vocabulary: readonly T[];
  /**
   * Canonicalizer applied per element before the membership check — this is where
   * documented aliases (`done` -> `completed`) and case folding live. Must be a
   * pure string mapping; a value it does not recognise is returned unchanged so it
   * still fails the membership check rather than being silently rewritten.
   */
  readonly normalize?: (value: string) => string;
  /**
   * Remediation text for inputs that are NOT vocabulary members but that operators
   * plausibly type, keyed by the normalized input. These are not accepted values —
   * they only make the rejection actionable (e.g. `all` -> point at `--all`).
   */
  readonly hints?: Readonly<Record<string, string>>;
  /** Whether a comma-separated list is accepted. Defaults to true. */
  readonly allowList?: boolean;
}

export type EnumVocabularyResult<T extends string> =
  | { readonly ok: true; readonly values: T[] }
  | { readonly ok: false; readonly message: string; readonly invalid: string[] };

/**
 * Split, canonicalize and validate a raw flag/query value against its vocabulary.
 *
 * Every element of a comma-separated list is validated: a single bad element fails
 * the whole value rather than being dropped, because dropping it produced a result
 * set that looked authoritative but silently ignored part of what was asked for.
 */
export function resolveEnumVocabulary<T extends string>(
  raw: string,
  spec: EnumVocabularySpec<T>,
): EnumVocabularyResult<T> {
  const allowList = spec.allowList !== false;
  const rawElements = (allowList ? raw.split(",") : [raw]).map((element) => element.trim());

  // Nothing but separators and whitespace: the caller supplied no value at all.
  if (rawElements.every((element) => element.length === 0)) {
    return {
      ok: false,
      message: `${spec.name} requires a value. Allowed values: ${spec.vocabulary.join(", ")}.`,
      invalid: [],
    };
  }

  // A BLANK element used to be dropped here, so `pending,` and `high,,critical`
  // were accepted as though the operator had typed a clean list. That is the
  // silent acceptance this module exists to remove, and it contradicted the rule
  // stated above — one bad element fails the whole value rather than being
  // dropped. An empty element IS a bad element: it is almost always a stray comma
  // or a shell expanding `--status "$A,$B"` with one variable unset, and in both
  // cases the operator asked for something the filter did not deliver.
  //
  // Surrounding whitespace on a NON-empty element stays tolerated (` pending , x`),
  // because that is a shape operators legitimately type and trimming already
  // handled it.
  if (rawElements.some((element) => element.length === 0)) {
    return {
      ok: false,
      message:
        `${spec.name} has an empty value in "${raw}" — remove the stray comma. ` +
        `Allowed values: ${spec.vocabulary.join(", ")}.`,
      invalid: [],
    };
  }

  const normalized = rawElements.map((element) => spec.normalize ? spec.normalize(element) : element);
  const allowed = new Set<string>(spec.vocabulary);
  const invalid: string[] = [];
  for (let i = 0; i < normalized.length; i += 1) {
    if (!allowed.has(normalized[i]!)) invalid.push(rawElements[i]!);
  }

  if (invalid.length === 0) {
    // De-duplicate while preserving the order the caller asked for.
    return { ok: true, values: [...new Set(normalized)] as T[] };
  }

  const label = invalid.length === 1 ? "value" : "values";
  const parts = [
    `Invalid ${spec.name} ${label}: ${invalid.join(", ")}.`,
    `Allowed values: ${spec.vocabulary.join(", ")}.`,
  ];
  const hints = new Set<string>();
  const suggestions = new Set<string>();
  for (let i = 0; i < normalized.length; i += 1) {
    const canonical = normalized[i]!;
    if (allowed.has(canonical)) continue;
    const hint = spec.hints?.[canonical.toLowerCase()];
    if (hint) {
      hints.add(hint);
      continue;
    }
    for (const match of suggestVocabularyMatches(canonical, spec.vocabulary)) {
      suggestions.add(match);
    }
  }
  if (suggestions.size > 0) parts.push(`Did you mean ${[...suggestions].join(", ")}?`);
  for (const hint of hints) parts.push(hint);

  return { ok: false, message: parts.join(" "), invalid };
}

/**
 * Collapse a validated list back to the shape the storage filter expects: a bare
 * string for a single value, an array for a real list. Keeps the emitted SQL/query
 * identical to what single-value callers produced before validation was added.
 */
export function collapseEnumValues<T extends string>(values: T[]): T | T[] {
  return values.length === 1 ? values[0]! : values;
}
