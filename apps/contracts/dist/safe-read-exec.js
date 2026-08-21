// @bun
var __defProp = Object.defineProperty;
var __returnValue = (v) => v;
function __exportSetter(name, newValue) {
  this[name] = __returnValue.bind(null, newValue);
}
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: __exportSetter.bind(all, name)
    });
};

// src/safe-read.ts
var ROWS_KEY_CANDIDATES = [
  "rows",
  "entries",
  "items",
  "results",
  "records",
  "tasks",
  "messages",
  "data"
];
var TOTAL_KEY_CANDIDATES = ["total", "total_count", "totalCount", "totalItems", "total_available"];
var STDERR_TRUNCATION_PATTERNS = [
  { re: /showing\s+(\d+)\s+of\s+(\d+)/i, note: "surface reported a bounded read" },
  { re: /\btruncated\b/i, note: "surface used the word truncated" },
  { re: /to see the rest/i, note: "surface offered a route to the remainder" },
  { re: /page with --cursor/i, note: "surface offered a cursor" }
];
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isUsableCursor(value) {
  return typeof value === "string" && value.trim().length > 0 || typeof value === "number" && Number.isSafeInteger(value);
}
function locateRows(parsed, rowsKey) {
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
      return { ok: true, rows: parsed[candidate], key: candidate };
    }
  }
  const arrayKeys = Object.keys(parsed).filter((k) => Array.isArray(parsed[k]));
  if (arrayKeys.length === 1) {
    return { ok: true, rows: parsed[arrayKeys[0]], key: arrayKeys[0] };
  }
  return {
    ok: false,
    error: arrayKeys.length === 0 ? `no array-valued key in envelope {${Object.keys(parsed).join(",")}}` : `ambiguous rows key: ${arrayKeys.join(", ")} \u2014 pass --rows-key`
  };
}
function readDottedPath(parsed, path) {
  let cursor = parsed;
  for (const segment of path.split(".")) {
    if (!isPlainObject(cursor))
      return;
    cursor = cursor[segment];
  }
  return typeof cursor === "number" ? cursor : undefined;
}
function classifyRead(captured, options = {}) {
  const evidence = [];
  const refuse = (code, reason) => ({
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
  if (captured.code !== 0) {
    return refuse("nonzero_exit", `the command exited ${captured.code}. A failed read is not an empty set. ` + `Captured stderr was ${captured.stderr.length} byte(s); content was not rendered.`);
  }
  if (captured.stdout.trim() === "") {
    return refuse("unparseable_stdout", "stdout was empty; there is no payload to judge");
  }
  let parsed;
  try {
    parsed = JSON.parse(captured.stdout);
  } catch {
    return refuse("unparseable_stdout", "stdout was not valid JSON; parse details were not rendered. A parse failure is a refusal, never an empty list.");
  }
  if (isPlainObject(parsed)) {
    if (parsed.ok === false) {
      return refuse("error_object", "the surface returned an error object at exit 0; payload content was not rendered");
    }
    if (typeof parsed.error === "string" && parsed.error.length > 0) {
      return refuse("error_object", "the surface returned an error object at exit 0; payload content was not rendered");
    }
    if (parsed.store_exists === false) {
      return refuse("store_unavailable", "the surface reported store_exists=false; zero rows here means the store was unreachable, not empty");
    }
  }
  const located = locateRows(parsed, options.rowsKey);
  if (!located.ok) {
    return refuse("rows_key_missing", `${located.error}. Refusing rather than reporting zero rows: a reader that cannot find the rows has measured nothing.`);
  }
  const rows = located.rows;
  const rowCount = rows.length;
  evidence.push(`rows=${rowCount} under ${located.key}`);
  for (const { re, note } of STDERR_TRUNCATION_PATTERNS) {
    const hit = re.exec(captured.stderr);
    if (hit) {
      return refuse("stderr_truncation_notice", `stderr carries a truncation notice (${note}); content was not rendered. ` + "The body parsed cleanly at exit 0; only stderr says the read was bounded.");
    }
  }
  let declaredTotal;
  let hasMore;
  let nextCursor;
  if (isPlainObject(parsed)) {
    const totalKeys = options.totalKey ? [options.totalKey] : TOTAL_KEY_CANDIDATES;
    for (const key of totalKeys) {
      if (!Object.prototype.hasOwnProperty.call(parsed, key))
        continue;
      const value = parsed[key];
      if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        return {
          ...refuse("declared_total_mismatch", `declared ${key} must be a non-negative safe integer, got ${JSON.stringify(value)}`),
          rowCount
        };
      }
      declaredTotal = value;
      evidence.push(`declared ${key}=${value}`);
      break;
    }
    if (typeof parsed.has_more === "boolean")
      hasMore = parsed.has_more;
    else if (typeof parsed.hasMore === "boolean")
      hasMore = parsed.hasMore;
    const cursor = Object.prototype.hasOwnProperty.call(parsed, "next_cursor") ? parsed.next_cursor : parsed.nextCursor;
    if (isUsableCursor(cursor) || cursor === null)
      nextCursor = cursor;
  }
  const usableCursor = isUsableCursor(nextCursor);
  if (hasMore === true || usableCursor) {
    return {
      ...refuse("unfollowed_cursor", `the surface indicates another page (has_more=${String(hasMore)}, cursor ${usableCursor ? nextCursor : "unset"}). ` + `You are holding a page and about to call it a population.`),
      rowCount,
      declaredTotal,
      nextCursor,
      hasMore
    };
  }
  if (declaredTotal !== undefined && rowCount !== declaredTotal) {
    return {
      ...refuse("declared_total_mismatch", `holding ${rowCount} row(s) against a declared total of ${declaredTotal}. ` + `The surface's count and payload disagree, so completeness is not established.`),
      rowCount,
      declaredTotal,
      nextCursor,
      hasMore
    };
  }
  const proofs = [];
  if (declaredTotal !== undefined && rowCount === declaredTotal) {
    proofs.push("declared_total_satisfied");
    evidence.push(`rowCount ${rowCount} equals declared total ${declaredTotal}`);
  }
  if (hasMore === false || nextCursor === null) {
    proofs.push("cursor_exhausted");
    evidence.push(`surface declared no next page (has_more=${hasMore}, next_cursor=${String(nextCursor)})`);
  }
  if (proofs.length === 0) {
    const cap = options.limit !== undefined && rowCount === options.limit ? ` rowCount equals the requested limit ${options.limit}, which is what a silent cap looks like.` : "";
    return {
      ok: false,
      code: rowCount === options.limit ? "page_cap_reached" : "completeness_unproven",
      reason: `the payload carries no total, no cursor and no truncation notice, so nothing in it proves the read is whole.${cap} ` + `Establish completeness by widening the bound, or by a sibling aggregate.`,
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

// src/safe-read-exec.ts
import { spawnSync } from "child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
var DEFAULT_MAX_PAGES = 200;
var KNOWN_CLAMPS = {
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
var SUSPICIOUS_COUNTS = new Set([10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]);
var SCOPE_WIDENERS = {
  "knowledge list": { flag: "--include-archived", grade: "M", note: "default hides archived items (1526 vs 1567)" },
  "todos list": { flag: "--all", grade: "M", note: "default is a subset; --all never reveals its own population" }
};
function lookupScopeWidener(argv) {
  const words = argv.filter((token) => !token.startsWith("-"));
  for (let take = Math.min(words.length, 4);take >= 1; take -= 1) {
    const key = words.slice(0, take).join(" ");
    const hit = SCOPE_WIDENERS[key];
    if (hit)
      return { key, ...hit };
  }
  return null;
}
function lookupClamp(argv) {
  const words = argv.filter((token) => !token.startsWith("-"));
  for (let take = Math.min(words.length, 4);take >= 1; take -= 1) {
    const key = words.slice(0, take).join(" ");
    const hit = KNOWN_CLAMPS[key];
    if (hit)
      return { key, ...hit };
  }
  return null;
}
function runCaptured(argv) {
  const [bin, ...args] = argv;
  if (!bin)
    throw new Error("empty argv");
  const dir = mkdtempSync(join(tmpdir(), "hasna-safe-read-"));
  const outPath = join(dir, "stdout.bin");
  const errPath = join(dir, "stderr.bin");
  let outFd;
  let errFd;
  try {
    outFd = openSync(outPath, "w");
    errFd = openSync(errPath, "w");
    const proc = spawnSync(bin, args, { shell: false, stdio: ["ignore", outFd, errFd] });
    closeSync(outFd);
    outFd = undefined;
    closeSync(errFd);
    errFd = undefined;
    if (proc.error) {
      const err = proc.error;
      return { stdout: "", stderr: `spawn failed: ${err.message}`, code: 252 };
    }
    return {
      stdout: readFileSync(outPath, "utf8"),
      stderr: readFileSync(errPath, "utf8"),
      code: proc.status ?? 253
    };
  } finally {
    if (outFd !== undefined)
      closeSync(outFd);
    if (errFd !== undefined)
      closeSync(errFd);
    rmSync(dir, { recursive: true, force: true });
  }
}
function withFlag(argv, flag, value) {
  if (!flag)
    return argv;
  const out = [...argv];
  const at = out.indexOf(flag);
  if (at >= 0 && at + 1 < out.length) {
    out[at + 1] = String(value);
    return out;
  }
  out.push(flag, String(value));
  return out;
}
function safeRead(request) {
  const widener = lookupScopeWidener(request.argv);
  const scopeLabel = widener && request.argv.includes(widener.flag) ? widener.flag : request.scopeAck ? `default (acknowledged: ${request.scopeAck})` : "default";
  const result = safeReadInner(request);
  return {
    ...result,
    scope: result.scope && result.scope !== "default" ? result.scope : scopeLabel,
    reason: result.ok ? `${result.reason} [scope: ${scopeLabel}]` : result.reason
  };
}
function safeReadInner(request) {
  const run = request.run ?? runCaptured;
  const evidence = [];
  const maxPages = request.maxPages ?? DEFAULT_MAX_PAGES;
  evidence.push(`argv: ${request.argv.join(" ")}`);
  const widener = lookupScopeWidener(request.argv);
  const scope = widener && request.argv.includes(widener.flag) ? widener.flag : "default";
  if (widener && scope === "default" && !request.scopeAck) {
    return {
      ...fail("scope_defaulted", `${widener.key} defaults to a NARROWER SCOPE than its full population (${widener.note}, evidence ${widener.grade}). ` + `The read may be complete, the predicate correct and the declared total honest, and the number still be a subset \u2014 ` + `a declared total is scope-relative, so reconciling against it CONFIRMS this rather than catching it. ` + `Pass ${widener.flag} for the wider scope, or --scope-ack to record the narrower one as a deliberate choice.`, evidence, 0),
      scope
    };
  }
  if (widener)
    evidence.push(`scope: ${scope} (widener ${widener.flag} available, grade ${widener.grade})`);
  else
    evidence.push(`scope: ${request.scopeAck ?? "unqualified"} (no scope widener in census for this surface)`);
  if (request.probeNegativeArgs?.length || request.probePositiveArgs?.length) {
    const probe = probePredicate(request, run, evidence);
    if (probe)
      return probe;
  }
  let argv = request.argv;
  if (request.limit !== undefined)
    argv = withFlag(argv, request.limitFlag ?? "--limit", request.limit);
  if (argv.join(" ") !== request.argv.join(" "))
    evidence.push(`ran: ${argv.join(" ")}`);
  let captured = run(argv);
  let verdict = classifyRead(captured, {
    rowsKey: request.rowsKey,
    totalKey: request.totalKey,
    allowEmpty: request.allowEmpty,
    limit: request.limit
  });
  evidence.push(...verdict.evidence);
  let pages = 1;
  if (!verdict.ok && verdict.code === "unfollowed_cursor" && request.cursorFlag) {
    const accumulated = [];
    let cursor = verdict.nextCursor;
    let declaredTotal = verdict.declaredTotal;
    let declaredTotalShape;
    if (!isUsableCursor(cursor)) {
      return fail("unfollowed_cursor", "the surface indicates another page but supplied no usable cursor; refusing rather than treating the first page as exhausted", evidence, pages);
    }
    const first = locateRows(safeParse(captured.stdout), request.rowsKey);
    if (first.ok)
      accumulated.push(...first.rows);
    while (isUsableCursor(cursor) && pages < maxPages) {
      const paged = withFlag(argv, request.cursorFlag, cursor);
      captured = run(paged);
      pages += 1;
      verdict = classifyRead(captured, {
        rowsKey: request.rowsKey,
        totalKey: request.totalKey,
        allowEmpty: true,
        limit: request.limit
      });
      if (verdict.declaredTotal !== undefined) {
        if (declaredTotal === undefined) {
          return fail("declared_total_mismatch", `paging introduced a declared total of ${verdict.declaredTotal} after page 1; ` + `its population-relative semantics cannot be established from the later page alone`, evidence, pages);
        }
        const samePopulation = verdict.declaredTotal === declaredTotal;
        const remainingPopulation = accumulated.length + verdict.declaredTotal === declaredTotal;
        if (!samePopulation && !remainingPopulation) {
          return fail("declared_total_mismatch", `paging changed its declared total from ${declaredTotal} to ${verdict.declaredTotal} ` + `after ${accumulated.length} accumulated row(s); it matches neither a stable population total ` + `nor a cursor-relative remaining total`, evidence, pages);
        }
        const observedShape = samePopulation ? "population" : "remaining";
        if (declaredTotalShape !== undefined && declaredTotalShape !== observedShape) {
          return fail("declared_total_mismatch", `paging changed declared-total semantics from ${declaredTotalShape} to ${observedShape}`, evidence, pages);
        }
        declaredTotalShape = observedShape;
        evidence.push(`page ${pages} declared total ${verdict.declaredTotal} as a ${observedShape} count ` + `after ${accumulated.length} accumulated row(s)`);
      }
      const located = locateRows(safeParse(captured.stdout), request.rowsKey);
      if (located.ok)
        accumulated.push(...located.rows);
      if (verdict.ok || verdict.code === "declared_total_mismatch" && (verdict.hasMore === false || verdict.nextCursor === null)) {
        cursor = null;
        break;
      }
      if (verdict.code !== "unfollowed_cursor") {
        return fail(verdict.code, `paging stopped at page ${pages}: ${verdict.reason}`, evidence, pages);
      }
      cursor = verdict.nextCursor;
      if (!isUsableCursor(cursor)) {
        return fail("unfollowed_cursor", `paging stopped at page ${pages}: the surface indicates another page but supplied no usable cursor`, evidence, pages);
      }
    }
    if (isUsableCursor(cursor) && pages >= maxPages) {
      return fail("unfollowed_cursor", `still paging after ${maxPages} pages; refusing rather than reporting a partial set`, evidence, pages);
    }
    if (declaredTotal !== undefined && accumulated.length !== declaredTotal) {
      return fail("declared_total_mismatch", `paged to exhaustion with ${accumulated.length} row(s) against a declared total of ${declaredTotal}`, evidence, pages);
    }
    if (declaredTotal !== undefined) {
      evidence.push(`accumulated rowCount ${accumulated.length} equals declared total ${declaredTotal}`);
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
  const recoverable = ["completeness_unproven", "page_cap_reached", "declared_total_mismatch", "stderr_truncation_notice"];
  if (!recoverable.includes(verdict.code)) {
    return fail(verdict.code, verdict.reason, evidence, pages);
  }
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
        return fail("declared_total_mismatch", `sibling aggregate ${request.siblingPath}=${aggregate} disagrees with ${verdict.rowCount} row(s) read`, evidence, pages);
      }
    }
  }
  if (request.limitFlag !== undefined || request.limit !== undefined) {
    const flag = request.limitFlag ?? "--limit";
    const base = request.limit ?? verdict.rowCount;
    const wider = request.widenTo ?? Math.max(base * 4, base + 1);
    const widened = run(withFlag(request.argv, flag, wider));
    pages += 1;
    if (widened.code !== 0) {
      return fail("completeness_unproven", `widening probe to ${flag} ${wider} exited ${widened.code}, so completeness is still unproven. ` + `Captured stderr was ${widened.stderr.length} byte(s); content was not rendered.`, evidence, pages);
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
      return fail(wideVerdict.code, `widening probe failed: ${wideVerdict.reason}`, evidence, pages);
    }
    if (wideCount >= 0 && wideCount < wider) {
      const clamp = request.knownClamp ?? lookupClamp(request.argv)?.cap;
      const clampNote = lookupClamp(request.argv);
      if (clamp !== undefined && wideCount >= clamp) {
        return fail("hidden_clamp_suspected", `widening to ${wider} returned ${wideCount} row(s), which meets this surface's known server cap of ${clamp}` + (clampNote ? ` (${clampNote.key}, evidence ${clampNote.grade}: ${clampNote.note})` : "") + `. The bound you asked for was never honoured, so a count below it proves nothing. ` + `Page with a cursor, or cross-check against a sibling aggregate.`, evidence, pages);
      }
      if (clamp === undefined && SUSPICIOUS_COUNTS.has(wideCount)) {
        return fail("hidden_clamp_suspected", `widening to ${wider} returned exactly ${wideCount} row(s) \u2014 a round number, and this surface is not in the ` + `clamp census, so a silent server cap cannot be ruled out. Widening cannot tell a population of ${wideCount} ` + `from a hidden cap at ${wideCount}. Supply --known-clamp once you have established the real cap, or prove ` + `completeness with a cursor or a sibling aggregate.`, evidence, pages);
      }
      if (wideCount > verdict.rowCount) {
        evidence.push(`population grew between reads (${verdict.rowCount} -> ${wideCount}); returning the wider read`);
      }
      if (clampNote)
        evidence.push(`clamp census: ${clampNote.key} cap=${clampNote.cap} grade=${clampNote.grade}`);
      return {
        ok: true,
        reason: `read proven complete by stable_under_widening (${wideCount} row(s), strictly below the bound ${wider}${clamp !== undefined ? ` and below the known cap ${clamp}` : " and not a round number"})`,
        proofs: ["stable_under_widening"],
        rows: wideRows.ok ? wideRows.rows : [],
        rowCount: wideCount,
        pages,
        scope: "default",
        evidence
      };
    }
    return fail("page_cap_reached", `widening to ${wider} returned ${wideCount} row(s), which still equals the bound. The population is at least ${wideCount} and the read is still a page.`, evidence, pages);
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
  return fail(verdict.code, verdict.reason, evidence, pages);
}
function probePredicate(request, run, evidence) {
  const count = (argv) => {
    const cap = run(argv);
    if (cap.code !== 0)
      return null;
    const located = locateRows(safeParse(cap.stdout), request.rowsKey);
    return located.ok ? located.rows.length : null;
  };
  if (request.probePositiveArgs?.length) {
    const positive = count([...request.argv, ...request.probePositiveArgs]);
    evidence.push(`predicate probe positive -> ${positive === null ? "unreadable" : positive} row(s)`);
    if (positive === null || positive === 0) {
      return fail("predicate_inert", `a predicate known to match returned ${positive === null ? "an unreadable result" : "zero rows"}. ` + `The query surface is not matching what it should, so a zero from the real query would mean nothing.`, evidence, 0);
    }
  }
  if (request.probeNegativeArgs?.length) {
    const negative = count([...request.argv, ...request.probeNegativeArgs]);
    evidence.push(`predicate probe negative -> ${negative === null ? "unreadable" : negative} row(s)`);
    if (negative === null) {
      return fail("predicate_ignored", "the negative predicate probe produced an unreadable result", evidence, 0);
    }
    if (negative > 0) {
      return fail("predicate_ignored", `a predicate known to match NOTHING returned ${negative} row(s). The surface is ignoring the predicate, ` + `so these rows are not the set you asked for. Use an exact-identity lookup instead of this query verb.`, evidence, 0);
    }
  }
  return null;
}
function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
function fail(code, reason, evidence, pages) {
  return { ok: false, code, reason, proofs: [], rows: [], rowCount: 0, pages, scope: "default", evidence };
}
export {
  safeRead,
  runCaptured,
  lookupScopeWidener,
  lookupClamp,
  SCOPE_WIDENERS,
  KNOWN_CLAMPS
};
