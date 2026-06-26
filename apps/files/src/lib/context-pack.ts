import { createHash } from "node:crypto";
import { getFile, getFileByPath } from "../db/files.js";
import { searchFiles } from "../db/search.js";
import {
  buildOpenFilesFileRef,
  parseOpenFilesSourceRef,
} from "./source-ref.js";
import { resolveKnowledgeSourceRef } from "./knowledge-resolver.js";
import type {
  ExtractedTextSegment,
  ExtractedTextResult,
  FileWithTags,
  FilesContextPack,
  FilesContextPackAttachmentRef,
  FilesContextPackCitation,
  FilesContextPackError,
  FilesContextPackExcerpt,
  FilesContextPackFile,
  FilesContextPackOptions,
  FilesSearchPackOptions,
  SearchResult,
} from "../types/index.js";

const DEFAULT_MAX_FILES = 5;
const DEFAULT_MAX_EXCERPTS = 12;
const DEFAULT_MAX_EXCERPT_CHARS = 900;
const DEFAULT_MAX_TOTAL_CHARS = 6000;
const DEFAULT_MAX_BYTES_PER_FILE = 256 * 1024;

const MAX_FILES_CEILING = 50;
const MAX_EXCERPTS_CEILING = 200;
const MAX_EXCERPT_CHARS_CEILING = 4000;
const MAX_TOTAL_CHARS_CEILING = 50_000;
const MAX_BYTES_PER_FILE_CEILING = 2 * 1024 * 1024;

