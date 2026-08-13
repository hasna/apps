# Data model

`@hasna/tables` mirrors Airtable's mental model with plain, JSON-serializable
objects.

```
Base
└── Table[]
    ├── Field[]     (typed columns)
    ├── RecordItem[] (rows: { [fieldId]: CellValue })
    └── View[]       (saved filter/sort/group projections)
```

Everything lives in a single `Base` object. Wrap it in the `TablesBase`
controller for ergonomic CRUD, or manipulate the plain data directly.

## Fields

A `Field` has an `id`, `name`, `type`, and optional per-type `options`.

| Type | Stored value | Notes |
| --- | --- | --- |
| `text` | `string \| null` | |
| `number` | `number \| null` | `options.precision`, `options.numberFormat` |
| `singleSelect` | `string \| null` | `options.choices` |
| `multiSelect` | `string[]` | `options.choices` |
| `date` | `string \| null` (ISO) | `options.includeTime` |
| `checkbox` | `boolean` | |
| `link` | `string[]` (record ids) | `options.linkedTableId`, `options.relationship` |
| `formula` | *computed* | `options.formula` |
| `lookup` | *computed* | `options.linkFieldId`, `options.foreignFieldId` |

`formula` and `lookup` are **computed** — they are never stored on a record.
Read them via `computeRecord()` / `computeRecords()` / `queryView()`, which
return a `ComputedRecord` carrying a `computed` map keyed by field id.

## Records

Records store values keyed by **field id**. `TablesBase` accepts input keyed by
either field id or field name and coerces values to the field's type:

```ts
base.createRecord("Deals", { Company: "Acme", Amount: "5000" }); // "5000" -> 5000
```

## Views

A `View` is a named, non-destructive projection:

```ts
base.createView("Deals", {
  name: "Hot",
  filters: [{ fieldId, operator: "gte", value: 1000 }],
  filterConjunction: "and",       // or "or"
  sorts: [{ fieldId, direction: "desc" }],
  groupByFieldId,                 // optional
  hiddenFieldIds: [],             // optional
  fieldOrder: [],                 // optional
});

const { records, groups } = base.queryView("Deals", "Hot");
```

Filter operators: `eq` `neq` `contains` `notContains` `gt` `gte` `lt` `lte`
`isEmpty` `isNotEmpty` `isAnyOf` `isNoneOf`. Filters, sorts, and grouping all
operate on **computed** values, so you can filter and sort by formula/lookup
fields too.

## Serialization

```ts
import { serializeBase, loadBase } from "@hasna/tables";

const json = serializeBase(base, true); // pretty JSON string
const restored = loadBase(json);        // -> TablesBase
```
