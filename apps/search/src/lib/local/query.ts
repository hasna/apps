import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { getIndexDb } from "../../db/index-db.js";
import { getRoot } from "./indexer.js";
import { buildFtsQueryFromRegex, compileSearchRegex } from "./regex.js";

export interface FileHit {
  rootId: string;
  rootName: string;
  rootPath: string;
  relPath: string;
  absPath: string;
  name: string;
  ext: string;
  dir: string;
  size: number;
  mtimeMs: number;
  isBinary: boolean;
  score: number;
}

export interface LineMatch {
  line: number;
  text: string;
}

export interface ContentHit extends FileHit {
  line: number;
  lineText: string;
  matches: LineMatch[];
}

export interface LocalQueryOptions {
  root?: string;
  ext?: string;
  dir?: string;
  limit?: number;
}

interface CandidateRow {
  id: number;
  root_id: string;
  root_name: string;
  root_path: string;
  rel_path: string;
  name: string;
  ext: string;
  dir: string;
  size: number;
  mtime_ms: number;
  is_binary: number;
}

const MAX_LINE_LENGTH = 200;
const MAX_MATCHES_PER_FILE = 5;
const MAX_PATH_CANDIDATES = 20_000;
const MAX_CONTENT_CANDIDATES = 50_000;
const MAX_REGEX_CANDIDATES = 50_000;

export function tokenize(query: string): string[] {
  // Control chars (NUL especially) would terminate FTS5's string parsing.
  return query
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

/** Build an FTS5 MATCH expression from query tokens (trigram needs >= 3 chars). */
export function buildFtsQuery(query: string): string | null {
  const tokens = tokenize(query).filter((t) => t.length >= 3);
  if (tokens.length === 0) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(" AND ");
}

/** Clamp a caller-supplied limit to something SQLite-safe and sane. */
export function clampLimit(limit: number | undefined, fallback = 20): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(500, Math.floor(limit)));
}

function filterClauses(opts: LocalQueryOptions, db?: Database): { sql: string; params: (string | number)[] } {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (opts.root) {
    const root = getRoot(opts.root, db);
    if (!root) throw new Error(`Index root not found: ${opts.root}`);
    clauses.push("r.id = ?");
    params.push(root.id);
  }
  if (opts.ext) {
    clauses.push("f.ext = ?");
    params.push(opts.ext.replace(/^\./, "").toLowerCase());
  }
  if (opts.dir) {
    clauses.push("f.dir LIKE ? ESCAPE '\\'");
    const dir = escapeLike(opts.dir.replace(/^\/|\/$/g, ""));
    params.push(`%${dir}%`);
  }

  return { sql: clauses.length > 0 ? ` AND ${clauses.join(" AND ")}` : "", params };
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function shortTokenClauses(tokens: string[]): { sql: string; params: string[] } {
  if (tokens.length === 0) return { sql: "", params: [] };
  return {
    sql: ` AND ${tokens.map(() => "f.rel_path LIKE ? ESCAPE '\\'").join(" AND ")}`,
    params: tokens.map((token) => `%${escapeLike(token)}%`),
  };
}

function contentGramClauses(tokens: string[]): { sql: string; params: string[] } {
  const gramTokens = tokens.filter((token) => /^[a-z0-9_$]{1,2}$/.test(token));
  if (gramTokens.length === 0) return { sql: "", params: [] };
  return {
    sql: gramTokens
      .map(
        (_token, index) =>
          ` AND (
            NOT EXISTS (
              SELECT 1 FROM file_content_grams cg_any_${index}
              WHERE cg_any_${index}.file_id = f.id
            )
            OR EXISTS (
              SELECT 1 FROM file_content_grams cg_${index}
              WHERE cg_${index}.file_id = f.id AND cg_${index}.gram = ?
            )
          )`,
      )
      .join(""),
    params: gramTokens,
  };
}

function rowToHit(row: CandidateRow, score: number): FileHit {
  return {
    rootId: row.root_id,
    rootName: row.root_name,
    rootPath: row.root_path,
    relPath: row.rel_path,
    absPath: `${row.root_path}/${row.rel_path}`,
    name: row.name,
    ext: row.ext,
    dir: row.dir,
    size: row.size,
    mtimeMs: row.mtime_ms,
    isBinary: row.is_binary === 1,
    score,
  };
}

/** Treat -, _, . as spaces so "dedup utils" matches dedup-utils.ts and dedup_utils.py. */
function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/[-_.]+/g, " ").trim();
}

// Tier floors keep name-match classes strictly ordered above content scores
// (content tops out at CONTENT_MAX_SCORE) regardless of depth/recency noise.
const EXACT_NAME_FLOOR = 0.72;
const PREFIX_NAME_FLOOR = 0.58;
const CONTENT_MAX_SCORE = 0.65;

