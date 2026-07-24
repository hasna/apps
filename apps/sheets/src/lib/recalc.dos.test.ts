/**
 * Denial-of-service regression suite. Each test reproduces a real attack
 * payload (V1..V5) and asserts it is neutralized by a {@link SheetsLimitError}
 * (or a bounded #VALUE! cell for the output-bomb class) instead of hanging, and
 * that a realistic ~10k-cell workbook still recalculates fast.
 *
 * The budget-based vectors (V2 dep-graph, V5 aggregate parse) are bounded at
 * the *default* limits in ~1.5-2s (the op budget trips the O(N^2) dep scan; the
 * wall-clock deadline trips the aggregate parse flood). To keep the suite fast
 * and deterministic they are exercised here with tightened `limits` on the
 * *real* payloads, and the production defaults are pinned separately by the
 * "DEFAULT_LIMITS are the shipped values" test.
 */
import { describe, expect, test } from "bun:test";
import { csvToWorkbook } from "./csv.js";
import { DEFAULT_LIMITS, SheetsLimitError } from "./limits.js";
import { loadWorkbook } from "./serialize.js";
import { createWorkbook, getCellValue, getRangeValues, setCell, setCells } from "./workbook.js";

/** Run `fn`, returning how it terminated and how long it took. */
function run(fn: () => void): { ms: number; error: unknown } {
  const t0 = Date.now();
  try {
    fn();
    return { ms: Date.now() - t0, error: null };
  } catch (error) {
    return { ms: Date.now() - t0, error };
  }
}

const FAST_MS = 3000; // every neutralized vector must terminate well under this.

