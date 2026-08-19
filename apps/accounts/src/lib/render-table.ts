// b27cc4a0: the accounts display surface renders as a clean aligned TABLE in
// text mode. Package-local column renderer — no new dependency exists today
// (no console.table in src/, no table lib in package.json) and none is added.
//
// Plain text by design: cells are padded to the widest value in their column
// (header included) and joined with two spaces, with a dashed separator row
// under the header. No ANSI colors inside cells, so the output is greppable
// and golden-testable.

export interface TableColumn<T> {
  header: string;
  cell: (row: T) => string;
}

/** Render rows as a plain-text aligned table (header + separator + rows). */
export function renderTable<T>(rows: readonly T[], columns: readonly TableColumn<T>[]): string {
  const widths = columns.map((col) =>
    Math.max(col.header.length, ...rows.map((row) => col.cell(row).length)),
  );
  // The last column is never padded, so lines carry no trailing whitespace.
  const pad = (cells: readonly string[]) =>
    cells.map((cell, i) => (i === cells.length - 1 ? cell : cell.padEnd(widths[i]!))).join("  ");
  const lines: string[] = [pad(columns.map((col) => col.header))];
  lines.push(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows) lines.push(pad(columns.map((col) => col.cell(row))));
  return lines.join("\n");
}
