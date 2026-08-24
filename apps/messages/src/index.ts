/**
 * @hasna/messages — direct agent-to-agent messaging with threads.
 *
 * Main export: the domain (MessagesService, MessagesStore), the types, and
 * the delivery model. Interface surfaces: `messages` CLI bin, `messages-mcp`
 * MCP bin, `messages-serve` HTTP bin, and the `./sdk` client export.
 *
 * Scope (Fable verdict, task 8c6b7978): messages owns direct agent-to-agent
 * DMs + DM-threads; conversations owns channels/announcements/channel-
 * threads. This package never reads conversations' store and vice versa.
 */
export { MessagesService, threadKeyFor, newThreadId, DELIVERY_STATES } from "./service";
export type { MessagesStore } from "./service";
export type {
  Agent,
  DeliveryState,
  Message,
  MessageDelivery,
  MessageDeliveryReport,
  DeliveredMessage,
  NewMessage,
  Thread,
  ThreadSummary,
  SendResult,
} from "./types";
export { version } from "./version";
