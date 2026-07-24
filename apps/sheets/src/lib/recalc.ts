/**
 * The recalculation engine. Builds a cross-sheet dependency graph from every
 * formula cell (via `fast-formula-parser`'s DepParser), evaluates cells in
 * dependency order to a stable fixed point, and flags circular references.
 *
 * Uses `fast-formula-parser` (MIT) exclusively — HyperFormula (GPL) is never
 * used.
 *
 * Untrusted-input safety: a per-call {@link RecalcBudget} bounds the O(N^2)
 * dependency loop and the per-cell evaluation loop, oversized formulas are
 * rejected before they are ever parsed, oversized ranges are rejected before
 * they are materialized, and string-amplifier functions (REPT/CONCAT/…) are
 * overridden to refuse output larger than a single cell can hold. See
 * {@link ./limits}.
 */
import FormulaParser from "fast-formula-parser";
import type { CellRef, RangeRef } from "fast-formula-parser";
import type { CellValue, Coord, Sheet, Workbook } from "../types/index.js";
import { toA1 } from "./a1.js";
import {
  assertFormulaLength,
  assertRangeCells,
  type LimitOptions,
  RecalcBudget,
  resolveLimits,
  type SheetsLimits,
  SheetsLimitError,
} from "./limits.js";

const DepParser = FormulaParser.DepParser;
const FormulaError = FormulaParser.FormulaError;

/** Whether a raw cell input is a formula (begins with `=`). */
export function isFormula(raw: string): boolean {
  return raw.trimStart().startsWith("=");
}

/** Parse a non-formula raw input into a concrete {@link CellValue}. */
export function parseLiteral(raw: string): CellValue {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    if (!Number.isNaN(n)) return n;
  }
  const lower = trimmed.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  return raw;
}

function coerceResult(result: unknown): CellValue {
  if (result === null || result === undefined) return null;
  const t = typeof result;
  if (t === "number" || t === "string" || t === "boolean") {
    return result as CellValue;
  }
  if (result instanceof Date) return result.toISOString();
  return String(result);
}

function nodeKey(sheetName: string, a1: string): string {
  return `${sheetName}!${a1}`;
}

function isRangeRef(ref: CellRef | RangeRef): ref is RangeRef {
  return (ref as RangeRef).from !== undefined;
}

/**
 * Build overrides for the string-amplifier functions so they refuse to produce
 * output larger than a single cell can hold (Excel's real per-cell character
 * limit). This stops the REPT/CONCAT output-bomb class at the source, before
 * the huge string is ever allocated — exactly Excel's documented `#VALUE!`
 * behavior. `config.functions` is spread last in the parser, so these override
 * the built-ins of the same name.
 */
function guardedTextFunctions(
  maxCellContent: number,
): Record<string, (...args: unknown[]) => unknown> {
  const H = FormulaParser.FormulaHelpers;
  const T = FormulaParser.Types;
  const VALUE = FormulaParser.FormulaError.VALUE;

  const asString = (arg: unknown): string => H.accept(arg, T.STRING) as string;

  return {
    REPT: (text: unknown, numberTimes: unknown) => {
      const s = asString(text);
      const n = Math.floor(H.accept(numberTimes, T.NUMBER) as number);
      if (n < 0) throw VALUE;
      // Price the output BEFORE building it so the huge string never allocates.
      if (s.length * n > maxCellContent) throw VALUE;
      let out = "";
      for (let i = 0; i < n; i++) out += s;
      return out;
    },

    CONCAT: (...params: unknown[]) => {
      let text = "";
      H.flattenParams(params, T.STRING, false, (item: unknown) => {
        const s = asString(item);
        if (text.length + s.length > maxCellContent) throw VALUE;
        text += s;
      });
      return text;
    },

    CONCATENATE: (...params: unknown[]) => {
      if (params.length === 0) throw VALUE;
      let text = "";
      for (const param of params) {
        const s = asString(param);
        if (text.length + s.length > maxCellContent) throw VALUE;
        text += s;
      }
      return text;
    },

    TEXTJOIN: (...params: unknown[]) => {
      const delimiter = asString(params[0]);
      const ignoreEmpty = H.accept(params[1], T.BOOLEAN) as boolean;
      const parts: string[] = [];
      let total = 0;
      H.flattenParams(params.slice(2), T.STRING, false, (item: unknown) => {
        const s = asString(item);
        if (ignoreEmpty && s === "") return;
        total += (parts.length > 0 ? delimiter.length : 0) + s.length;
        if (total > maxCellContent) throw VALUE;
        parts.push(s);
      });
      return parts.join(delimiter);
    },
  };
}

interface FormulaNode {
  key: string;
  sheet: Sheet;
  coord: Coord;
  a1: string;
  /** Formula body without the leading `=`. */
  body: string;
  /** Node keys of the *formula* cells this cell depends on. */
  deps: string[];
}

