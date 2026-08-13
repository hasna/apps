/**
 * A1-notation helpers. All coordinates produced/consumed here are 0-indexed
 * (column 0 = "A", row 0 = spreadsheet row 1), which is the model's internal
 * convention. Conversion to the 1-indexed form used by `fast-formula-parser`
 * happens in the recalc engine.
 */
import type { Coord, Range } from "../types/index.js";

const CELL_RE = /^\$?([A-Za-z]+)\$?([0-9]+)$/;
const A = "A".charCodeAt(0);

/** Convert a column label (e.g. "A", "Z", "AA") to a 0-indexed column number. */
export function columnLabelToIndex(label: string): number {
  const upper = label.toUpperCase();
  if (!/^[A-Z]+$/.test(upper)) {
    throw new Error(`Invalid column label: ${label}`);
  }
  let index = 0;
  for (let i = 0; i < upper.length; i++) {
    index = index * 26 + (upper.charCodeAt(i) - A + 1);
  }
  return index - 1;
}

/** Convert a 0-indexed column number to its label (0 -> "A", 26 -> "AA"). */
export function columnIndexToLabel(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid column index: ${index}`);
  }
  let n = index + 1;
  let label = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(A + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

/** Parse an A1 reference (e.g. "B3", "$A$1") into a 0-indexed {@link Coord}. */
export function parseA1(ref: string): Coord {
  const match = CELL_RE.exec(ref.trim());
  if (!match || match[1] === undefined || match[2] === undefined) {
    throw new Error(`Invalid A1 reference: ${ref}`);
  }
  const col = columnLabelToIndex(match[1]);
  const row = Number.parseInt(match[2], 10) - 1;
  if (row < 0) {
    throw new Error(`Invalid A1 reference: ${ref}`);
  }
  return { row, col };
}

/** Render a 0-indexed {@link Coord} as an uppercase A1 reference. */
export function toA1(coord: Coord): string {
  if (coord.row < 0 || coord.col < 0) {
    throw new Error(`Invalid coordinate: ${JSON.stringify(coord)}`);
  }
  return columnIndexToLabel(coord.col) + String(coord.row + 1);
}

/** Whether a string is a syntactically valid single-cell A1 reference. */
export function isA1(ref: string): boolean {
  return CELL_RE.test(ref.trim());
}

/** Parse a range like "A1:B3" into a normalized inclusive {@link Range}. */
export function parseRange(range: string): Range {
  const parts = range.split(":");
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
    throw new Error(`Invalid range: ${range}`);
  }
  const a = parseA1(parts[0]);
  const b = parseA1(parts[1]);
  return normalizeRange({ start: a, end: b });
}

/** Render an inclusive {@link Range} as "A1:B3". */
export function toRangeRef(range: Range): string {
  return `${toA1(range.start)}:${toA1(range.end)}`;
}

/** Normalize a range so `start` is the top-left and `end` the bottom-right. */
export function normalizeRange(range: Range): Range {
  return {
    start: {
      row: Math.min(range.start.row, range.end.row),
      col: Math.min(range.start.col, range.end.col),
    },
    end: {
      row: Math.max(range.start.row, range.end.row),
      col: Math.max(range.start.col, range.end.col),
    },
  };
}

/** Enumerate every coordinate in an inclusive range, row-major. */
export function expandRange(range: Range): Coord[] {
  const norm = normalizeRange(range);
  const coords: Coord[] = [];
  for (let row = norm.start.row; row <= norm.end.row; row++) {
    for (let col = norm.start.col; col <= norm.end.col; col++) {
      coords.push({ row, col });
    }
  }
  return coords;
}
