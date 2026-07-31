import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import { getDb } from "./database.js";
import type {
  FileSearchDocument,
  FileSearchDocumentKind,
  FileSearchDocumentStatus,
  FileSearchIndexStats,
  ListFileSearchDocumentsOptions,
  UpsertFileSearchDocumentInput,
} from "../types/index.js";

interface FileSearchDocumentRow {
  id: string;
  file_id: string;
  revision_id: string | null;
  source_ref: string;
  kind: string;
  extractor: string;
  content_hash: string;
  searchable_text: string;
  metadata: string;
  status: string;
  private: number;
  created_at: string;
  updated_at: string;
}

const KINDS = new Set<FileSearchDocumentKind>([
  "extracted_text",
  "extraction_summary",
  "ocr_text",
  "vision_summary",
  "transcript",
  "llm_summary",
  "semantic_metadata",
  "manual_note",
]);

const STATUSES = new Set<FileSearchDocumentStatus>([
  "ready",
  "partial",
  "unsupported",
  "error",
  "stale",
]);

export function upsertFileSearchDocument(input: UpsertFileSearchDocumentInput): FileSearchDocument {
  validateInput(input);
  const db = getDb();
  const file = db.query<{ id: string }, [string]>("SELECT id FROM files WHERE id = ?").get(input.file_id);
  if (!file) throw new Error(`File not found: ${input.file_id}`);

  const kind = input.kind;
  const sourceRef = input.source_ref.trim();
  const contentHash = normalizeContentHash(input.content_hash, input.searchable_text);
  const searchableText = input.searchable_text;
  const metadata = input.metadata ?? {};
  const extractor = (input.extractor ?? "unknown").trim() || "unknown";
  const status = input.status ?? "ready";
  const isPrivate = input.private ?? true;
  const now = new Date().toISOString();

  return db.transaction(() => {
    if (input.replace_existing !== false) {
      const staleIds = db.query<{ id: string }, [string, string, string, string]>(
        `SELECT id
         FROM file_search_documents
         WHERE file_id = ? AND kind = ? AND source_ref = ? AND content_hash != ? AND status != 'stale'`,
      ).all(input.file_id, kind, sourceRef, contentHash);
      db.run(
        `UPDATE file_search_documents
         SET status = 'stale', updated_at = ?
         WHERE file_id = ? AND kind = ? AND source_ref = ? AND content_hash != ? AND status != 'stale'`,
        [now, input.file_id, kind, sourceRef, contentHash],
      );
      for (const stale of staleIds) refreshFileSearchDocumentFts(stale.id);
    }

    const existing = input.id
      ? db.query<FileSearchDocumentRow, [string]>("SELECT * FROM file_search_documents WHERE id = ?").get(input.id)
      : db.query<FileSearchDocumentRow, [string, string, string, string]>(
          `SELECT * FROM file_search_documents
           WHERE file_id = ? AND kind = ? AND source_ref = ? AND content_hash = ?`,
        ).get(input.file_id, kind, sourceRef, contentHash);

    const id = existing?.id ?? input.id ?? `fsd_${nanoid(14)}`;
    if (existing) {
      db.run(
        `UPDATE file_search_documents
         SET file_id = ?, revision_id = ?, source_ref = ?, kind = ?, extractor = ?,
             content_hash = ?, searchable_text = ?, metadata = ?, status = ?,
             private = ?, updated_at = ?
         WHERE id = ?`,
        [
          input.file_id,
          input.revision_id ?? null,
          sourceRef,
          kind,
          extractor,
          contentHash,
          searchableText,
          JSON.stringify(metadata),
          status,
          isPrivate ? 1 : 0,
          now,
          id,
        ],
      );
    } else {
      db.run(
        `INSERT INTO file_search_documents (
          id, file_id, revision_id, source_ref, kind, extractor, content_hash,
          searchable_text, metadata, status, private, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.file_id,
          input.revision_id ?? null,
          sourceRef,
          kind,
          extractor,
          contentHash,
          searchableText,
          JSON.stringify(metadata),
          status,
          isPrivate ? 1 : 0,
          now,
          now,
        ],
      );
    }

    refreshFileSearchDocumentFts(id);
    return getFileSearchDocument(id)!;
  })();
}

export function getFileSearchDocument(id: string): FileSearchDocument | null {
  const row = getDb().query<FileSearchDocumentRow, [string]>(
    "SELECT * FROM file_search_documents WHERE id = ?",
  ).get(id);
  return row ? toDocument(row) : null;
}

export function listFileSearchDocuments(opts: ListFileSearchDocumentsOptions = {}): FileSearchDocument[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.file_id) {
    conditions.push("file_id = ?");
    params.push(opts.file_id);
  }
  if (opts.kind) {
    if (!KINDS.has(opts.kind)) throw new Error(`Invalid search document kind: ${opts.kind}`);
    conditions.push("kind = ?");
    params.push(opts.kind);
  }
  if (opts.status) {
    if (!STATUSES.has(opts.status)) throw new Error(`Invalid search document status: ${opts.status}`);
    conditions.push("status = ?");
    params.push(opts.status);
  }

  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return getDb()
    .query<FileSearchDocumentRow, any[]>(
      `SELECT * FROM file_search_documents
       ${where}
       ORDER BY updated_at DESC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset)
    .map(toDocument);
}

export function deleteFileSearchDocument(id: string): boolean {
  const db = getDb();
  return db.transaction(() => {
    db.run("DELETE FROM file_search_documents_fts WHERE document_id = ?", [id]);
    const result = db.run("DELETE FROM file_search_documents WHERE id = ?", [id]);
    return result.changes > 0;
  })();
}

export function deleteFileSearchDocumentsForFile(fileId: string): number {
  const db = getDb();
  return db.transaction(() => {
    db.run("DELETE FROM file_search_documents_fts WHERE file_id = ?", [fileId]);
    const result = db.run("DELETE FROM file_search_documents WHERE file_id = ?", [fileId]);
    return result.changes;
  })();
}

export function refreshFileSearchDocumentFts(id: string): void {
  const db = getDb();
  const row = db.query<FileSearchDocumentRow, [string]>(
    "SELECT * FROM file_search_documents WHERE id = ?",
  ).get(id);
  db.run("DELETE FROM file_search_documents_fts WHERE document_id = ?", [id]);
  if (!row || (row.status !== "ready" && row.status !== "partial")) return;
  db.run(
    `INSERT INTO file_search_documents_fts (
      document_id, file_id, kind, extractor, searchable_text, metadata
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.file_id,
      row.kind,
      row.extractor,
      row.searchable_text,
      row.metadata,
    ],
  );
}

export function refreshAllFileSearchDocumentFts(): number {
  const db = getDb();
  const ids = db.query<{ id: string }, []>("SELECT id FROM file_search_documents").all();
  db.run("DELETE FROM file_search_documents_fts");
  for (const row of ids) refreshFileSearchDocumentFts(row.id);
  return ids.length;
}

export function getFileSearchIndexStats(): FileSearchIndexStats {
  const db = getDb();
  const total = db.query<{ count: number }, []>(
    "SELECT COUNT(*) AS count FROM file_search_documents",
  ).get()?.count ?? 0;
  const indexedFiles = db.query<{ count: number }, []>(
    "SELECT COUNT(DISTINCT file_id) AS count FROM file_search_documents WHERE status IN ('ready', 'partial')",
  ).get()?.count ?? 0;
  const activeFiles = db.query<{ count: number }, []>(
    "SELECT COUNT(*) AS count FROM files WHERE status = 'active'",
  ).get()?.count ?? 0;
  const activeIndexedFiles = db.query<{ count: number }, []>(
    `SELECT COUNT(DISTINCT f.id) AS count
     FROM files f
     JOIN file_search_documents d ON d.file_id = f.id
     WHERE f.status = 'active' AND d.status IN ('ready', 'partial')`,
  ).get()?.count ?? 0;
  const organizedActiveFiles = db.query<{ count: number }, []>(
    `SELECT COUNT(DISTINCT f.id) AS count
     FROM files f
     JOIN file_organization_reviews r ON r.file_id = f.id
     WHERE f.status = 'active'`,
  ).get()?.count ?? 0;
  const activeFilesWithOwner = db.query<{ count: number }, []>(
    `SELECT COUNT(DISTINCT f.id) AS count
     FROM files f
     JOIN file_organization_reviews r ON r.file_id = f.id
     WHERE f.status = 'active' AND COALESCE(r.owner, '') != ''`,
  ).get()?.count ?? 0;
  const activeFilesWithTargetPath = db.query<{ count: number }, []>(
    `SELECT COUNT(DISTINCT f.id) AS count
     FROM files f
     JOIN file_organization_reviews r ON r.file_id = f.id
     WHERE f.status = 'active' AND COALESCE(r.target_path, '') != ''`,
  ).get()?.count ?? 0;
  const activeFilesWithCanonicalName = db.query<{ count: number }, []>(
    "SELECT COUNT(*) AS count FROM files WHERE status = 'active' AND COALESCE(canonical_name, '') != ''",
  ).get()?.count ?? 0;
  const stale = db.query<{ count: number }, []>(
    "SELECT COUNT(*) AS count FROM file_search_documents WHERE status = 'stale'",
  ).get()?.count ?? 0;
  const byKind = db.query<{ kind: FileSearchDocumentKind; count: number }, []>(
    "SELECT kind, COUNT(*) AS count FROM file_search_documents GROUP BY kind ORDER BY kind",
  ).all();
  const byStatus = db.query<{ status: FileSearchDocumentStatus; count: number }, []>(
    "SELECT status, COUNT(*) AS count FROM file_search_documents GROUP BY status ORDER BY status",
  ).all();
  const byOwner = db.query<{ owner: string; active_files: number; indexed_files: number }, []>(
    `SELECT COALESCE(NULLIF(r.owner, ''), 'unassigned') AS owner,
            COUNT(DISTINCT f.id) AS active_files,
            COUNT(DISTINCT CASE WHEN d.file_id IS NOT NULL THEN f.id END) AS indexed_files
     FROM files f
     LEFT JOIN file_organization_reviews r ON r.file_id = f.id
     LEFT JOIN file_search_documents d ON d.file_id = f.id AND d.status IN ('ready', 'partial')
     WHERE f.status = 'active'
     GROUP BY owner
     ORDER BY active_files DESC, owner`,
  ).all();
  const byReviewStatus = db.query<{
    review_status: FileSearchIndexStats["by_review_status"][number]["review_status"];
    active_files: number;
    indexed_files: number;
  }, []>(
    `SELECT COALESCE(NULLIF(r.review_status, ''), 'none') AS review_status,
            COUNT(DISTINCT f.id) AS active_files,
            COUNT(DISTINCT CASE WHEN d.file_id IS NOT NULL THEN f.id END) AS indexed_files
     FROM files f
     LEFT JOIN file_organization_reviews r ON r.file_id = f.id
     LEFT JOIN file_search_documents d ON d.file_id = f.id AND d.status IN ('ready', 'partial')
     WHERE f.status = 'active'
     GROUP BY review_status
     ORDER BY active_files DESC, review_status`,
  ).all();

  return {
    documents: total,
    indexed_files: indexedFiles,
    active_files: activeFiles,
    active_indexed_files: activeIndexedFiles,
    missing_indexed_active_files: Math.max(activeFiles - activeIndexedFiles, 0),
    indexed_active_coverage_pct: percentage(activeIndexedFiles, activeFiles),
    organized_active_files: organizedActiveFiles,
    active_files_with_owner: activeFilesWithOwner,
    active_files_with_target_path: activeFilesWithTargetPath,
    active_files_with_canonical_name: activeFilesWithCanonicalName,
    stale_documents: stale,
    by_kind: byKind,
    by_status: byStatus,
    by_owner: byOwner,
    by_review_status: byReviewStatus,
  };
}

function percentage(part: number, total: number): number {
  if (!total) return 0;
  return Math.round((part / total) * 10000) / 100;
}

function validateInput(input: UpsertFileSearchDocumentInput): void {
  if (!input.file_id) throw new Error("file_id is required.");
  if (!input.source_ref?.trim()) throw new Error("source_ref is required.");
  if (!KINDS.has(input.kind)) throw new Error(`Invalid search document kind: ${input.kind}`);
  if (input.status && !STATUSES.has(input.status)) throw new Error(`Invalid search document status: ${input.status}`);
  if (input.searchable_text.length === 0 && (input.status ?? "ready") !== "unsupported") {
    throw new Error("searchable_text is required unless status is unsupported.");
  }
}

function normalizeContentHash(raw: string | undefined, text: string): string {
  const value = raw?.trim();
  if (!value) {
    return `sha256:${createHash("sha256").update(text).digest("hex")}`;
  }
  const hash = value.startsWith("sha256:") ? value.slice("sha256:".length) : value;
  if (/^[a-f0-9]{64}$/i.test(hash)) return `sha256:${hash.toLowerCase()}`;
  return value;
}

function toDocument(row: FileSearchDocumentRow): FileSearchDocument {
  return {
    id: row.id,
    file_id: row.file_id,
    revision_id: row.revision_id ?? undefined,
    source_ref: row.source_ref,
    kind: row.kind as FileSearchDocumentKind,
    extractor: row.extractor,
    content_hash: row.content_hash,
    searchable_text: row.searchable_text,
    metadata: parseJsonObject(row.metadata),
    status: row.status as FileSearchDocumentStatus,
    private: Boolean(row.private),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
