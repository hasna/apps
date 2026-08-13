# @hasna/tables

[![npm](https://img.shields.io/npm/v/@hasna/tables.svg)](https://www.npmjs.com/package/@hasna/tables)
[![license](https://img.shields.io/npm/l/@hasna/tables.svg)](./LICENSE)

Headless, framework-agnostic **Airtable-like data tables** for TypeScript.

Model your data as **bases → tables → typed fields → records**, run **views**
(filter / sort / group), compute **formula** and **lookup** fields, and
**import/export** CSV and JSON — all with zero UI dependencies so it runs
happily server-side. When you want a grid, the optional `@hasna/tables/react`
export ships a [Glide Data Grid](https://github.com/glideapps/glide-data-grid)
(MIT) backed `<DataTable>` component.

## Install

```bash
bun install -g @hasna/tables   # for the `tables` CLI
# or, as a library
bun add @hasna/tables
```

The React component needs three peer deps in your app:

```bash
bun add react react-dom @glideapps/glide-data-grid
```

## Surfaces

| Import | What you get |
| --- | --- |
| `@hasna/tables` | Headless SDK — the `TablesBase` engine, field/record/view model, formula + lookup engine, CSV/JSON codecs. No React, safe server-side. |
| `@hasna/tables/react` | `<DataTable>` / `<Grid>` — an editable Glide-Data-Grid component over a `TablesBase`. |
| `tables` (CLI) | A headless CLI backed by local JSON base files under `~/.hasna/tables`. |

## Quick start (SDK)

```ts
import { createBase } from "@hasna/tables";

const base = createBase("CRM");

base.createTable({
  name: "Deals",
  fields: [
    { name: "Company", type: "text" },
    { name: "Amount", type: "number" },
    { name: "Stage", type: "singleSelect",
      options: { choices: [{ id: "s1", name: "Lead" }, { id: "s2", name: "Won" }] } },
    { name: "Commission", type: "formula", options: { formula: "{Amount} * 0.1" } },
  ],
});

base.createRecord("Deals", { Company: "Acme", Amount: 5000, Stage: "Won" });

// A filtered + sorted view
const view = base.createView("Deals", {
  name: "Big wins",
  filters: [{ fieldId: base.getTable("Deals").fields[1]!.id, operator: "gte", value: 1000 }],
  sorts: [{ fieldId: base.getTable("Deals").fields[1]!.id, direction: "desc" }],
});

const { records } = base.queryView("Deals", view.id);
records[0]!.computed; // includes the resolved `Commission` formula value
```

## Field types

`text` · `number` · `singleSelect` · `multiSelect` · `date` · `checkbox` ·
`link` (reference records in another table) · `formula` (computed expression) ·
`lookup` (pull a field through a `link`).

## Formula engine

A dependency-free expression engine with field references (`{Field Name}`),
arithmetic, comparison, string concatenation (`&`), and functions:

```
SUM AVERAGE MIN MAX ROUND ABS CEILING FLOOR MOD POWER SQRT VALUE
CONCAT UPPER LOWER TRIM LEN LEFT RIGHT MID REPT SUBSTITUTE T
IF AND OR NOT ISBLANK BLANK  TODAY NOW
```

```ts
import { evaluateFormula } from "@hasna/tables";
evaluateFormula("IF({Qty} > 10, 'bulk', 'retail')", (name) => (name === "Qty" ? 12 : null));
// => "bulk"
```

## React grid

```tsx
import { DataTable } from "@hasna/tables/react";
import "@glideapps/glide-data-grid/dist/index.css"; // once, in your app

<DataTable model={base} tableId="Deals" viewId={view.id} onChange={rerender} />;
```

Render a `<div id="portal" />` at the document root so Glide's overlay editors
have somewhere to mount. See [`docs/react.md`](./docs/react.md).

## CLI

```bash
tables init crm --title "CRM"
tables import crm deals.csv --name Deals
tables field add crm Deals Commission formula --formula "{Amount} * 0.1"
tables record add crm Deals --set "Company=Acme" --set "Amount=5000"
tables view crm Deals          # prints computed records
tables export crm Deals        # CSV to stdout
```

## Dashboard demo

`dashboard/` is a Vite + React + Tailwind SPA showing an Airtable-style grid —
add/edit typed columns, inline-add rows, filter + sort a view, and switch
between views.

```bash
bun run build            # build the library (the dashboard consumes ../dist)
bun run dev:dashboard    # http://localhost:5173
```

## Docs

- [`docs/data-model.md`](./docs/data-model.md) — bases, fields, records, views
- [`docs/formulas.md`](./docs/formulas.md) — the formula language + functions
- [`docs/react.md`](./docs/react.md) — the `<DataTable>` component

## Development

```bash
bun install
bun run typecheck
bun test
bun run build
```

## License

MIT © hasna