describe("DoS vectors are neutralized", () => {
  test("V1a: getRangeValues on A1:A2000000 is clamped to the grid, not amplified", () => {
    const wb = createWorkbook({ rows: 100, columns: 3 });
    const { ms, error } = run(() => {
      const grid = getRangeValues(wb, "A1:A2000000");
      // The bug materialized ~2M rows; the fix clamps to the 100-row grid.
      expect(grid.length).toBe(100);
    });
    expect(error).toBeNull();
    expect(ms).toBeLessThan(FAST_MS);
  });

  test("V1a': getRangeValues whose clamped range still exceeds maxRangeCells throws", () => {
    // A grid large enough that even the clamped request is oversized.
    const wb = createWorkbook({ rows: 200000, columns: 1 });
    const { ms, error } = run(() => getRangeValues(wb, "A1:A200000"));
    expect(error).toBeInstanceOf(SheetsLimitError);
    expect((error as SheetsLimitError).code).toBe("range_too_large");
    expect(ms).toBeLessThan(FAST_MS);
  });

  test("V1b: =SUM over an oversized declared range throws range_too_large", () => {
    const wb = createWorkbook({ rows: 200000, columns: 2 });
    const { ms, error } = run(() => setCell(wb, "B1", "=SUM(A1:A200000)"));
    expect(error).toBeInstanceOf(SheetsLimitError);
    expect((error as SheetsLimitError).code).toBe("range_too_large");
    expect(ms).toBeLessThan(FAST_MS);
  });

  test("V2: O(N^2) dependency graph trips the recalc op budget", () => {
    // N formula cells that each SUM a wide range -> N x N candidate comparisons.
    const N = 5000;
    const entries: Array<[string, string]> = [];
    for (let r = 1; r <= N; r++) entries.push([`C${r}`, "=SUM(A1:A20000)"]);
    const wb = createWorkbook({ rows: N, columns: 3 });
    const { ms, error } = run(() =>
      // Real payload; tightened op budget so the O(N^2) trip is instant here.
      setCells(wb, entries, undefined, { limits: { recalcOpBudget: 5_000_000 } }),
    );
    expect(error).toBeInstanceOf(SheetsLimitError);
    expect((error as SheetsLimitError).code).toBe("recalc_op_budget_exceeded");
    expect(ms).toBeLessThan(FAST_MS);
  });

  test("V3: bulk CSV import beyond maxCellsPerWrite throws batch_too_large", () => {
    // 100001 formula cells (one per row) exceeds the 100000 batch cap.
    let csv = "";
    for (let r = 0; r <= DEFAULT_LIMITS.maxCellsPerWrite; r++) csv += "=A1\n";
    const { ms, error } = run(() => csvToWorkbook(csv));
    expect(error).toBeInstanceOf(SheetsLimitError);
    expect((error as SheetsLimitError).code).toBe("batch_too_large");
    expect(ms).toBeLessThan(FAST_MS);
  });

  test("V4: REPT output bomb becomes a bounded #VALUE! cell, no huge allocation", () => {
    const wb = createWorkbook();
    const { ms, error } = run(() => setCell(wb, "A1", '=REPT("z",300000000)'));
    expect(error).toBeNull();
    expect(getCellValue(wb, "A1")).toBe("#VALUE!");
    expect(wb.sheets[0]?.cells.A1?.error).toBe("#VALUE!");
    expect(ms).toBeLessThan(FAST_MS);
  });

  test("V4': REPT '&' concat residual is bounded at each operand and post-eval", () => {
    const wb = createWorkbook();
    const { ms, error } = run(() =>
      setCell(wb, "A1", '=REPT("z",100000000)&REPT("z",100000000)'),
    );
    expect(error).toBeNull();
    expect(getCellValue(wb, "A1")).toBe("#VALUE!");
    expect(ms).toBeLessThan(FAST_MS);
  });

  test("V4'': oversized '&' concatenation of valid strings hits the coerceResult guard", () => {
    const wb = createWorkbook();
    // Two 20000-char literals are individually legal (<= maxCellContent) but
    // concatenating them exceeds a single cell, so the post-eval guard fires.
    setCell(wb, "A1", "a".repeat(20000), { recalc: false });
    setCell(wb, "B1", "b".repeat(20000), { recalc: false });
    const { ms, error } = run(() => setCell(wb, "C1", "=A1&B1"));
    expect(error).toBeNull();
    expect(getCellValue(wb, "C1")).toBe("#VALUE!");
    expect(wb.sheets[0]?.cells.C1?.error).toBe("#VALUE!");
    expect(ms).toBeLessThan(FAST_MS);
  });

  test("V5 (single): one oversized formula body is rejected before parsing", () => {
    const wb = createWorkbook();
    const giant = "=1" + "+1".repeat(5000); // body ~10001 chars > 8192
    const { ms, error } = run(() => setCell(wb, "A1", giant));
    expect(error).toBeInstanceOf(SheetsLimitError);
    expect((error as SheetsLimitError).code).toBe("formula_too_long");
    expect(ms).toBeLessThan(FAST_MS);
  });

  test("V5 (single, load path): oversized formula rejected on load too", () => {
    const doc = {
      schema: "hasna.sheets.workbook",
      version: 1,
      workbook: {
        id: "wb",
        activeSheetId: "s1",
        createdAt: "",
        updatedAt: "",
        sheets: [
          {
            id: "s1",
            name: "Sheet1",
            rows: 10,
            columns: 10,
            cells: { A1: { raw: "=1" + "+1".repeat(5000), value: null } },
          },
        ],
      },
    };
    const { ms, error } = run(() => loadWorkbook(JSON.stringify(doc)));
    expect(error).toBeInstanceOf(SheetsLimitError);
    expect((error as SheetsLimitError).code).toBe("formula_too_long");
    expect(ms).toBeLessThan(FAST_MS);
  });

  test("V5 (aggregate): many max-length formulas trip the total parse budget", () => {
    // 5000 cells of an ~8000-char =1+1+... body (each individually under the
    // per-formula cap). The aggregate parse-char budget must be the deterministic
    // binding constraint, so it is tightened to trip after only a few dozen dep
    // parses (fast on any runner) and the wall-clock deadline is lifted far above
    // any runner's real parse time. Otherwise a slow CI runner's expensive parses
    // cross the default 1800ms deadline first and the test flakes with
    // `recalc_time_budget_exceeded` (and a budget that needs hundreds of parses
    // can also blow the FAST_MS bound under heavy CPU contention).
    const body = "=1" + "+1".repeat(3999); // ~8000 chars, body ~7999 < 8192
    const entries: Array<[string, string]> = [];
    for (let r = 1; r <= 5000; r++) entries.push([`A${r}`, body]);
    const wb = createWorkbook({ rows: 5000, columns: 1 });
    const { ms, error } = run(() =>
      setCells(wb, entries, undefined, {
        limits: { totalFormulaCharsBudget: 200_000, recalcWallClockMs: 600_000 },
      }),
    );
    expect(error).toBeInstanceOf(SheetsLimitError);
    expect((error as SheetsLimitError).code).toBe("formula_parse_budget_exceeded");
    expect(ms).toBeLessThan(FAST_MS);
  });

  test("cap: maxPopulatedCells is enforced across a batch", () => {
    const wb = createWorkbook({ rows: 2000, columns: 2 });
    const entries: Array<[string, string]> = [];
    for (let r = 1; r <= 2001; r++) entries.push([`A${r}`, String(r)]);
    const { error } = run(() =>
      setCells(wb, entries, undefined, { limits: { maxPopulatedCells: 2000 } }),
    );
    expect(error).toBeInstanceOf(SheetsLimitError);
    expect((error as SheetsLimitError).code).toBe("too_many_cells");
  });

  test("cap: sheet auto-grow beyond maxSheetRows throws sheet_too_large", () => {
    const wb = createWorkbook();
    const { error } = run(() => setCell(wb, "A2000000", "1"));
    expect(error).toBeInstanceOf(SheetsLimitError);
    expect((error as SheetsLimitError).code).toBe("sheet_too_large");
  });
});

