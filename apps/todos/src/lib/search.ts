import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { Task, TaskRow } from "../types/index.js";
import { clearExpiredLocks, getDatabase } from "../db/database.js";

function rowToTask(row: TaskRow): Task {
  return {
    ...row,
    tags: JSON.parse(row.tags || "[]") as string[],
    metadata: JSON.parse(row.metadata || "{}") as Record<string, unknown>,
    status: row.status as Task["status"],
    priority: row.priority as Task["priority"],
    requires_approval: Boolean(row.requires_approval),
  };
}

export interface SearchOptions {
  query?: string;
  project_id?: string;
  task_list_id?: string;
  status?: string | string[];
  priority?: string | string[];
  assigned_to?: string;
  agent_id?: string;
  created_after?: string;
  updated_after?: string;
  has_dependencies?: boolean;
  is_blocked?: boolean;
  /** Max results to return. Bounded default applied when omitted/invalid. */
  limit?: number;
}

// A search was previously UNBOUNDED (no LIMIT anywhere), so a broad query
// materialized the entire task table. Cap it; explicit SearchOptions.limit wins.
// Matches the 1000 ceiling used by saved-search views (normalizeLimit).
export const DEFAULT_SEARCH_LIMIT = 1000;

// bm25 column weights: title >> description > tags. Column order matches the
// tasks_fts schema (task_id UNINDEXED, title, description, tags); the UNINDEXED
// column's weight is inert. Mirrors the Postgres ts_rank_cd A/B/C weighting so
// SQLite and Postgres rank equivalently.
const BM25_WEIGHTS = "0.0, 10.0, 5.0, 3.0";

function hasFts(db: Database): boolean {
  try {
    const result = db.query("SELECT 1 FROM sqlite_master WHERE type='table' AND name='tasks_fts'").get();
    return result !== null;
  } catch {
    return false;
  }
}

/**
 * Build a safe FTS5 MATCH expression from a free-text query.
 *
 * The old gate (`shouldUseFts`) REJECTED any query containing punctuation with
 * `/^[\p{L}\p{N}_\-\s]+$/u`, silently degrading those searches. This parser never
 * rejects — it always yields a valid MATCH string:
 *   - double-quoted substrings become exact phrases
 *   - bare terms are prefix-matched (`"term"*`)
 *   - terms with default AND between them (websearch-like)
 *   - every term is wrapped in double quotes and FTS5 operator characters are
 *     stripped, so internal punctuation (e.g. `log-in`) is a literal the
 *     tokenizer splits — never an operator that raises a syntax error
 *
 * Returns "" when the query has no searchable content; the caller then relies on
 * the LIKE fallback alone.
 */
function buildFtsMatchQuery(raw: string): string {
  const terms: string[] = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (m[1] !== undefined) {
      const phrase = m[1].replace(/"/g, " ").replace(/\s+/g, " ").trim();
      if (phrase) terms.push(`"${phrase}"`);
    } else {
      const cleaned = m[2]!.replace(/["*^():]/g, " ").replace(/\s+/g, " ").trim();
      if (cleaned) terms.push(`"${cleaned}"*`);
    }
  }
  return terms.join(" AND ");
}

function boundedLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || !limit || (limit as number) <= 0) return DEFAULT_SEARCH_LIMIT;
  return Math.trunc(limit as number);
}

