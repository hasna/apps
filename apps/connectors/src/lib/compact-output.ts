import type { ConnectorMeta } from "./registry.js";

export const DEFAULT_COMPACT_LIMIT = 20;
export const DEFAULT_MCP_LIMIT = 20;
export const MAX_COMPACT_LIMIT = 100;
export const DEFAULT_TEXT_WIDTH = 96;
export const DEFAULT_OUTPUT_CHARS = 6000;

export type ParseIntResult = { value: number | undefined; error?: string };

export function parseNonNegativeInt(raw: string | undefined, flag: string): ParseIntResult {
  if (raw === undefined) return { value: undefined };
  if (!/^\d+$/.test(raw)) {
    return {
      value: undefined,
      error: `Invalid value for ${flag}: '${raw}'. Expected a non-negative integer.`,
    };
  }
  return { value: parseInt(raw, 10) };
}

export function normalizeLimit(value: number | undefined, fallback: number, max = MAX_COMPACT_LIMIT): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(1, Math.floor(value)), max);
}

export function parseCursor(raw: string | undefined): ParseIntResult {
  if (raw === undefined || raw === "") return { value: 0 };
  return parseNonNegativeInt(raw, "--cursor");
}

export function pageItems<T>(
  items: T[],
  options: { offset?: number; limit?: number }
): { items: T[]; total: number; offset: number; limit: number | null; nextOffset: number | null } {
  const offset = Math.max(0, options.offset ?? 0);
  const limit = options.limit === undefined ? undefined : Math.max(1, Math.floor(options.limit));
  const paged = limit === undefined ? items.slice(offset) : items.slice(offset, offset + limit);
  const nextOffset = limit === undefined || offset + paged.length >= items.length ? null : offset + paged.length;
  return {
    items: paged,
    total: items.length,
    offset,
    limit: limit ?? null,
    nextOffset,
  };
}

export function truncateText(value: string | undefined, max = DEFAULT_TEXT_WIDTH): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  if (max <= 3) return text.slice(0, max);
  return `${text.slice(0, max - 3).trimEnd()}...`;
}

export function firstNonEmptyLines(value: string | undefined, maxLines: number, maxWidth = DEFAULT_TEXT_WIDTH): string[] {
  return (value ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .map((line) => truncateText(line, maxWidth));
}

export function compactConnector(connector: ConnectorMeta, descriptionWidth = DEFAULT_TEXT_WIDTH) {
  return {
    name: connector.name,
    displayName: connector.displayName,
    version: connector.version,
    category: connector.category,
    description: truncateText(connector.description, descriptionWidth),
  };
}

export function maybeTruncateOutput(
  text: string,
  options: { maxChars?: number; enabled?: boolean; hint?: string } = {}
): { text: string; truncated: boolean } {
  const enabled = options.enabled ?? true;
  const maxChars = options.maxChars ?? DEFAULT_OUTPUT_CHARS;
  if (!enabled || text.length <= maxChars) {
    return { text, truncated: false };
  }

  const hint = options.hint ?? "Use --verbose for full output.";
  const omitted = text.length - maxChars;
  return {
    text: `${text.slice(0, maxChars).trimEnd()}\n\n[truncated ${omitted} chars] ${hint}`,
    truncated: true,
  };
}
