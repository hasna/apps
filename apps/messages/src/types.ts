/**
 * Domain types for @hasna/messages — direct agent-to-agent DMs with threads.
 *
 * A thread is the pair of agents that exchange messages. The thread id is a
 * canonical, order-independent key over the two agents, so both sides of a
 * DM conversation address the same thread.
 */

export interface Message {
  /** Stable message id (uuid). */
  id: string;
  /** The thread this message belongs to. */
  thread_id: string;
  /** Sending agent. */
  from_agent: string;
  /** Receiving agent. */
  to_agent: string;
  /** Message body. */
  content: string;
  /** When replying inside a thread, the message id being replied to. */
  reply_to: string | null;
  /** RFC3339 creation timestamp. */
  created_at: string;
  /** RFC3339 read timestamp, null until the recipient reads the thread. */
  read_at: string | null;
}

export interface NewMessage {
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
  /** Last message preview from the perspective of the requesting agent. */
  last_message_preview: string | null;
}

export interface SendResult {
  message: Message;
  thread: Thread;
}
