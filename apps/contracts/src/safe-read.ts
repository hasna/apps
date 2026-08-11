/**
 * safe-read — the collection-read contract between a Hasna CLI and its consumer.
 *
 * WHY THIS EXISTS. On 2026-08-11 six published claims were corrected inside three
 * hours across five tools, every one a bounded or failed read reported as the
 * population. Every agent involved already held the rule; several had written parts
 * of it. A correctness property that depends on the caller remembering is the rule
 * that was already broken, so this is the mechanical form.
 *
 * THE DESIGN PRINCIPLE, and everything below follows from it:
 *
 *     COMPLETENESS MUST BE PROVEN. IT IS NEVER INFERRED FROM THE ABSENCE OF A FLAG.
 *
 * The quietest failure in this family is a first page that is complete, well-formed,
 * rc=0 and parses, with no artefact of failure anywhere in the output. Nothing in
 * such a payload can be inspected to reveal it. A checker that looks for a
 * truncation marker and finds none has learned nothing, because several Hasna
 * collection verbs cap with no marker at all — measured: `repos repos --json`
 * returns 50 rows at rc=0 with a clean body, and the notice "showing 50 of 1793"
 * appears only on stderr.
 *
 * So this module enumerates the PROOFS OF COMPLETENESS (see CompletenessProof) and
 * refuses any read that carries none of them. Absence of evidence is a refusal, not
 * a pass.
 *
 * This module is PURE: it classifies bytes you already captured and spawns nothing.
 * The executor that runs the command, pages it, and cross-checks it lives in
 * ./safe-read-exec, so that importing the contract never pulls in a subprocess
 * surface.
 */

/** Reason a read was refused. One tag per distinct mechanism, so callers can branch. */
export type RefusalCode =
  // --- mechanism 2: FAILED-AS-EMPTY -------------------------------------------
  | "nonzero_exit"
  | "unparseable_stdout"
  | "error_object"
  | "store_unavailable"
  | "rows_key_missing"
  // --- mechanism 1: CUT SHORT ---------------------------------------------------
  | "unfollowed_cursor"
  | "declared_total_mismatch"
  | "stderr_truncation_notice"
  // --- mechanism 3: UNPAGINATED -------------------------------------------------
  | "completeness_unproven"
  | "page_cap_reached"
  | "hidden_clamp_suspected"
  | "population_moved"
  // --- mechanism 4: PREDICATE IGNORED -------------------------------------------
  | "predicate_ignored"
  | "predicate_inert"
  // --- mechanism 5: DEFAULTED SCOPE ---------------------------------------------
  | "scope_defaulted";

/**
 * The accepted proofs that a read covered its whole population.
 *
 * A verdict of `complete` must name at least one of these. They are listed in
 * descending order of strength; `assumed_complete` is a caller waiver and is
 * recorded in the evidence so it can never be silent.
 */
export type CompletenessProof =
  /** rowCount equals a total the surface declared itself (e.g. knowledge `total`). */
  | "declared_total_satisfied"
  /** Paged until the surface said there was no next page. */
  | "cursor_exhausted"
  /** rowCount equals an aggregate read from a sibling verb the caller named. */
  | "sibling_aggregate_agrees"
  /**
   * Re-read at a strictly larger bound returned fewer rows than that bound AND
   * fewer than any clamp that bound might have been silently replaced by.
   *
   * THIS IS THE WEAKEST PROOF AND IT IS UNSOUND AGAINST AN UNKNOWN HIDDEN CLAMP.
   * Measured (knowledge k_mso1r678_fhgm1o, 2026-08-11): `conversations read`
   * silently returns 500 for any request above 500, so `count < requestedBound`
   * says nothing when the surface never honoured the bound. Two-step widening does
   * not rescue it either — a true population of 300 and a hidden clamp of 500 both
   * yield equal counts below both bounds, so the two cases are indistinguishable by
   * widening at any number of steps. The executor therefore refuses whenever the
   * widened count lands on a known or suspected clamp, and only accepts this proof
   * strictly below it.
   */
  | "stable_under_widening"
  /** The caller explicitly waived proof. Always recorded, never inferred. */
  | "assumed_complete";

