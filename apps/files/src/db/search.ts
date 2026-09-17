import { getDb } from "./database.js";
import { getFile } from "./files.js";
import type {
  FileSearchDocumentKind,
  FileWithTags,
  ListFilesOptions,
  SearchMatchSource,
  SearchResult,
} from "../types/index.js";

type SearchOptions = Omit<ListFilesOptions, "query">;

interface SearchCandidate {
  id: string;
  rank: number;
  match_sources: Set<SearchMatchSource>;
  document_kinds: Set<FileSearchDocumentKind>;
  document_count: number;
}

/**
 * Full-text search using FTS5. Metadata and derived-content indexes are merged
 * at the file level so raw extracted text does not have to be printed by search.
 */
export function searchFiles(query: string, opts: SearchOptions = {}): SearchResult[] {
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const scope = opts.search_scope ?? "all";
  const targetCount = limit + offset;
  let candidateLimit = Math.max(targetCount * 4, 100);
  const ftsQuery = sanitizeFtsQuery(query);

  while (true) {
    let loaded: { candidates: Map<string, SearchCandidate>; exhausted: boolean };
    try {
      loaded = loadFtsCandidates(ftsQuery, scope, candidateLimit);
    } catch {
      loaded = fallbackLikeCandidates(query, scope, candidateLimit);
    }

    const results = materializeCandidates(loaded.candidates, opts, targetCount);
    if (results.length >= targetCount || loaded.exhausted) {
      return results.slice(offset, offset + limit);
    }
    candidateLimit *= 2;
  }
}

function loadFtsCandidates(
  query: string,
  scope: SearchOptions["search_scope"],
  limit: number,
): { candidates: Map<string, SearchCandidate>; exhausted: boolean } {
  const candidates = new Map<string, SearchCandidate>();
  const metadataRows = scope === "content" ? [] : searchMetadataFts(query, limit);
  const contentRows = scope === "metadata" ? [] : searchContentFts(query, limit);
  for (const row of metadataRows) mergeCandidate(candidates, row.id, row.rank, "metadata");
  for (const row of contentRows) {
    mergeCandidate(candidates, row.file_id, row.rank, "content", parseKinds(row.kinds), row.document_count);
  }
  return {
    candidates,
    exhausted: (scope === "content" || metadataRows.length < limit)
      && (scope === "metadata" || contentRows.length < limit),
  };
}

function materializeCandidates(
  candidates: Map<string, SearchCandidate>,
  opts: SearchOptions,
  targetCount: number,
): SearchResult[] {
  const db = getDb();
  const results: SearchResult[] = [];
  const ordered = [...candidates.values()].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  for (const candidate of ordered) {
    if (results.length >= targetCount) break;
    const file = getFile(candidate.id);
    if (!file || file.status !== "active" || !passesPostFilters(file, opts)) continue;

    const source = db.query<{ name: string }, [string]>("SELECT name FROM sources WHERE id=?").get(file.source_id);
    const machine = db.query<{ name: string }, [string]>("SELECT name FROM machines WHERE id=?").get(file.machine_id);
    const organization = db.query<{
      owner: string | null;
      target_path: string | null;
      review_status: string | null;
    }, [string]>(
      "SELECT owner, target_path, review_status FROM file_organization_reviews WHERE file_id=? LIMIT 1",
    ).get(file.id);

    results.push({
      ...file,
      rank: candidate.rank,
      source_name: source?.name,
      machine_name: machine?.name,
      organization_owner: organization?.owner ?? undefined,
      organization_target_path: organization?.target_path ?? undefined,
      organization_review_status: organization?.review_status as SearchResult["organization_review_status"] | undefined,
      search_match_sources: [...candidate.match_sources],
      search_document_kinds: [...candidate.document_kinds],
      search_document_count: candidate.document_count || undefined,
    });
  }
  return results;
}

