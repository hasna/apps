import { createHash } from "node:crypto";
import { extractTextFromBuffer, extractTextFromFile, type ExtractTextFromBufferInput, type ExtractTextOptions } from "./extraction.js";
import type {
  ExtractedTextResult,
  ExtractedTextSegment,
  ExtractionSnapshot,
  ExtractionSnapshotPage,
  ExtractionSnapshotSection,
} from "../types/index.js";

const SNAPSHOT_EXTRACTOR = "open-files-extraction-snapshot-v1";

export type ExtractionSnapshotOptions = ExtractTextOptions;

export async function extractTextSnapshotFromFile(fileId: string, opts: ExtractionSnapshotOptions = {}): Promise<ExtractionSnapshot> {
  return buildExtractionSnapshot(await extractTextFromFile(fileId, opts));
}

export function extractTextSnapshotFromBuffer(input: ExtractTextFromBufferInput): ExtractionSnapshot {
  return buildExtractionSnapshot(extractTextFromBuffer(input));
}

export function buildExtractionSnapshot(result: ExtractedTextResult): ExtractionSnapshot {
  const normalizedText = normalizeSnapshotText(result.segments);
  const contentHash = sha256(normalizedText);
  const pages = buildPages(result.segments);
  const sections = buildSections(result.segments);

  return {
    snapshot_id: `snap_${sha256([
      result.source_ref,
      result.revision_id ?? "",
      contentHash,
      SNAPSHOT_EXTRACTOR,
    ].join("|")).slice(0, 24)}`,
    source_ref: result.source_ref,
    file_id: result.file_id,
    revision_id: result.revision_id,
    status: result.status,
    status_reason: result.status_reason,
    extractor: SNAPSHOT_EXTRACTOR,
    content_hash_algorithm: "sha256",
    content_hash: contentHash,
    mime: result.mime,
    encoding: result.encoding,
    language_hints: inferLanguageHints(normalizedText, result.mime),
    content_hints: inferContentHints(result.mime),
    redacted: result.redacted,
    truncated: result.truncated,
    bytes_read: result.bytes_read,
    total_size: result.total_size,
    pages,
    sections,
    metadata: {
      generated_at: new Date().toISOString(),
      max_bytes: result.metadata.max_bytes,
      max_segment_chars: result.metadata.max_segment_chars,
      source_segments: result.segments.length,
    },
  };
}

function buildPages(segments: ExtractedTextSegment[]): ExtractionSnapshotPage[] {
  if (segments.length === 0) return [];
  const groups = new Map<number, ExtractedTextSegment[]>();
  for (const segment of segments) {
    const page = Number(segment.page_hint ?? 1) || 1;
    const current = groups.get(page) ?? [];
    current.push(segment);
    groups.set(page, current);
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([page_number, pageSegments]) => {
      const sorted = pageSegments.sort((a, b) => a.index - b.index);
      return {
        page_number,
        text: normalizeSnapshotText(sorted),
        byte_start: min(sorted.map((segment) => segment.byte_start)),
        byte_end: max(sorted.map((segment) => segment.byte_end)),
        char_start: min(sorted.map((segment) => segment.char_start)),
        char_end: max(sorted.map((segment) => segment.char_end)),
        line_start: min(sorted.map((segment) => segment.line_start)),
        line_end: max(sorted.map((segment) => segment.line_end)),
        segment_indexes: sorted.map((segment) => segment.index),
      };
    });
}

function buildSections(segments: ExtractedTextSegment[]): ExtractionSnapshotSection[] {
  if (segments.length === 0) return [];
  const sections: ExtractionSnapshotSection[] = [];
  let current: ExtractedTextSegment[] = [];
  let title: string | undefined;

  const flush = () => {
    if (current.length === 0) return;
    const sorted = [...current].sort((a, b) => a.index - b.index);
    const page = Number(sorted[0]?.page_hint ?? 1) || 1;
    const sectionId = `sec_${sha256(`${title ?? "untitled"}|${sorted.map((segment) => segment.index).join(",")}`).slice(0, 12)}`;
    sections.push({
      id: sectionId,
      title,
      page_number: page,
      text: normalizeSnapshotText(sorted),
      byte_start: min(sorted.map((segment) => segment.byte_start)),
      byte_end: max(sorted.map((segment) => segment.byte_end)),
      char_start: min(sorted.map((segment) => segment.char_start)),
      char_end: max(sorted.map((segment) => segment.char_end)),
      line_start: min(sorted.map((segment) => segment.line_start)),
      line_end: max(sorted.map((segment) => segment.line_end)),
      segment_indexes: sorted.map((segment) => segment.index),
    });
    current = [];
  };

  for (const segment of segments.sort((a, b) => a.index - b.index)) {
    if (current.length > 0 && segment.section_hint !== title) {
      flush();
    }
    if (current.length === 0) title = segment.section_hint;
    current.push(segment);
  }
  flush();
  return sections;
}

function normalizeSnapshotText(segments: ExtractedTextSegment[]): string {
  return segments
    .sort((a, b) => a.index - b.index)
    .map((segment) => segment.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n"))
    .join("")
    .replace(/[ \t]+\n/g, "\n");
}

function inferContentHints(mime: string): string[] {
  const normalized = mime.split(";")[0]!.toLowerCase();
  const hints = new Set<string>();
  if (normalized.includes("markdown")) hints.add("markdown");
  if (normalized.includes("json")) hints.add("json");
  if (normalized.includes("xml")) hints.add("xml");
  if (normalized.includes("html")) hints.add("html");
  if (normalized.includes("csv") || normalized.includes("tsv")) hints.add("tabular");
  if (normalized.includes("javascript") || normalized.includes("typescript") || normalized.includes("sql")) hints.add("code");
  if (normalized.startsWith("text/") && hints.size === 0) hints.add("plain_text");
  return [...hints];
}

function inferLanguageHints(text: string, mime: string): string[] {
  const hints = new Set<string>();
  const normalized = mime.split(";")[0]!.toLowerCase();
  if (normalized.includes("javascript")) hints.add("javascript");
  if (normalized.includes("typescript")) hints.add("typescript");
  if (normalized.includes("sql")) hints.add("sql");
  if (/\b(the|and|or|with|from|for|this|that)\b/i.test(text)) hints.add("en");
  return [...hints];
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function min(values: number[]): number {
  return Math.min(...values);
}

function max(values: number[]): number {
  return Math.max(...values);
}
