# @hasna/sheets — SDK reference

The `.` entry point is headless (no React, no DOM) and safe to run server-side.

## Data model

```ts
interface Workbook {
  id: string;
  sheets: Sheet[];
  activeSheetId: string;
  createdAt: string;
  updatedAt: string;
}

interface Sheet {
  id: string;
  name: string;          // unique; used in cross-sheet references
  rows: number;
  columns: number;
  cells: Record<string, Cell>; // keyed by uppercase A1, e.g. "A1"
}

interface Cell {
  raw: string;           // exactly what was typed; formulas start with "="
  value: number | string | boolean | null; // computed
  error?: string;        // "#DIV/0!", "#CIRCULAR!", "#ERROR!", ...
}
```

Cells are stored **sparsely**, keyed by A1 reference. Internally the model uses
0-indexed coordinates (`{ row, col }`, `A1 → { row: 0, col: 0 }`); the recalc
engine converts to the 1-indexed form `fast-formula-parser` expects.

## Workbook operations

| Function | Purpose |
| --- | --- |
| `createWorkbook(opts?)` | new workbook with one sheet |
| `loadWorkbook(json \| doc \| workbook)` | parse + validate + recalc |
| `addSheet(wb, opts?)` | append a sheet |
| `renameSheet(wb, ref, name)` | rename (recalcs) |
| `removeSheet(wb, ref)` | remove (keeps ≥1 sheet) |
| `setActiveSheet(wb, ref)` | change active sheet |
| `setCell(wb, a1, raw, opts?)` | write a cell, auto-grow, recalc |
| `setCells(wb, entries, sheet?)` | batch write, one recalc |
| `clearCell(wb, a1, sheet?)` | delete a cell |
| `getCell(wb, a1, sheet?)` | raw + value |
| `getCellValue(wb, a1, sheet?)` | computed value |
| `getRangeValues(wb, "A1:C3", sheet?)` | 2D value grid |

`ref`/`sheet` accept either a sheet id or a sheet name; omit to target the
active sheet.

## Recalc

`recalc(workbook)` re-derives every literal value, extracts each formula's
dependencies via `fast-formula-parser`'s `DepParser`, builds a cross-sheet
dependency graph, topologically orders it (Kahn), and evaluates to a stable
fixed point. Any cell that participates in a cycle is flagged `#CIRCULAR!`.
Running `recalc` twice yields identical values.

## Serialization

`serializeWorkbook(wb, pretty?)` produces a versioned document:

```json
{ "schema": "hasna.sheets.workbook", "version": 1, "workbook": { ... } }
```

`loadWorkbook` / `deserializeWorkbook` accept either that envelope or a bare
workbook object and always recalculate on load.

## CSV / XLSX

- `csvToWorkbook(text, opts?)` — each field becomes raw input, so `=A1+B1`
  imported from CSV is a live formula.
- `sheetToCsv(sheet, { raw? })` — computed values by default, formulas with
  `raw: true`.
- `xlsxToWorkbook(bytes)` / `workbookToXlsx(wb)` — async, lazy-load `exceljs`.