/**
 * Recompute every formula cell in the workbook in-place and return it.
 * Literal cells have their {@link CellValue} refreshed from their raw input.
 * Idempotent: running twice yields the same values (a fixed point).
 *
 * @throws {SheetsLimitError} when input or the recalc pass exceeds a limit.
 */
export function recalc(workbook: Workbook, options: LimitOptions = {}): Workbook {
  const limits: SheetsLimits = resolveLimits(options.limits);
  const budget = new RecalcBudget(limits);

  const sheetByName = new Map<string, Sheet>();
  for (const sheet of workbook.sheets) sheetByName.set(sheet.name, sheet);

  // 1. Refresh literals, gather formula nodes.
  const formulaNodes = new Map<string, FormulaNode>();
  const nodesBySheet = new Map<string, FormulaNode[]>();
  for (const sheet of workbook.sheets) {
    const list: FormulaNode[] = [];
    nodesBySheet.set(sheet.name, list);
    for (const [a1, cell] of Object.entries(sheet.cells)) {
      if (isFormula(cell.raw)) {
        const body = cell.raw.trim().slice(1);
        // Belt-and-suspenders: bound the body length before any parse, even for
        // workbooks mutated directly rather than through setCell/validateCell.
        assertFormulaLength(body, limits);
        const coord = parseCellA1(a1);
        const node: FormulaNode = {
          key: nodeKey(sheet.name, a1),
          sheet,
          coord,
          a1,
          body,
          deps: [],
        };
        formulaNodes.set(node.key, node);
        list.push(node);
      } else {
        cell.value = parseLiteral(cell.raw);
        delete cell.error;
      }
    }
  }

  // 2. Extract dependencies (only edges to *other formula cells* matter for ordering).
  const depParser = new DepParser();
  for (const node of formulaNodes.values()) {
    // Price the dependency parse (formulas are parsed twice per recalc).
    budget.chargeParse(node.body.length);
    let refs: Array<CellRef | RangeRef> = [];
    try {
      refs = depParser.parse(node.body, {
        row: node.coord.row + 1,
        col: node.coord.col + 1,
        sheet: node.sheet.name,
      });
    } catch {
      refs = [];
    }
    const depKeys = new Set<string>();
    for (const ref of refs) {
      const sheetName = ref.sheet ?? node.sheet.name;
      const targetSheet = sheetByName.get(sheetName);
      if (!targetSheet) continue;
      if (isRangeRef(ref)) {
        const r1 = ref.from.row;
        const c1 = ref.from.col;
        const r2 = ref.to.row;
        const c2 = ref.to.col;
        // Reject an oversized range here, outside the parser, so the throw
        // propagates cleanly (the parser wraps anything thrown inside its
        // onRange callback as a FormulaError). Clamp to the target grid first,
        // matching how onRange materializes it. This also covers a huge-range
        // formula that never reaches evaluation (e.g. part of a cycle).
        const spanRows = Math.min(r2, targetSheet.rows) - Math.max(1, r1) + 1;
        const spanCols = Math.min(c2, targetSheet.columns) - Math.max(1, c1) + 1;
        if (spanRows > 0 && spanCols > 0) {
          assertRangeCells(spanRows * spanCols, limits);
        }
        // The O(N^2) dep-graph hot loop: every formula cell scans every formula
        // cell on the target sheet. This is the primary V2/V3 choke. Charge the
        // whole comparison count up front (one call, so the budget still trips
        // at the same op threshold) and keep the scan itself a tight integer
        // loop with no per-iteration call overhead.
        const candidates = nodesBySheet.get(sheetName) ?? [];
        budget.charge(candidates.length);
        for (const candidate of candidates) {
          const row = candidate.coord.row + 1;
          const col = candidate.coord.col + 1;
          if (row >= r1 && row <= r2 && col >= c1 && col <= c2) {
            depKeys.add(candidate.key);
          }
        }
      } else {
        const key = nodeKey(sheetName, toA1({ row: ref.row - 1, col: ref.col - 1 }));
        if (formulaNodes.has(key)) depKeys.add(key);
      }
    }
    node.deps = [...depKeys];
  }

  // 3. Topological order (Kahn); leftover nodes are circular.
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const node of formulaNodes.values()) {
    indegree.set(node.key, node.deps.length);
    for (const dep of node.deps) {
      const list = dependents.get(dep) ?? [];
      list.push(node.key);
      dependents.set(dep, list);
    }
  }
  const queue: string[] = [];
  for (const [key, degree] of indegree) {
    if (degree === 0) queue.push(key);
  }
  const ordered = new Set<string>();
  while (queue.length > 0) {
    const key = queue.shift();
    if (key === undefined) break;
    ordered.add(key);
    for (const dependent of dependents.get(key) ?? []) {
      const next = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, next);
      if (next === 0) queue.push(dependent);
    }
  }

  // 4. Evaluate acyclic formula cells in order.
  const getValue = (sheetName: string, row0: number, col0: number): CellValue => {
    const sheet = sheetByName.get(sheetName);
    if (!sheet) return null;
    const cell = sheet.cells[toA1({ row: row0, col: col0 })];
    return cell ? cell.value : null;
  };
  // fast-formula-parser catches anything thrown inside onCell/onRange and
  // rewraps it as a FormulaError, which would silently swallow a limit breach.
  // So we stash the first SheetsLimitError here and re-throw it after parse().
  let pendingLimitError: SheetsLimitError | null = null;
  const charge = (cost: number): void => {
    try {
      budget.charge(cost);
    } catch (err) {
      if (err instanceof SheetsLimitError) pendingLimitError ??= err;
      throw err;
    }
  };
  const parser = new FormulaParser({
    functions: guardedTextFunctions(limits.maxCellContent),
    onCell: (ref) => {
      charge(1);
      return getValue(ref.sheet ?? "", ref.row - 1, ref.col - 1);
    },
    onRange: (ref) => {
      const sheet = sheetByName.get(ref.sheet ?? "");
      const maxRow = sheet ? sheet.rows : 0;
      const maxCol = sheet ? sheet.columns : 0;
      const r1 = Math.max(1, ref.from.row);
      const c1 = Math.max(1, ref.from.col);
      const r2 = Math.min(ref.to.row, maxRow);
      const c2 = Math.min(ref.to.col, maxCol);
      const rowCount = r2 - r1 + 1;
      const colCount = c2 - c1 + 1;
      if (rowCount > 0 && colCount > 0) {
        const cellCount = rowCount * colCount;
        // Reject before allocating: bounds the single-call parser cost (SUM et
        // al. over a range is super-linear and cannot be interrupted mid-call).
        if (cellCount > limits.maxRangeCells) {
          const err = new SheetsLimitError(
            "range_too_large",
            `range materializes more than the maximum of ${limits.maxRangeCells} cells`,
            limits.maxRangeCells,
            cellCount,
          );
          pendingLimitError ??= err;
          throw err;
        }
        charge(cellCount);
      }
      const out: CellValue[][] = [];
      for (let r = r1; r <= r2; r++) {
        const rowValues: CellValue[] = [];
        for (let c = c1; c <= c2; c++) {
          rowValues.push(getValue(ref.sheet ?? "", r - 1, c - 1));
        }
        out.push(rowValues);
      }
      return out;
    },
  });

  for (const key of ordered) {
    const node = formulaNodes.get(key);
    if (!node) continue;
    const cell = node.sheet.cells[node.a1];
    if (!cell) continue;
    // Charge the evaluation parse and check the wall clock on every cell, so a
    // small cell count with expensive parses is still time-bounded.
    budget.chargeParse(node.body.length);
    try {
      const result = parser.parse(node.body, {
        row: node.coord.row + 1,
        col: node.coord.col + 1,
        sheet: node.sheet.name,
      });
      // A limit breach inside onCell/onRange was rewrapped by the parser; the
      // stashed original takes precedence over any produced value or error.
      if (pendingLimitError) throw pendingLimitError;
      if (result instanceof FormulaError) {
        cell.error = result.toString();
        cell.value = result.toString();
      } else {
        const value = coerceResult(result);
        // Post-eval guard: any produced string longer than a cell can hold
        // becomes a #VALUE! cell error (defense in depth behind the function
        // overrides, and a catch-all for the raw `&` concat operator).
        if (typeof value === "string" && value.length > limits.maxCellContent) {
          cell.error = "#VALUE!";
          cell.value = "#VALUE!";
        } else {
          delete cell.error;
          cell.value = value;
        }
      }
    } catch (err) {
      // Limit breaches (op/time/range budget) must propagate to the caller; only
      // genuine formula-evaluation failures collapse to a cell error.
      if (pendingLimitError) throw pendingLimitError;
      if (err instanceof SheetsLimitError) throw err;
      cell.error = "#ERROR!";
      cell.value = "#ERROR!";
    }
  }

  // 5. Flag circular cells.
  for (const node of formulaNodes.values()) {
    if (ordered.has(node.key)) continue;
    const cell = node.sheet.cells[node.a1];
    if (cell) {
      cell.error = "#CIRCULAR!";
      cell.value = "#CIRCULAR!";
    }
  }

  workbook.updatedAt = new Date().toISOString();
  return workbook;
}

/** Parse an A1 key that is guaranteed valid (comes from sheet.cells keys). */
function parseCellA1(a1: string): Coord {
  const match = /^([A-Za-z]+)([0-9]+)$/.exec(a1);
  if (!match || match[1] === undefined || match[2] === undefined) {
    throw new Error(`Corrupt cell key: ${a1}`);
  }
  let col = 0;
  const label = match[1].toUpperCase();
  for (let i = 0; i < label.length; i++) {
    col = col * 26 + (label.charCodeAt(i) - 64);
  }
  return { row: Number.parseInt(match[2], 10) - 1, col: col - 1 };
}
