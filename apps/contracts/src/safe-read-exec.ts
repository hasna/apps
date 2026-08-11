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

import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  classifyRead,
  locateRows,
  readDottedPath,
  type CapturedRead,
  type CompletenessProof,
  type ReadVerdict,
  type RefusalCode
} from "./safe-read";

/** A runaway cursor loop is a hang; bound it and refuse rather than spin. */
const DEFAULT_MAX_PAGES = 200;

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
export const KNOWN_CLAMPS: Record<string, { cap: number; grade: "M" | "S/U"; note: string }> = {
  "conversations read": { cap: 500, grade: "M", note: "requests above 500 silently return 500" },
  "conversations channel read": { cap: 500, grade: "M", note: "same path as read; the clamp is hidden above 500" },
  "conversations search": { cap: 500, grade: "M", note: "server max 500 plus a 48 KiB compact-JSON budget" },
  "conversations since": { cap: 500, grade: "S/U", note: "requests above 500 can hide the clamp" },
  "conversations pinned": { cap: 500, grade: "S/U", note: "bare JSON carries no truncation metadata" },
  "conversations notifications": { cap: 500, grade: "S/U", note: "neither surface signals the server clamp" },
  "conversations agents list": {
    cap: 500,
    grade: "M",
    note: "server hard-caps 500 newest by last_seen_at and IGNORES the client limit entirely"
  },
  "conversations blockers": { cap: 500, grade: "S/U", note: "JSON ignores --limit; the flag moves only the human surface" },
  "conversations project list": { cap: 1000, grade: "M", note: "exactly 1000 cannot prove more; the probe is itself clamped" },
  "knowledge list": { cap: 200, grade: "M", note: "--limit above 200 is REJECTED at rc=1 rather than clamped" }
};

/**
 * Counts that are far more likely to be a cap than a population.
 *
 * Used only when the surface is absent from KNOWN_CLAMPS. Landing exactly on one of
 * these after widening is refused rather than accepted: the cost of a false refusal
 * is one extra flag from the caller, and the cost of a false pass is a page
 * published as a population.
 */
const SUSPICIOUS_COUNTS = new Set([10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]);

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
export const SCOPE_WIDENERS: Record<string, { flag: string; grade: "M" | "S/U"; note: string }> = {
  "knowledge list": { flag: "--include-archived", grade: "M", note: "default hides archived items (1526 vs 1567)" },
  "todos list": { flag: "--all", grade: "M", note: "default is a subset; --all never reveals its own population" }
};

/** Longest matching "<binary> <subcommand...>" prefix of the argv. */
export function lookupScopeWidener(argv: string[]): { key: string; flag: string; grade: "M" | "S/U"; note: string } | null {
  const words = argv.filter((token) => !token.startsWith("-"));
  for (let take = Math.min(words.length, 4); take >= 1; take -= 1) {
    const key = words.slice(0, take).join(" ");
    const hit = SCOPE_WIDENERS[key];
    if (hit) return { key, ...hit };
  }
  return null;
}

/** Longest matching "<binary> <subcommand...>" prefix of the argv. */
export function lookupClamp(argv: string[]): { key: string; cap: number; grade: "M" | "S/U"; note: string } | null {
  const words = argv.filter((token) => !token.startsWith("-"));
  for (let take = Math.min(words.length, 4); take >= 1; take -= 1) {
    const key = words.slice(0, take).join(" ");
    const hit = KNOWN_CLAMPS[key];
    if (hit) return { key, ...hit };
  }
  return null;
}

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

