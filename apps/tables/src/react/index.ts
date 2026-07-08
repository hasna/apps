/**
 * `@hasna/tables/react` — a Glide-Data-Grid-backed grid component for the
 * headless `@hasna/tables` data model.
 *
 * Peer deps (install alongside): react, react-dom, @glideapps/glide-data-grid.
 * Import Glide's CSS once in your app:
 *   import "@glideapps/glide-data-grid/dist/index.css";
 */
export { DataTable } from "./DataTable.js";
export type { DataTableProps } from "./DataTable.js";

// `Grid` is a convenience alias for `DataTable`.
export { DataTable as Grid } from "./DataTable.js";

export { fieldToColumn, fromGridCell, toGridCell } from "./cell-mapping.js";
