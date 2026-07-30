import type { Database } from "bun:sqlite";
import {
  hasReadyRoot,
  autoRefreshStaleRoots,
  scheduleAutoRefreshStaleRoots,
  listRoots,
  rootHealth,
  type IndexRoot,
  type RootHealth,
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
  /**
   * Why the query could not be served at all. Present only when `indexed` is
   * false, i.e. when NO root was able to answer.
   *
   * Scope, stated precisely because the obvious stronger reading is false: the
   * gate is "is any root ready", not "is every root ready". With one ready root
   * and one wedged sibling, this stays undefined and the call exits 0 — the
   * wedged root silently contributes whatever it captured before it died, and
   * anything written since is simply absent. So an empty `results` array with
   * no `error` means *some* root was ready; it does NOT prove the index was
   * healthy or that the corpus genuinely had nothing.
   *
   * Per-root health is reported in `rootHealth` and by `search index status`,
   * which is where a partially-degraded index is currently visible. Narrowing
   * this gate to per-root reporting is tracked separately.
   */
  error?: string;
  /** Per-root health, always present, so a degraded sibling is never invisible. */
  rootHealth?: Array<{ name: string; path: string; health: RootHealth }>;
}

/** Human-readable reason a set of roots cannot answer a query. */
function describeUnusableRoots(roots: IndexRoot[]): string {
  if (roots.length === 0) {
    return "no index roots configured — run `search index add <path>` first";
  }

  const byHealth = new Map<RootHealth, string[]>();
  for (const root of roots) {
    const health = rootHealth(root);
    if (health === "ready" || health === "stale") continue;
    const names = byHealth.get(health) ?? [];
    names.push(root.name);
    byHealth.set(health, names);
  }

  const parts: string[] = [];
  const wedged = byHealth.get("wedged");
  if (wedged) {
    // Deliberately does NOT promise automatic recovery. The background refresh
    // is scheduled on an unref'd timer, so a short-lived CLI process exits
    // before it can finish — measured. Only long-running processes
    // (search-serve, search-mcp) heal this on their own. Naming the command is
    // the honest instruction.
    parts.push(
      `${wedged.join(", ")} wedged (an index run was killed and never finished) — ` +
        "recover it with `search index update`",
    );
  }
  const indexing = byHealth.get("indexing");
  if (indexing) parts.push(`${indexing.join(", ")} still indexing`);
  const pending = byHealth.get("pending");
  if (pending) parts.push(`${pending.join(", ")} never indexed (run \`search index update\`)`);
  const errored = byHealth.get("error");
  if (errored) parts.push(`${errored.join(", ")} failed to index (see \`search index status\`)`);

  return `no index root is ready: ${parts.join("; ")}`;
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
    // Kick recovery before giving up: a wedged root is exactly the case the
    // refresh path can repair, and the old early return meant a wedged sole
    // root never reached the scheduler at all — the query gate and the recovery
    // gate deadlocked each other. This run still fails loudly; the next
    // succeeds.
    if (opts.refresh === true) autoRefreshStaleRoots(db);
    else if (opts.refresh !== false) scheduleAutoRefreshStaleRoots(db);

    if (hasReadyRoot(db)) return findLocal(query, { ...opts, refresh: false }, db);

    const current = listRoots(db);
    return {
      query,
      kind,
      indexed: false,
      roots: current.length,
      total: 0,
      results: [],
      error: describeUnusableRoots(current),
      rootHealth: current.map((r) => ({ name: r.name, path: r.path, health: rootHealth(r) })),
    };
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
    // Emitted on the SUCCESS path too. Reporting it only alongside `error` left
    // it undefined in exactly the partially-degraded case — one ready root, one
    // wedged sibling — which is the case a caller most needs it for, and the
    // one the doc comment above points at it for.
    rootHealth: roots.map((r) => ({ name: r.name, path: r.path, health: rootHealth(r) })),
  };
}