function sanitizeFtsQuery(q: string): string {
  if (/[*"^()]/.test(q) || /\b(?:OR|AND|NOT)\b/.test(q)) return q;
  return q
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replace(/"/g, '""')}"*`)
    .join(" ");
}

function searchMetadataFts(query: string, limit: number): Array<{ id: string; rank: number }> {
  return getDb().query<{ id: string; rank: number }, [string, number]>(
    "SELECT id, rank FROM files_fts WHERE files_fts MATCH ? ORDER BY rank, id LIMIT ?",
  ).all(query, limit);
}

function searchContentFts(query: string, limit: number): Array<{
  file_id: string;
  rank: number;
  kinds: string | null;
  document_count: number;
}> {
  return getDb().query<{
    file_id: string;
    rank: number;
    kinds: string | null;
    document_count: number;
  }, [string, number]>(
    `SELECT file_id, MIN(rank) AS rank, group_concat(DISTINCT kind) AS kinds, COUNT(DISTINCT document_id) AS document_count
     FROM file_search_documents_fts
     WHERE file_search_documents_fts MATCH ?
     GROUP BY file_id
     ORDER BY rank, file_id
     LIMIT ?`,
  ).all(query, limit);
}

function fallbackLikeCandidates(
  query: string,
  scope: SearchOptions["search_scope"],
  limit: number,
): { candidates: Map<string, SearchCandidate>; exhausted: boolean } {
  const db = getDb();
  const candidates = new Map<string, SearchCandidate>();
  const like = `%${query}%`;
  let metadataCount = 0;
  let contentCount = 0;

  if (scope !== "content") {
    const rows = db.query<{ id: string; rank: number }, [string, string, string, string, string, string, string, string, number]>(
      `SELECT f.id, 0 AS rank
       FROM files f
       LEFT JOIN file_organization_reviews r ON r.file_id = f.id
       WHERE f.status='active'
         AND (
           f.name LIKE ?
           OR f.path LIKE ?
           OR f.mime LIKE ?
           OR COALESCE(f.canonical_name, '') LIKE ?
           OR COALESCE(f.description, '') LIKE ?
           OR COALESCE(r.target_path, '') LIKE ?
           OR COALESCE(r.owner, '') LIKE ?
           OR COALESCE(r.review_status, '') LIKE ?
         )
       ORDER BY f.indexed_at DESC, f.id DESC
       LIMIT ?`,
    ).all(like, like, like, like, like, like, like, like, limit);
    metadataCount = rows.length;
    for (const row of rows) mergeCandidate(candidates, row.id, row.rank, "metadata");
  }

  if (scope !== "metadata") {
    const rows = db.query<{
      file_id: string;
      rank: number;
      kinds: string | null;
      document_count: number;
    }, [string, string, string, string, number]>(
      `SELECT file_id, 0 AS rank, group_concat(DISTINCT kind) AS kinds, COUNT(DISTINCT id) AS document_count,
              MAX(updated_at) AS newest
       FROM file_search_documents
       WHERE status IN ('ready', 'partial')
         AND (
           searchable_text LIKE ?
           OR metadata LIKE ?
           OR kind LIKE ?
           OR extractor LIKE ?
         )
       GROUP BY file_id
       ORDER BY newest DESC, file_id DESC
       LIMIT ?`,
    ).all(like, like, like, like, limit);
    contentCount = rows.length;
    for (const row of rows) {
      mergeCandidate(candidates, row.file_id, row.rank, "content", parseKinds(row.kinds), row.document_count);
    }
  }

  return {
    candidates,
    exhausted: (scope === "content" || metadataCount < limit)
      && (scope === "metadata" || contentCount < limit),
  };
}

function mergeCandidate(
  candidates: Map<string, SearchCandidate>,
  id: string,
  rank: number,
  source: SearchMatchSource,
  documentKinds: FileSearchDocumentKind[] = [],
  documentCount = 0,
): void {
  const existing = candidates.get(id);
  if (existing) {
    existing.rank = Math.min(existing.rank, rank);
    existing.match_sources.add(source);
    for (const kind of documentKinds) existing.document_kinds.add(kind);
    existing.document_count += documentCount;
    return;
  }

  candidates.set(id, {
    id,
    rank,
    match_sources: new Set([source]),
    document_kinds: new Set(documentKinds),
    document_count: documentCount,
  });
}

function parseKinds(raw: string | null): FileSearchDocumentKind[] {
  if (!raw) return [];
  return raw.split(",").map((kind) => kind.trim()).filter(Boolean) as FileSearchDocumentKind[];
}

function passesPostFilters(file: FileWithTags, opts: SearchOptions): boolean {
  if (opts.source_id && file.source_id !== opts.source_id) return false;
  if (opts.machine_id && file.machine_id !== opts.machine_id) return false;
  if (opts.ext && file.ext !== normalizeExt(opts.ext)) return false;
  if (opts.tag && !file.tags.includes(opts.tag.toLowerCase())) return false;
  return true;
}

function normalizeExt(ext: string): string {
  return ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
}
