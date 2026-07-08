#!/usr/bin/env bun
/**
 * `tables` — a headless CLI for the @hasna/tables data model, backed by a local
 * JSON base file (~/.hasna/tables/<name>.json). Demonstrates that the SDK core
 * is fully usable server-side with no UI.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Command } from "commander";
import type { FieldType } from "../types/index.js";
import { formatCell } from "../lib/fields.js";
import { exportTableCsv, importTableCsv } from "../lib/csv.js";
import {
  baseExists,
  createBaseFile,
  loadBaseFile,
  resolveBasePath,
  saveBaseFile,
} from "./store.js";

const FIELD_TYPES: FieldType[] = [
  "text",
  "number",
  "singleSelect",
  "multiSelect",
  "date",
  "checkbox",
  "link",
  "formula",
  "lookup",
];

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function parsePairs(pairs: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq === -1) throw new Error(`Invalid --set "${pair}" (expected key=value)`);
    out[pair.slice(0, eq).trim()] = pair.slice(eq + 1);
  }
  return out;
}

function printTable(rows: string[][]): void {
  if (rows.length === 0) return;
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  for (const row of rows) {
    console.log(row.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join("  "));
  }
}

const program = new Command();
program
  .name("tables")
  .description("Headless Airtable-like data tables — bases, fields, records, views")
  .version("0.1.0");

program
  .command("init")
  .argument("<base>", "base name or path")
  .option("-t, --title <title>", "human-readable base title")
  .description("create a new empty base")
  .action((base: string, opts: { title?: string }) => {
    if (baseExists(base)) throw new Error(`Base already exists at ${resolveBasePath(base)}`);
    const { path } = createBaseFile(base, opts.title ?? base);
    console.log(`Created base at ${path}`);
  });

const table = program.command("table").description("manage tables");
table
  .command("add")
  .argument("<base>")
  .argument("<name>", "table name")
  .description("add a table (with a primary Name field)")
  .action((base: string, name: string) => {
    const model = loadBaseFile(base);
    const t = model.createTable({ name });
    saveBaseFile(base, model);
    console.log(`Added table "${name}" (${t.id})`);
  });

table
  .command("list")
  .argument("<base>")
  .description("list tables in a base")
  .action((base: string) => {
    const model = loadBaseFile(base);
    printTable([["ID", "NAME", "FIELDS", "RECORDS"], ...model.listTables().map((t) => [
      t.id,
      t.name,
      String(t.fields.length),
      String(t.records.length),
    ])]);
  });

const field = program.command("field").description("manage fields");
field
  .command("add")
  .argument("<base>")
  .argument("<table>")
  .argument("<name>", "field name")
  .argument("<type>", `field type (${FIELD_TYPES.join("|")})`)
  .option("-f, --formula <expr>", "formula expression (for type=formula)")
  .description("add a field/column to a table")
  .action((base: string, tableRef: string, name: string, type: string, opts: { formula?: string }) => {
    if (!FIELD_TYPES.includes(type as FieldType)) {
      throw new Error(`Unknown field type "${type}". One of: ${FIELD_TYPES.join(", ")}`);
    }
    const model = loadBaseFile(base);
    const f = model.addField(tableRef, {
      name,
      type: type as FieldType,
      options: opts.formula ? { formula: opts.formula } : undefined,
    });
    saveBaseFile(base, model);
    console.log(`Added field "${name}" (${f.type}, ${f.id})`);
  });

const record = program.command("record").description("manage records");
record
  .command("add")
  .argument("<base>")
  .argument("<table>")
  .option("-s, --set <pair>", "field=value (repeatable)", collect, [])
  .description("add a record")
  .action((base: string, tableRef: string, opts: { set: string[] }) => {
    const model = loadBaseFile(base);
    const rec = model.createRecord(tableRef, parsePairs(opts.set));
    saveBaseFile(base, model);
    console.log(`Added record ${rec.id}`);
  });

program
  .command("view")
  .argument("<base>")
  .argument("<table>")
  .argument("[view]", "view name or id (defaults to the first grid view)")
  .description("print a table's records through a view (computed)")
  .action((base: string, tableRef: string, viewRef: string | undefined) => {
    const model = loadBaseFile(base);
    const t = model.getTable(tableRef);
    const view = viewRef ? model.getView(tableRef, viewRef) : t.views[0];
    if (!view) throw new Error("No view found");
    const result = model.queryView(tableRef, view.id);
    const header = t.fields.map((f) => f.name);
    const rows = result.records.map((r) => t.fields.map((f) => formatCell(f, r.computed[f.id] ?? null)));
    printTable([header, ...rows]);
    console.log(`\n${result.records.length} record(s)`);
  });

program
  .command("import")
  .argument("<base>")
  .argument("<csv>", "path to a CSV file")
  .option("-n, --name <name>", "name for the created table")
  .description("import a CSV file into a new table")
  .action((base: string, csvPath: string, opts: { name?: string }) => {
    const model = loadBaseFile(base);
    const csv = readFileSync(csvPath, "utf8");
    const t = importTableCsv(model, csv, { tableName: opts.name });
    saveBaseFile(base, model);
    console.log(`Imported ${t.records.length} record(s) into table "${t.name}" (${t.id})`);
  });

program
  .command("export")
  .argument("<base>")
  .argument("<table>")
  .option("-o, --out <file>", "write CSV to a file instead of stdout")
  .description("export a table to CSV")
  .action((base: string, tableRef: string, opts: { out?: string }) => {
    const model = loadBaseFile(base);
    const csv = exportTableCsv(model.data, model.getTable(tableRef));
    if (opts.out) {
      writeFileSync(opts.out, csv);
      console.log(`Wrote ${opts.out}`);
    } else {
      console.log(csv);
    }
  });

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

void main();
