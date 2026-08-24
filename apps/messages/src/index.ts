/**
 * @hasna/messages — direct agent-to-agent messaging with threads.
 *
 * Main export: the domain (MessagesService, MessagesStore) and the types.
 * Interface surfaces: `messages` CLI bin, `messages-mcp` MCP bin,
 * `messages-serve` HTTP bin, and the `./sdk` client export.
 */
export { MessagesService, threadKeyFor, newThreadId } from "./service";
export type { MessagesStore } from "./service";
export type { Message, NewMessage, Thread, ThreadSummary, SendResult } from "./types";
export { version } from "./version";
