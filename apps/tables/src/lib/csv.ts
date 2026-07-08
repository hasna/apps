import type { Base, Field, FieldType, Table } from "../types/index.js";
import { formatCell } from "./fields.js";
import { computeRecords } from "./compute.js";
import type { TablesBase } from "./base.js";

/** Parse CSV text into a matrix of string cells (RFC 4180: quotes, commas, newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      pushCell();
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  // trailing cell/row (unless the file ended with a newline and nothing pending)
  if (cell !== "" || row.length > 0) pushRow();
  return rows;
}

function escapeCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export interface ExportCsvOptions {
  /** Field ids to export (defaults to all fields, in table order). */
  fieldIds?: string[];
  /** Include computed formula/lookup fields (default true). */
  includeComputed?: boolean;
}

/** Export a table's records to CSV (computed values resolved). */
export function exportTableCsv(base: Base, table: Table, options: ExportCsvOptions = {}): string {
  const includeComputed = options.includeComputed ?? true;
  const fields = (options.fieldIds
    ? options.fieldIds.map((id) => table.fields.find((f) => f.id === id)).filter((f): f is Field => Boolean(f))
    : table.fields
  ).filter((f) => includeComputed || (f.type !== "formula" && f.type !== "lookup"));

  const computed = computeRecords(base, table);
  const lines: string[] = [];
  lines.push(fields.map((f) => escapeCsvCell(f.name)).join(","));
  for (const record of computed) {
    lines.push(
      fields
        .map((f) => escapeCsvCell(formatCell(f, record.computed[f.id] ?? null)))
        .join(","),
    );
  }
  return lines.join("\n");
}

function inferType(values: string[]): FieldType {
  const nonEmpty = values.filter((v) => v.trim() !== "");
  if (nonEmpty.length === 0) return "text";
  const allNumbers = nonEmpty.every((v) => v.trim() !== "" && !Number.isNaN(Number(v)));
  if (allNumbers) return "number";
  const boolSet = new Set(["true", "false", "yes", "no", "0", "1"]);
  const allBool = nonEmpty.every((v) => boolSet.has(v.trim().toLowerCase()));
  if (allBool) return "checkbox";
  return "text";
}

export interface ImportCsvOptions {
  tableName?: string;
  /** Infer number/checkbox column types (default true); otherwise all text. */
  inferTypes?: boolean;
}

/**
 * Import CSV text into a new table on the given base. The first row is treated
 * as the header. Returns the created table.
 */
export function importTableCsv(model: TablesBase, csvText: string, options: ImportCsvOptions = {}): Table {
  const matrix = parseCsv(csvText.trim());
  if (matrix.length === 0) throw new Error("CSV is empty");
  const header = matrix[0]!;
  const dataRows = matrix.slice(1);
  const inferTypes = options.inferTypes ?? true;

  const columnValues: string[][] = header.map((_, colIndex) =>
    dataRows.map((r) => r[colIndex] ?? ""),
  );

  const table = model.createTable({
    name: options.tableName ?? "Imported",
    fields: header.map((name, colIndex) => ({
      name: name.trim() === "" ? `Field ${colIndex + 1}` : name.trim(),
      type: inferTypes ? inferType(columnValues[colIndex] ?? []) : ("text" as FieldType),
    })),
  });

  for (const row of dataRows) {
    const input: Record<string, unknown> = {};
    table.fields.forEach((field, colIndex) => {
      input[field.id] = row[colIndex] ?? "";
    });
    model.createRecord(table.id, input);
  }
  return table;
}
