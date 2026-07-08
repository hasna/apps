import type {
  Base,
  CellValue,
  ComputedRecord,
  Field,
  FieldType,
  RecordItem,
  Table,
  View,
} from "../types/index.js";
import { coerceValue, isComputedField } from "./fields.js";
import { newId } from "./ids.js";
import { computeRecord, computeRecords } from "./compute.js";
import { queryView, type ViewResult } from "./views.js";

export interface FieldSpec {
  name: string;
  type: FieldType;
  options?: Field["options"];
  description?: string;
}

export interface TableSpec {
  name: string;
  /** Optional initial fields; if omitted a primary "Name" text field is created. */
  fields?: FieldSpec[];
}

export interface ViewSpec {
  name: string;
  type?: "grid";
  filters?: View["filters"];
  filterConjunction?: View["filterConjunction"];
  sorts?: View["sorts"];
  groupByFieldId?: string;
  fieldOrder?: string[];
  hiddenFieldIds?: string[];
}

/** Record input keyed by field id OR field name. */
export type RecordInput = Record<string, unknown>;

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * A mutable, in-memory Airtable-like base. All state lives in `.data`, a plain
 * JSON-serializable object you can persist with `toJSON()` / restore with `fromJSON()`.
 */
export class TablesBase {
  private base: Base;

  constructor(data?: Partial<Base> & { name?: string }) {
    this.base = {
      id: data?.id ?? newId("bas"),
      name: data?.name ?? "Untitled Base",
      tables: data?.tables ?? [],
    };
  }

  get data(): Base {
    return this.base;
  }

  get id(): string {
    return this.base.id;
  }

  get name(): string {
    return this.base.name;
  }

  rename(name: string): void {
    this.base.name = name;
  }

  // ---- tables ---------------------------------------------------------------

  listTables(): Table[] {
    return this.base.tables;
  }

  createTable(spec: TableSpec): Table {
    const fields: Field[] = [];
    const specs = spec.fields && spec.fields.length > 0
      ? spec.fields
      : [{ name: "Name", type: "text" as FieldType }];
    for (const fieldSpec of specs) {
      fields.push(makeField(fieldSpec));
    }
    const primaryFieldId = fields[0]!.id;
    const table: Table = {
      id: newId("tbl"),
      name: spec.name,
      fields,
      records: [],
      views: [defaultView()],
      primaryFieldId,
    };
    this.base.tables.push(table);
    return table;
  }

  getTable(idOrName: string): Table {
    const table = this.findTable(idOrName);
    if (!table) throw new Error(`Table not found: ${idOrName}`);
    return table;
  }

  findTable(idOrName: string): Table | undefined {
    return (
      this.base.tables.find((t) => t.id === idOrName) ??
      this.base.tables.find((t) => t.name === idOrName)
    );
  }

  deleteTable(idOrName: string): void {
    const table = this.getTable(idOrName);
    this.base.tables = this.base.tables.filter((t) => t.id !== table.id);
  }

  renameTable(idOrName: string, name: string): Table {
    const table = this.getTable(idOrName);
    table.name = name;
    return table;
  }

  // ---- fields ---------------------------------------------------------------

  addField(tableIdOrName: string, spec: FieldSpec): Field {
    const table = this.getTable(tableIdOrName);
    const field = makeField(spec);
    table.fields.push(field);
    return field;
  }

  updateField(tableIdOrName: string, fieldId: string, patch: Partial<FieldSpec>): Field {
    const table = this.getTable(tableIdOrName);
    const field = table.fields.find((f) => f.id === fieldId);
    if (!field) throw new Error(`Field not found: ${fieldId}`);
    if (patch.name !== undefined) field.name = patch.name;
    if (patch.type !== undefined) field.type = patch.type;
    if (patch.options !== undefined) field.options = patch.options;
    if (patch.description !== undefined) field.description = patch.description;
    return field;
  }

  deleteField(tableIdOrName: string, fieldId: string): void {
    const table = this.getTable(tableIdOrName);
    if (fieldId === table.primaryFieldId) {
      throw new Error("Cannot delete the primary field");
    }
    table.fields = table.fields.filter((f) => f.id !== fieldId);
    for (const record of table.records) {
      delete record.fields[fieldId];
    }
  }

  // ---- records --------------------------------------------------------------

  createRecord(tableIdOrName: string, input: RecordInput = {}): RecordItem {
    const table = this.getTable(tableIdOrName);
    const fields = this.resolveInput(table, input);
    const now = nowIso();
    const record: RecordItem = {
      id: newId("rec"),
      fields,
      createdTime: now,
      updatedTime: now,
    };
    table.records.push(record);
    return record;
  }

