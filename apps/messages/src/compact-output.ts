import type {
  Agent,
  DeliveredMessage,
  DiscoveredAgent,
  InboxItem,
  Message,
  MessageDeliveryReport,
  ThreadSummary,
} from "./types.js";

export const DEFAULT_OUTPUT_LIMIT = 20;
export const MAX_OUTPUT_LIMIT = 100;

export interface CollectionOptions {
  limit?: number;
  cursor?: number;
  verbose?: boolean;
}

function normalizedLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_OUTPUT_LIMIT;
  if (!Number.isInteger(value) || value <= 0) throw new Error("limit must be a positive integer");
  if (value > MAX_OUTPUT_LIMIT) throw new Error(`limit must be <= ${MAX_OUTPUT_LIMIT}`);
  return value;
}

function normalizedCursor(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0) throw new Error("cursor must be a non-negative integer");
  return value;
}

export function truncateText(value: string | null | undefined, max = 160): string | null {
  if (!value) return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function collectionPage<K extends string, T, U>(
  key: K,
  items: T[],
  options: CollectionOptions,
  summarize: (item: T) => U,
): Record<K, Array<T | U>> & {
  count: number;
  total: number;
  limit: number;
  cursor: number;
  next_cursor: number | null;
  compact: boolean;
  hint: string;
} {
  const limit = normalizedLimit(options.limit);
  const cursor = normalizedCursor(options.cursor);
  const selected = items.slice(cursor, cursor + limit);
  const nextCursor = cursor + selected.length < items.length ? cursor + selected.length : null;
  return {
    [key]: options.verbose ? selected : selected.map(summarize),
    count: selected.length,
    total: items.length,
    limit,
    cursor,
    next_cursor: nextCursor,
    compact: !options.verbose,
    hint: nextCursor === null
      ? "Set verbose=true for full fields in this page, or full=true for the legacy complete response."
      : `Continue with cursor=${nextCursor}; set verbose=true for full fields in a page, or full=true for the legacy complete response.`,
  } as Record<K, Array<T | U>> & {
    count: number; total: number; limit: number; cursor: number; next_cursor: number | null;
    compact: boolean; hint: string;
  };
}

export function compactAgent(agent: Agent) {
  return {
    id: agent.id,
    name: agent.name,
    display_name: truncateText(agent.display_name, 80),
    last_seen_at: agent.last_seen_at,
  };
}

export function compactDiscoveredAgent(agent: DiscoveredAgent) {
  return {
    ...compactAgent(agent),
    station: agent.station,
    application: agent.application,
    online: agent.online,
  };
}

export function compactThread(thread: ThreadSummary) {
  return {
    id: thread.id,
    peer: thread.agent_a,
    peer_alt: thread.agent_b,
    last_message_at: thread.last_message_at,
    message_count: thread.message_count,
    unread_count: thread.unread_count,
    closed: thread.closed,
    last_message_preview: truncateText(thread.last_message_preview, 120),
  };
}

export function compactMessage(message: Message) {
  return {
    id: message.id,
    thread_id: message.thread_id,
    from_agent: message.from_agent,
    content: truncateText(message.content, 160),
    reply_to: message.reply_to,
    created_at: message.created_at,
    seq: message.seq,
  };
}

export function compactDeliveredMessage(message: DeliveredMessage) {
  return {
    ...compactMessage(message),
    to_agent: message.to_agent,
    delivery_state: message.delivery.state,
  };
}

export function compactInboxItem(item: InboxItem) {
  return {
    message: compactMessage(item.message),
    delivery: {
      recipient: item.delivery.recipient,
      state: item.delivery.state,
    },
  };
}

export function compactDeliveryReport(report: MessageDeliveryReport) {
  return {
    message: compactMessage(report.message),
    deliveries: report.deliveries.map((delivery) => ({ recipient: delivery.recipient, state: delivery.state })),
  };
}
