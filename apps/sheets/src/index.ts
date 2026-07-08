/**
 * @hasna/sheets — headless spreadsheet SDK.
 *
 * A framework-agnostic workbook model with an MIT formula engine
 * (fast-formula-parser), dependency-graph recalculation, and CSV/XLSX/JSON
 * import-export. The React editor lives in the separate `@hasna/sheets/react`
 * entry point so this module stays dependency-light and server-safe.
 */

// Types
export type {
  AddSheetOptions,
  Cell,
  CellValue,
  Coord,
  CreateWorkbookOptions,
  Range,
  Sheet,
  Workbook,
  WorkbookDocument,
} from "./types/index.js";

// A1 notation
export {
  columnIndexToLabel,
  columnLabelToIndex,
  expandRange,
  isA1,
  normalizeRange,
  parseA1,
  parseRange,
  toA1,
  toRangeRef,
} from "./lib/a1.js";

// Recalc engine
export { isFormula, parseLiteral, recalc } from "./lib/recalc.js";

// Workbook operations
export {
  addSheet,
  clearCell,
  createWorkbook,
  getCell,
  getCellValue,
  getRangeValues,
  removeSheet,
  renameSheet,
  resolveSheet,
  setActiveSheet,
  setCell,
  setCells,
} from "./lib/workbook.js";

// Serialization
export {
  WORKBOOK_SCHEMA,
  WORKBOOK_VERSION,
  deserializeWorkbook,
  loadWorkbook,
  serializeWorkbook,
  toDocument,
  validateWorkbook,
} from "./lib/serialize.js";

// CSV
export { csvToWorkbook, importCsv, parseCsv, sheetToCsv, toCsv } from "./lib/csv.js";

// XLSX (optional exceljs)
export { workbookToXlsx, xlsxToWorkbook } from "./lib/xlsx.js";

// Version
export { VERSION } from "./version.js";
