/**
 * safe-read-exec — run a Hasna collection read and either prove it complete or refuse.
 *
 * The pure contract lives in ./safe-read. This module is the half that can actually
 * establish completeness, because establishing it requires a SECOND OBSERVATION:
 * another page, a wider bound, or a sibling aggregate. No inspection of a single
 * payload can do it, which is why a checker that only reads captured bytes passes
 * the quietest member of this family.
 *
 * TWO PROPERTIES OF THE CAPTURE PATH, both deliberate:
 *
 *  - The command is spawned from an ARGV ARRAY and never through a shell. That is
 *    not a style preference: composing a command into a shell string is how prose
 *    and identifiers get eaten by backticks and unbalanced quotes, and a helper
 *    that reintroduced it would be shipping one defect inside the fix for another.
 *  - stdout and stderr are captured SEPARATELY and the exit status is read from the
 *    process itself. Never a pipe, never 2>&1. A pipe takes its status from the last
 *    stage and can cut a large payload at one buffer; merging the streams corrupts
 *    the JSON with whatever diagnostics the tool emitted.
 *
 * WIDENING IS THE DEFAULT, NOT A FLAG. The lesson that shaped this API: a corrected
 * count went 1 -> 3 by widening the same read and was STILL WRONG, then 3 -> 15 by
 * changing shape. Widening agrees with itself until it happens to exceed the
 * population, so the widened read is only accepted when it returns FEWER rows than
 * its own bound — the one condition under which a bound cannot be what limited it.
 */
import { type CapturedRead, type CompletenessProof, type ReadVerdict, type RefusalCode } from "./safe-read";
/**
 * Server-side caps that a surface applies SILENTLY, replacing the bound you asked
 * for without saying so. Keyed by "<binary> <subcommand...>".
 *
 * Source: knowledge k_mso1r678_fhgm1o, "Conversations Readbounds Census Matrix",
 * measured 2026-08-11 against @hasna/conversations 0.5.43 and the hosted service.
 * Evidence grade is carried per row exactly as that census carries it, because a
 * source-read bound and an exercised bound are different claims and merging them is
 * how a table starts asserting more than anyone measured:
 *   M   = live behaviour exercised
 *   S/U = established from installed client or bundled server source; live
 *         behaviour not safely measurable
 *
 * This table is an OPTIMISATION, not the safety property. An absent entry falls back
 * to the round-number heuristic below, which is deliberately conservative.
 */
export declare const KNOWN_CLAMPS: Record<string, {
    cap: number;
    grade: "M" | "S/U";
    note: string;
}>;
/**
 * Flags that widen a surface's SCOPE, as opposed to its row bound.
 *
 * MECHANISM 5, AND IT IS UNLIKE THE OTHERS. The read is complete, the predicate is
 * correct, pagination is followed, and the declared total is honest — only the scope
 * is defaulted, and nothing in the output is wrong. Measured 2026-08-11:
 *
 *   knowledge list --limit 1 --json                      total=1526
 *   knowledge list --limit 1 --include-archived --json   total=1567   (41 invisible)
 *   todos list --json --limit 9000                       7301, converged, a SUBSET
 *   todos list --all --json --limit 40000                40000
 *
 * THE ENVELOPE'S `total` IS SCOPE-RELATIVE, so reconciling rows against it CONFIRMS
 * a defaulted scope with a clean three-way agreement (1526 collected, 1526 distinct
 * ids, 1526 declared — and 41 short). Total-reconciliation, which is otherwise this
 * module's strongest proof, is structurally blind here.
 *
 * This census is deliberately TINY and is not an attempt to discover every scope
 * flag on every CLI. That is a per-surface fact, it rots, and guessing it is worse
 * than declaring the limitation. Naming the scope beside the number is the defence.
 */
export declare const SCOPE_WIDENERS: Record<string, {
    flag: string;
    grade: "M" | "S/U";
    note: string;
}>;
/** Longest matching "<binary> <subcommand...>" prefix of the argv. */
export declare function lookupScopeWidener(argv: string[]): {
    key: string;
    flag: string;
    grade: "M" | "S/U";
    note: string;
} | null;
/** Longest matching "<binary> <subcommand...>" prefix of the argv. */
export declare function lookupClamp(argv: string[]): {
    key: string;
    cap: number;
    grade: "M" | "S/U";
    note: string;
} | null;
export interface SafeReadRequest {
    /** argv of the command under test. argv[0] is the binary. */
    argv: string[];
    rowsKey?: string | undefined;
    totalKey?: string | undefined;
    allowEmpty?: boolean | undefined;
    /** Flag used to bound rows, e.g. "--limit". */
    limitFlag?: string | undefined;
    /** Bound passed on the first read. Required for the widening proof. */
    limit?: number | undefined;
    /** Bound used for the widening probe. Defaults to limit * 4. */
    widenTo?: number | undefined;
    /**
     * The server-side cap this surface really imposes, when the caller has
     * established it. Overrides the census and disables the round-number heuristic.
     */
    knownClamp?: number | undefined;
    /** Flag used to page, e.g. "--cursor". */
    cursorFlag?: string | undefined;
    maxPages?: number | undefined;
    /** argv of a sibling verb carrying an aggregate, e.g. ["mementos","stats","--json"]. */
    siblingArgv?: string[] | undefined;
    /** Dotted path to the aggregate in the sibling payload, e.g. "by_scope.global". */
    siblingPath?: string | undefined;
    /** Tokens appended to argv forming a query that MUST match nothing. */
    probeNegativeArgs?: string[] | undefined;
    /** Tokens appended to argv forming a query that MUST match something. */
    probePositiveArgs?: string[] | undefined;
    /** Waive proof explicitly. Recorded in evidence; never silent. */
    assumeComplete?: boolean | undefined;
    /**
     * Acknowledge that the narrower default scope is the one you want, and say why.
     * Turns a silent default into a recorded choice; it does not widen anything.
     */
    scopeAck?: string | undefined;
    /** Injectable for tests. */
    run?: ((argv: string[]) => CapturedRead) | undefined;
}
export interface SafeReadResult {
    ok: boolean;
    code?: RefusalCode | "capture_overflow" | "spawn_failed" | undefined;
    reason: string;
    proofs: CompletenessProof[];
    rows: unknown[];
    rowCount: number;
    pages: number;
    /**
     * The scope the count was taken under. A NUMBER WITHOUT ITS SCOPE IS NOT A
     * POPULATION: `1526 (default)` and `1567 (--include-archived)` are different
     * facts and neither is "the population" on its own.
     */
    scope: string;
    evidence: string[];
}
/** Spawn with both streams captured to separate files, with no shell. */
export declare function runCaptured(argv: string[]): CapturedRead;
/**
 * Read a collection and prove it whole, or refuse.
 *
 * The order below is the order in which the four mechanisms can be ruled out
 * cheaply, and each step is skipped only when an earlier one already produced a
 * proof — so the expensive checks cost nothing on surfaces that declare a total.
 */
export declare function safeRead(request: SafeReadRequest): SafeReadResult;
export type { ReadVerdict };
