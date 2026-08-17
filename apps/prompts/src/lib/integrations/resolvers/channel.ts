/**
 * Conversations (channel) resolver — {{channel:<chn-id>}}.
 *
 * Reads through the owning @hasna/conversations Store. Channel IDs survive
 * renames, so the resolver resolves the ID to its current name via the store's
 * channel listing, then reads ONE bounded message-preview page with
 * `mark_read` never set — preview reads must not mark messages read or mutate
 * read state.
 */

import type { ParsedIntegrationRef, ResolvedIntegration } from "../types.js"
import { IntegrationResolutionError } from "../types.js"
import { PROJECTION_BOUNDS, redactText, truncateText } from "../redact.js"
import { loadOwningPackage } from "../load.js"

export const CHANNEL_PROJECTION = "channel.v1"

export interface ChannelPreviewItem {
  id: number
  from_agent: string
  created_at: string
  priority: string
  preview: string
  truncated: boolean
  redacted: boolean
  has_attachments: boolean
  blocking: boolean
}

export interface ChannelProjectionData {
  channel_id: string
  name: string
  description: string | null
  topic: string | null
  tags: string[]
  message_count: number
  previews: ChannelPreviewItem[]
  has_more: boolean
  skipped_count: number
  cursor: number
  redacted: boolean
}

/** Owning package's channel shape (id survives rename). */
export interface ResolvedChannel {
  id: string
  name: string
  description: string | null
  topic: string | null
  tags: string[]
}

/** Owning package's bounded preview page shape. */
export interface MessagePreviewPageLike {
  messages: Array<{
    id: number
    from_agent: string
    created_at: string
    priority: string
    preview: string
    truncated: boolean
    redacted: boolean
    has_attachments: boolean
    blocking: boolean
  }>
  count: number
  limit: number
  cursor: number
  has_more: boolean
  skipped_count: number
}

/** Injectable read surface so tests never touch a live conversations store. */
export interface ChannelReadSurface {
  listChannels(): Promise<ResolvedChannel[]>
  readMessagePreviews(opts: {
    channel: string
    latest?: number
    preview_bytes?: number
    max_bytes?: number
  }): Promise<MessagePreviewPageLike>
}

export function projectChannel(
  channel: ResolvedChannel,
  page: MessagePreviewPageLike,
): ChannelProjectionData {
  const description = truncateText(
    redactText(channel.description ?? ""),
    PROJECTION_BOUNDS.channelDescriptionChars,
  )
  const topic = truncateText(
    redactText(channel.topic ?? ""),
    PROJECTION_BOUNDS.channelTopicChars,
  )

  const previews: ChannelPreviewItem[] = page.messages.slice(0, PROJECTION_BOUNDS.channelPreviewLimit).map((m) => ({
    id: m.id,
    from_agent: m.from_agent,
    created_at: m.created_at,
    priority: m.priority,
    preview: redactText(m.preview),
    truncated: m.truncated,
    redacted: m.redacted,
    has_attachments: m.has_attachments,
    blocking: m.blocking,
  }))

  return {
    channel_id: channel.id,
    name: channel.name,
    description: description.text || null,
    topic: topic.text || null,
    tags: (channel.tags ?? []).slice(0, PROJECTION_BOUNDS.channelTags),
    message_count: page.count,
    previews,
    has_more: page.has_more,
    skipped_count: page.skipped_count,
    cursor: page.cursor,
    redacted: description.truncated || topic.truncated || previews.some((p) => p.redacted),
  }
}

export function serializeChannelProjection(data: ChannelProjectionData): string {
  return JSON.stringify(data)
}

/**
 * Resolve one {{channel:<chn-id>}} ref. `surface` is injectable for tests; the
 * default reads through the owning package's Store (local or hosted), and the
 * preview read never marks messages read.
 */