describe("SheetsLimitError shape", () => {
  test("carries a machine code, the limit, the actual, and survives instanceof", () => {
    const wb = createWorkbook();
    let caught: unknown = null;
    try {
      setCell(wb, "A1", "=1" + "+1".repeat(5000));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SheetsLimitError);
    expect(caught).toBeInstanceOf(Error);
    const err = caught as SheetsLimitError;
    expect(err.name).toBe("SheetsLimitError");
    expect(err.code).toBe("formula_too_long");
    expect(err.limit).toBe(8192);
    expect(typeof err.actual).toBe("number");
    // Messages must be dash-free.
    expect(err.message).not.toMatch(/[-‐-―]/);
  });
});

describe("DEFAULT_LIMITS are the shipped values", () => {
  test("match the design so production callers get the intended protection", () => {
    expect(DEFAULT_LIMITS).toEqual({
      maxFormulaLength: 8192,
      maxCellContent: 32767,
      maxSheetRows: 1048576,
      maxSheetColumns: 16384,
      maxPopulatedCells: 1000000,
      maxRangeCells: 65536,
      maxCellsPerWrite: 100000,
      recalcOpBudget: 90000000,
      totalFormulaCharsBudget: 33554432,
      recalcWallClockMs: 1800,
      clockCheckInterval: 1000000,
    });
  });
});

describe("false positive guard", () => {
  test("a realistic ~9k-cell workbook recalculates quickly and correctly", () => {
    // 3000 rows x (A number, B number, C=A*B) + a couple of aggregate formulas.
    const wb = createWorkbook({ rows: 3000, columns: 6 });
    const entries: Array<[string, string]> = [];
    for (let r = 1; r <= 3000; r++) {
      entries.push([`A${r}`, String(r)]);
      entries.push([`B${r}`, String(r * 2)]);
      entries.push([`C${r}`, `=A${r}*B${r}`]);
    }
    entries.push(["E1", "=SUM(C1:C3000)"]);
    entries.push(["E2", "=AVERAGE(A1:A3000)"]);
    entries.push(["E3", "=SUM(A1:A3000)+SUM(B1:B3000)"]);

    const { ms, error } = run(() => setCells(wb, entries));
    expect(error).toBeNull();
    expect(ms).toBeLessThan(FAST_MS);

    // Values are correct.
    expect(getCellValue(wb, "C10")).toBe(200); // 10 * 20
    expect(getCellValue(wb, "E2")).toBe(1500.5); // avg of 1..3000
    // sum of A (1..3000) + sum of B (2..6000 step 2) = 4501500 + 9003000
    expect(getCellValue(wb, "E3")).toBe(13504500);
  });
});