export function searchTasks(
  options: SearchOptions | string,
  projectId?: string,
  taskListId?: string,
  db?: Database,
): Task[] {
  // Support old signature for backward compatibility
  const opts: SearchOptions = typeof options === "string"
    ? { query: options || undefined, project_id: projectId, task_list_id: taskListId }
    : options;

  const d = db || getDatabase();
  clearExpiredLocks(d);

  const params: SQLQueryBindings[] = [];
  let sql: string;

  const raw = opts.query?.trim() ?? "";
  // "*" means "match everything" — treat as no query (filter-only mode)
  const q = raw === "*" ? "" : raw;

  const ftsMatch = q ? buildFtsMatchQuery(q) : "";
  const useFts = hasFts(d) && q !== "" && ftsMatch !== "";

  if (useFts) {
    // LEFT JOIN a bm25-ranked FTS subquery so full-text hits carry a relevance
    // score, then OR in a LIKE fallback for fields FTS does NOT index
    // (id/short_id/working_dir/metadata) so identifier/fingerprint/path pastes
    // still resolve. A single row per task — no UNION dedupe needed.
    const pattern = `%${q}%`;
    sql = `SELECT t.* FROM tasks t
      LEFT JOIN (
        SELECT rowid, bm25(tasks_fts, ${BM25_WEIGHTS}) AS rank
        FROM tasks_fts WHERE tasks_fts MATCH ?
      ) fts ON fts.rowid = t.rowid
      WHERE (
        fts.rowid IS NOT NULL
        OR t.id LIKE ?
        OR t.short_id LIKE ?
        OR t.title LIKE ?
        OR t.description LIKE ?
        OR t.working_dir LIKE ?
        OR t.metadata LIKE ?
        OR EXISTS (SELECT 1 FROM task_tags WHERE task_tags.task_id = t.id AND tag LIKE ?)
      )`;
    params.push(ftsMatch, pattern, pattern, pattern, pattern, pattern, pattern, pattern);
  } else if (q) {
    // No usable FTS (unavailable, or the query was only punctuation): LIKE match,
    // including ids and structured fields operators paste as exact fingerprints.
    const pattern = `%${q}%`;
    sql = `SELECT t.* FROM tasks t WHERE (
      t.id LIKE ?
      OR t.short_id LIKE ?
      OR t.title LIKE ?
      OR t.description LIKE ?
      OR t.working_dir LIKE ?
      OR t.metadata LIKE ?
      OR EXISTS (SELECT 1 FROM task_tags WHERE task_tags.task_id = t.id AND tag LIKE ?)
    )`;
    params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
  } else {
    // No query — filter-only mode, return all tasks matching filters
    sql = `SELECT t.* FROM tasks t WHERE 1=1`;
  }

  if (opts.project_id) {
    sql += " AND t.project_id = ?";
    params.push(opts.project_id);
  }

  if (opts.task_list_id) {
    sql += " AND t.task_list_id = ?";
    params.push(opts.task_list_id);
  }

  if (opts.status) {
    if (Array.isArray(opts.status)) {
      sql += ` AND t.status IN (${opts.status.map(() => "?").join(",")})`;
      params.push(...opts.status);
    } else {
      sql += " AND t.status = ?";
      params.push(opts.status);
    }
  }

  if (opts.priority) {
    if (Array.isArray(opts.priority)) {
      sql += ` AND t.priority IN (${opts.priority.map(() => "?").join(",")})`;
      params.push(...opts.priority);
    } else {
      sql += " AND t.priority = ?";
      params.push(opts.priority);
    }
  }

  if (opts.assigned_to) {
    sql += " AND t.assigned_to = ?";
    params.push(opts.assigned_to);
  }

  if (opts.agent_id) {
    sql += " AND t.agent_id = ?";
    params.push(opts.agent_id);
  }

  if (opts.created_after) {
    sql += " AND t.created_at > ?";
    params.push(opts.created_after);
  }

  if (opts.updated_after) {
    sql += " AND t.updated_at > ?";
    params.push(opts.updated_after);
  }

  if (opts.has_dependencies === true) {
    sql += " AND t.id IN (SELECT task_id FROM task_dependencies)";
  } else if (opts.has_dependencies === false) {
    sql += " AND t.id NOT IN (SELECT task_id FROM task_dependencies)";
  }

  if (opts.is_blocked === true) {
    sql += " AND t.id IN (SELECT td.task_id FROM task_dependencies td JOIN tasks dep ON dep.id = td.depends_on WHERE dep.status != 'completed')";
  } else if (opts.is_blocked === false) {
    sql += " AND t.id NOT IN (SELECT td.task_id FROM task_dependencies td JOIN tasks dep ON dep.id = td.depends_on WHERE dep.status != 'completed')";
  }

  if (useFts) {
    // Full-text hits first (LIKE-only fallback matches after), then bm25
    // relevance, then priority, then recency. NULLS from the LEFT JOIN sort last.
    sql += ` ORDER BY (fts.rowid IS NULL) ASC, fts.rank ASC,
      CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
      t.created_at DESC`;
  } else {
    sql += ` ORDER BY
      CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
      t.created_at DESC`;
  }

  // Bound the result set. Searches were previously unbounded (no LIMIT).
  sql += ` LIMIT ?`;
  params.push(boundedLimit(opts.limit));

  const rows = d.query(sql).all(...params) as TaskRow[];
  return rows.map(rowToTask);
}
