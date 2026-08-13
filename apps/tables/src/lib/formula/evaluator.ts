/** Evaluates a formula AST against a record's field values. */
import type { CellValue } from "../../types/index.js";
import { FormulaError } from "./tokenizer.js";
import { parseFormula, type Ast } from "./parser.js";

export type FormulaValue = number | string | boolean | null;

/** Resolves a field reference ({Name}) to a scalar formula value. */
export type FieldResolver = (name: string) => CellValue | undefined;

export function toNumber(v: FormulaValue): number {
  if (v === null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  if (Number.isNaN(n)) throw new FormulaError(`Cannot convert "${v}" to a number`);
  return n;
}

export function toText(v: FormulaValue): string {
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

export function toBoolean(v: FormulaValue): boolean {
  if (v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return v !== "" && v.toLowerCase() !== "false";
}

/** Normalize a stored CellValue into a scalar for the formula engine. */
function cellToScalar(value: CellValue | undefined): FormulaValue {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.join(", ");
  return value;
}

type Fn = (args: FormulaValue[]) => FormulaValue;

function numericArgs(args: FormulaValue[]): number[] {
  return args.map(toNumber);
}

const FUNCTIONS: Record<string, Fn> = {
  // math
  SUM: (a) => numericArgs(a).reduce((s, n) => s + n, 0),
  AVERAGE: (a) => (a.length ? numericArgs(a).reduce((s, n) => s + n, 0) / a.length : 0),
  MIN: (a) => Math.min(...numericArgs(a)),
  MAX: (a) => Math.max(...numericArgs(a)),
  ABS: (a) => Math.abs(toNumber(a[0] ?? null)),
  ROUND: (a) => {
    const n = toNumber(a[0] ?? null);
    const p = a.length > 1 ? toNumber(a[1] ?? null) : 0;
    const f = 10 ** p;
    return Math.round(n * f) / f;
  },
  CEILING: (a) => Math.ceil(toNumber(a[0] ?? null)),
  FLOOR: (a) => Math.floor(toNumber(a[0] ?? null)),
  MOD: (a) => toNumber(a[0] ?? null) % toNumber(a[1] ?? null),
  POWER: (a) => toNumber(a[0] ?? null) ** toNumber(a[1] ?? null),
  SQRT: (a) => Math.sqrt(toNumber(a[0] ?? null)),
  VALUE: (a) => toNumber(a[0] ?? null),

  // text
  CONCAT: (a) => a.map(toText).join(""),
  CONCATENATE: (a) => a.map(toText).join(""),
  UPPER: (a) => toText(a[0] ?? null).toUpperCase(),
  LOWER: (a) => toText(a[0] ?? null).toLowerCase(),
  TRIM: (a) => toText(a[0] ?? null).trim(),
  LEN: (a) => toText(a[0] ?? null).length,
  LEFT: (a) => toText(a[0] ?? null).slice(0, toNumber(a[1] ?? null)),
  RIGHT: (a) => {
    const s = toText(a[0] ?? null);
    const n = toNumber(a[1] ?? null);
    return n <= 0 ? "" : s.slice(Math.max(0, s.length - n));
  },
  MID: (a) => {
    const s = toText(a[0] ?? null);
    const start = Math.max(0, toNumber(a[1] ?? null) - 1);
    const count = toNumber(a[2] ?? null);
    return s.slice(start, start + count);
  },
  REPT: (a) => toText(a[0] ?? null).repeat(Math.max(0, toNumber(a[1] ?? null))),
  SUBSTITUTE: (a) => toText(a[0] ?? null).split(toText(a[1] ?? null)).join(toText(a[2] ?? null)),
  T: (a) => (typeof a[0] === "string" ? a[0] : ""),

  // logic
  IF: (a) => (toBoolean(a[0] ?? null) ? (a[1] ?? null) : (a[2] ?? null)),
  AND: (a) => a.every((v) => toBoolean(v)),
  OR: (a) => a.some((v) => toBoolean(v)),
  NOT: (a) => !toBoolean(a[0] ?? null),
  ISBLANK: (a) => {
    const v = a[0] ?? null;
    return v === null || v === "";
  },
  BLANK: () => null,

  // date
  TODAY: () => new Date().toISOString().slice(0, 10),
  NOW: () => new Date().toISOString(),
};

function evalNode(node: Ast, resolve: FieldResolver): FormulaValue {
  switch (node.kind) {
    case "number":
      return node.value;
    case "string":
      return node.value;
    case "boolean":
      return node.value;
    case "field":
      return cellToScalar(resolve(node.name));
    case "unary": {
      const v = evalNode(node.operand, resolve);
      return node.op === "-" ? -toNumber(v) : !toBoolean(v);
    }
    case "binary":
      return evalBinary(node, resolve);
    case "call": {
      const fn = FUNCTIONS[node.name];
      if (!fn) throw new FormulaError(`Unknown function "${node.name}"`);
      return fn(node.args.map((a) => evalNode(a, resolve)));
    }
  }
}

function evalBinary(node: Extract<Ast, { kind: "binary" }>, resolve: FieldResolver): FormulaValue {
  const { op } = node;
  const l = evalNode(node.left, resolve);
  const r = evalNode(node.right, resolve);

  switch (op) {
    case "+":
      return toNumber(l) + toNumber(r);
    case "-":
      return toNumber(l) - toNumber(r);
    case "*":
      return toNumber(l) * toNumber(r);
    case "/": {
      const d = toNumber(r);
      if (d === 0) throw new FormulaError("Division by zero");
      return toNumber(l) / d;
    }
    case "&":
      return toText(l) + toText(r);
    case "=":
    case "==":
      return looseEquals(l, r);
    case "!=":
    case "<>":
      return !looseEquals(l, r);
    case "<":
      return compare(l, r) < 0;
    case "<=":
      return compare(l, r) <= 0;
    case ">":
      return compare(l, r) > 0;
    case ">=":
      return compare(l, r) >= 0;
    default:
      throw new FormulaError(`Unknown operator "${op}"`);
  }
}

function looseEquals(l: FormulaValue, r: FormulaValue): boolean {
  if (typeof l === "number" || typeof r === "number") {
    if (l === null || r === null) return l === r;
    return toNumber(l) === toNumber(r);
  }
  return toText(l) === toText(r);
}

function compare(l: FormulaValue, r: FormulaValue): number {
  if (typeof l === "number" || typeof r === "number") {
    return toNumber(l) - toNumber(r);
  }
  const a = toText(l);
  const b = toText(r);
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Compile a formula source into a reusable evaluator function. */
export function compileFormula(source: string): (resolve: FieldResolver) => FormulaValue {
  const ast = parseFormula(source);
  return (resolve: FieldResolver) => evalNode(ast, resolve);
}

/** One-shot evaluate. */
export function evaluateFormula(source: string, resolve: FieldResolver): FormulaValue {
  return compileFormula(source)(resolve);
}
