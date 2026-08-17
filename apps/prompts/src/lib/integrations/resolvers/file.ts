/**
 * Files resolver — {{file:open-files://file/<id>/revision/<revision-id>}}.
 *
 * Reads through the owning @hasna/files package: `parseOpenFilesSourceRef` for
 * identity, then `buildFilesContextPack` for bounded, redacted extraction.
 * The context pack applies its own redaction and per-file byte caps; oversized
 * content surfaces as FILE_TOO_LARGE.
 */

import type { ParsedIntegrationRef, ResolvedIntegration } from "../types.js"
import { IntegrationResolutionError } from "../types.js"
import { loadOwningPackage } from "../load.js"

export const FILE_PROJECTION = "file.v1"

export interface FilePackLike {
  files: Array<{
    file_id: string
    source_ref: string
    attachment_ref: string
    revision_id?: string
    revision_ref?: string
    name: string | null
    path: string | null
    mime: string | null
    size: number | null
    status: string
    hash: string | null
    modified_at: string | null
    extraction?: {
      status: string
      status_reason?: string | null
      bytes_read: number | null
      total_size: number | null
      truncated: boolean
      redacted: boolean
    }
  }>
  counts: {
    requested_files: number
    matched_files: number
    included_files: number
    included_excerpts: number
    omitted_files: number
    omitted_excerpts: number
    omitted_chars: number
    errors: number
  }
  citations?: Array<{
    file_id: string
    source_ref?: string
    excerpt: string
    excerpt_chars: number
    start?: number
    end?: number
    page?: number | null
    revision_ref?: string
  }>
  errors?: Array<{ input: string; code: string; message: string }>
}

export interface FileProjectionData {
  uri: string
  file_id: string
  revision_id: string | null
  name: string | null
  mime: string | null
  size: number | null
  status: string
  modified_at: string | null
  extraction_status: string
  truncated: boolean
  redacted: boolean
  bytes_read: number | null
  total_size: number | null
  excerpts: Array<{ excerpt: string; excerpt_chars: number }>
  excerpt_count: number
  omitted_chars: number
}

/** Injectable read surface so tests never touch a live files store. */
export interface FileReadSurface {
  /** Returns the bounded redacted context pack for one source ref. */
  buildContextPack(sourceRef: string): Promise<FilePackLike>
}

export function projectFilePack(uri: string, pack: FilePackLike): FileProjectionData {
  const file = pack.files[0]
  const excerpts = (pack.citations ?? [])
    .filter((c) => c.file_id === file?.file_id)
    .slice(0, 12)
    .map((c) => ({ excerpt: c.excerpt, excerpt_chars: c.excerpt_chars }))

  return {
    uri,
    file_id: file?.file_id ?? "",
    revision_id: file?.revision_id ?? null,
    name: file?.name ?? null,
    mime: file?.mime ?? null,
    size: file?.size ?? null,
    status: file?.status ?? "unknown",
    modified_at: file?.modified_at ?? null,
    extraction_status: file?.extraction?.status ?? "none",
    truncated: file?.extraction?.truncated ?? false,
    redacted: file?.extraction?.redacted ?? false,
    bytes_read: file?.extraction?.bytes_read ?? null,
    total_size: file?.extraction?.total_size ?? null,
    excerpts,
    excerpt_count: excerpts.length,
    omitted_chars: pack.counts?.omitted_chars ?? 0,
  }
}

export function serializeFileProjection(data: FileProjectionData): string {
  return JSON.stringify(data)
}

/**
 * Resolve one {{file:open-files://...}} ref. `surface` is injectable for tests;
 * the default reads through the owning package's source-ref + context-pack
 * surfaces (bounded, redacted extraction).
 */
export async function resolveFile(
  ref: Extract<ParsedIntegrationRef, { kind: "file" }>,
  surface?: FileReadSurface,
): Promise<ResolvedIntegration> {
  const read: FileReadSurface =
    surface ??
    {
      buildContextPack: async (sourceRef) => {
        const mod = await loadOwningPackage("file", "@hasna/files")
        const buildPack = mod["buildFilesContextPack"] as (opts: Record<string, unknown>) => Promise<unknown>
        const pack = await buildPack({
          source_refs: [sourceRef],
          max_files: 1,
          max_excerpts: 12,
          max_excerpt_chars: 900,
          max_total_chars: 6000,
          max_bytes_per_file: 256 * 1024,
        })
        return pack as unknown as FilePackLike
      },
    }

  // On the default (owning-package) path, validate the URI through the owning
  // package's own parser first so a malformed ref fails as FILE_UNSUPPORTED
  // rather than a generic pack error. Injected test surfaces own their ref
  // handling, so the owning parser is only consulted on the default path.
  if (!surface) {
    try {
      const mod = await loadOwningPackage("file", "@hasna/files")
      const parseRef = mod["parseOpenFilesSourceRef"] as (uri: string) => { kind: string; file_id?: string }
      const parsed = parseRef(ref.uri)
      if (parsed.kind !== "file") {
        throw new IntegrationResolutionError("FILE_UNSUPPORTED", "file", ref.raw, `unsupported source ref kind: ${parsed.kind}`)
      }
      if (!parsed.file_id) {
        throw new IntegrationResolutionError("FILE_UNSUPPORTED", "file", ref.raw, "source ref missing file id")
      }
    } catch (e) {
      if (e instanceof IntegrationResolutionError) throw e
      throw new IntegrationResolutionError("FILE_UNSUPPORTED", "file", ref.raw, e instanceof Error ? e.message : String(e))
    }
  }

  let pack: FilePackLike
  try {
    pack = await read.buildContextPack(ref.uri)
  } catch (e) {
    if (e instanceof IntegrationResolutionError) throw e
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("denied") || msg.toLowerCase().includes("forbidden")) {
      throw new IntegrationResolutionError("FILE_DENIED", "file", ref.raw, msg)
    }
    throw new IntegrationResolutionError("FILE_ERROR", "file", ref.raw, msg)
  }

  // Named pack errors map to named resolver failures.
  const packError = pack.errors?.[0]
  if (packError) {
    if (packError.code === "not_found") {
      throw new IntegrationResolutionError("FILE_NOT_FOUND", "file", ref.raw, packError.message)
    }
    if (packError.code === "unsupported_ref" || packError.code === "invalid_ref") {
      throw new IntegrationResolutionError("FILE_UNSUPPORTED", "file", ref.raw, packError.message)
    }
    throw new IntegrationResolutionError("FILE_ERROR", "file", ref.raw, packError.message)
  }

  const file = pack.files[0]
  if (!file) {
    throw new IntegrationResolutionError("FILE_NOT_FOUND", "file", ref.raw, "no file in context pack")
  }
  if (file.extraction?.status === "too_large") {
    throw new IntegrationResolutionError("FILE_TOO_LARGE", "file", ref.raw, `file exceeds extraction byte cap (${file.extraction.total_size ?? "?"} bytes)`)
  }
  if (file.extraction?.status === "unsupported") {
    throw new IntegrationResolutionError("FILE_UNSUPPORTED", "file", ref.raw, "file type not supported for extraction")
  }
  if (file.extraction?.status === "error") {
    throw new IntegrationResolutionError("FILE_ERROR", "file", ref.raw, file.extraction.status_reason ?? "extraction failed")
  }

  const data = projectFilePack(ref.uri, pack)
  return {
    kind: "file",
    ref: ref.raw,
    source_id: data.file_id,
    source_version: data.revision_id,
    projection: FILE_PROJECTION,
    text: serializeFileProjection(data),
  }
}