function scoreFileName(query: string, tokens: string[], row: CandidateRow): number {
  const q = query.trim().toLowerCase();
  const qNorm = normalizeForMatch(query);
  const name = row.name.toLowerCase();
  const stem = name.replace(/\.[^.]+$/, "");
  const nameNorm = normalizeForMatch(row.name);
  const stemNorm = normalizeForMatch(row.name.replace(/\.[^.]+$/, ""));
  const relPath = row.rel_path.toLowerCase();

  let score = 0;
  let floor = 0;
  if (name === q || stem === q || nameNorm === qNorm || stemNorm === qNorm) {
    score += 100;
    floor = EXACT_NAME_FLOOR;
  } else if (name.startsWith(q) || stem.startsWith(q) || stemNorm.startsWith(qNorm)) {
    score += 60;
    floor = PREFIX_NAME_FLOOR;
  } else if (name.includes(q) || nameNorm.includes(qNorm)) {
    score += 40;
  }

  for (const token of tokens) {
    const t = token.toLowerCase();
    if (name.includes(t)) score += 15;
    else if (relPath.includes(t)) score += 5;
  }

  const depth = row.rel_path.split("/").length - 1;
  score -= depth * 2;

  const age = Date.now() - row.mtime_ms;
  if (age < 7 * 86_400_000) score += 10;
  else if (age < 30 * 86_400_000) score += 5;

  // Normalize to 0..1 so local scores blend with provider scores.
  return Math.max(floor, Math.max(0, score) / (Math.max(0, score) + 60));
}

const CANDIDATE_COLUMNS = `
  f.id, f.root_id, r.name as root_name, r.path as root_path,
  f.rel_path, f.name, f.ext, f.dir, f.size, f.mtime_ms, f.is_binary
`;

/** Search indexed file paths/names. Trigram FTS when possible, LIKE fallback for short queries. */
export function searchFilePaths(
  query: string,
  opts: LocalQueryOptions = {},
  db?: Database,
): FileHit[] {
  const d = db ?? getIndexDb();
  const limit = clampLimit(opts.limit);
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const ftsQuery = buildFtsQuery(query);
  const filters = filterClauses(opts, d);
  const shortTokens = tokens.filter((t) => t.length < 3).map((t) => t.toLowerCase());
  const shortFilters = shortTokenClauses(shortTokens);
  const candidateLimit = Math.max(200, limit * 10);

  let rows: CandidateRow[];
  if (ftsQuery) {
    // Weight the name column heavily in the bm25 pre-rank so token-dense
    // paths can't crowd real filename matches out of the candidate pool.
    rows = d
      .prepare(
        `SELECT ${CANDIDATE_COLUMNS}
         FROM files_fts fts
         JOIN files f ON f.id = fts.rowid
         JOIN index_roots r ON r.id = f.root_id
         WHERE files_fts MATCH ?${filters.sql}${shortFilters.sql}
         ORDER BY bm25(files_fts, 10.0, 1.0)
         LIMIT ?`,
      )
      .all(ftsQuery, ...filters.params, ...shortFilters.params, Math.min(candidateLimit, MAX_PATH_CANDIDATES)) as CandidateRow[];

    // Guarantee exact/prefix basename matches are in the pool even when the
    // bm25 pool is flooded (LIKE is ASCII-case-insensitive in SQLite).
    const namePattern = `${escapeLike(query.trim())}%`;
    const nameRows = d
      .prepare(
        `SELECT ${CANDIDATE_COLUMNS}
         FROM files f
         JOIN index_roots r ON r.id = f.root_id
         WHERE f.name LIKE ? ESCAPE '\\'${filters.sql}${shortFilters.sql}
         ORDER BY length(f.name)
         LIMIT 100`,
      )
      .all(namePattern, ...filters.params, ...shortFilters.params) as CandidateRow[];
    const seen = new Set(rows.map((row) => row.id));
    for (const row of nameRows) {
      if (!seen.has(row.id)) rows.push(row);
    }
  } else {
    // All tokens shorter than the trigram minimum: LIKE over the path.
    const likeClauses = tokens.map(() => "f.rel_path LIKE ? ESCAPE '\\'").join(" AND ");
    const likeParams = tokens.map((t) => `%${escapeLike(t)}%`);
    rows = d
      .prepare(
        `SELECT ${CANDIDATE_COLUMNS}
         FROM files f
         JOIN index_roots r ON r.id = f.root_id
         WHERE ${likeClauses}${filters.sql}
         ORDER BY length(f.name), length(f.rel_path), f.rel_path
         LIMIT ?`,
      )
      .all(...likeParams, ...filters.params, Math.min(candidateLimit, MAX_PATH_CANDIDATES)) as CandidateRow[];
  }

  // Short tokens are also enforced in SQL before LIMIT. Keep this final guard
  // in case SQLite LIKE behavior differs for non-ASCII paths.
  const filtered = shortTokens.length > 0
    ? rows.filter((row) => shortTokens.every((t) => row.rel_path.toLowerCase().includes(t)))
    : rows;

  return filtered
    .map((row) => rowToHit(row, scoreFileName(query, tokens, row)))
    .sort((a, b) => b.score - a.score)
    .filter((hit) => existsSync(hit.absPath)) // drop ghosts deleted since indexing
    .slice(0, limit);
}