/** Spawn with both streams captured to memory, separately, with no shell. */
export function runCaptured(argv: string[]): CapturedRead {
  const [bin, ...args] = argv;
  if (!bin) throw new Error("empty argv");

  // Capture to FILES via file descriptors, which is the capture-path doctrine
  // written out literally: `cmd > out 2> err`, then read the files.
  //
  // AN IN-MEMORY CAPTURE WAS TRIED FIRST AND TRUNCATED, WHICH IS WHY THIS IS NOT A
  // STYLE CHOICE. Measured on bun 1.3.14, arm64, against a 1.23 MB payload
  // (`mementos list --scope global --json --limit 2000`):
  //
  //   shell redirect to a file                    1227488 B   parses, 684 rows
  //   spawnSync(encoding:"utf8", maxBuffer:256MiB) 1079970 B   UNPARSEABLE, status 0, error undefined
  //
  // The 1079970 figure is exactly what an explicit 1 MiB maxBuffer produces, so the
  // option did not reach the call — and the ENOBUFS that a 1 MiB run does surface
  // was NOT raised, so the truncation arrived as a clean exit-0 short read. That is
  // precisely the failure this module exists to refuse, inside its own capture path.
  // File descriptors have no such ceiling.
  const dir = mkdtempSync(join(tmpdir(), "hasna-safe-read-"));
  const outPath = join(dir, "stdout.bin");
  const errPath = join(dir, "stderr.bin");
  let outFd: number | undefined;
  let errFd: number | undefined;
  try {
    outFd = openSync(outPath, "w");
    errFd = openSync(errPath, "w");
    const proc = spawnSync(bin, args, { shell: false, stdio: ["ignore", outFd, errFd] });
    closeSync(outFd);
    outFd = undefined;
    closeSync(errFd);
    errFd = undefined;
    if (proc.error) {
      const err = proc.error as NodeJS.ErrnoException;
      return { stdout: "", stderr: `spawn failed: ${err.message}`, code: 252 };
    }
    return {
      stdout: readFileSync(outPath, "utf8"),
      stderr: readFileSync(errPath, "utf8"),
      code: proc.status ?? 253
    };
  } finally {
    if (outFd !== undefined) closeSync(outFd);
    if (errFd !== undefined) closeSync(errFd);
    rmSync(dir, { recursive: true, force: true });
  }
}

function withFlag(argv: string[], flag: string | undefined, value: string | number): string[] {
  if (!flag) return argv;
  const out = [...argv];
  const at = out.indexOf(flag);
  if (at >= 0 && at + 1 < out.length) {
    out[at + 1] = String(value);
    return out;
  }
  out.push(flag, String(value));
  return out;
}

/**
 * Read a collection and prove it whole, or refuse.
 *
 * The order below is the order in which the four mechanisms can be ruled out
 * cheaply, and each step is skipped only when an earlier one already produced a
 * proof — so the expensive checks cost nothing on surfaces that declare a total.
 */
export function safeRead(request: SafeReadRequest): SafeReadResult {
  const widener = lookupScopeWidener(request.argv);
  const scopeLabel =
    widener && request.argv.includes(widener.flag)
      ? widener.flag
      : request.scopeAck
        ? `default (acknowledged: ${request.scopeAck})`
        : "default";
  const result = safeReadInner(request);
  // Stamp the scope onto every outcome, so no count leaves this module naked.
  return {
    ...result,
    scope: result.scope && result.scope !== "default" ? result.scope : scopeLabel,
    reason: result.ok ? `${result.reason} [scope: ${scopeLabel}]` : result.reason
  };
}