export interface CapturedRead {
  /** Bytes the command wrote to stdout. Captured to a file, never through a pipe. */
  stdout: string;
  /** Bytes the command wrote to stderr. Truncation notices hide here. */
  stderr: string;
  /** The command's own exit status — never a pipeline's last stage. */
  code: number;
}

export interface ClassifyOptions {
  /** Key holding the row array. Auto-detected when omitted. */
  rowsKey?: string | undefined;
  /** Key holding a self-declared population size. Auto-detected when omitted. */
  totalKey?: string | undefined;
  /** An empty result is a legitimate answer rather than a suspicious one. */
  allowEmpty?: boolean | undefined;
  /** The row bound that produced this read, if one was passed. */
  limit?: number | undefined;
}

export interface ReadVerdict {
  ok: boolean;
  /** Present only when ok. */
  proofs: CompletenessProof[];
  /** Present only when !ok. */
  code?: RefusalCode | undefined;
  /** One-line human explanation. Always present. */
  reason: string;
  /** Rows, only when ok. Never a degraded [] standing in for a failure. */
  rows: unknown[];
  rowCount: number;
  /** The population the surface declared, when it declared one. */
  declaredTotal?: number | undefined;
  /** Opaque cursor for the next page, when the surface offered one. */
  nextCursor?: string | null | undefined;
  hasMore?: boolean | undefined;
  /** Everything the classifier observed, for pasting into a record. */
  evidence: string[];
}

const ROWS_KEY_CANDIDATES = [
  "rows",
  "entries",
  "items",
  "results",
  "records",
  "tasks",
  "messages",
  "data"
] as const;

/**
 * Keys that mean "the size of the whole population".
 *
 * `count` is DELIBERATELY ABSENT. Measured on `todos show --json`, `comments_page.count`
 * is the size of the page in hand, not of the population, so auto-detecting it would
 * manufacture `declared_total_satisfied` on exactly the reads that are truncated.
 */
const TOTAL_KEY_CANDIDATES = ["total", "total_count", "totalCount", "totalItems"] as const;

/**
 * Truncation notices that Hasna CLIs write to STDERR while exiting 0.
 *
 * Anchors are deliberately avoided. In JavaScript and Python `m` makes `^`/`$` match
 * per line and `s` makes `.` match a newline; in jq `m` IS dotall and there is no
 * per-line anchor flag at all. A pattern that leans on anchors therefore changes
 * meaning when it is carried between those engines, silently and in the direction of
 * a false negative. These patterns match substrings and need no anchor.
 */
