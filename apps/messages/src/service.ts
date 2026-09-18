import { createHash } from "node:crypto";
import {
  boundedLimit,
  label,
  MessagesInputError,
  PRESENCE_TTL_MS,
  HEARTBEAT_BATCH_LIMIT,
} from "./directory";
/**
 * The single domain implementation of @hasna/messages.
 *
 * Per the one-domain-implementation law (monorepo-app-layout), this file owns
 * ALL business logic: agent identity, thread identity, send/mark-read
 * semantics, per-recipient delivery state, unread accounting and thread
 * close/reopen. The CLI, MCP server, HTTP server and SDK are interface layers
 * over this service — business logic is never duplicated across interfaces.
 *
 * The service is storage-agnostic through the `MessagesStore` interface. The
 * server layer selects the concrete store from configuration (SQLite default,
 * PostgreSQL via HASNA_MESSAGES_DATABASE_URL) — never from a mode enum.
 */
import type {
  Agent,
  AgentHeartbeat,
  AgentPresence,
  AgentDiscovery,
  AgentPage,
  InboxItem,
  SendCommit,
  DeliveredMessage,
  Message,
  MessageDelivery,
  MessageDeliveryReport,
  NewMessage,
  SendResult,
  Thread,
  ThreadSummary,
} from "./types";

/** Per-recipient delivery state machine: stored -> delivered -> read. */
export const DELIVERY_STATES = ["stored", "delivered", "read"] as const;

export interface MessagesStore {
  // --- agent identity ---
  findAgentByName(name: string): Promise<Agent | null>;
  insertAgent(agent: Agent): Promise<void>;
  listAgents(): Promise<Agent[]>;
  /** Refresh the agent's last_seen_at. */
  touchAgent(name: string, at: string): Promise<void>;

  discoverAgents(input: AgentDiscovery, now: string): Promise<AgentPage>;
  heartbeat(rows: AgentPresence[], labels: Map<string, string>): Promise<void>;
  runtimeInbox(
    runtimeId: string,
    limit: number,
    now: string,
  ): Promise<InboxItem[]>;
  acknowledge(runtimeId: string, ids: string[], now: string): Promise<number>;

  commitSend(input: SendCommit): Promise<SendResult>;

  // --- threads ---
  findThread(id: string): Promise<Thread | null>;
  upsertThread(thread: Thread): Promise<void>;
  /** Ensure the agent is a participant of the thread (idempotent). */
  ensureParticipant(
    threadId: string,
    agent: string,
    joinedAt: string,
  ): Promise<void>;
  /** Set the participant's closed_at (null reopens). */
  setParticipantClosed(
    threadId: string,
    agent: string,
    closedAt: string | null,
  ): Promise<void>;
  /** The participant's closed_at, or null when the agent is not a participant. */
  participantClosedAt(threadId: string, agent: string): Promise<string | null>;
  /** Threads involving `agent`; openOnly filters to participants that have not closed it. */
  listThreads(agent: string, openOnly: boolean): Promise<Thread[]>;

  // --- messages + deliveries ---
  /** Insert a message; the store assigns the per-thread `seq` atomically and
   * returns the stored message. `seq` must never be computed client-side from
   * a count (concurrent sends to one thread would duplicate it). */
  insertMessage(message: Omit<Message, "seq">): Promise<Message>;
  insertDelivery(messageId: string, delivery: MessageDelivery): Promise<void>;
  /** Most recent `limit` messages of the thread, oldest-first within the window. */
  listMessages(threadId: string, limit?: number): Promise<Message[]>;
  /** Messages of the thread with the requesting agent's delivery record (null if the agent is the sender). */
  messagesWithDelivery(
    threadId: string,
    agent: string,
  ): Promise<Array<{ message: Message; delivery: MessageDelivery | null }>>;
  /** Per-message delivery state for all recipients (the delivery-status verb). */
  deliveryReport(threadId: string): Promise<MessageDeliveryReport[]>;
  /** Transition stored -> delivered for the recipient, returning the delivered messages. */
  deliverTo(
    recipient: string,
    at: string,
    limit?: number,
  ): Promise<Array<{ message: Message; delivery: MessageDelivery }>>;
  /** Mark a whole thread read from an agent's perspective (stored/delivered -> read). */
  markThreadRead(threadId: string, agent: string, at: string): Promise<void>;
  /** Mark a single message read from an agent's perspective. */
  markMessageRead(messageId: string, agent: string, at: string): Promise<void>;

  // --- counts ---
  countUnread(threadId: string, agent: string): Promise<number>;
  countMessages(threadId: string): Promise<number>;
}

