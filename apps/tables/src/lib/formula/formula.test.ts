import { describe, expect, test } from "bun:test";
import { evaluateFormula, compileFormula } from "./evaluator.js";
import { parseFormula } from "./parser.js";
import { tokenize, FormulaError } from "./tokenizer.js";

const noFields = () => null;

describe("tokenizer", () => {
  test("tokenizes fields, numbers, strings, operators", () => {
    const tokens = tokenize("{Price} * 2 + 'x'");
    expect(tokens.map((t) => t.type)).toEqual(["field", "op", "number", "op", "string"]);
    expect(tokens[0]!.value).toBe("Price");
  });

  test("throws on unterminated field reference", () => {
    expect(() => tokenize("{Price")).toThrow(FormulaError);
  });
});

describe("parser precedence", () => {
  test("multiplication binds tighter than addition", () => {
    const ast = parseFormula("1 + 2 * 3");
    expect(ast.kind).toBe("binary");
    if (ast.kind === "binary") expect(ast.op).toBe("+");
  });
});

describe("arithmetic", () => {
  test("respects precedence", () => {
    expect(evaluateFormula("1 + 2 * 3", noFields)).toBe(7);
    expect(evaluateFormula("(1 + 2) * 3", noFields)).toBe(9);
  });

  test("unary minus", () => {
    expect(evaluateFormula("-5 + 3", noFields)).toBe(-2);
  });

  test("division by zero throws", () => {
    expect(() => evaluateFormula("1 / 0", noFields)).toThrow(FormulaError);
  });
});

describe("field references", () => {
  const values: Record<string, number> = { Price: 10, Qty: 3 };
  const resolve = (name: string) => values[name] ?? null;

  test("resolves and computes", () => {
    expect(evaluateFormula("{Price} * {Qty}", resolve)).toBe(30);
  });

  test("compiled formula is reusable", () => {
    const fn = compileFormula("{Price} + {Qty}");
    expect(fn(resolve)).toBe(13);
  });
});

describe("string ops", () => {
  test("concatenation with &", () => {
    expect(evaluateFormula("'a' & 'b' & 'c'", noFields)).toBe("abc");
  });

  test("CONCAT and UPPER", () => {
    expect(evaluateFormula("UPPER(CONCAT('foo', 'bar'))", noFields)).toBe("FOOBAR");
  });

  test("LEFT/RIGHT/MID/LEN", () => {
    expect(evaluateFormula("LEFT('hello', 2)", noFields)).toBe("he");
    expect(evaluateFormula("RIGHT('hello', 2)", noFields)).toBe("lo");
    expect(evaluateFormula("MID('hello', 2, 3)", noFields)).toBe("ell");
    expect(evaluateFormula("LEN('hello')", noFields)).toBe(5);
  });
});

describe("logic + comparison", () => {
  test("IF branches", () => {
    expect(evaluateFormula("IF(1 > 0, 'yes', 'no')", noFields)).toBe("yes");
    expect(evaluateFormula("IF(1 < 0, 'yes', 'no')", noFields)).toBe("no");
  });

  test("AND / OR / NOT", () => {
    expect(evaluateFormula("AND(TRUE, TRUE)", noFields)).toBe(true);
    expect(evaluateFormula("OR(FALSE, TRUE)", noFields)).toBe(true);
    expect(evaluateFormula("NOT(FALSE)", noFields)).toBe(true);
  });

  test("equality operators", () => {
    expect(evaluateFormula("2 = 2", noFields)).toBe(true);
    expect(evaluateFormula("2 != 3", noFields)).toBe(true);
    expect(evaluateFormula("'a' = 'a'", noFields)).toBe(true);
  });
});

describe("math functions", () => {
  test("SUM / AVERAGE / MIN / MAX / ROUND", () => {
    expect(evaluateFormula("SUM(1, 2, 3, 4)", noFields)).toBe(10);
    expect(evaluateFormula("AVERAGE(2, 4, 6)", noFields)).toBe(4);
    expect(evaluateFormula("MIN(3, 1, 2)", noFields)).toBe(1);
    expect(evaluateFormula("MAX(3, 1, 2)", noFields)).toBe(3);
    expect(evaluateFormula("ROUND(3.14159, 2)", noFields)).toBe(3.14);
  });
});

describe("errors", () => {
  test("unknown function", () => {
    expect(() => evaluateFormula("NOPE(1)", noFields)).toThrow(FormulaError);
  });

  test("empty formula", () => {
    expect(() => parseFormula("")).toThrow(FormulaError);
  });
});