const STDERR_TRUNCATION_PATTERNS: Array<{ re: RegExp; note: string }> = [
  { re: /showing\s+(\d+)\s+of\s+(\d+)/i, note: "surface reported a bounded read" },
  { re: /\btruncated\b/i, note: "surface used the word truncated" },
  { re: /to see the rest/i, note: "surface offered a route to the remainder" },
  { re: /page with --cursor/i, note: "surface offered a cursor" }
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Locate the row array without ever letting a miss become an empty list. */
export function locateRows(
  parsed: unknown,
  rowsKey?: string
): { ok: true; rows: unknown[]; key: string } | { ok: false; error: string } {
  if (Array.isArray(parsed)) {
    return { ok: true, rows: parsed, key: "<top-level array>" };
  }
  if (!isPlainObject(parsed)) {
    return { ok: false, error: `payload is ${parsed === null ? "null" : typeof parsed}, not a list or an envelope` };
  }
  if (rowsKey) {
    const explicit = parsed[rowsKey];
    if (!Array.isArray(explicit)) {
      return {
        ok: false,
        error: `--rows-key '${rowsKey}' is ${explicit === undefined ? "absent" : `a ${typeof explicit}`}, not an array`
      };
    }
    return { ok: true, rows: explicit, key: rowsKey };
  }
  for (const candidate of ROWS_KEY_CANDIDATES) {
    if (Array.isArray(parsed[candidate])) {
      return { ok: true, rows: parsed[candidate] as unknown[], key: candidate };
    }
  }
  const arrayKeys = Object.keys(parsed).filter((k) => Array.isArray(parsed[k]));
  if (arrayKeys.length === 1) {
    return { ok: true, rows: parsed[arrayKeys[0]!] as unknown[], key: arrayKeys[0]! };
  }
  return {
    ok: false,
    error:
      arrayKeys.length === 0
        ? `no array-valued key in envelope {${Object.keys(parsed).join(",")}}`
        : `ambiguous rows key: ${arrayKeys.join(", ")} — pass --rows-key`
  };
}

/** Read a dotted path such as `by_scope.global` out of a parsed payload. */
export function readDottedPath(parsed: unknown, path: string): number | undefined {
  let cursor: unknown = parsed;
  for (const segment of path.split(".")) {
    if (!isPlainObject(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return typeof cursor === "number" ? cursor : undefined;
}

/**
 * Classify one captured read.
 *
 * Returns `ok: false` with a RefusalCode whenever completeness cannot be
 * established from this payload ALONE. That includes the ordinary, healthy-looking
 * case of a bare array with no envelope: this function does not know whether such a
 * read is complete, and says so rather than guessing. The executor answers that
 * question by widening or by a sibling aggregate; see ./safe-read-exec.
 */
export function classifyRead(captured: CapturedRead, options: ClassifyOptions = {}): ReadVerdict {
  const evidence: string[] = [];
  const refuse = (code: RefusalCode, reason: string): ReadVerdict => ({
    ok: false,
    code,
    reason,
    proofs: [],
    rows: [],
    rowCount: 0,
    evidence
  });

  evidence.push(`exit=${captured.code}`);
  evidence.push(`stdout=${captured.stdout.length}B stderr=${captured.stderr.length}B`);

  // --- mechanism 2: FAILED-AS-EMPTY -----------------------------------------
  // rc is checked before the body is even parsed. A CLI that writes
  // {"ok":false,...} to stdout at rc=1 is the exact shape that ran the fleet
  // knowledge monitor blind for ~11.6h: a reader degraded the dict to [] and a
  // guard skipped the branch.
  if (captured.code !== 0) {
    return refuse(
      "nonzero_exit",
      `the command exited ${captured.code}. A failed read is not an empty set. stderr: ${
        captured.stderr.trim().slice(0, 300) || "(empty)"
      }`
    );
  }

  if (captured.stdout.trim() === "") {
    return refuse("unparseable_stdout", "stdout was empty; there is no payload to judge");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(captured.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return refuse(
      "unparseable_stdout",
      `stdout is not JSON (${message}). A parse failure is a refusal, never an empty list.`
    );
  }

  if (isPlainObject(parsed)) {
    if (parsed.ok === false) {
      const err = typeof parsed.error === "string" ? parsed.error : JSON.stringify(parsed).slice(0, 200);
      return refuse("error_object", `the surface returned an error object at exit 0: ${err}`);
    }
    if (typeof parsed.error === "string" && parsed.error.length > 0) {
      return refuse("error_object", `the surface returned an error object at exit 0: ${parsed.error}`);
    }
    if (parsed.store_exists === false) {
      return refuse(
        "store_unavailable",
        "the surface reported store_exists=false; zero rows here means the store was unreachable, not empty"
      );
    }
  }

  const located = locateRows(parsed, options.rowsKey);
  if (!located.ok) {
    return refuse(
      "rows_key_missing",
      `${located.error}. Refusing rather than reporting zero rows: a reader that cannot find the rows has measured nothing.`
    );
  }
  const rows = located.rows;
  const rowCount = rows.length;
  evidence.push(`rows=${rowCount} under ${located.key}`);

  // --- mechanism 1: CUT SHORT -------------------------------------------------
  // stderr first, because it is the stream a caller who redirected only stdout
  // never sees, and it carries the most explicit notice the fleet emits.
  for (const { re, note } of STDERR_TRUNCATION_PATTERNS) {
    const hit = re.exec(captured.stderr);
    if (hit) {
      return refuse(
        "stderr_truncation_notice",
        `stderr carries a truncation notice (${note}): "${hit[0]}". The body parsed cleanly at exit 0; only stderr says the read was bounded.`
      );
    }
  }

  let declaredTotal: number | undefined;
  let hasMore: boolean | undefined;
  let nextCursor: string | null | undefined;

  if (isPlainObject(parsed)) {
    const totalKeys = options.totalKey ? [options.totalKey] : TOTAL_KEY_CANDIDATES;
    for (const key of totalKeys) {
      if (!Object.prototype.hasOwnProperty.call(parsed, key)) continue;
      const value = parsed[key];
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        return {
          ...refuse(
            "declared_total_mismatch",
            `declared ${key} must be a non-negative safe integer, got ${JSON.stringify(value)}`
          ),
          rowCount
        };
      }
      declaredTotal = value;
      evidence.push(`declared ${key}=${value}`);
      break;
    }
    if (typeof parsed.has_more === "boolean") hasMore = parsed.has_more;
    else if (typeof parsed.hasMore === "boolean") hasMore = parsed.hasMore;
    const cursor = parsed.next_cursor ?? parsed.nextCursor;
    if (typeof cursor === "string" || cursor === null) nextCursor = cursor as string | null;
  }

  const usableCursor = typeof nextCursor === "string" && nextCursor.trim().length > 0;
  if (hasMore === true || usableCursor) {
    // This refusal MUST carry the cursor. It is the one refusal a caller can act on
    // automatically, and an executor that cannot see next_cursor here silently
    // stops after page one — measured: the paging fixture accumulated 2 rows of 5
    // because an earlier version of this branch dropped the field.
    return {
      ...refuse(
        "unfollowed_cursor",
        `the surface indicates another page (has_more=${String(hasMore)}, cursor ${usableCursor ? nextCursor : "unset"}). ` +
          `You are holding a page and about to call it a population.`
      ),
      rowCount,
      declaredTotal,
      nextCursor,
      hasMore
    };
  }

  if (declaredTotal !== undefined && rowCount !== declaredTotal) {
    return refuse(
      "declared_total_mismatch",
      `holding ${rowCount} row(s) against a declared total of ${declaredTotal}. ` +
        `The surface's count and payload disagree, so completeness is not established.`
    );
  }

  // --- proofs ------------------------------------------------------------------
  const proofs: CompletenessProof[] = [];
  if (declaredTotal !== undefined && rowCount === declaredTotal) {
    proofs.push("declared_total_satisfied");
    evidence.push(`rowCount ${rowCount} equals declared total ${declaredTotal}`);
  }
  if (hasMore === false || nextCursor === null) {
    proofs.push("cursor_exhausted");
    evidence.push(`surface declared no next page (has_more=${hasMore}, next_cursor=${String(nextCursor)})`);
  }

  if (proofs.length === 0) {
    // The quiet case. Nothing in this payload is wrong; nothing in it proves
    // completeness either. Whether the read is whole is a question this payload
    // cannot answer, and the honest verdict is that it is unproven.
    const cap =
      options.limit !== undefined && rowCount === options.limit
        ? ` rowCount equals the requested limit ${options.limit}, which is what a silent cap looks like.`
        : "";
    return {
      ok: false,
      code: rowCount === options.limit ? "page_cap_reached" : "completeness_unproven",
      reason:
        `the payload carries no total, no cursor and no truncation notice, so nothing in it proves the read is whole.${cap} ` +
        `Establish completeness by widening the bound, or by a sibling aggregate.`,
      proofs: [],
      rows: [],
      rowCount,
      declaredTotal,
      nextCursor,
      hasMore,
      evidence
    };
  }

  if (rowCount === 0 && !options.allowEmpty) {
    evidence.push("empty result accepted only because a proof of completeness was present");
  }

  return { ok: true, proofs, reason: `read proven complete by ${proofs.join(" + ")}`, rows, rowCount, declaredTotal, nextCursor, hasMore, evidence };
}
