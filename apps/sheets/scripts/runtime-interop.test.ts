import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const packageRoot = join(import.meta.dir, "..");
const root = mkdtempSync(join(tmpdir(), "sheets-runtime-interop-"));
const present = join(root, "with-exceljs");
const absent = join(root, "without-exceljs");
const env: Record<string, string> = {
  PATH: process.env.PATH ?? "",
  HOME: join(root, "home"), XDG_CONFIG_HOME: join(root, "config"),
  XDG_DATA_HOME: join(root, "data"), XDG_STATE_HOME: join(root, "state"),
  XDG_CACHE_HOME: join(root, "cache"), BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(root, "bun-cache"),
};

beforeAll(async () => {
  for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"]) mkdirSync(env[key]!);
  for (const cwd of [present, absent]) {
    mkdirSync(join(cwd, "node_modules"), { recursive: true });
    writeFileSync(join(cwd, "package.json"), '{"private":true,"type":"module"}');
    // Keep resolution isolated: the missing-peer control has no ExcelJS link.
    for (const name of ["fast-formula-parser", "nanoid", "commander", "react", "react-dom", "react-spreadsheet",
      ...(cwd === present ? ["exceljs"] : [])]) {
      symlinkSync(join(packageRoot, "node_modules", name), join(cwd, "node_modules", name), "dir");
    }
  }
  const built = await Bun.build({
    entrypoints: ["index.ts", "react.tsx", "cli/index.ts"].map((file) => join(packageRoot, "src", file)),
    root: join(packageRoot, "src"), outdir: join(present, "dist"), target: "bun", packages: "external",
  });
  if (!built.success) throw new Error(built.logs.join("\n"));
  mkdirSync(join(absent, "dist"));
  copyFileSync(join(present, "dist/index.js"), join(absent, "dist/index.js"));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

function run(executable: string, args: string[], cwd = present): string {
  const result = Bun.spawnSync([executable, ...args], { cwd, env, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`${executable} exited ${result.exitCode}: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

for (const [runtime, executable] of [["Node", "node"], ["pinned Bun", process.execPath]] as const) {
  const evaluate = (source: string, cwd = present) => run(executable,
    runtime === "Node" ? ["--input-type=module", "-e", source] : ["-e", source], cwd);

  describe(`${runtime} external optional-peer interop`, () => {
    test("actual ExcelJS preserves formulas and literals through XLSX", () => {
      expect(evaluate(`
        import assert from "node:assert/strict";
        import { createWorkbook, setCells, workbookToXlsx, xlsxToWorkbook, getCellValue } from "./dist/index.js";
        const workbook = createWorkbook({ sheetName: "Interop" });
        setCells(workbook, { A1: "2", A2: "3", A3: "=SUM(A1:A2)", B1: "hello" });
        const bytes = await workbookToXlsx(workbook);
        assert.ok(bytes.byteLength > 0);
        const loaded = await xlsxToWorkbook(bytes);
        assert.equal(loaded.sheets[0].name, "Interop");
        assert.equal(getCellValue(loaded, "A3"), 5);
        assert.equal(loaded.sheets[0].cells.A3.raw, "=SUM(A1:A2)");
        assert.equal(getCellValue(loaded, "B1"), "hello");
        console.log("xlsx preserved");
      `)).toBe("xlsx preserved");
    });

    test("actual React grid renders controlled model updates without mutating input", () => {
      expect(evaluate(`
        import assert from "node:assert/strict";
        import { createElement } from "react";
        import { renderToStaticMarkup } from "react-dom/server";
        import { createWorkbook, setCells, getCellValue, recalc } from "./dist/index.js";
        import { Spreadsheet, workbookSheetToMatrix, applyMatrixToSheet } from "./dist/react.js";
        const workbook = createWorkbook();
        setCells(workbook, { A1: "2", B1: "=A1*3", A50: "off-window" });
        const original = JSON.stringify(workbook);
        const render = (value) => renderToStaticMarkup(createElement(Spreadsheet, { workbook: value, rows: 2, columns: 2 }));
        assert.ok(render(workbook).includes("table"));
        const updated = structuredClone(workbook);
        const matrix = workbookSheetToMatrix(updated.sheets[0], 2, 2);
        matrix[0][0] = { value: "7" };
        applyMatrixToSheet(updated.sheets[0], matrix);
        recalc(updated);
        assert.equal(getCellValue(updated, "B1"), 21);
        assert.equal(getCellValue(updated, "A50"), "off-window");
        assert.ok(render(updated).includes("21"));
        assert.equal(JSON.stringify(workbook), original);
        console.log("react controlled model preserved");
      `)).toBe("react controlled model preserved");
    });

    test("bare CLI shape retains explicit XLSX file output and import", () => {
      const files = join(present, runtime === "Node" ? "node-files" : "bun-files");
      mkdirSync(files);
      const input = join(files, "book.json");
      const cli = (...args: string[]) => run(executable, [join(present, "dist/cli/index.js"), ...args]);
      cli("new", "--out", input);
      cli("set", input, "A1", "2");
      cli("set", input, "A2", "=A1*6");
      cli("export-xlsx", input);
      const loaded = JSON.parse(cli("import-xlsx", join(files, "book.xlsx")));
      expect(loaded.workbook.sheets[0].cells.A2.value).toBe(12);
      expect(readdirSync(files).sort()).toEqual(["book.json", "book.xlsx"]);
    });

    test("ExcelJS remains lazy and absent peers retain the actionable diagnostic", () => {
      expect(evaluate(`
        import assert from "node:assert/strict";
        import { createWorkbook, setCells, getCellValue, workbookToXlsx, xlsxToWorkbook } from "./dist/index.js";
        const workbook = createWorkbook();
        setCells(workbook, { A1: "2", A2: "=A1*6" });
        assert.equal(getCellValue(workbook, "A2"), 12);
        const missing = { message: "XLSX support requires the optional 'exceljs' dependency. Install it with: bun add exceljs" };
        await assert.rejects(workbookToXlsx(workbook), missing);
        await assert.rejects(xlsxToWorkbook(new Uint8Array()), missing);
        console.log("optional peer remains lazy");
      `, absent)).toBe("optional peer remains lazy");
      for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"]) {
        expect(readdirSync(env[key]!)).toEqual([]);
      }
    });
  });
}
