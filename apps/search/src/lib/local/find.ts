import type { Database } from "bun:sqlite";
import {
  hasReadyRoot,
  autoRefreshStaleRoots,
  scheduleAutoRefreshStaleRoots,
  listRoots,
} from "./indexer.js";
import {
  searchFilePaths,
  searchFileContent,
  searchFilePathsRegex,
  searchFileContentRegex,
  clampLimit,
  type LineMatch,
  type LocalQueryOptions,
} from "./query.js";

export type FindKind = "file" | "content" | "both";

export interface FindMatch {
  /** Absolute path. */
  path: string;
  root: string;
  kind: FindKind;
  score: number;
  /** First matching line (content matches only). */
  line?: number;
  snippet?: string;
  matches?: LineMatch[];
}

export interface FindOptions extends LocalQueryOptions {
  kind?: FindKind;
  /** true refreshes synchronously, false skips refresh scheduling, undefined schedules async refresh. */
  refresh?: boolean;
  /** Treat the query as a regular expression (grep-style, line-based). */
  regex?: boolean;
  /** Case-sensitive matching (regex mode only; plain queries are always case-insensitive). */
  caseSensitive?: boolean;
}

export interface FindResponse {
  query: string;
  kind: FindKind;
  /** False when no index roots are ready — results will be empty. */
  indexed: boolean;
  roots: number;
  total: number;
  results: FindMatch[];
}

/**
 * One-call local lookup: ranked file-path and content matches across all
 * indexed roots. Designed for agents — replaces glob/grep/ls round trips.
 */
export function findLocal(query: string, opts: FindOptions = {}, db?: Database): FindResponse {
  const kind = opts.kind ?? "both";
  if (kind !== "file" && kind !== "content" && kind !== "both") {
    throw new Error(`Invalid kind "${kind}" — use file, content, or both.`);
  }
  const limit = clampLimit(opts.limit);
  const roots = listRoots(db);

  if (!hasReadyRoot(db)) {
    return { query, kind, indexed: false, roots: roots.length, total: 0, results: [] };
  }

  if (opts.refresh === true) autoRefreshStaleRoots(db);
  else if (opts.refresh !== false) scheduleAutoRefreshStaleRoots(db);

  const queryOpts: LocalQueryOptions = {
    root: opts.root,
    ext: opts.ext,
    dir: opts.dir,
    limit,
  };

  const merged = new Map<string, FindMatch>();
  const pathSearch = opts.regex
    ? () => searchFilePathsRegex(query, { ...queryOpts, caseSensitive: opts.caseSensitive }, db)
    : () => searchFilePaths(query, queryOpts, db);
  const contentSearch = opts.regex
    ? () => searchFileContentRegex(query, { ...queryOpts, caseSensitive: opts.caseSensitive }, db)
    : () => searchFileContent(query, queryOpts, db);

  if (kind === "file" || kind === "both") {
    for (const hit of pathSearch()) {
      merged.set(hit.absPath, {
        path: hit.absPath,
        root: hit.rootName,
        kind: "file",
        score: hit.score,
        snippet: hit.relPath,
      });
    }
  }

  if (kind === "content" || kind === "both") {
    for (const hit of contentSearch()) {
      const existing = merged.get(hit.absPath);
      if (existing) {
        // Path and content both match: strongest possible local signal.
        existing.kind = "both";
        existing.score = Math.min(1, Math.max(existing.score, hit.score) + 0.1);
        existing.line = hit.line;
        existing.snippet = hit.lineText;
        existing.matches = hit.matches;
      } else {
        merged.set(hit.absPath, {
          path: hit.absPath,
          root: hit.rootName,
          kind: "content",
          score: hit.score,
          line: hit.line,
          snippet: hit.lineText,
          matches: hit.matches,
        });
      }
    }
  }

  const results = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, limit);

  return {
    query,
    kind,
    indexed: true,
    roots: roots.length,
    total: results.length,
    results,
  };
}
