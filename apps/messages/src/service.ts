/**
 * The single domain implementation of @hasna/messages.
 *
 * Per the one-domain-implementation law (monorepo-app-layout), this file owns
 * ALL business logic: thread identity, send/mark-read semantics, unread
 * accounting. The CLI, MCP server, HTTP server and SDK are interface layers
 * over this service — business logic is never duplicated across interfaces.
 *
 * The service is storage-agnostic through the `MessagesStore` interface. The
 * server layer selects the concrete store from configuration (SQLite default,
 * PostgreSQL via HASNA_MESSAGES_DATABASE_URL) — never from a mode enum.
 */
import type { Message, NewMessage, SendResult, Thread, ThreadSummary } from "./types";

export interface MessagesStore {
  insertMessage(message: Message): Promise<void>;
  findThread(id: string): Promise<Thread | null>;
  upsertThread(thread: Thread): Promise<void>;
  /** Most recent `limit` messages of the thread, oldest-first within the
   * window; full history when limit is omitted. */
  listMessages(threadId: string, limit?: number): Promise<Message[]>;  /** All threads involving the agent, newest activity first. */
  listThreads(agent: string): Promise<Thread[]>;
  /** Count of messages addressed to `agent` in the thread that are unread. */
  countUnread(threadId: string, agent: string): Promise<number>;
  countMessages(threadId: string): Promise<number>;
  markThreadRead(threadId: string, agent: string, at: string): Promise<void>;
}

/**
 * Canonical, order-independent thread key for a pair of agents.
 * "augustus" <-> "silvanus" is the same thread from either side.
 */
export function threadKeyFor(agentA: string, agentB: string): string {
  return [agentA, agentB].sort().join("__");
}

export function newThreadId(agentA: string, agentB: string): string {
  return `t_${threadKeyFor(agentA, agentB)}`;
}

export class MessagesService {
  constructor(private readonly store: MessagesStore) {}

  async send(input: NewMessage): Promise<SendResult> {
    const { from_agent, to_agent, content } = input;
    if (!from_agent || !to_agent) {
      throw new Error("from_agent and to_agent are required");
    }
    if (from_agent === to_agent) {
      throw new Error("a direct message must have two distinct agents");
    }
    if (!content || content.trim().length === 0) {
      throw new Error("content is required");
    }

    const threadId = newThreadId(from_agent, to_agent);
    let thread = await this.store.findThread(threadId);
    const now = new Date().toISOString();
    if (!thread) {
      thread = {
        id: threadId,
        agent_a: [from_agent, to_agent].sort()[0]!,
        agent_b: [from_agent, to_agent].sort()[1]!,
        last_message_at: now,
        created_at: now,
      };
      await this.store.upsertThread(thread);
    }

    const message: Message = {
      id: crypto.randomUUID(),
      thread_id: threadId,
      from_agent,
      to_agent,
      content,
      reply_to: input.reply_to ?? null,
      created_at: now,
      read_at: null,
    };
    await this.store.insertMessage(message);
    await this.store.upsertThread({ ...thread, last_message_at: now });

    return { message, thread };
  }

  /** Threads involving `agent`, newest activity first, with unread counts. */
  async threads(agent: string): Promise<ThreadSummary[]> {
    const threads = await this.store.listThreads(agent);
    const summaries: ThreadSummary[] = [];
    for (const thread of threads) {
      const messages = await this.store.listMessages(thread.id, 1);
      const last = messages.at(-1) ?? null;

      summaries.push({
        ...thread,
        message_count: await this.store.countMessages(thread.id),
        unread_count: await this.store.countUnread(thread.id, agent),
        last_message_preview: last?.content.slice(0, 120) ?? null,
      });
    }
    return summaries;
  }

  /** Full message history of one thread, oldest first. */
  async threadMessages(threadId: string, limit?: number): Promise<Message[]> {
    const thread = await this.store.findThread(threadId);
    if (!thread) {
      throw new Error(`thread not found: ${threadId}`);
    }
    return this.store.listMessages(threadId, limit);
  }

  /** Mark a thread read from the perspective of `agent`. */
  async markRead(threadId: string, agent: string): Promise<void> {
    const thread = await this.store.findThread(threadId);
    if (!thread) {
      throw new Error(`thread not found: ${threadId}`);
    }
    await this.store.markThreadRead(threadId, agent, new Date().toISOString());
  }

  async unreadCount(agent: string): Promise<number> {
    const threads = await this.store.listThreads(agent);
    let total = 0;
    for (const thread of threads) {
      total += await this.store.countUnread(thread.id, agent);
    }
    return total;
  }
}
