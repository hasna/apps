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
export type RefusalCode = "nonzero_exit" | "unparseable_stdout" | "error_object" | "store_unavailable" | "rows_key_missing" | "unfollowed_cursor" | "declared_total_mismatch" | "stderr_truncation_notice" | "completeness_unproven" | "page_cap_reached" | "hidden_clamp_suspected" | "population_moved" | "predicate_ignored" | "predicate_inert" | "scope_defaulted";
/**
 * The accepted proofs that a read covered its whole population.
 *
 * A verdict of `complete` must name at least one of these. They are listed in
 * descending order of strength; `assumed_complete` is a caller waiver and is
 * recorded in the evidence so it can never be silent.
 */
export type CompletenessProof = 
/** rowCount equals a total the surface declared itself (e.g. knowledge `total`). */
"declared_total_satisfied"
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
    nextCursor?: string | number | null | undefined;
    hasMore?: boolean | undefined;
    /** Everything the classifier observed, for pasting into a record. */
    evidence: string[];
}
/** A cursor is opaque; only argv-safe scalar shape matters. */
export declare function isUsableCursor(value: unknown): value is string | number;
/** Locate the row array without ever letting a miss become an empty list. */
export declare function locateRows(parsed: unknown, rowsKey?: string): {
    ok: true;
    rows: unknown[];
    key: string;
} | {
    ok: false;
    error: string;
};
/** Read a dotted path such as `by_scope.global` out of a parsed payload. */
export declare function readDottedPath(parsed: unknown, path: string): number | undefined;
/**
 * Classify one captured read.
 *
 * Returns `ok: false` with a RefusalCode whenever completeness cannot be
 * established from this payload ALONE. That includes the ordinary, healthy-looking
 * case of a bare array with no envelope: this function does not know whether such a
 * read is complete, and says so rather than guessing. The executor answers that
 * question by widening or by a sibling aggregate; see ./safe-read-exec.
 */
export declare function classifyRead(captured: CapturedRead, options?: ClassifyOptions): ReadVerdict;
