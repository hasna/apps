import { assertValidCaptureId, assertValidCorpusDate } from "./frontmatter.js";

/**
 * Corpus layout for auto-saved search captures (I38-00188).
 *
 * Object key: <prefix>/<yyyy-mm-dd>/<captureId>.md
 *
 * The date bucket comes from the capture's captured_at (UTC), so captures
 * enumerate by day for lifecycle policies and manual browsing. The captureId
 * is the search record id — unique, so the key is unique and the corpus is
 * append-only by construction (see writer.ts, which adds If-None-Match
 * create-exclusive PUT as well).
 */

export const DEFAULT_CAPTURE_PREFIX = "search";

export interface CaptureLayout {
  prefix: string;
}

/** Derive the S3 object key for one capture. */
export function captureObjectKey(
  layout: CaptureLayout,
  capturedAt: string,
  captureId: string,
): string {
  const date = capturedAt.slice(0, 10);
  assertValidCorpusDate(date);
  assertValidCaptureId(captureId);
  const prefix = (layout.prefix ?? DEFAULT_CAPTURE_PREFIX).replace(/^\/+|\/+$/g, "");
  if (prefix === "") {
    throw new Error("capture prefix must not be empty");
  }
  return `${prefix}/${date}/${captureId}.md`;
}

/** Parse a corpus object key back into its parts; null when it does not match. */
export function parseCaptureObjectKey(
  key: string,
): { prefix: string; date: string; captureId: string } | null {
  const m = key.match(/^([^/]+)\/(\d{4}-\d{2}-\d{2})\/([a-zA-Z0-9_-]+)\.md$/);
  if (!m) return null;
  return { prefix: m[1] ?? "", date: m[2] ?? "", captureId: m[3] ?? "" };
}