type MatchTier = "phrase" | "all" | "any";

function findLineMatches(
  content: string,
  query: string,
  tokens: string[],
): { matches: LineMatch[]; tier: MatchTier } {
  const lines = content.split("\n");
  const phrase = query.trim().toLowerCase();
  const lowered = tokens.map((t) => t.toLowerCase());

  const phraseHits: LineMatch[] = [];
  const allTokenHits: LineMatch[] = [];
  const anyTokenHits: LineMatch[] = [];

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!;
    const lower = text.toLowerCase();
    const match: LineMatch = { line: i + 1, text: text.trim().slice(0, MAX_LINE_LENGTH) };

    if (phrase.length > 0 && lower.includes(phrase)) phraseHits.push(match);
    else if (lowered.every((t) => lower.includes(t))) allTokenHits.push(match);
    else if (lowered.some((t) => t.length >= 3 && lower.includes(t))) anyTokenHits.push(match);

    if (phraseHits.length >= MAX_MATCHES_PER_FILE) break;
  }

  const tier: MatchTier = phraseHits.length > 0 ? "phrase" : allTokenHits.length > 0 ? "all" : "any";
  const combined = [...phraseHits, ...allTokenHits, ...anyTokenHits];
  return { matches: combined.slice(0, MAX_MATCHES_PER_FILE), tier };
}

/**
 * Regex search over indexed file paths. Required literals extracted from the
 * pattern prefilter candidates via trigram FTS; the real RegExp then runs
 * against rel_path and name. Throws when the pattern has no usable literals.
 */
export function searchFilePathsRegex(
  pattern: string,
  opts: LocalQueryOptions & { caseSensitive?: boolean } = {},
  db?: Database,
): FileHit[] {
  const d = db ?? getIndexDb();
  const limit = clampLimit(opts.limit);
  const regex = compileSearchRegex(pattern, opts.caseSensitive);
  const ftsQuery = buildFtsQueryFromRegex(pattern);
  if (!ftsQuery) {
    throw new Error(
      "Regex pattern needs at least one required literal of 3+ characters (e.g. 'handle.*Click', not '\\w+').",
    );
  }

  const filters = filterClauses(opts, d);
  const hits: FileHit[] = [];
  const pageSize = Math.max(500, limit * 20);
  for (let offset = 0; hits.length < limit && offset < MAX_REGEX_CANDIDATES; offset += pageSize) {
    const rows = d
      .prepare(
        `SELECT ${CANDIDATE_COLUMNS}
         FROM files_fts fts
         JOIN files f ON f.id = fts.rowid
         JOIN index_roots r ON r.id = f.root_id
         WHERE files_fts MATCH ?${filters.sql}
         ORDER BY fts.rank
         LIMIT ? OFFSET ?`,
      )
      .all(ftsQuery, ...filters.params, pageSize, offset) as CandidateRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      if (!regex.test(row.rel_path) && !regex.test(row.name)) continue;
      const depth = row.rel_path.split("/").length - 1;
      const score = Math.max(0.05, 0.6 - depth * 0.02);
      const hit = rowToHit(row, score);
      if (!existsSync(hit.absPath)) continue; // ghost: deleted since indexing
      hits.push(hit);
      if (hits.length >= limit) break;
    }

    if (rows.length < pageSize) break;
  }
  return hits;
}

/**
 * Regex search over indexed file content (line-based, like grep). Trigram FTS
 * prefilters candidate files from the pattern's required literals; the real
 * RegExp runs per line on the actual file text. Throws when the pattern has
 * no usable literals.
 */
