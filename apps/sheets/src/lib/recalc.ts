/**
 * The recalculation engine. Builds a cross-sheet dependency graph from every
 * formula cell (via `fast-formula-parser`'s DepParser), evaluates cells in
 * dependency order to a stable fixed point, and flags circular references.
 *
 * Uses `fast-formula-parser` (MIT) exclusively — HyperFormula (GPL) is never
 * used.
 */
import FormulaParser from "fast-formula-parser";
import type { CellRef, RangeRef } from "fast-formula-parser";
import type { CellValue, Coord, Sheet, Workbook } from "../types/index.js";
import { toA1 } from "./a1.js";

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
 */
export function recalc(workbook: Workbook): Workbook {
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
        const coord = parseCellA1(a1);
        const node: FormulaNode = {
          key: nodeKey(sheet.name, a1),
          sheet,
          coord,
          a1,
          body: cell.raw.trim().slice(1),
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
        for (const candidate of nodesBySheet.get(sheetName) ?? []) {
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
  const parser = new FormulaParser({
    onCell: (ref) => getValue(ref.sheet ?? "", ref.row - 1, ref.col - 1),
    onRange: (ref) => {
      const sheet = sheetByName.get(ref.sheet ?? "");
      const maxRow = sheet ? sheet.rows : 0;
      const maxCol = sheet ? sheet.columns : 0;
      const r1 = Math.max(1, ref.from.row);
      const c1 = Math.max(1, ref.from.col);
      const r2 = Math.min(ref.to.row, maxRow);
      const c2 = Math.min(ref.to.col, maxCol);
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
    try {
      const result = parser.parse(node.body, {
        row: node.coord.row + 1,
        col: node.coord.col + 1,
        sheet: node.sheet.name,
      });
      if (result instanceof FormulaError) {
        cell.error = result.toString();
        cell.value = result.toString();
      } else {
        delete cell.error;
        cell.value = coerceResult(result);
      }
    } catch {
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
