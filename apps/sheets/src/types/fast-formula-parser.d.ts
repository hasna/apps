/**
 * Ambient type declarations for `fast-formula-parser` (MIT), which ships no
 * TypeScript types of its own. Only the subset of the API that @hasna/sheets
 * (and its `react-spreadsheet` peer) relies on is declared here.
 */
declare module "fast-formula-parser" {
  /** A 1-indexed cell reference (row/col start at 1, like Excel). */
  export interface CellRef {
    sheet?: string;
    row: number;
    col: number;
  }

  /** A 1-indexed range reference. */
  export interface RangeRef {
    sheet?: string;
    from: { row: number; col: number };
    to: { row: number; col: number };
  }

  /** Position of the formula being evaluated (1-indexed). */
  export interface Position {
    row: number;
    col: number;
    sheet?: string;
  }

  export interface FormulaParserConfig {
    onCell?: (ref: CellRef) => unknown;
    onRange?: (ref: RangeRef) => unknown[][];
    onVariable?: (name: string, sheet?: string) => unknown;
    functions?: Record<string, (...args: unknown[]) => unknown>;
    functionsNeedContext?: Record<string, (...args: unknown[]) => unknown>;
  }

  /** Error value returned when a formula cannot be evaluated (e.g. `#DIV/0!`). */
  export class FormulaError {
    constructor(error: string, message?: string);
    error: string;
    message: string;
    toString(): string;
    /** `#VALUE!` — the canonical result for oversized/invalid string output. */
    static VALUE: FormulaError;
    /** `#NUM!` — numeric overflow / out-of-range. */
    static NUM: FormulaError;
  }

  /** Numeric type tags accepted by {@link FormulaHelpers.accept}. */
  export interface FormulaTypes {
    NUMBER: number;
    ARRAY: number;
    BOOLEAN: number;
    STRING: number;
    RANGE_REF: number;
    CELL_REF: number;
    COLLECTIONS: number;
    NUMBER_NO_BOOLEAN: number;
  }

  /**
   * The singleton helper used by built-in functions to coerce raw argument
   * objects into concrete values. `accept(arg, Types.STRING/NUMBER)` returns a
   * coerced scalar or throws a {@link FormulaError}.
   */
  export interface FormulaHelpers {
    Types: FormulaTypes;
    accept(param: unknown, type?: number, defValue?: unknown, flat?: boolean, allowSingleValue?: boolean): unknown;
    flattenParams(
      params: unknown[],
      valueType: number | null,
      allowUnion: boolean,
      hook: (item: unknown, info: unknown) => void,
      defValue?: unknown,
      minSize?: number,
    ): void;
  }

  /** Extracts the dependencies (cell/range references) of a formula. */
  export class DepParser {
    constructor(config?: { onVariable?: (name: string, sheet?: string) => unknown });
    parse(formula: string, position: Position, ignoreError?: boolean): Array<CellRef | RangeRef>;
  }

  export default class FormulaParser {
    constructor(config?: FormulaParserConfig, isTest?: boolean);
    parse(formula: string, position: Position, allowReturnArray?: boolean): unknown;
    parseAsync(formula: string, position: Position, allowReturnArray?: boolean): Promise<unknown>;
    supportedFunctions(): string[];
    static MAX_ROW: number;
    static MAX_COLUMN: number;
    static DepParser: typeof DepParser;
    static FormulaError: typeof FormulaError;
    /** Coercion helper singleton (spread from `./formulas/helpers`). */
    static FormulaHelpers: FormulaHelpers;
    /** Type tag map (spread from `./formulas/helpers`). */
    static Types: FormulaTypes;
  }
}