const DEFAULT_REDACT_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\b(?:xox[baprs]-[A-Za-z0-9-]{10,}|gh[pousr]_[A-Za-z0-9_]{20,})\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi,
  /\b[A-Z0-9_]*(?:API[_-]?KEY|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|SECRET|PASSWORD)\b\s*[:=]\s*["']?[^"'\s]{8,}/gi,
  /\b(api[_-]?key|access[_-]?token|auth[_-]?token|secret|password)\b\s*[:=]\s*["']?[^"'\s]{8,}/gi,
];

interface NormalizedLimits {
  max_files: number;
  max_excerpts: number;
  max_excerpt_chars: number;
  max_total_chars: number;
  max_bytes_per_file: number;
}

interface Candidate {
  input: string;
  file: FileWithTags;
  source_ref?: string;
  search?: SearchResult;
}

interface BuildOptions extends FilesContextPackOptions {
  mode: FilesContextPack["mode"];
  query?: string;
  candidates: Candidate[];
  requestedCount: number;
  matchedCount: number;
  initialErrors?: FilesContextPackError[];
}

export async function buildFilesContextPack(opts: FilesContextPackOptions = {}): Promise<FilesContextPack> {
  const resolved = resolveContextCandidates(opts);
  return buildPack({
    ...opts,
    mode: "context",
    candidates: resolved.candidates,
    requestedCount: resolved.requestedCount,
    matchedCount: resolved.candidates.length,
    initialErrors: resolved.errors,
  });
}

export async function buildFilesSearchPack(opts: FilesSearchPackOptions): Promise<FilesContextPack> {
  const limits = normalizeLimits(opts);
  const results = searchFiles(opts.query, {
    source_id: opts.source_id,
    machine_id: opts.machine_id,
    tag: opts.tag,
    ext: opts.ext,
    search_scope: opts.search_scope,
    limit: limits.max_files + 1,
    offset: opts.offset,
  });
  return buildPack({
    ...opts,
    mode: "search",
    candidates: results.map((result) => ({ input: result.id, file: result, search: result })),
    requestedCount: results.length,
    matchedCount: results.length,
  });
}

function resolveContextCandidates(opts: FilesContextPackOptions): {
  candidates: Candidate[];
  errors: FilesContextPackError[];
  requestedCount: number;
} {
  const inputs = [
    ...(opts.file_ids ?? []).map((id) => ({ kind: "file_id" as const, value: id })),
    ...(opts.source_refs ?? []).map((ref) => ({ kind: "source_ref" as const, value: ref })),
  ];
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  const errors: FilesContextPackError[] = [];

  for (const input of inputs) {
    try {
      const file = input.kind === "file_id"
        ? getFile(input.value)
        : fileFromSourceRef(input.value);
      if (!file) {
        errors.push({
          input: input.value,
          code: "not_found",
          message: `File not found for ${input.kind === "file_id" ? "id" : "source ref"}: ${input.value}`,
        });
        continue;
      }
      const dedupeKey = input.kind === "source_ref" ? input.value : file.id;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      candidates.push({ input: input.value, file, source_ref: input.kind === "source_ref" ? input.value : undefined });
    } catch (error) {
      errors.push({
        input: input.value,
        code: "invalid_ref",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { candidates, errors, requestedCount: inputs.length };
}

function fileFromSourceRef(sourceRef: string): FileWithTags | null {
  const parsed = parseOpenFilesSourceRef(sourceRef);
  if (parsed.kind === "file") return getFile(parsed.file_id);
  if (parsed.kind === "source_path") {
    const record = getFileByPath(parsed.source_id, parsed.path);
    return record ? getFile(record.id) : null;
  }
  throw new Error("Context packs support file and source path refs; asset refs are attachment refs only.");
}

async function buildPack(opts: BuildOptions): Promise<FilesContextPack> {
  const limits = normalizeLimits(opts);
  const customPatterns = opts.redact_patterns ?? [];
  const redactionPatterns = [...DEFAULT_REDACT_PATTERNS, ...customPatterns];
  const files: FilesContextPackFile[] = [];
  const citations: FilesContextPackCitation[] = [];
  const attachmentRefs: FilesContextPackAttachmentRef[] = [];
  const errors = [...(opts.initialErrors ?? [])];
  let remainingChars = limits.max_total_chars;
  let remainingExcerpts = limits.max_excerpts;
  let omittedFiles = Math.max(0, opts.candidates.length - limits.max_files);
  let omittedExcerpts = 0;
  let omittedChars = 0;

  for (const candidate of opts.candidates.slice(0, limits.max_files)) {
    if (remainingExcerpts <= 0 || remainingChars <= 0) {
      omittedFiles += 1;
      continue;
    }

    try {
      const resolution = await resolveKnowledgeSourceRef(candidate.source_ref ?? buildOpenFilesFileRef(candidate.file.id), {
        mode: "extracted_text",
        purpose: "agent_context",
        max_bytes: limits.max_bytes_per_file,
        max_segment_chars: limits.max_excerpt_chars,
        redact_patterns: redactionPatterns,
      });
      const extraction = resolution.extracted_text ?? emptyExtraction(resolution.source_ref, candidate.file.id, resolution.revision_id, resolution.status_reason);
      const attachmentRef = buildOpenFilesFileRef(candidate.file.id);
      const revisionRef = resolution.revision_id ? resolution.source_ref : undefined;
      const filePack: FilesContextPackFile = {
        file_id: candidate.file.id,
        source_ref: resolution.source_ref,
        attachment_ref: attachmentRef,
        revision_id: resolution.revision_id,
        revision_ref: revisionRef,
        name: resolution.name ?? candidate.file.name,
        path: resolution.path ?? candidate.file.path,
        mime: resolution.content.mime,
        size: resolution.content.size ?? candidate.file.size,
        status: candidate.file.status,
        hash: resolution.content.hash ?? candidate.file.hash,
        modified_at: resolution.updated_at ?? candidate.file.modified_at,
        indexed_at: candidate.file.indexed_at,
        search_match_sources: candidate.search?.search_match_sources,
        search_document_kinds: candidate.search?.search_document_kinds,
        extraction: {
          status: extraction.status,
          status_reason: extraction.status_reason,
          bytes_read: extraction.bytes_read,
          total_size: extraction.total_size,
          truncated: extraction.truncated,
          redacted: extraction.redacted,
        },
        excerpts: [],
        omitted_excerpt_count: 0,
        omitted_char_count: 0,
      };

      for (const segment of extraction.segments) {
        if (remainingExcerpts <= 0 || remainingChars <= 0) {
          filePack.omitted_excerpt_count += 1;
          omittedExcerpts += 1;
          omittedChars += segment.text.length;
          filePack.omitted_char_count += segment.text.length;
          continue;
        }
        const citationId = `c${citations.length + 1}`;
        const excerpt = excerptFromSegment(segment, citationId, remainingChars, limits.max_excerpt_chars);
        if (!excerpt.text) {
          filePack.omitted_excerpt_count += 1;
          omittedExcerpts += 1;
          omittedChars += segment.text.length;
          filePack.omitted_char_count += segment.text.length;
          continue;
        }
        remainingChars -= excerpt.text.length;
        remainingExcerpts -= 1;
        omittedChars += excerpt.omitted_chars;
        filePack.omitted_char_count += excerpt.omitted_chars;
        filePack.excerpts.push(excerpt);
        citations.push({
          id: citationId,
          file_id: candidate.file.id,
          source_ref: resolution.source_ref,
          attachment_ref: attachmentRef,
          path: resolution.path ?? candidate.file.path,
          name: resolution.name ?? candidate.file.name,
          line_start: excerpt.line_start,
          line_end: excerpt.line_end,
          char_start: excerpt.char_start,
          char_end: excerpt.char_end,
          section_hint: excerpt.section_hint,
        });
      }

      if (extraction.segments.length > filePack.excerpts.length + filePack.omitted_excerpt_count) {
        const extra = extraction.segments.length - filePack.excerpts.length - filePack.omitted_excerpt_count;
        filePack.omitted_excerpt_count += extra;
        omittedExcerpts += extra;
      }

      files.push(filePack);
      attachmentRefs.push({
        ref: attachmentRef,
        file_id: candidate.file.id,
        revision_ref: revisionRef,
        name: resolution.name ?? candidate.file.name,
        mime: resolution.content.mime,
        size: resolution.content.size ?? candidate.file.size,
      });
    } catch (error) {
      errors.push({
        input: candidate.input,
        code: "extract_failed",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const packWithoutId = {
    schema_version: "files.context_pack.v1" as const,
    pack_id: "",
    mode: opts.mode,
    query: opts.query,
    limits,
    counts: {
      requested_files: opts.requestedCount,
      matched_files: opts.matchedCount,
      included_files: files.length,
      included_excerpts: citations.length,
      omitted_files: omittedFiles,
      omitted_excerpts: omittedExcerpts,
      omitted_chars: omittedChars,
      errors: errors.length,
    },
    files,
    citations,
    attachment_refs: attachmentRefs,
    errors,
    safety: {
      redacted: redactionPatterns.length > 0,
      default_redactions: true,
      custom_redaction_patterns: customPatterns.length,
    },
  };

  return {
    ...packWithoutId,
    pack_id: `ctxpack_${sha256(stableStringify(packWithoutId)).slice(0, 24)}`,
  };
}

function emptyExtraction(
  sourceRef: string,
  fileId: string,
  revisionId: string | undefined,
  reason: string | undefined,
): ExtractedTextResult {
  return {
    source_ref: sourceRef,
    file_id: fileId,
    revision_id: revisionId,
    status: "unsupported",
    status_reason: reason ?? "No extracted text is available for this ref.",
    mime: "application/octet-stream",
    bytes_read: 0,
    truncated: false,
    redacted: false,
    segments: [],
    metadata: {
      extractor: "open-files-context-pack-v1",
      max_bytes: 0,
      max_segment_chars: 0,
      supported_mime: false,
    },
  };
}

function excerptFromSegment(
  segment: ExtractedTextSegment,
  citationId: string,
  remainingChars: number,
  maxExcerptChars: number,
): FilesContextPackExcerpt {
  const maxChars = Math.min(remainingChars, maxExcerptChars);
  const text = segment.text.slice(0, maxChars).trimEnd();
  const omittedChars = Math.max(0, segment.text.length - text.length);
  return {
    citation_id: citationId,
    text,
    line_start: segment.line_start,
    line_end: segment.line_end,
    char_start: segment.char_start,
    char_end: segment.char_start + text.length,
    omitted_chars: omittedChars,
    section_hint: segment.section_hint,
  };
}

function normalizeLimits(opts: FilesContextPackOptions): NormalizedLimits {
  return {
    max_files: normalizePositiveInt(opts.max_files, DEFAULT_MAX_FILES, MAX_FILES_CEILING),
    max_excerpts: normalizePositiveInt(opts.max_excerpts, DEFAULT_MAX_EXCERPTS, MAX_EXCERPTS_CEILING),
    max_excerpt_chars: normalizePositiveInt(opts.max_excerpt_chars, DEFAULT_MAX_EXCERPT_CHARS, MAX_EXCERPT_CHARS_CEILING),
    max_total_chars: normalizePositiveInt(opts.max_total_chars, DEFAULT_MAX_TOTAL_CHARS, MAX_TOTAL_CHARS_CEILING),
    max_bytes_per_file: normalizePositiveInt(opts.max_bytes_per_file, DEFAULT_MAX_BYTES_PER_FILE, MAX_BYTES_PER_FILE_CEILING),
  };
}

function normalizePositiveInt(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isInteger(value) || value! <= 0) return fallback;
  return Math.min(value!, max);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entryValue]) => [key, sortValue(entryValue)]),
  );
}
