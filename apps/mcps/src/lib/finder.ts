/**
 * Backwards-compatible re-exports from sources.ts.
 * Use sources.ts directly for new code.
 */

export { findServers } from "./sources.js";
export type { FindOptions } from "./sources.js";

/** List all entries from the awesome-mcp-servers curated list */
export async function listAwesomeServers(): Promise<import("../types.js").FinderResult[]> {
  const { listSources, searchSource } = await import("./sources.js");
  const source = listSources().find((s) => s.type === "awesome-list" && s.enabled);
  if (!source) return [];
  return searchSource(source, "");
}