function safeReadInner(request: SafeReadRequest): SafeReadResult {
  const run = request.run ?? runCaptured;
  const evidence: string[] = [];
  const maxPages = request.maxPages ?? DEFAULT_MAX_PAGES;

  evidence.push(`argv: ${request.argv.join(" ")}`);

  // --- mechanism 5: DEFAULTED SCOPE ---------------------------------------------
  // Checked first and cheaply. Every later proof is scope-relative, so a number
  // established under a defaulted scope is a correct count of the wrong set.
  const widener = lookupScopeWidener(request.argv);
  const scope = widener && request.argv.includes(widener.flag) ? widener.flag : "default";
  if (widener && scope === "default" && !request.scopeAck) {
    return {
      ...fail(
        "scope_defaulted",
        `${widener.key} defaults to a NARROWER SCOPE than its full population (${widener.note}, evidence ${widener.grade}). ` +
          `The read may be complete, the predicate correct and the declared total honest, and the number still be a subset — ` +
          `a declared total is scope-relative, so reconciling against it CONFIRMS this rather than catching it. ` +
          `Pass ${widener.flag} for the wider scope, or --scope-ack to record the narrower one as a deliberate choice.`,
        evidence,
        0
      ),
      scope
    };
  }
  if (widener) evidence.push(`scope: ${scope} (widener ${widener.flag} available, grade ${widener.grade})`);
  else evidence.push(`scope: ${request.scopeAck ?? "unqualified"} (no scope widener in census for this surface)`);

  // --- mechanism 4: PREDICATE IGNORED ------------------------------------------
  // Run first. If the surface is not honouring the predicate, every count below is
  // a count of the wrong population and no amount of paging repairs it.
  if (request.probeNegativeArgs?.length || request.probePositiveArgs?.length) {
    const probe = probePredicate(request, run, evidence);
    if (probe) return probe;
  }

  let argv = request.argv;
  if (request.limit !== undefined) argv = withFlag(argv, request.limitFlag ?? "--limit", request.limit);
  // Record the argv ACTUALLY RUN, not the one requested. An evidence line that
  // prints the base argv while a bound was appended sends the next reader to
  // reproduce a different command than the one that produced the verdict.
  if (argv.join(" ") !== request.argv.join(" ")) evidence.push(`ran: ${argv.join(" ")}`);

  let captured = run(argv);
  let verdict = classifyRead(captured, {
    rowsKey: request.rowsKey,
    totalKey: request.totalKey,
    allowEmpty: request.allowEmpty,
    limit: request.limit
  });
  evidence.push(...verdict.evidence);
  let pages = 1;

  // --- mechanism 1 -> 3: follow the cursor to exhaustion ------------------------
  if (!verdict.ok && verdict.code === "unfollowed_cursor" && request.cursorFlag) {
    const accumulated: unknown[] = [];
    let cursor = verdict.nextCursor;
    if (typeof cursor !== "string" || cursor.trim().length === 0) {
      return fail(
        "unfollowed_cursor",
        "the surface indicates another page but supplied no usable cursor; refusing rather than treating the first page as exhausted",
        evidence,
        pages
      );
    }
    // Re-locate rows from the first page: classifyRead withholds rows on refusal,
    // deliberately, so a caller can never use a partial result by accident.
    const first = locateRows(safeParse(captured.stdout), request.rowsKey);
    if (first.ok) accumulated.push(...first.rows);

    while (cursor && pages < maxPages) {
      const paged = withFlag(argv, request.cursorFlag, cursor);
      captured = run(paged);
      pages += 1;
      verdict = classifyRead(captured, {
        rowsKey: request.rowsKey,
        totalKey: request.totalKey,
        allowEmpty: true,
        limit: request.limit
      });
      const located = locateRows(safeParse(captured.stdout), request.rowsKey);
      if (located.ok) accumulated.push(...located.rows);
      if (verdict.ok) break;
      if (verdict.code !== "unfollowed_cursor") {
        return fail(verdict.code!, `paging stopped at page ${pages}: ${verdict.reason}`, evidence, pages);
      }
      cursor = verdict.nextCursor;
      if (typeof cursor !== "string" || cursor.trim().length === 0) {
        return fail(
          "unfollowed_cursor",
          `paging stopped at page ${pages}: the surface indicates another page but supplied no usable cursor`,
          evidence,
          pages
        );
      }
    }
    if (cursor && pages >= maxPages) {
      return fail("unfollowed_cursor", `still paging after ${maxPages} pages; refusing rather than reporting a partial set`, evidence, pages);
    }
    evidence.push(`paged to exhaustion over ${pages} page(s), ${accumulated.length} row(s)`);
    return {
      ok: true,
      reason: `read proven complete by cursor_exhausted over ${pages} page(s)`,
      proofs: ["cursor_exhausted"],
      rows: accumulated,
      rowCount: accumulated.length,
      pages,
      scope: "default",
      evidence
    };
  }

  if (verdict.ok) {
    return { ok: true, reason: verdict.reason, proofs: verdict.proofs, rows: verdict.rows, rowCount: verdict.rowCount, pages, scope: "default", evidence };
  }

  // Only the "nothing proves this whole" refusals are recoverable by a second
  // observation. A nonzero exit or an error object is a fact about the read and no
  // amount of widening changes it.
  const recoverable: RefusalCode[] = ["completeness_unproven", "page_cap_reached", "declared_total_mismatch", "stderr_truncation_notice"];
  if (!recoverable.includes(verdict.code!)) {
    return fail(verdict.code!, verdict.reason, evidence, pages);
  }

  // --- proof by SIBLING AGGREGATE ----------------------------------------------
  // The aggregate is named by the caller and never guessed. Measured reason:
  // `mementos stats --json` carries `total`, and that field equals by_status.active
  // with archived sitting OUTSIDE it — so an auto-detected "total" from a sibling
  // would silently compare against the wrong population.
  if (request.siblingArgv?.length && request.siblingPath) {
    const sib = run(request.siblingArgv);
    if (sib.code !== 0) {
      evidence.push(`sibling aggregate unavailable (exit ${sib.code}); falling through`);
    } else {
      const aggregate = readDottedPath(safeParse(sib.stdout), request.siblingPath);
      if (aggregate === undefined) {
        evidence.push(`sibling path '${request.siblingPath}' absent or non-numeric; falling through`);
      } else {
        evidence.push(`sibling ${request.siblingPath}=${aggregate} vs rows=${verdict.rowCount}`);
        if (aggregate === verdict.rowCount) {
          const rows = locateRows(safeParse(captured.stdout), request.rowsKey);
          return {
            ok: true,
            reason: `read proven complete by sibling_aggregate_agrees (${request.siblingPath}=${aggregate})`,
            proofs: ["sibling_aggregate_agrees"],
            rows: rows.ok ? rows.rows : [],
            rowCount: verdict.rowCount,
            pages,
      scope: "default",
            evidence
          };
        }
        return fail(
          "declared_total_mismatch",
          `sibling aggregate ${request.siblingPath}=${aggregate} disagrees with ${verdict.rowCount} row(s) read`,
          evidence,
          pages
        );
      }
    }
  }

  // --- proof by WIDENING --------------------------------------------------------
  if (request.limitFlag !== undefined || request.limit !== undefined) {
    const flag = request.limitFlag ?? "--limit";
    const base = request.limit ?? verdict.rowCount;
    const wider = request.widenTo ?? Math.max(base * 4, base + 1);
    const widened = run(withFlag(request.argv, flag, wider));
    pages += 1;
    if (widened.code !== 0) {
      return fail(
        "completeness_unproven",
        `widening probe to ${flag} ${wider} exited ${widened.code}, so completeness is still unproven. ` +
          `stderr: ${widened.stderr.trim().slice(0, 200)}`,
        evidence,
        pages
      );
    }
    const wideVerdict = classifyRead(widened, {
      rowsKey: request.rowsKey,
      totalKey: request.totalKey,
      allowEmpty: true,
      limit: wider
    });
    const wideRows = locateRows(safeParse(widened.stdout), request.rowsKey);
    const wideCount = wideRows.ok ? wideRows.rows.length : -1;
    evidence.push(`widened ${flag} ${base} -> ${wider}: ${verdict.rowCount} -> ${wideCount} row(s)`);
    evidence.push(...wideVerdict.evidence.map((line) => `widened: ${line}`));

    if (wideVerdict.ok) {
      return { ok: true, reason: `widened read proven complete by ${wideVerdict.proofs.join(" + ")}`, proofs: wideVerdict.proofs, rows: wideVerdict.rows, rowCount: wideVerdict.rowCount, pages, scope: "default", evidence };
    }
    if (wideVerdict.code !== "completeness_unproven" && wideVerdict.code !== "page_cap_reached") {
      return fail(
        wideVerdict.code!,
        `widening probe failed: ${wideVerdict.reason}`,
        evidence,
        pages
      );
    }
    if (wideCount >= 0 && wideCount < wider) {
      // `wideCount < wider` is necessary and NOT sufficient. A surface that silently
      // clamps never honoured `wider` at all, so the comparison is against a bound
      // that was never applied. Refuse whenever the count lands on a cap this
      // surface is known to impose, or on a round number that is far more likely to
      // be a cap than a population.
      const clamp = request.knownClamp ?? lookupClamp(request.argv)?.cap;
      const clampNote = lookupClamp(request.argv);
      if (clamp !== undefined && wideCount >= clamp) {
        return fail(
          "hidden_clamp_suspected",
          `widening to ${wider} returned ${wideCount} row(s), which meets this surface's known server cap of ${clamp}` +
            (clampNote ? ` (${clampNote.key}, evidence ${clampNote.grade}: ${clampNote.note})` : "") +
            `. The bound you asked for was never honoured, so a count below it proves nothing. ` +
            `Page with a cursor, or cross-check against a sibling aggregate.`,
          evidence,
          pages
        );
      }
      if (clamp === undefined && SUSPICIOUS_COUNTS.has(wideCount)) {
        return fail(
          "hidden_clamp_suspected",
          `widening to ${wider} returned exactly ${wideCount} row(s) — a round number, and this surface is not in the ` +
            `clamp census, so a silent server cap cannot be ruled out. Widening cannot tell a population of ${wideCount} ` +
            `from a hidden cap at ${wideCount}. Supply --known-clamp once you have established the real cap, or prove ` +
            `completeness with a cursor or a sibling aggregate.`,
          evidence,
          pages
        );
      }
      if (wideCount > verdict.rowCount) {
        evidence.push(`population grew between reads (${verdict.rowCount} -> ${wideCount}); returning the wider read`);
      }
      if (clampNote) evidence.push(`clamp census: ${clampNote.key} cap=${clampNote.cap} grade=${clampNote.grade}`);
      return {
        ok: true,
        reason: `read proven complete by stable_under_widening (${wideCount} row(s), strictly below the bound ${wider}${
          clamp !== undefined ? ` and below the known cap ${clamp}` : " and not a round number"
        })`,
        proofs: ["stable_under_widening"],
        rows: wideRows.ok ? wideRows.rows : [],
        rowCount: wideCount,
        pages,
      scope: "default",
        evidence
      };
    }
    return fail(
      "page_cap_reached",
      `widening to ${wider} returned ${wideCount} row(s), which still equals the bound. The population is at least ${wideCount} and the read is still a page.`,
      evidence,
      pages
    );
  }

  if (request.assumeComplete) {
    const rows = locateRows(safeParse(captured.stdout), request.rowsKey);
    evidence.push("CALLER WAIVED PROOF (--assume-complete): this result is asserted, not established");
    return {
      ok: true,
      reason: "completeness ASSUMED by the caller, not proven",
      proofs: ["assumed_complete"],
      rows: rows.ok ? rows.rows : [],
      rowCount: verdict.rowCount,
      pages,
      scope: "default",
      evidence
    };
  }

  return fail(verdict.code!, verdict.reason, evidence, pages);
}

