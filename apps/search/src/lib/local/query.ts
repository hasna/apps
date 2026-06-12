import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
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
    const dir = opts.dir.replace(/^\/|\/$/g, "").replace(/[\\%_]/g, "\\$&");
    params.push(`%${dir}%`);
  }

  return { sql: clauses.length > 0 ? ` AND ${clauses.join(" AND ")}` : "", params };
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

function scoreFileName(query: string, tokens: string[], row: CandidateRow): number {
  const q = query.trim().toLowerCase();
  const name = row.name.toLowerCase();
  const stem = name.replace(/\.[^.]+$/, "");
  const relPath = row.rel_path.toLowerCase();

  let score = 0;
  if (name === q || stem === q) score += 100;
  else if (name.startsWith(q) || stem.startsWith(q)) score += 60;
  else if (name.includes(q)) score += 40;

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
  return Math.max(0, score) / (Math.max(0, score) + 60);
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
  const candidateLimit = Math.max(200, limit * 10);

  let rows: CandidateRow[];
  if (ftsQuery) {
    rows = d
      .prepare(
        `SELECT ${CANDIDATE_COLUMNS}
         FROM files_fts fts
         JOIN files f ON f.id = fts.rowid
         JOIN index_roots r ON r.id = f.root_id
         WHERE files_fts MATCH ?${filters.sql}
         ORDER BY fts.rank
         LIMIT ?`,
      )
      .all(ftsQuery, ...filters.params, candidateLimit) as CandidateRow[];
  } else {
    // All tokens shorter than the trigram minimum: LIKE over the path.
    const likeClauses = tokens.map(() => "f.rel_path LIKE ? ESCAPE '\\'").join(" AND ");
    const likeParams = tokens.map((t) => `%${t.replace(/[\\%_]/g, "\\$&")}%`);
    rows = d
      .prepare(
        `SELECT ${CANDIDATE_COLUMNS}
         FROM files f
         JOIN index_roots r ON r.id = f.root_id
         WHERE ${likeClauses}${filters.sql}
         LIMIT ?`,
      )
      .all(...likeParams, ...filters.params, candidateLimit) as CandidateRow[];
  }

  // Short tokens are invisible to trigram FTS — enforce them here.
  const shortTokens = tokens.filter((t) => t.length < 3).map((t) => t.toLowerCase());
  const filtered = shortTokens.length > 0
    ? rows.filter((row) => shortTokens.every((t) => row.rel_path.toLowerCase().includes(t)))
    : rows;

  return filtered
    .map((row) => rowToHit(row, scoreFileName(query, tokens, row)))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function findLineMatches(content: string, query: string, tokens: string[]): LineMatch[] {
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

  const combined = [...phraseHits, ...allTokenHits, ...anyTokenHits];
  return combined.slice(0, MAX_MATCHES_PER_FILE);
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
  const rows = d
    .prepare(
      `SELECT ${CANDIDATE_COLUMNS}
       FROM files_fts fts
       JOIN files f ON f.id = fts.rowid
       JOIN index_roots r ON r.id = f.root_id
       WHERE files_fts MATCH ?${filters.sql}
       ORDER BY fts.rank
       LIMIT 5000`,
    )
    .all(ftsQuery, ...filters.params) as CandidateRow[];

  const hits: FileHit[] = [];
  for (const row of rows) {
    if (!regex.test(row.rel_path) && !regex.test(row.name)) continue;
    const depth = row.rel_path.split("/").length - 1;
    const score = Math.max(0.05, 0.6 - depth * 0.02);
    hits.push(rowToHit(row, score));
    if (hits.length >= limit) break;
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
  const rows = d
    .prepare(
      `SELECT ${CANDIDATE_COLUMNS}
       FROM file_content_fts fts
       JOIN files f ON f.id = fts.rowid
       JOIN index_roots r ON r.id = f.root_id
       WHERE file_content_fts MATCH ?${filters.sql}
       ORDER BY fts.rank
       LIMIT ?`,
    )
    .all(ftsQuery, ...filters.params, Math.max(200, limit * 10)) as CandidateRow[];

  const hits: ContentHit[] = [];
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

    const score = Math.max(0.25, 0.65 - i * 0.05);
    hits.push({
      ...rowToHit(row, score),
      line: matches[0]!.line,
      lineText: matches[0]!.text,
      matches,
    });
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
  const rows = d
    .prepare(
      `SELECT ${CANDIDATE_COLUMNS}
       FROM file_content_fts fts
       JOIN files f ON f.id = fts.rowid
       JOIN index_roots r ON r.id = f.root_id
       WHERE file_content_fts MATCH ?${filters.sql}
       ORDER BY fts.rank
       LIMIT ?`,
    )
    .all(ftsQuery, ...filters.params, Math.max(50, limit * 3)) as CandidateRow[];

  const tokens = tokenize(query);
  const hits: ContentHit[] = [];

  for (let i = 0; i < rows.length && hits.length < limit; i++) {
    const row = rows[i]!;
    const absPath = `${row.root_path}/${row.rel_path}`;

    let content: string;
    try {
      content = readFileSync(absPath, "utf-8");
    } catch {
      continue; // File vanished since indexing; next refresh will drop it.
    }

    const matches = findLineMatches(content, query, tokens);
    if (matches.length === 0) continue;

    // bm25 ordering from FTS, decayed by position. Capped below strong
    // filename matches so "dedup" ranks dedup.ts above files mentioning it.
    const score = Math.max(0.25, 0.65 - i * 0.05);
    hits.push({
      ...rowToHit(row, score),
      line: matches[0]!.line,
      lineText: matches[0]!.text,
      matches,
    });
  }

  return hits;
}
