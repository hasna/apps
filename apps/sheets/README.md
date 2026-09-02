# @hasna/sheets

[![npm](https://img.shields.io/npm/v/@hasna/sheets.svg)](https://www.npmjs.com/package/@hasna/sheets)
[![license](https://img.shields.io/npm/l/@hasna/sheets.svg)](./LICENSE)

A **headless spreadsheet SDK** for Hasna-coded apps. It gives you a
framework-agnostic workbook model, a real formula engine with dependency-graph
recalculation, and CSV / XLSX / JSON import-export — all MIT-licensed. A
`react-spreadsheet`-backed `<Spreadsheet>` editor is shipped separately from the
`@hasna/sheets/react` entry point so the core stays dependency-light and
server-safe.

The formula engine is built entirely on
[`fast-formula-parser`](https://www.npmjs.com/package/fast-formula-parser) (MIT).
**HyperFormula (GPL-3.0) is deliberately not used.**

## Install

```bash
bun install -g @hasna/sheets   # CLI
# or as a library
bun add @hasna/sheets
```

The React editor needs the peer deps `react`, `react-dom`, and
`react-spreadsheet`; XLSX import/export needs the optional `exceljs`.

Installing the library creates no implicit home or XDG directory. The SDK works
in memory and the CLI reads/writes caller-selected files or stdout. The separate
browser demo retains its localStorage workbook persistence.

## SDK (headless, `.`)

```ts
import {
  createWorkbook,
  setCell,
  setCells,
  getCellValue,
  serializeWorkbook,
} from "@hasna/sheets";

const wb = createWorkbook({ sheetName: "Revenue" });

setCells(wb, {
  A1: "120",
  A2: "150",
  A3: "=SUM(A1:A2)",   // → 270
  B1: "=A3*1.2",       // → 324
});

getCellValue(wb, "A3"); // 270
setCell(wb, "A1", "200"); // recalcs the whole dependency graph
getCellValue(wb, "A3"); // 350

const json = serializeWorkbook(wb, true); // versioned document
```

Highlights:

- **A1 addressing** — `parseA1`, `toA1`, `parseRange`, `columnIndexToLabel`, …
- **Workbook ops** — `createWorkbook`, `loadWorkbook`, `addSheet`,
  `renameSheet`, `removeSheet`, `setCell`, `setCells`, `getRangeValues`.
- **Recalc engine** — `recalc(workbook)` builds a cross-sheet dependency graph,
  evaluates in topological order to a stable fixed point, flags circular
  references as `#CIRCULAR!`, and surfaces `#DIV/0!` and friends.
- **Serialization** — `serializeWorkbook` / `loadWorkbook` with structural
  validation; loading always recalculates so stored values can never drift.
- **CSV** — `csvToWorkbook`, `sheetToCsv`, `parseCsv`, `toCsv`.
- **XLSX (optional)** — `xlsxToWorkbook`, `workbookToXlsx` (lazy-loads
  `exceljs`).

## React editor (`./react`)

```tsx
import { useState } from "react";
import { Spreadsheet } from "@hasna/sheets/react";
import { createWorkbook, setCells, type Workbook } from "@hasna/sheets";

function Demo() {
  const [wb, setWb] = useState<Workbook>(() => {
    const w = createWorkbook();
    setCells(w, { A1: "1", A2: "2", A3: "=A1+A2" });
    return w;
  });

  return <Spreadsheet workbook={wb} onWorkbookChange={setWb} />;
}
```

`<Spreadsheet>` renders the given sheet with live formula results and writes
every edit back into a recalculated copy of the model via `onWorkbookChange`.

## CLI

```bash
sheets new -o book.json
sheets set book.json A1 5
sheets set book.json A2 "=A1*10"
sheets get book.json A2            # 50
sheets import-csv data.csv -o book.json
sheets export-csv book.json        # computed values (add --raw for formulas)
sheets export-xlsx book.json -o book.xlsx   # requires exceljs
sheets info book.json
```

## Formula support

Formulas are evaluated by `fast-formula-parser`, which implements ~280 Excel
functions (`SUM`, `AVERAGE`, `COUNT`, `IF`, `ROUND`, `PRODUCT`, `POWER`,
`SUMIF`, `VLOOKUP`, text/date functions, …), cross-sheet references
(`=Data!A1`), ranges, and full-column refs.

> **Known engine limitation:** `fast-formula-parser@1.0.19` does **not**
> implement `MAX` / `MIN`. Use `AVERAGE`, `PRODUCT`, `SUMIF`, etc.; an
> unsupported function evaluates to `#ERROR!`.

## Dashboard

`dashboard/` is a Vite + React + Tailwind SPA that demonstrates the SDK: open a
workbook, edit cells, type formulas with live recalc, add/rename sheets, and
import a CSV. Build it with `bun run build:dashboard`; the output ships in
`dashboard/dist`.

## Development

Release artifact checks require npm >=11 on PATH (verified with 11.19.0), because
older npm can run `prepare` despite `--ignore-scripts`. The prepack build is
followed by a scan of one actual npm archive in a private temporary directory;
inherited dry-run settings cannot turn the scan into a missing-file success.
Build the dashboard with `build:all` before packaging its advertised assets.

```bash
bun install
bun test          # unit tests for the SDK core
bun run typecheck # tsc --noEmit
bun run build     # SDK: lib + react + cli + .d.ts
bun run build:all # + dashboard
```

## License

MIT © Hasna. Bundles no GPL code: the formula engine is `fast-formula-parser`
(MIT), the grid is `react-spreadsheet` (MIT), and XLSX support is `exceljs`
(MIT, optional).
