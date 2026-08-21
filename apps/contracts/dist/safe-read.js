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
export {
  readDottedPath,
  locateRows,
  isUsableCursor,
  classifyRead
};