  updateRecord(tableIdOrName: string, recordId: string, input: RecordInput): RecordItem {
    const table = this.getTable(tableIdOrName);
    const record = table.records.find((r) => r.id === recordId);
    if (!record) throw new Error(`Record not found: ${recordId}`);
    const patch = this.resolveInput(table, input);
    record.fields = { ...record.fields, ...patch };
    record.updatedTime = nowIso();
    return record;
  }

  getRecord(tableIdOrName: string, recordId: string): RecordItem {
    const table = this.getTable(tableIdOrName);
    const record = table.records.find((r) => r.id === recordId);
    if (!record) throw new Error(`Record not found: ${recordId}`);
    return record;
  }

  deleteRecord(tableIdOrName: string, recordId: string): void {
    const table = this.getTable(tableIdOrName);
    table.records = table.records.filter((r) => r.id !== recordId);
  }

  listRecords(tableIdOrName: string): RecordItem[] {
    return this.getTable(tableIdOrName).records;
  }

  /** Compute all records (formula + lookup resolved) for a table. */
  computeRecords(tableIdOrName: string): ComputedRecord[] {
    const table = this.getTable(tableIdOrName);
    return computeRecords(this.base, table);
  }

  computeRecord(tableIdOrName: string, recordId: string): ComputedRecord {
    const table = this.getTable(tableIdOrName);
    return computeRecord(this.base, table, this.getRecord(tableIdOrName, recordId));
  }

  // ---- views ----------------------------------------------------------------

  createView(tableIdOrName: string, spec: ViewSpec): View {
    const table = this.getTable(tableIdOrName);
    const view: View = {
      id: newId("viw"),
      name: spec.name,
      type: spec.type ?? "grid",
      filters: spec.filters ?? [],
      filterConjunction: spec.filterConjunction ?? "and",
      sorts: spec.sorts ?? [],
      groupByFieldId: spec.groupByFieldId,
      fieldOrder: spec.fieldOrder,
      hiddenFieldIds: spec.hiddenFieldIds,
    };
    table.views.push(view);
    return view;
  }

  updateView(tableIdOrName: string, viewId: string, patch: Partial<ViewSpec>): View {
    const table = this.getTable(tableIdOrName);
    const view = table.views.find((v) => v.id === viewId);
    if (!view) throw new Error(`View not found: ${viewId}`);
    Object.assign(view, patch);
    return view;
  }

  deleteView(tableIdOrName: string, viewId: string): void {
    const table = this.getTable(tableIdOrName);
    table.views = table.views.filter((v) => v.id !== viewId);
  }

  getView(tableIdOrName: string, viewIdOrName: string): View {
    const table = this.getTable(tableIdOrName);
    const view =
      table.views.find((v) => v.id === viewIdOrName) ??
      table.views.find((v) => v.name === viewIdOrName);
    if (!view) throw new Error(`View not found: ${viewIdOrName}`);
    return view;
  }

  queryView(tableIdOrName: string, viewIdOrName: string): ViewResult {
    const table = this.getTable(tableIdOrName);
    return queryView(this.base, table, this.getView(tableIdOrName, viewIdOrName));
  }

  // ---- serialization --------------------------------------------------------

  toJSON(): Base {
    return this.base;
  }

  clone(): TablesBase {
    return new TablesBase(structuredClone(this.base));
  }

  static fromJSON(data: Base): TablesBase {
    return new TablesBase(structuredClone(data));
  }

  // ---- internals ------------------------------------------------------------

  private resolveInput(table: Table, input: RecordInput): Record<string, CellValue> {
    const out: Record<string, CellValue> = {};
    for (const [key, raw] of Object.entries(input)) {
      const field =
        table.fields.find((f) => f.id === key) ??
        table.fields.find((f) => f.name === key);
      if (!field) throw new Error(`Unknown field "${key}" on table "${table.name}"`);
      if (isComputedField(field)) continue; // computed fields are never stored
      out[field.id] = coerceValue(field, raw);
    }
    return out;
  }
}

function makeField(spec: FieldSpec): Field {
  return {
    id: newId("fld"),
    name: spec.name,
    type: spec.type,
    options: spec.options,
    description: spec.description,
  };
}

function defaultView(): View {
  return {
    id: newId("viw"),
    name: "Grid view",
    type: "grid",
    filters: [],
    filterConjunction: "and",
    sorts: [],
  };
}

/** Create a fresh empty base. */
export function createBase(name: string): TablesBase {
  return new TablesBase({ name });
}