export async function resolveChannel(
  ref: Extract<ParsedIntegrationRef, { kind: "channel" }>,
  surface?: ChannelReadSurface,
): Promise<ResolvedIntegration> {
  const read: ChannelReadSurface =
    surface ??
    {
      listChannels: async () => {
        const mod = await loadOwningPackage("channel", "@hasna/conversations")
        const getStore = mod["getStore"] as () => {
          listChannels: () => Promise<unknown[]>
        }
        const channels = await getStore().listChannels()
        return (channels as unknown[]).map((c) => ({
          id: (c as { id: string }).id,
          name: (c as { name: string }).name,
          description: (c as { description: string | null }).description ?? null,
          topic: (c as { topic: string | null }).topic ?? null,
          tags: Array.isArray((c as { tags?: unknown }).tags)
            ? ((c as { tags: unknown[] }).tags as string[])
            : [],
        }))
      },
      readMessagePreviews: async (opts) => {
        const mod = await loadOwningPackage("channel", "@hasna/conversations")
        const getStore = mod["getStore"] as () => {
          readMessagePreviews: (opts: Record<string, unknown>) => Promise<unknown>
        }
        // Pure preview read. No mark_read flag is ever passed; the store's
        // preview verb is a SELECT that does not touch read state.
        const page = await getStore().readMessagePreviews({
          channel: opts.channel,
          latest: opts.latest,
          preview_bytes: opts.preview_bytes,
          max_bytes: opts.max_bytes,
        })
        return page as unknown as MessagePreviewPageLike
      },
    }

  let channels: ResolvedChannel[]
  try {
    channels = await read.listChannels()
  } catch (e) {
    if (e instanceof IntegrationResolutionError) throw e
    const msg = e instanceof Error ? e.message : String(e)
    if (
      msg.toLowerCase().includes("unauthorized") ||
      msg.toLowerCase().includes("401") ||
      msg.toLowerCase().includes("api key")
    ) {
      throw new IntegrationResolutionError("CHANNEL_AUTH_FAILED", "channel", ref.raw, msg)
    }
    if (
      msg.toLowerCase().includes("timeout") ||
      msg.toLowerCase().includes("timed out") ||
      msg.toLowerCase().includes("connection") ||
      msg.toLowerCase().includes("fetch failed")
    ) {
      throw new IntegrationResolutionError("CHANNEL_TIMEOUT", "channel", ref.raw, msg)
    }
    throw new IntegrationResolutionError("CHANNEL_RESPONSE_INVALID", "channel", ref.raw, msg)
  }

  const channel = channels.find((c) => c.id === ref.channelId)
  if (!channel) {
    throw new IntegrationResolutionError("CHANNEL_NOT_FOUND", "channel", ref.raw, `channel not found: ${ref.channelId}`)
  }

  let page: MessagePreviewPageLike
  try {
    page = await read.readMessagePreviews({
      channel: channel.name,
      latest: PROJECTION_BOUNDS.channelPreviewLimit,
      preview_bytes: PROJECTION_BOUNDS.channelPreviewBytes,
      max_bytes: PROJECTION_BOUNDS.channelMaxBytes,
    })
  } catch (e) {
    if (e instanceof IntegrationResolutionError) throw e
    const msg = e instanceof Error ? e.message : String(e)
    if (
      msg.toLowerCase().includes("unauthorized") ||
      msg.toLowerCase().includes("401") ||
      msg.toLowerCase().includes("api key")
    ) {
      throw new IntegrationResolutionError("CHANNEL_AUTH_FAILED", "channel", ref.raw, msg)
    }
    if (
      msg.toLowerCase().includes("timeout") ||
      msg.toLowerCase().includes("timed out") ||
      msg.toLowerCase().includes("connection") ||
      msg.toLowerCase().includes("fetch failed")
    ) {
      throw new IntegrationResolutionError("CHANNEL_TIMEOUT", "channel", ref.raw, msg)
    }
    throw new IntegrationResolutionError("CHANNEL_RESPONSE_INVALID", "channel", ref.raw, msg)
  }

  const data = projectChannel(channel, page)
  return {
    kind: "channel",
    ref: ref.raw,
    source_id: data.channel_id,
    source_version: null,
    projection: CHANNEL_PROJECTION,
    text: serializeChannelProjection(data),
  }
}