/**
 * Canonical, order-independent, collision-free thread key for a pair of
 * agents. "augustus" <-> "silvanus" is the same thread from either side.
 *
 * Each name's underscores are escaped (`_` -> `_u`) before the sorted join,
 * making the `__` separator unambiguous inside the new id space: the escape
 * can never contain `__` (every `_` is followed by `u`), so `0_`/`a` and
 * `0`/`_a` no longer collapse onto one key. newThreadId prefixes the result
 * with `t1_`, keeping the new id space disjoint from the legacy `t_` space
 * (legacy names like `0_u` cannot collide with the escaped id of `0_`).
 * Legacy rows are adopted by the grandfather fallback in send(), which uses
 * the raw legacy id and verifies the stored participants.
 */
export function threadKeyFor(agentA: string, agentB: string): string {
  const [a, b] = [agentA, agentB].sort();
  return `${escapeKeyPart(a)}__${escapeKeyPart(b)}`;
}

/** Escape every `_` in a key part so the `__` join is unambiguous. */
function escapeKeyPart(name: string): string {
  return name.replace(/_/g, "_u");
}

export function newThreadId(agentA: string, agentB: string): string {
  // The `t1_` prefix keeps the NEW id space disjoint from the legacy `t_`
  // space: every legacy id is `t_<a>__<b>`, which never starts with `t1_`, so
  // a primary escaped-id lookup can never match a legacy row of a different
  // pair (a legacy name like `0_u` would otherwise collide with the escaped
  // id of `0_`). Legacy rows are adopted via the grandfather fallback in
  // send(), which uses the raw legacy id and verifies the participants.
  return `t1_${threadKeyFor(agentA, agentB)}`;
}

function normalizeAgentName(name: string): string {
  // No name constraint: the thread-key encoding is injective for any name
  // (see threadKeyFor), so legacy identities with underscores keep working.
  return name.trim().toLowerCase();
}

export class MessagesService {
  constructor(private readonly store: MessagesStore) {}

  // --- agent identity -----------------------------------------------------

  /** Register (or return) an agent identity. Identity is first-class: every
   * message is addressed by a registered agent name. */
  async registerAgent(name: string, displayName?: string): Promise<Agent> {
    const normalized = normalizeAgentName(name);
    if (!normalized) throw new Error("agent name is required");
    return this.ensureAgent(
      normalized,
      displayName ?? null,
      new Date().toISOString(),
    );
  }

  async listAgents(): Promise<Agent[]> {
    return this.store.listAgents();
  }

  async discoverAgents(input: AgentDiscovery = {}): Promise<AgentPage> {
    return this.store.discoverAgents(input, new Date().toISOString());
  }

  async heartbeat(
    input: AgentHeartbeat,
  ): Promise<{ expires_at: string; count: number }> {
    const runtime = label(input.runtime_id, "runtime_id");
    const station =
      input.station === undefined ? null : label(input.station, "station");
    const application =
      input.application === undefined
        ? null
        : label(input.application, "application");
    if (
      !Array.isArray(input.agents) ||
      input.agents.length < 1 ||
      input.agents.length > HEARTBEAT_BATCH_LIMIT
    )
      throw new MessagesInputError(
        `agents must contain 1 to ${HEARTBEAT_BATCH_LIMIT} identities`,
      );
    const at = new Date().toISOString();
    const expires = new Date(Date.parse(at) + PRESENCE_TTL_MS).toISOString();
    const labels = new Map<string, string>();
    const rows = input.agents.map((agent) => {
      const name = normalizeAgentName(label(agent?.name, "agent name", 256));
      if (agent.display_name !== undefined)
        labels.set(name, label(agent.display_name, "display_name", 200));
      return {
        agent: name,
        runtime_id: runtime,
        station,
        application,
        heartbeat_at: at,
        expires_at: expires,
      };
    });
    if (new Set(rows.map((row) => row.agent)).size !== rows.length)
      throw new MessagesInputError("duplicate agent in heartbeat");
    // Validation finishes before any registration. An offline peer is never
    // made online by somebody else's send; only its runtime renews this lease.
    await this.store.heartbeat(rows, labels);
    return { expires_at: expires, count: rows.length };
  }

  async runtimeInbox(
    runtimeId: string,
    limit?: number,
  ): Promise<{ messages: InboxItem[] }> {
    return {
      messages: await this.store.runtimeInbox(
        label(runtimeId, "runtime_id"),
        boundedLimit(limit, 100, 500),
        new Date().toISOString(),
      ),
    };
  }