function probePredicate(
  request: SafeReadRequest,
  run: (argv: string[]) => CapturedRead,
  evidence: string[]
): SafeReadResult | null {
  const count = (argv: string[]): number | null => {
    const cap = run(argv);
    if (cap.code !== 0) return null;
    const located = locateRows(safeParse(cap.stdout), request.rowsKey);
    return located.ok ? located.rows.length : null;
  };

  if (request.probePositiveArgs?.length) {
    const positive = count([...request.argv, ...request.probePositiveArgs]);
    evidence.push(`predicate probe positive -> ${positive === null ? "unreadable" : positive} row(s)`);
    if (positive === null || positive === 0) {
      return fail(
        "predicate_inert",
        `a predicate known to match returned ${positive === null ? "an unreadable result" : "zero rows"}. ` +
          `The query surface is not matching what it should, so a zero from the real query would mean nothing.`,
        evidence,
        0
      );
    }
  }

  if (request.probeNegativeArgs?.length) {
    const negative = count([...request.argv, ...request.probeNegativeArgs]);
    evidence.push(`predicate probe negative -> ${negative === null ? "unreadable" : negative} row(s)`);
    if (negative === null) {
      return fail("predicate_ignored", "the negative predicate probe produced an unreadable result", evidence, 0);
    }
    if (negative > 0) {
      return fail(
        "predicate_ignored",
        `a predicate known to match NOTHING returned ${negative} row(s). The surface is ignoring the predicate, ` +
          `so these rows are not the set you asked for. Use an exact-identity lookup instead of this query verb.`,
        evidence,
        0
      );
    }
  }
  return null;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function fail(
  code: SafeReadResult["code"],
  reason: string,
  evidence: string[],
  pages: number
): SafeReadResult {
  return { ok: false, code, reason, proofs: [], rows: [], rowCount: 0, pages, scope: "default", evidence };
}

export type { ReadVerdict };
