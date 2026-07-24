/**
 * Resource limits and the recalc work budget that make @hasna/sheets safe to
 * run against untrusted input (raw client workbooks, CSV imports, agent tool
 * calls). Every limit lives in {@link DEFAULT_LIMITS} and every new parameter
 * that threads a limit override is optional, so existing callers are unchanged.
 *
 * The two enforcement strategies are complementary:
 *
 *  - **Source caps** (formula length, cell content, sheet dimensions, populated
 *    cells, range size, batch size) reject oversized input *before* the
 *    expensive work runs. They are the only defense that can bound a single
 *    synchronous `parser.parse` call, which a JS counter cannot interrupt.
 *  - **The recalc budget** ({@link RecalcBudget}) is an integer op counter plus
 *    a wall-clock deadline threaded through the O(N^2) dependency loop and the
 *    per-cell evaluation loop. It is the catch-all for cost the source caps
 *    underprice (e.g. many cheap-looking formulas that together do too much
 *    work).
 */

/** Tunable resource limits. All values are inclusive maximums. */
export interface SheetsLimits {
  /** Max characters in a single formula body (after the leading `=`). */
  maxFormulaLength: number;
  /** Max characters any single cell value may hold. */
  maxCellContent: number;
  /** Max addressable rows a sheet may declare. */
  maxSheetRows: number;
  /** Max addressable columns a sheet may declare. */
  maxSheetColumns: number;
  /** Max populated (non-empty) cells across every sheet in the workbook. */
  maxPopulatedCells: number;
  /** Max cells a single range may materialize (read path and recalc eval). */
  maxRangeCells: number;
  /** Max cells a single {@link setCells}/CSV batch may write. */
  maxCellsPerWrite: number;
  /** Integer op budget for one recalc pass (dep comparisons + eval + cells). */
  recalcOpBudget: number;
  /** Total formula characters parsed in one recalc pass (parsed twice). */
  totalFormulaCharsBudget: number;
  /** Wall-clock deadline for one recalc pass, in milliseconds. */
  recalcWallClockMs: number;
  /** How many ops between wall-clock checks in the hot integer loops. */
  clockCheckInterval: number;
}

/**
 * Defaults anchored to Excel's real ceilings or set far above any realistic
 * in-app model, so a legitimate workbook never trips them.
 *
 * `maxRangeCells` is deliberately below Excel's 1,048,576 row ceiling: the MIT
 * `fast-formula-parser` evaluates a single range super-linearly (a 200k-cell
 * `SUM` costs ~66s in one synchronous, uninterruptible call, and the cost
 * climbs a sharp cliff past ~65k cells), so the per-range cap has to sit under
 * that cliff to be an effective single-call CPU bound. 65,536 keeps the
 * worst-case single-range evaluation well under a second while still sitting
 * roughly 100x above any realistic in-app range.
 *
 * `recalcWallClockMs` (1800) and `recalcOpBudget` (90M) bound the two residual
 * within-cap payloads the source caps underprice: an O(N^2) dependency graph
 * (thousands of `=SUM(A1:A20000)` cells) and a parse-aggregate flood (thousands
 * of ~8000-char `=1+1+...` bodies). Both trip in ~1.5-2s at these values
 * instead of blocking the event loop for ~10s. A realistic ~10k-cell workbook
 * recalculates in ~70ms, so 1800ms keeps a ~25x safety margin against false
 * positives; the op budget is scaled to the same time envelope.
 */
export const DEFAULT_LIMITS: SheetsLimits = {
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
};

/** Stable, dash-free machine codes for every limit breach. */
export type SheetsLimitCode =
  | "formula_too_long"
  | "cell_content_too_long"
  | "sheet_too_large"
  | "too_many_cells"
  | "range_too_large"
  | "batch_too_large"
  | "recalc_op_budget_exceeded"
  | "recalc_time_budget_exceeded"
  | "formula_parse_budget_exceeded";

/**
 * Thrown when input or a recalc pass exceeds a {@link SheetsLimits} value.
 * Consumers catch this via `instanceof SheetsLimitError` and map `code` to an
 * HTTP 4xx. `instanceof` survives transpilation via the explicit prototype fix.
 */
export class SheetsLimitError extends Error {
  readonly code: SheetsLimitCode;
  readonly limit: number;
  readonly actual?: number;

  constructor(code: SheetsLimitCode, message: string, limit: number, actual?: number) {
    super(message);
    this.name = "SheetsLimitError";
    this.code = code;
    this.limit = limit;
    this.actual = actual;
    Object.setPrototypeOf(this, SheetsLimitError.prototype);
  }
}

/** Optional per-call limit overrides, threaded through recalc/load/write. */
export interface LimitOptions {
  /** Overrides merged over {@link DEFAULT_LIMITS} for this operation. */
  limits?: Partial<SheetsLimits>;
}

/** Merge caller overrides over {@link DEFAULT_LIMITS}. */
export function resolveLimits(overrides?: Partial<SheetsLimits>): SheetsLimits {
  return overrides ? { ...DEFAULT_LIMITS, ...overrides } : DEFAULT_LIMITS;
}

