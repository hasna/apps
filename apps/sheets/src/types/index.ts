/**
 * Core data model for @hasna/sheets. Framework-agnostic and dependency-free
 * (no React, no DOM) so it can run server-side or in any runtime.
 */

/** The concrete value a cell resolves to after recalculation. */
export type CellValue = number | string | boolean | null;

/** A single spreadsheet cell. */
export interface Cell {
  /**
   * The raw input exactly as entered by the user. Formulas begin with `"="`
   * (e.g. `"=SUM(A1:A3)"`). Literals are stored as their typed string.
   */
  raw: string;
  /** The computed value after {@link recalc}. Non-formula cells hold their parsed literal. */
  value: CellValue;
  /** Error code when evaluation failed, e.g. `"#DIV/0!"` or `"#CIRCULAR!"`. */
  error?: string;
}

/** A single worksheet within a {@link Workbook}. */
export interface Sheet {
  /** Stable identifier, unique within the workbook. */
  id: string;
  /** Display name, unique within the workbook (used in cross-sheet refs). */
  name: string;
  /** Number of addressable rows. */
  rows: number;
  /** Number of addressable columns. */
  columns: number;
  /** Sparse cell storage keyed by uppercase A1 reference (e.g. `"A1"`). */
  cells: Record<string, Cell>;
}

/** A workbook: an ordered collection of {@link Sheet}s. */
export interface Workbook {
  /** Stable workbook identifier. */
  id: string;
  /** Ordered worksheets. Always at least one. */
  sheets: Sheet[];
  /** Id of the currently active sheet. */
  activeSheetId: string;
  /** ISO-8601 creation timestamp. */
  createdAt: string;
  /** ISO-8601 last-modified timestamp. */
  updatedAt: string;
}

/** A 0-indexed grid coordinate. Column 0 = "A"; row 0 = spreadsheet row 1. */
export interface Coord {
  row: number;
  col: number;
}

/** An inclusive rectangular range of coordinates. */
export interface Range {
  start: Coord;
  end: Coord;
}

/** Options for {@link createWorkbook}. */
export interface CreateWorkbookOptions {
  id?: string;
  sheetName?: string;
  rows?: number;
  columns?: number;
}

/** Options for {@link addSheet}. */
export interface AddSheetOptions {
  id?: string;
  name?: string;
  rows?: number;
  columns?: number;
  activate?: boolean;
}

/** The versioned on-disk / on-wire serialization envelope. */
export interface WorkbookDocument {
  schema: "hasna.sheets.workbook";
  version: 1;
  workbook: Workbook;
}
