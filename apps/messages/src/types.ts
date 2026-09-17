/**
 * Domain types for @hasna/messages — direct agent-to-agent DMs with threads.
 *
 * A thread is the pair of agents that exchange messages. The thread id is a
 * canonical, order-independent key over the two agents, so both sides of a
 * DM conversation address the same thread.
 *
 * Delivery model (the repair for the measured "conversations send --to"
 * silent-success failure): every message carries a PER-RECIPIENT delivery
 * record whose state machine is
 *
 *     stored -> delivered -> read
 *
 * A message that is stored in the store but has not yet been pulled by the
 * recipient is `stored`. The recipient's client transitions it to
 * `delivered` when it actually drains its inbox (`receive`), and to `read`
 * when the recipient marks the thread read. A stored-but-undelivered message
 * is therefore distinguishable from a delivered one — the sender can query
 * per-recipient delivery state instead of trusting that a successful store
 * meant delivery.
 */

/** Per-recipient delivery state. */
export type DeliveryState = "stored" | "delivered" | "read";

/** First-class agent identity. Messages are addressed by agent name. */
export interface Agent {
  id: string;
  /** Canonical agent name (unique, the addressing key). */
  name: string;
  /** Optional human/seat-friendly label. */
  display_name: string | null;
  created_at: string;
  last_seen_at: string | null;
}

/** Per-recipient delivery record for one message. */
export interface MessageDelivery {
  /** The recipient agent name. */
  recipient: string;
  state: DeliveryState;
  /** When the message was stored for this recipient. */
  stored_at: string;
  /** When the recipient's client drained it (delivered), null until then. */
  delivered_at: string | null;
  /** When the recipient marked it read, null until then. */
  read_at: string | null;
}

export interface Message {
  /** Stable message id (uuid). */
  id: string;
  /** The thread this message belongs to. */
  thread_id: string;
  /** Sending agent. */
  from_agent: string;
  /** Message body. */
  content: string;
  /** When replying inside a thread, the message id being replied to. */
  reply_to: string | null;
  /** RFC3339 creation timestamp. */
  created_at: string;
  /** Per-thread monotonic sequence (stable ordering). */
  seq: number;
}

/** A message as seen by its recipient after `receive` delivers it. */
export interface DeliveredMessage extends Message {
  /** The recipient this delivery is addressed to. */
  to_agent: string;
  /** This recipient's delivery record. */
  delivery: MessageDelivery;
}

export interface NewMessage {
  /** Stable per-sender retry key. Reuse only with the identical request. */
  idempotency_key?: string;
  from_agent: string;
  to_agent: string;
  content: string;
  reply_to?: string | null;
}

export interface Thread {
  id: string;
  agent_a: string;
  agent_b: string;
  last_message_at: string | null;
  created_at: string;
}

export interface ThreadSummary extends Thread {
  /** Message count in the thread. */
  message_count: number;
  /** Unread count from the perspective of the requesting agent. */
  unread_count: number;
  /** Whether the thread is closed from the requesting agent's perspective. */
  closed: boolean;
  /** Last message preview from the perspective of the requesting agent. */
  last_message_preview: string | null;
}

export interface SendResult {
  message: Message;
  thread: Thread;
  /** Per-recipient delivery records created by this send. */
  deliveries: MessageDelivery[];
}

/** Delivery status report for one message (all recipients). */
export interface MessageDeliveryReport {
  message: Message;
  deliveries: MessageDelivery[];
}

/** A runtime is the receiver hosting one or more agents on a station. */
export interface AgentHeartbeat {
  runtime_id: string;
  station?: string;
  application?: string;
  agents: Array<{ name: string; display_name?: string }>;
}

export interface AgentPresence {
  agent: string;
  runtime_id: string;
  station: string | null;
  application: string | null;
  heartbeat_at: string;
  expires_at: string;
}

export interface DiscoveredAgent extends Agent {
  station: string | null;
  application: string | null;
  runtime_id: string | null;
  heartbeat_at: string | null;
  expires_at: string | null;
  /** Receiver reachability; does not imply that a model is currently working. */
  online: boolean;
}

export interface AgentDiscovery {
  search?: string;
  station?: string;
  application?: string;
  online?: boolean;
  cursor?: string;
  limit?: number;
}

export interface AgentPage {
  agents: DiscoveredAgent[];
  next_cursor: string | null;
}

export interface InboxItem {
  message: Message;
  delivery: MessageDelivery;
}

export interface SendCommit {
  thread: Thread;
  message: Omit<Message, "seq">;
  delivery: MessageDelivery;
  requestKey?: string;
  requestHash?: string;
}
