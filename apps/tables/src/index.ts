/**
 * @hasna/tables — headless, framework-agnostic Airtable-like data model.
 *
 * Bases -> tables -> typed fields -> records, with views (filter/sort/group),
 * formula + lookup fields, and CSV/JSON import-export. No UI, no I/O — safe to
 * run server-side. For a Glide-Data-Grid React component, import
 * `@hasna/tables/react`.
 */

// types
export type {
  Base,
  CellValue,
  ComputedRecord,
  Field,
  FieldOptions,
  FieldType,
  FilterCondition,
  FilterConjunction,
  FilterOperator,
  RecordGroup,
  RecordItem,
  SelectChoice,
  SortSpec,
  Table,
  ValueType,
  View,
} from "./types/index.js";

// core engine
export {
  TablesBase,
  createBase,
} from "./lib/base.js";
export type { FieldSpec, RecordInput, TableSpec, ViewSpec } from "./lib/base.js";

// field helpers
export {
  COMPUTED_FIELD_TYPES,
  coerceValue,
  emptyValue,
  formatCell,
  isComputedField,
  isEmptyValue,
  readCell,
} from "./lib/fields.js";

// compute (formula + lookup resolution)
export { computeRecord, computeRecords } from "./lib/compute.js";

// views
export {
  filterRecords,
  groupRecords,
  queryView,
  sortRecords,
  visibleFieldIds,
} from "./lib/views.js";
export type { ViewResult } from "./lib/views.js";

// filter / sort primitives
export { matchesCondition } from "./lib/filter.js";
export { compareValues } from "./lib/sort.js";

// formula engine
export {
  compileFormula,
  evaluateFormula,
  parseFormula,
  tokenize,
  FormulaError,
  toBoolean,
  toNumber,
  toText,
} from "./lib/formula/index.js";
export type { Ast, FieldResolver, FormulaValue, Token, TokenType } from "./lib/formula/index.js";

// csv
export {
  exportTableCsv,
  importTableCsv,
  parseCsv,
} from "./lib/csv.js";
export type { ExportCsvOptions, ImportCsvOptions } from "./lib/csv.js";

// serialization
export {
  deserializeBase,
  loadBase,
  serializeBase,
} from "./lib/serialize.js";

// ids
export { newId } from "./lib/ids.js";
export type { IdPrefix } from "./lib/ids.js";
