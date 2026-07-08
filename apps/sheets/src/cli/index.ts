#!/usr/bin/env node
/**
 * `sheets` CLI — a headless demonstration of the @hasna/sheets SDK. Operates on
 * workbook JSON documents and CSV/XLSX files entirely server-side (no browser).
 */
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { Command } from "commander";
import {
  createWorkbook,
  csvToWorkbook,
  getCellValue,
  loadWorkbook,
  recalc,
  resolveSheet,
  serializeWorkbook,
  setCell,
  sheetToCsv,
  VERSION,
  workbookToXlsx,
  xlsxToWorkbook,
} from "../index.js";

async function emit(content: string, out: string | undefined): Promise<void> {
  if (out) {
    await writeFile(out, content);
    console.log(`Wrote ${out}`);
  } else {
    console.log(content);
  }
}

const program = new Command();
program
  .name("sheets")
  .description("Headless spreadsheet workbook toolkit (@hasna/sheets)")
  .version(VERSION);

program
  .command("new")
  .description("Create an empty workbook")
  .option("-o, --out <file>", "write to file instead of stdout")
  .option("--name <name>", "first sheet name")
  .action(async (opts: { out?: string; name?: string }) => {
    const workbook = createWorkbook({ sheetName: opts.name });
    await emit(serializeWorkbook(workbook, true), opts.out);
  });

program
  .command("info")
  .description("Summarize a workbook JSON document")
  .argument("<file>", "workbook JSON file")
  .action(async (file: string) => {
    const workbook = loadWorkbook(await readFile(file, "utf8"));
    console.log(`Workbook ${workbook.id} (${workbook.sheets.length} sheet(s))`);
    for (const sheet of workbook.sheets) {
      const count = Object.keys(sheet.cells).length;
      const active = sheet.id === workbook.activeSheetId ? " [active]" : "";
      console.log(`  - ${sheet.name}: ${sheet.rows}x${sheet.columns}, ${count} cell(s)${active}`);
    }
  });

program
  .command("get")
  .description("Read a cell's computed value")
  .argument("<file>", "workbook JSON file")
  .argument("<cell>", "A1 reference, e.g. B2")
  .option("--sheet <name>", "sheet id or name")
  .action(async (file: string, cell: string, opts: { sheet?: string }) => {
    const workbook = loadWorkbook(await readFile(file, "utf8"));
    const value = getCellValue(workbook, cell, opts.sheet);
    console.log(value === null ? "" : String(value));
  });

program
  .command("set")
  .description("Set a cell's raw input, recalc, and save")
  .argument("<file>", "workbook JSON file")
  .argument("<cell>", "A1 reference, e.g. B2")
  .argument("<value>", "literal or formula, e.g. =SUM(A1:A3)")
  .option("--sheet <name>", "sheet id or name")
  .option("-o, --out <file>", "output file (defaults to input)")
  .action(async (file: string, cell: string, value: string, opts: { sheet?: string; out?: string }) => {
    const workbook = loadWorkbook(await readFile(file, "utf8"));
    setCell(workbook, cell, value, { sheet: opts.sheet });
    await writeFile(opts.out ?? file, serializeWorkbook(workbook, true));
    console.log(`${cell} = ${String(getCellValue(workbook, cell, opts.sheet))}`);
  });

program
  .command("recalc")
  .description("Recalculate every formula and save")
  .argument("<file>", "workbook JSON file")
  .option("-o, --out <file>", "output file (defaults to input)")
  .action(async (file: string, opts: { out?: string }) => {
    const workbook = loadWorkbook(await readFile(file, "utf8"));
    recalc(workbook);
    await writeFile(opts.out ?? file, serializeWorkbook(workbook, true));
    console.log("Recalculated");
  });

program
  .command("import-csv")
  .description("Build a workbook from a CSV file")
  .argument("<file>", "CSV file")
  .option("-o, --out <file>", "workbook JSON output")
  .option("--name <name>", "sheet name")
  .action(async (file: string, opts: { out?: string; name?: string }) => {
    const workbook = csvToWorkbook(await readFile(file, "utf8"), { sheetName: opts.name });
    await emit(serializeWorkbook(workbook, true), opts.out);
  });

program
  .command("export-csv")
  .description("Export a sheet to CSV")
  .argument("<file>", "workbook JSON file")
  .option("--sheet <name>", "sheet id or name")
  .option("--raw", "export raw formulas instead of computed values")
  .option("-o, --out <file>", "CSV output")
  .action(async (file: string, opts: { sheet?: string; raw?: boolean; out?: string }) => {
    const workbook = loadWorkbook(await readFile(file, "utf8"));
    const sheet = resolveSheet(workbook, opts.sheet);
    await emit(sheetToCsv(sheet, { raw: Boolean(opts.raw) }), opts.out);
  });

program
  .command("import-xlsx")
  .description("Build a workbook from an .xlsx file (requires exceljs)")
  .argument("<file>", ".xlsx file")
  .option("-o, --out <file>", "workbook JSON output")
  .action(async (file: string, opts: { out?: string }) => {
    const bytes = new Uint8Array(await readFile(file));
    const workbook = await xlsxToWorkbook(bytes);
    await emit(serializeWorkbook(workbook, true), opts.out);
  });

program
  .command("export-xlsx")
  .description("Export a workbook to .xlsx (requires exceljs)")
  .argument("<file>", "workbook JSON file")
  .option("-o, --out <file>", ".xlsx output")
  .action(async (file: string, opts: { out?: string }) => {
    const workbook = loadWorkbook(await readFile(file, "utf8"));
    const bytes = await workbookToXlsx(workbook);
    const out = opts.out ?? `${file.replace(/\.json$/, "")}.xlsx`;
    await writeFile(out, bytes);
    console.log(`Wrote ${out}`);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
