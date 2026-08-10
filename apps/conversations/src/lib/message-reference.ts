import type { Message, ReadMessagesOptions } from "../types.js";
import { normalizeChannelName } from "./channel-names.js";

export type MessageReference =
  | { kind: "id"; id: number }
  | { kind: "uuid"; uuid: string };

export interface MessageReferenceScope {
  channel?: string;
  session_id?: string;
}

export interface MessageReferenceStore {
  getMessageById(id: number): Promise<Message | null>;
  getMessageByUuid(uuid: string): Promise<Message | null>;
  readMessages(options: ReadMessagesOptions): Promise<Message[]>;
}

const COMPACT_UUID = /^[0-9a-f]{32}$/i;
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHANNEL_SESSION_PREFIX = "channel:";

export function normalizeMessageUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return COMPACT_UUID.test(normalized) || CANONICAL_UUID.test(normalized)
    ? normalized
    : null;
}

export function parseMessageReference(value: unknown): MessageReference | null {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  if (/^[1-9]\d*$/.test(raw)) {
    const id = Number(raw);
    return Number.isSafeInteger(id) ? { kind: "id", id } : null;
  }
  const uuid = normalizeMessageUuid(raw);
  return uuid ? { kind: "uuid", uuid } : null;
}

/**
 * Resolve a message reference inside the caller's independently supplied scope.
 *
 * Numeric message IDs are mutable backend-local identifiers. A direct
 * `/messages/:id` read can therefore name a reachable row from the wrong
 * channel when server generations or tenant-local stores disagree. A scoped
 * forward read asks the collection endpoint for the exact ID inside the
 * expected channel/session instead; the equality check rejects the next row
 * when the requested ID is absent.
 *
 * UUIDs remain globally scoped and use the store's UUID compatibility path.
 */
export async function resolveMessageReference(
  store: MessageReferenceStore,
  reference: MessageReference,
  scope: MessageReferenceScope = {},
): Promise<Message | null> {
  if (reference.kind === "uuid") {
    return store.getMessageByUuid(reference.uuid);
  }

  const channel = scope.channel ? normalizeChannelName(scope.channel) : undefined;
  const sessionId = scope.session_id?.trim() || undefined;
  if (!channel && !sessionId) {
    return store.getMessageById(reference.id);
  }

  const rows = await store.readMessages({
    ...(channel ? { channel } : {}),
    ...(sessionId ? { session_id: sessionId } : {}),
    since_id: reference.id - 1,
    limit: 1,
    order: "asc",
  });
  const scoped = rows.find((message) => message.id === reference.id);
  if (scoped) return scoped;

  // Preserve the established mismatch diagnostic when the ID exists but the
  // caller supplied the wrong scope. This fallback is reached only after the
  // scoped collection read found no exact row, so a colliding direct lookup
  // cannot replace a valid parent that was found in the requested channel.
  return store.getMessageById(reference.id);
}

/** Return the canonical channel carried directly or through a channel session. */
export function messageChannel(
  message: Pick<Message, "channel" | "session_id">,
): string | undefined {
  if (message.channel) return normalizeChannelName(message.channel);
  if (!message.session_id?.startsWith(CHANNEL_SESSION_PREFIX)) return undefined;
  const channel = message.session_id.slice(CHANNEL_SESSION_PREFIX.length);
  return channel ? normalizeChannelName(channel) : undefined;
}