  async acknowledge(
    runtimeId: string,
    ids: string[],
  ): Promise<{ acknowledged: number }> {
    const runtime = label(runtimeId, "runtime_id");
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 500)
      throw new MessagesInputError("message_ids must contain 1 to 500 ids");
    const validated = [...new Set(ids.map((id) => label(id, "message id")))];
    return {
      acknowledged: await this.store.acknowledge(
        runtime,
        validated,
        new Date().toISOString(),
      ),
    };
  }

  /** Resolve an agent by name, registering it on first use. Registration is
   * conflict-tolerant: two concurrent sends of the same new agent race the
   * UNIQUE(name) insert, and the loser re-reads the committed row instead of
   * surfacing a unique-constraint failure. */
  private async ensureAgent(
    name: string,
    displayName: string | null,
    at: string,
    active = true,
  ): Promise<Agent> {
    const normalized = normalizeAgentName(name);
    if (!normalized) throw new Error("agent name is required");
    const existing = await this.store.findAgentByName(normalized);
    if (existing) {
      if (active) await this.store.touchAgent(normalized, at);
      return active ? { ...existing, last_seen_at: at } : existing;
    }
    const agent: Agent = {
      id: crypto.randomUUID(),
      name: normalized,
      display_name: displayName,
      created_at: at,
      last_seen_at: active ? at : null,
    };
    try {
      await this.store.insertAgent(agent);
      return agent;
    } catch (err) {
      // A concurrent registration won the race; return the committed row.
      const raced = await this.store.findAgentByName(normalized);
      if (raced) {
        if (active) await this.store.touchAgent(normalized, at);
        return active ? { ...raced, last_seen_at: at } : raced;
      }
      throw err;
    }
  }

  // --- messaging ----------------------------------------------------------

  async send(input: NewMessage): Promise<SendResult> {
    const { from_agent, to_agent, content } = input;
    if (!from_agent || !to_agent) {
      throw new Error("from_agent and to_agent are required");
    }
    if (normalizeAgentName(from_agent) === normalizeAgentName(to_agent)) {
      throw new Error("a direct message must have two distinct agents");
    }
    if (!content || content.trim().length === 0) {
      throw new Error("content is required");
    }

    const requestKey =
      input.idempotency_key === undefined
        ? undefined
        : createHash("sha256")
            .update(
              JSON.stringify([
                normalizeAgentName(from_agent),
                label(input.idempotency_key, "idempotency_key", 200),
              ]),
            )
            .digest("hex");
    const requestHash = requestKey
      ? createHash("sha256")
          .update(
            JSON.stringify([
              normalizeAgentName(to_agent),
              content,
              input.reply_to ?? null,
            ]),
          )
          .digest("hex")
      : undefined;
    const now = new Date().toISOString();
    const sender = await this.ensureAgent(from_agent, null, now);
    const recipient = await this.ensureAgent(to_agent, null, now, false);

    let threadId = newThreadId(sender.name, recipient.name);
    let thread = await this.store.findThread(threadId);
    if (!thread) {
      // Grandfather path for legacy rows: before the escape encoding, thread
      // ids were the raw sorted join, so an underscore-named pair's stored
      // thread carries the unescaped id. Adopt it (only when its participants
      // are this pair — otherwise the legacy id belongs to a colliding pair
      // and the escaped thread is the correct one).
      const sortedPair = [sender.name, recipient.name].sort();
      const legacyId = `t_${sortedPair.join("__")}`;
      if (legacyId !== threadId) {
        const legacy = await this.store.findThread(legacyId);
        if (
          legacy &&
          legacy.agent_a === sortedPair[0] &&
          legacy.agent_b === sortedPair[1]
        ) {
          thread = legacy;
          threadId = legacyId;
        }
      }
    }
    if (!thread) {
      thread = {
        id: threadId,
        agent_a: [sender.name, recipient.name].sort()[0]!,
        agent_b: [sender.name, recipient.name].sort()[1]!,
        last_message_at: now,
        created_at: now,
      };
    }
    return this.store.commitSend({
      thread: { ...thread, last_message_at: now },
      message: {
        id: crypto.randomUUID(),
        thread_id: threadId,
        from_agent: sender.name,
        content,
        reply_to: input.reply_to ?? null,
        created_at: now,
      },
      delivery: {
        recipient: recipient.name,
        state: "stored",
        stored_at: now,
        delivered_at: null,
        read_at: null,
      },
      requestKey,
      requestHash,
    });
  }

  // --- threads ------------------------------------------------------------

  /** Threads involving `agent`, newest activity first, with unread counts.
   * openOnly (default) excludes threads the agent has closed. */
  async threads(
    agent: string,
    opts?: { openOnly?: boolean },
  ): Promise<ThreadSummary[]> {
    const openOnly = opts?.openOnly ?? true;
    const agentName = normalizeAgentName(agent);
    const threads = await this.store.listThreads(agentName, openOnly);
    const summaries: ThreadSummary[] = [];
    for (const thread of threads) {
      const messages = await this.store.listMessages(thread.id, 1);
      const last = messages.at(-1) ?? null;
      const closed =
        (await this.store.participantClosedAt(thread.id, agentName)) !== null;
      summaries.push({
        ...thread,
        message_count: await this.store.countMessages(thread.id),
        unread_count: await this.store.countUnread(thread.id, agentName),
        closed,
        last_message_preview: last?.content.slice(0, 120) ?? null,
      });
    }
    return summaries;
  }

  /** Expand a thread: its messages (oldest first) with the requesting agent's
   * per-message delivery state, plus the thread and its unread count. Does NOT
   * mark anything read — reading is an explicit `markRead`. */
  async expandThread(
    threadId: string,
    agent: string,
  ): Promise<{
    thread: Thread;
    messages: Array<{ message: Message; delivery: MessageDelivery | null }>;
    unread_count: number;
  }> {
    const thread = await this.store.findThread(threadId);
    if (!thread) throw new Error(`thread not found: ${threadId}`);
    const agentName = normalizeAgentName(agent);
    const messages = await this.store.messagesWithDelivery(threadId, agentName);
    const unreadCount = await this.store.countUnread(threadId, agentName);
    return { thread, messages, unread_count: unreadCount };
  }

  /** Full message history of one thread, oldest first. */
  async threadMessages(threadId: string, limit?: number): Promise<Message[]> {
    const thread = await this.store.findThread(threadId);
    if (!thread) throw new Error(`thread not found: ${threadId}`);
    return this.store.listMessages(threadId, limit);
  }

  /** Unread count of one thread for one agent. */
  async threadUnread(threadId: string, agent: string): Promise<number> {
    const thread = await this.store.findThread(threadId);
    if (!thread) throw new Error(`thread not found: ${threadId}`);
    return this.store.countUnread(threadId, normalizeAgentName(agent));
  }

  /** Threads with unread messages for `agent` (open and closed), newest first. */
  async unreadThreads(agent: string): Promise<ThreadSummary[]> {
    const all = await this.threads(agent, { openOnly: false });
    return all.filter((t) => t.unread_count > 0);
  }

  /** Total unread count across all threads for `agent`. */
  async unreadCount(agent: string): Promise<number> {
    const agentName = normalizeAgentName(agent);
    const threads = await this.store.listThreads(agentName, false);
    let total = 0;
    for (const thread of threads) {
      total += await this.store.countUnread(thread.id, agentName);
    }
    return total;
  }

  /** Close a thread from the agent's perspective (excluded from the default list). */
  async closeThread(threadId: string, agent: string): Promise<Thread> {
    const thread = await this.requireThread(threadId);
    await this.store.setParticipantClosed(
      threadId,
      normalizeAgentName(agent),
      new Date().toISOString(),
    );
    return thread;
  }

  /** Reopen a thread from the agent's perspective. */
  async reopenThread(threadId: string, agent: string): Promise<Thread> {
    const thread = await this.requireThread(threadId);
    await this.store.setParticipantClosed(
      threadId,
      normalizeAgentName(agent),
      null,
    );
    return thread;
  }

  // --- delivery -----------------------------------------------------------

  /** Drain the agent's inbox: transition stored -> delivered for the agent's
   * undelivered messages and return them. This is the verb that makes a
   * stored-but-undelivered message distinguishable from a delivered one —
   * delivery is recorded when the recipient actually pulls. */
  async receive(agent: string, limit?: number): Promise<DeliveredMessage[]> {
    const agentName = normalizeAgentName(agent);
    if (!agentName) throw new Error("agent is required");
    const now = new Date().toISOString();
    const delivered = await this.store.deliverTo(agentName, now, limit);
    await this.store.touchAgent(agentName, now);
    return delivered.map(({ message, delivery }) => ({
      ...message,
      to_agent: agentName,
      delivery,
    }));
  }

  /** Mark a whole thread read from an agent's perspective. */
  async markRead(threadId: string, agent: string): Promise<void> {
    const thread = await this.store.findThread(threadId);
    if (!thread) throw new Error(`thread not found: ${threadId}`);
    await this.store.markThreadRead(
      threadId,
      normalizeAgentName(agent),
      new Date().toISOString(),
    );
  }

  /** Mark a single message read from an agent's perspective. */
  async markMessageRead(messageId: string, agent: string): Promise<void> {
    await this.store.markMessageRead(
      messageId,
      normalizeAgentName(agent),
      new Date().toISOString(),
    );
  }

  /** Per-message, per-recipient delivery state for a thread — the sender's
   * view of whether each message was stored, delivered or read. */
  async deliveryStatus(threadId: string): Promise<MessageDeliveryReport[]> {
    const thread = await this.store.findThread(threadId);
    if (!thread) throw new Error(`thread not found: ${threadId}`);
    return this.store.deliveryReport(threadId);
  }

  // --- helpers ------------------------------------------------------------

  private async requireThread(threadId: string): Promise<Thread> {
    const thread = await this.store.findThread(threadId);
    if (!thread) throw new Error(`thread not found: ${threadId}`);
    return thread;
  }
}