/** Reject a formula body longer than {@link SheetsLimits.maxFormulaLength}. */
export function assertFormulaLength(body: string, limits: SheetsLimits): void {
  if (body.length > limits.maxFormulaLength) {
    throw new SheetsLimitError(
      "formula_too_long",
      `formula body exceeds the maximum length of ${limits.maxFormulaLength} characters`,
      limits.maxFormulaLength,
      body.length,
    );
  }
}

/** Reject a literal cell value longer than {@link SheetsLimits.maxCellContent}. */
export function assertCellContent(text: string, limits: SheetsLimits): void {
  if (text.length > limits.maxCellContent) {
    throw new SheetsLimitError(
      "cell_content_too_long",
      `cell content exceeds the maximum length of ${limits.maxCellContent} characters`,
      limits.maxCellContent,
      text.length,
    );
  }
}

/** Reject a sheet that declares more rows/columns than allowed. */
export function assertSheetDimensions(rows: number, columns: number, limits: SheetsLimits): void {
  if (rows > limits.maxSheetRows) {
    throw new SheetsLimitError(
      "sheet_too_large",
      `sheet row count exceeds the maximum of ${limits.maxSheetRows}`,
      limits.maxSheetRows,
      rows,
    );
  }
  if (columns > limits.maxSheetColumns) {
    throw new SheetsLimitError(
      "sheet_too_large",
      `sheet column count exceeds the maximum of ${limits.maxSheetColumns}`,
      limits.maxSheetColumns,
      columns,
    );
  }
}

/** Reject a workbook with more populated cells than allowed. */
export function assertPopulatedCells(count: number, limits: SheetsLimits): void {
  if (count > limits.maxPopulatedCells) {
    throw new SheetsLimitError(
      "too_many_cells",
      `workbook exceeds the maximum populated cell count of ${limits.maxPopulatedCells}`,
      limits.maxPopulatedCells,
      count,
    );
  }
}

/** Reject a single write batch larger than {@link SheetsLimits.maxCellsPerWrite}. */
export function assertBatchSize(count: number, limits: SheetsLimits): void {
  if (count > limits.maxCellsPerWrite) {
    throw new SheetsLimitError(
      "batch_too_large",
      `write batch exceeds the maximum of ${limits.maxCellsPerWrite} cells`,
      limits.maxCellsPerWrite,
      count,
    );
  }
}

/** Reject a range that would materialize more than {@link SheetsLimits.maxRangeCells}. */
export function assertRangeCells(count: number, limits: SheetsLimits): void {
  if (count > limits.maxRangeCells) {
    throw new SheetsLimitError(
      "range_too_large",
      `range materializes more than the maximum of ${limits.maxRangeCells} cells`,
      limits.maxRangeCells,
      count,
    );
  }
}

/**
 * A single mutable work budget for one {@link recalc} pass. Instantiated once
 * per call and threaded through the dependency and evaluation phases.
 */
export class RecalcBudget {
  ops = 0;
  opsSinceClock = 0;
  formulaChars = 0;
  readonly deadline: number;
  private readonly limits: SheetsLimits;

  constructor(limits: SheetsLimits) {
    this.limits = limits;
    this.deadline = Date.now() + limits.recalcWallClockMs;
  }

  /**
   * Charge `cost` cheap ops (dep comparisons, cell evaluations, materialized
   * range cells). Trips the integer op budget immediately and checks the
   * wall clock only every {@link SheetsLimits.clockCheckInterval} ops so the
   * `Date.now()` cost stays amortized in the tight loops.
   */
  charge(cost: number): void {
    this.ops += cost;
    if (this.ops > this.limits.recalcOpBudget) {
      throw new SheetsLimitError(
        "recalc_op_budget_exceeded",
        "recalc exceeded the operation budget",
        this.limits.recalcOpBudget,
        this.ops,
      );
    }
    this.opsSinceClock += cost;
    if (this.opsSinceClock >= this.limits.clockCheckInterval) {
      this.opsSinceClock = 0;
      if (Date.now() > this.deadline) {
        throw new SheetsLimitError(
          "recalc_time_budget_exceeded",
          "recalc exceeded the time budget",
          this.limits.recalcWallClockMs,
        );
      }
    }
  }

  /**
   * Charge one formula parse of `bodyLength` characters. Accumulates against
   * the total-formula-chars budget and checks the wall clock on *every* parse
   * (a parse dwarfs a `Date.now()` call), so a small cell count with expensive
   * parses is still time-bounded. Also charges one op.
   */
  chargeParse(bodyLength: number): void {
    this.formulaChars += bodyLength;
    if (this.formulaChars > this.limits.totalFormulaCharsBudget) {
      throw new SheetsLimitError(
        "formula_parse_budget_exceeded",
        "recalc exceeded the formula parse budget",
        this.limits.totalFormulaCharsBudget,
        this.formulaChars,
      );
    }
    if (Date.now() > this.deadline) {
      throw new SheetsLimitError(
        "recalc_time_budget_exceeded",
        "recalc exceeded the time budget",
        this.limits.recalcWallClockMs,
      );
    }
    this.charge(1);
  }
}
