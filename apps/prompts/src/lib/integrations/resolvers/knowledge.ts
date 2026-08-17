/**
 * Knowledge resolver — {{knowledge:<full-id>}}.
 *
 * Reads through the owning @hasna/knowledge public SDK (`createKnowledgeClient()
 * .items.get(id)`), which routes local-or-hosted internally. Content is bounded
 * and redacted; oversized content fails closed with KNOWLEDGE_TOO_LARGE.
 */

import type { ParsedIntegrationRef, ResolvedIntegration } from "../types.js"
import { IntegrationResolutionError } from "../types.js"
import { PROJECTION_BOUNDS, redactText, truncateText } from "../redact.js"
import { loadOwningPackage } from "../load.js"

export const KNOWLEDGE_PROJECTION = "knowledge.v1"

export interface KnowledgeItemLike {
  id: string
  short_id?: string | null
  title: string
  content: string
  tags: string[]
  version?: number
  updated_at: string
  created_at: string
}

export interface KnowledgeProjectionData {
  id: string
  short_id: string | null
  title: string
  tags: string[]
  version: number | null
  updated_at: string | null
  content: string
  content_truncated: boolean
  redacted: boolean
}

/** Injectable read surface so tests never touch a live knowledge store. */
export interface KnowledgeReadSurface {
  getItem(id: string): Promise<KnowledgeItemLike | null>
}

export function projectKnowledgeItem(item: KnowledgeItemLike): KnowledgeProjectionData {
  const title = truncateText(redactText(item.title), PROJECTION_BOUNDS.knowledgeTitleChars)
  const content = truncateText(redactText(item.content), PROJECTION_BOUNDS.knowledgeContentChars)

  return {
    id: item.id,
    short_id: item.short_id ?? null,
    title: title.text,
    tags: (item.tags ?? []).slice(0, 20),
    version: typeof item.version === "number" ? item.version : null,
    updated_at: item.updated_at ?? null,
    content: content.text,
    content_truncated: content.truncated,
    redacted: title.text !== item.title || content.text !== item.content,
  }
}

export function serializeKnowledgeProjection(data: KnowledgeProjectionData): string {
  return JSON.stringify(data)
}

/**
 * Resolve one {{knowledge:<full-id>}} ref. `surface` is injectable for tests;
 * the default reads through the owning package's public SDK.
 */
export async function resolveKnowledge(
  ref: Extract<ParsedIntegrationRef, { kind: "knowledge" }>,
  surface?: KnowledgeReadSurface,
): Promise<ResolvedIntegration> {
  const read: KnowledgeReadSurface =
    surface ??
    {
      getItem: async (id) => {
        const mod = await loadOwningPackage("knowledge", "@hasna/knowledge")
        const createClient = mod["createKnowledgeClient"] as () => {
          items: { get: (id: string) => Promise<unknown> }
        }
        const item = await createClient().items.get(id)
        if (!item) return null
        return item as unknown as KnowledgeItemLike
      },
    }

  let item: KnowledgeItemLike | null
  try {
    item = await read.getItem(ref.id)
  } catch (e) {
    if (e instanceof IntegrationResolutionError) throw e
    const msg = e instanceof Error ? e.message : String(e)
    if (
      msg.toLowerCase().includes("unauthorized") ||
      msg.toLowerCase().includes("401") ||
      msg.toLowerCase().includes("api key") ||
      msg.toLowerCase().includes("unable to connect")
    ) {
      throw new IntegrationResolutionError("KNOWLEDGE_UNAVAILABLE", "knowledge", ref.raw, msg)
    }
    if (
      msg.toLowerCase().includes("timeout") ||
      msg.toLowerCase().includes("timed out") ||
      msg.toLowerCase().includes("connection") ||
      msg.toLowerCase().includes("fetch failed")
    ) {
      throw new IntegrationResolutionError("KNOWLEDGE_UNAVAILABLE", "knowledge", ref.raw, msg)
    }
    throw new IntegrationResolutionError("KNOWLEDGE_RESPONSE_INVALID", "knowledge", ref.raw, msg)
  }

  if (!item) {
    throw new IntegrationResolutionError("KNOWLEDGE_NOT_FOUND", "knowledge", ref.raw, `knowledge item not found: ${ref.id}`)
  }

  if (item.content.length > PROJECTION_BOUNDS.knowledgeContentMaxBytes) {
    throw new IntegrationResolutionError(
      "KNOWLEDGE_TOO_LARGE",
      "knowledge",
      ref.raw,
      `knowledge content exceeds ${PROJECTION_BOUNDS.knowledgeContentMaxBytes} chars`,
    )
  }

  const data = projectKnowledgeItem(item)
  return {
    kind: "knowledge",
    ref: ref.raw,
    source_id: data.id,
    source_version: data.version,
    projection: KNOWLEDGE_PROJECTION,
    text: serializeKnowledgeProjection(data),
  }
}
