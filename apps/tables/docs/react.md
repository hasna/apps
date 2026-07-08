# React grid (`@hasna/tables/react`)

An editable, canvas-based grid built on
[Glide Data Grid](https://github.com/glideapps/glide-data-grid) (MIT).

## Setup

Install the peer dependencies:

```bash
bun add react react-dom @glideapps/glide-data-grid
```

Import Glide's stylesheet once, and add a portal element to your document root
(Glide renders overlay editors into `#portal`):

```tsx
import "@glideapps/glide-data-grid/dist/index.css";
```

```html
<div id="root"></div>
<div id="portal"></div>
```

## `<DataTable>`

```tsx
import { DataTable } from "@hasna/tables/react";

function Editor({ model }) {
  const [, force] = React.useReducer((n) => n + 1, 0);
  const table = model.listTables()[0];
  return (
    <DataTable
      model={model}
      tableId={table.id}
      viewId={table.views[0].id}     // optional: apply a view's filter/sort/group
      onChange={force}               // called after edits / row adds
      onAddField={() => openDialog()} // renders a "+" affordance in the header
      height={600}
      width="100%"
    />
  );
}
```

`Grid` is exported as an alias of `DataTable`.

### Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `model` | `TablesBase` | — | The in-memory base. |
| `tableId` | `string` | — | Table id or name. |
| `viewId` | `string?` | — | Apply a view (filter/sort/group + column visibility). |
| `onChange` | `(model) => void` | — | Fired after any mutation. |
| `onAddField` | `() => void` | — | Enables the header "+" add-column button. |
| `editable` | `boolean` | `true` | Inline cell editing. |
| `canAddRows` | `boolean` | `true` | Trailing "new record" row. |
| `height` / `width` | `number \| string` | `100%` | Grid size. |
| `gridProps` | `Partial<DataEditorProps>` | — | Escape hatch to Glide. |

### Behavior

- Typed cells: text/number/date/select → text & number cells; checkbox →
  boolean cell; multiSelect/link → bubble cells; formula/lookup → read-only.
- Edits are coerced back to the field's type and written to the model, then
  `onChange` fires so you can persist or re-render.
- Column resizing is tracked in component state.

For a full example, see [`../dashboard`](../dashboard).
