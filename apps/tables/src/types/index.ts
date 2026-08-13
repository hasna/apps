/**
 * @hasna/tables — core data model types.
 *
 * A headless, framework-agnostic Airtable-like model:
 *   Base -> Tables -> Fields (typed columns) + Records (rows) + Views.
 *
 * These types are plain data (JSON-serializable) so the whole model can be
 * persisted, sent over the wire, or rendered by any UI (see `@hasna/tables/react`).
 */

/** Supported field (column) types. */
export type FieldType =
  | "text"
  | "number"
  | "singleSelect"
  | "multiSelect"
  | "date"
  | "checkbox"
  | "link"
  | "formula"
  | "lookup";

/** A choice for single/multi select fields. */
export interface SelectChoice {
  id: string;
  name: string;
  /** Optional UI color token (e.g. "blue", "#ff0"). Not interpreted by the core. */
  color?: string;
}

/** Formula/lookup result value primitive kinds. */
export type ValueType = "text" | "number" | "boolean" | "date";

/** Per-field-type configuration. All properties optional; only the relevant ones apply. */
export interface FieldOptions {
  /** number: digits after the decimal point when formatting. */
  precision?: number;
  /** number: render as currency/percent (UI hint only). */
  numberFormat?: "plain" | "currency" | "percent";
  /** single/multi select: available choices. */
  choices?: SelectChoice[];
  /** date: whether the value carries a time component. */
  includeTime?: boolean;
  /** link: the id of the table this field links to. */
  linkedTableId?: string;
  /** link: whether a cell can reference many records or exactly one. */
  relationship?: "oneToMany" | "manyToOne" | "manyToMany";
  /** formula: the expression source, e.g. "{Price} * {Qty}". */
  formula?: string;
  /** formula: declared result type (defaults to inferred). */
  resultType?: ValueType;
  /** lookup: the link field (on this table) to traverse. */
  linkFieldId?: string;
  /** lookup: the field id on the linked table to read. */
  foreignFieldId?: string;
}

/** A typed column definition. */
export interface Field {
  id: string;
  name: string;
  type: FieldType;
  options?: FieldOptions;
  /** Optional human description. */
  description?: string;
}

/**
 * A cell value. The concrete shape depends on the field type:
 *  - text/singleSelect/date  -> string | null
 *  - number                  -> number | null
 *  - checkbox                -> boolean
 *  - multiSelect             -> string[]
 *  - link                    -> string[] (linked record ids)
 *  - formula/lookup          -> computed, never stored
 */
export type CellValue =
  | string
  | number
  | boolean
  | string[]
  | null;

/** A single row. `fields` maps field id -> stored cell value. */
export interface RecordItem {
  id: string;
  fields: Record<string, CellValue>;
  createdTime: string;
  updatedTime: string;
}

/** Comparison operators available to view filters. */
export type FilterOperator =
  | "eq"
  | "neq"
  | "contains"
  | "notContains"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "isEmpty"
  | "isNotEmpty"
  | "isAnyOf"
  | "isNoneOf";

export interface FilterCondition {
  fieldId: string;
  operator: FilterOperator;
  /** Comparison operand; ignored for isEmpty/isNotEmpty. */
  value?: CellValue;
}

export type FilterConjunction = "and" | "or";

export interface SortSpec {
  fieldId: string;
  direction: "asc" | "desc";
}

/** A saved view: a filtered/sorted/grouped projection over a table's records. */
export interface View {
  id: string;
  name: string;
  type: "grid";
  filters: FilterCondition[];
  filterConjunction: FilterConjunction;
  sorts: SortSpec[];
  /** Optional field to group rows by. */
  groupByFieldId?: string;
  /** Explicit column order (field ids). Missing fields fall back to table order. */
  fieldOrder?: string[];
  /** Field ids hidden in this view. */
  hiddenFieldIds?: string[];
}

/** A table: fields (columns) + records (rows) + saved views. */
export interface Table {
  id: string;
  name: string;
  fields: Field[];
  records: RecordItem[];
  views: View[];
  /** The primary (first) field id — used as the record label. */
  primaryFieldId: string;
}

/** A base: a collection of related tables. */
export interface Base {
  id: string;
  name: string;
  tables: Table[];
}

/** A fully computed row: stored values plus resolved formula/lookup values. */
export type ComputedRecord = RecordItem & {
  computed: Record<string, CellValue>;
};

/** A grouped view result. */
export interface RecordGroup {
  /** The group key value (stringified for stable comparison). */
  key: string;
  /** The raw cell value the group was formed from. */
  value: CellValue;
  records: ComputedRecord[];
}