export function searchFileContentRegex(
  pattern: string,
  opts: LocalQueryOptions & { caseSensitive?: boolean } = {},
  db?: Database,
): ContentHit[] {
  const d = db ?? getIndexDb();
  const limit = clampLimit(opts.limit);
  const regex = compileSearchRegex(pattern, opts.caseSensitive);
  const ftsQuery = buildFtsQueryFromRegex(pattern);
  if (!ftsQuery) {
    throw new Error(
      "Regex pattern needs at least one required literal of 3+ characters (e.g. 'export.*function', not '\\d+').",
    );
  }

  const filters = filterClauses(opts, d);

  const hits: ContentHit[] = [];
  const pageSize = Math.max(200, limit * 10);
  for (let offset = 0; hits.length < limit && offset < MAX_REGEX_CANDIDATES; offset += pageSize) {
    const rows = d
      .prepare(
        `SELECT ${CANDIDATE_COLUMNS}
         FROM file_content_fts fts
         JOIN files f ON f.id = fts.rowid
         JOIN index_roots r ON r.id = f.root_id
         WHERE file_content_fts MATCH ?${filters.sql}
         ORDER BY fts.rank
         LIMIT ? OFFSET ?`,
      )
      .all(ftsQuery, ...filters.params, pageSize, offset) as CandidateRow[];
    if (rows.length === 0) break;

    for (let i = 0; i < rows.length && hits.length < limit; i++) {
      const row = rows[i]!;
      const absPath = `${row.root_path}/${row.rel_path}`;

      let content: string;
      try {
        content = readFileSync(absPath, "utf-8");
      } catch {
        continue;
      }

      const lines = content.split("\n");
      const matches: LineMatch[] = [];
      for (let n = 0; n < lines.length && matches.length < MAX_MATCHES_PER_FILE; n++) {
        if (regex.test(lines[n]!)) {
          matches.push({ line: n + 1, text: lines[n]!.trim().slice(0, MAX_LINE_LENGTH) });
        }
      }
      if (matches.length === 0) continue;

      const rankIndex = offset + i;
      const score = Math.max(0.25, 0.65 - rankIndex * 0.05);
      hits.push({
        ...rowToHit(row, score),
        line: matches[0]!.line,
        lineText: matches[0]!.text,
        matches,
      });
    }

    if (rows.length < pageSize) break;
  }

  return hits;
}

/**
 * Search indexed file content. FTS narrows to candidate files; the actual
 * files are re-read to produce exact, current line numbers and snippets.
 */
export function searchFileContent(
  query: string,
  opts: LocalQueryOptions = {},
  db?: Database,
): ContentHit[] {
  const d = db ?? getIndexDb();
  const limit = clampLimit(opts.limit);
  const ftsQuery = buildFtsQuery(query);
  if (!ftsQuery) return []; // Content search needs at least one 3+ char token.

  const filters = filterClauses(opts, d);
  const tokens = tokenize(query);
  const shortTokens = tokens.filter((t) => t.length < 3).map((t) => t.toLowerCase());
  const gramFilters = contentGramClauses(shortTokens);
  const scored: ContentHit[] = [];
  const pageSize = Math.max(50, limit * 3);

  for (let offset = 0; scored.length < limit * 2 && offset < MAX_CONTENT_CANDIDATES; offset += pageSize) {
    const rows = d
      .prepare(
        `SELECT ${CANDIDATE_COLUMNS}
         FROM file_content_fts fts
         JOIN files f ON f.id = fts.rowid
         JOIN index_roots r ON r.id = f.root_id
         WHERE file_content_fts MATCH ?${filters.sql}${gramFilters.sql}
         ORDER BY fts.rank
         LIMIT ? OFFSET ?`,
      )
      .all(ftsQuery, ...filters.params, ...gramFilters.params, pageSize, offset) as CandidateRow[];
    if (rows.length === 0) break;

    for (let i = 0; i < rows.length && scored.length < limit * 2; i++) {
      const row = rows[i]!;
      const absPath = `${row.root_path}/${row.rel_path}`;

      let content: string;
      try {
        content = readFileSync(absPath, "utf-8");
      } catch {
        continue; // File vanished since indexing; next refresh will drop it.
      }

      // Short tokens are invisible to trigram FTS — enforce them on the body.
      if (shortTokens.length > 0) {
        const lower = content.toLowerCase();
        if (!shortTokens.every((t) => lower.includes(t))) continue;
      }

      const { matches, tier } = findLineMatches(content, query, tokens);
      if (matches.length === 0) continue;

      // bm25 ordering decayed by position, boosted by line-match quality.
      // Stays below EXACT_NAME_FLOOR so "dedup" ranks dedup.ts above mentions.
      const rankIndex = offset + i;
      const base = Math.max(0.25, 0.55 - rankIndex * 0.04);
      const tierBoost = tier === "phrase" ? 0.1 : tier === "all" ? 0.05 : 0;
      const score = Math.min(CONTENT_MAX_SCORE, base + tierBoost);
      scored.push({
        ...rowToHit(row, score),
        line: matches[0]!.line,
        lineText: matches[0]!.text,
        matches,
      });
    }

    if (rows.length < pageSize) break;
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
