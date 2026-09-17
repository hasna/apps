import {
  discoveryQuery,
  directoryPage,
  PRESENCE_SCHEMA,
  presenceValues,
  MessagesConflictError,
} from "../directory";
/**
 * PostgreSQL-backed MessagesStore — the harness server store.
 *
 * Selected when HASNA_MESSAGES_DATABASE_URL is set. The schema mirrors
 * sqlite-store.ts exactly (same tables, same column shapes — timestamps are
 * TEXT so ISO-string comparisons behave identically on both backends, flags
 * and counters stay INTEGER, JSON payloads stay TEXT). Both stores implement
 * the same MessagesStore contract behind MessagesService.
 *
 * The connection string is never logged, printed, or included in errors.
 */
import pg from "pg";
import type {
  SendCommit,
  SendResult,
  AgentDiscovery,
  AgentPresence,
  InboxItem,
  DiscoveredAgent,
  Agent,
  Message,
  MessageDelivery,
  MessageDeliveryReport,
  Thread,
} from "../types";
import type { MessagesStore } from "../service";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  agent_a TEXT NOT NULL,
  agent_b TEXT NOT NULL,
  last_message_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS thread_participants (
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  agent TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  closed_at TEXT,
  PRIMARY KEY (thread_id, agent)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  sender TEXT NOT NULL,
  content TEXT NOT NULL,
  reply_to TEXT,
  created_at TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS message_deliveries (
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'stored',
  stored_at TEXT NOT NULL,
  delivered_at TEXT,
  read_at TEXT,
  PRIMARY KEY (message_id, recipient)
);
CREATE INDEX IF NOT EXISTS idx_deliveries_recipient ON message_deliveries(recipient, state);
`;

const MESSAGE_COLS =
  "m.id, m.thread_id, m.sender, m.content, m.reply_to, m.created_at, m.seq";
const DELIVERY_COLS =
  "d.recipient, d.state, d.stored_at, d.delivered_at, d.read_at";
const AGENT_COLS = "id, name, display_name, created_at, last_seen_at";

interface MessageRow {
  id: string;
  thread_id: string;
  sender: string;
  content: string;
  reply_to: string | null;
  created_at: string;
  seq: number;
}
interface MessageDeliveryJoin extends MessageRow {
  recipient: string | null;
  state: string | null;
  stored_at: string | null;
  delivered_at: string | null;
  read_at: string | null;
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    thread_id: row.thread_id,
    from_agent: row.sender,
    content: row.content,
    reply_to: row.reply_to,
    created_at: row.created_at,
    seq: row.seq,
  };
}

function toDelivery(row: MessageDeliveryJoin): MessageDelivery {
  return {
    recipient: row.recipient!,
    state: row.state! as MessageDelivery["state"],
    stored_at: row.stored_at!,
    delivered_at: row.delivered_at,
    read_at: row.read_at,
  };
}

export class PostgresMessagesStore implements MessagesStore {
  private readonly pool: pg.Pool;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }

  async init(): Promise<void> {
    await this.pool.query(SCHEMA + PRESENCE_SCHEMA);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  // --- agent identity ---

  async findAgentByName(name: string): Promise<Agent | null> {
    const { rows } = await this.pool.query(
      `SELECT ${AGENT_COLS} FROM agents WHERE name = $1`,
      [name],
    );
    return (rows[0] as Agent | undefined) ?? null;
  }

  async insertAgent(agent: Agent): Promise<void> {
    await this.pool.query(
      `INSERT INTO agents (id, name, display_name, created_at, last_seen_at) VALUES ($1, $2, $3, $4, $5)`,
      [
        agent.id,
        agent.name,
        agent.display_name,
        agent.created_at,
        agent.last_seen_at,
      ],
    );
  }

  async listAgents(): Promise<Agent[]> {
    const { rows } = await this.pool.query(
      `SELECT ${AGENT_COLS} FROM agents ORDER BY name ASC`,
    );
    return rows as Agent[];
  }

  async touchAgent(name: string, at: string): Promise<void> {
    await this.pool.query(
      "UPDATE agents SET last_seen_at = $2 WHERE name = $1",
      [name, at],
    );
  }

  async discoverAgents(input: AgentDiscovery, now: string) {
    const query = discoveryQuery(input, now, true);
    const result = await this.pool.query(query.sql, query.args);
    return directoryPage(result.rows, query.limit);
  }

  async heartbeat(
    rows: AgentPresence[],
    labels: Map<string, string>,
  ): Promise<void> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const sorted = [...rows].sort((a, b) => (a.agent < b.agent ? -1 : 1));
      const agents = sorted.flatMap((row) => [
        crypto.randomUUID(),
        row.agent,
        labels.get(row.agent) ?? null,
        row.heartbeat_at,
        row.heartbeat_at,
      ]);
      const tuples = (width: number) =>
        sorted
          .map(
            (_, i) =>
              `(${Array.from({ length: width }, (_, j) => `$${i * width + j + 1}`).join(",")})`,
          )
          .join(",");
      await db.query(
        `INSERT INTO agents (id, name, display_name, created_at, last_seen_at) VALUES ${tuples(5)}
        ON CONFLICT(name) DO UPDATE SET last_seen_at = excluded.last_seen_at, display_name = COALESCE(excluded.display_name, agents.display_name)`,
        agents,
      );
      const result = await db.query(
        `INSERT INTO agent_presence (agent, runtime_id, station, application, heartbeat_at, expires_at)
        VALUES ${tuples(6)} ON CONFLICT(agent) DO UPDATE SET
        runtime_id = excluded.runtime_id, station = excluded.station, application = excluded.application,
        heartbeat_at = excluded.heartbeat_at, expires_at = excluded.expires_at
        WHERE agent_presence.runtime_id = excluded.runtime_id OR agent_presence.expires_at <= excluded.heartbeat_at`,
        sorted.flatMap(presenceValues),
      );
      if (result.rowCount !== rows.length)
        throw new MessagesConflictError(
          "one or more agents already have another online receiver",
        );
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }

  async runtimeInbox(
    runtimeId: string,
    limit: number,
    now: string,
  ): Promise<InboxItem[]> {
    const result = await this.pool.query(
      `SELECT ${MESSAGE_COLS}, ${DELIVERY_COLS}
      FROM message_deliveries d JOIN messages m ON m.id = d.message_id
      JOIN agent_presence p ON p.agent = d.recipient
      WHERE p.runtime_id = $1 AND p.expires_at > $2 AND d.state = 'stored'
      ORDER BY m.created_at, m.id LIMIT $3`,
      [runtimeId, now, limit],
    );
    return result.rows.map((row) => ({
      message: toMessage(row),
      delivery: toDelivery(row)!,
    }));
  }

  async acknowledge(
    runtimeId: string,
    ids: string[],
    now: string,
  ): Promise<number> {
    const result = await this.pool.query(
      `UPDATE message_deliveries d SET state = 'delivered', delivered_at = $1
      WHERE d.state = 'stored' AND d.message_id = ANY($2::text[])
      AND EXISTS (SELECT 1 FROM agent_presence p WHERE p.agent = d.recipient AND p.runtime_id = $3 AND p.expires_at > $1)`,
      [now, ids, runtimeId],
    );
    return result.rowCount ?? 0;
  }

  async commitSend(input: SendCommit): Promise<SendResult> {
    const db = await this.pool.connect();
    try {
      await db.query("BEGIN");
      const { message: m, thread: t, delivery: d } = input;
      if (input.requestKey) {
        const claim = await db.query(
          "INSERT INTO message_requests (request_key, request_hash, message_id) VALUES ($1, $2, $3) ON CONFLICT(request_key) DO NOTHING RETURNING message_id",
          [input.requestKey, input.requestHash, m.id],
        );
        if (!claim.rowCount) {
          const previous = (
            await db.query(
              "SELECT request_hash, message_id FROM message_requests WHERE request_key = $1",
              [input.requestKey],
            )
          ).rows[0]!;
          if (previous.request_hash !== input.requestHash)
            throw new MessagesConflictError(
              "idempotency_key was already used with a different request",
            );
          const row = (
            await db.query("SELECT * FROM messages WHERE id = $1", [
              previous.message_id,
            ])
          ).rows[0] as MessageRow;
          const delivery = (
            await db.query(
              "SELECT recipient, state, stored_at, delivered_at, read_at FROM message_deliveries WHERE message_id = $1",
              [row.id],
            )
          ).rows[0] as MessageDelivery;
          const thread = (
            await db.query("SELECT * FROM threads WHERE id = $1", [
              row.thread_id,
            ])
          ).rows[0] as Thread;
          await db.query("COMMIT");
          return { message: toMessage(row), thread, deliveries: [delivery] };
        }
      }
      // The upsert locks the thread until commit, serializing sequence allocation.
      const thread = (
        await db.query(
          `INSERT INTO threads (id, agent_a, agent_b, last_message_at, created_at) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT(id) DO UPDATE SET last_message_at = excluded.last_message_at RETURNING *`,
          [t.id, t.agent_a, t.agent_b, t.last_message_at, t.created_at],
        )
      ).rows[0] as Thread;
      for (const name of [t.agent_a, t.agent_b])
        await db.query(
          "INSERT INTO thread_participants (thread_id, agent, joined_at, closed_at) VALUES ($1, $2, $3, NULL) ON CONFLICT(thread_id, agent) DO NOTHING",
          [t.id, name, m.created_at],
        );
      const row = (
        await db.query(
          `INSERT INTO messages (id, thread_id, sender, content, reply_to, created_at, seq)
        VALUES ($1, $2, $3, $4, $5, $6, (SELECT COALESCE(MAX(seq), 0) + 1 FROM messages WHERE thread_id = $2)) RETURNING *`,
          [
            m.id,
            m.thread_id,
            m.from_agent,
            m.content,
            m.reply_to,
            m.created_at,
          ],
        )
      ).rows[0] as MessageRow;
      await db.query(
        "INSERT INTO message_deliveries (message_id, recipient, state, stored_at, delivered_at, read_at) VALUES ($1, $2, 'stored', $3, NULL, NULL)",
        [m.id, d.recipient, d.stored_at],
      );
      await db.query("COMMIT");
      return { message: toMessage(row), thread, deliveries: [d] };
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    } finally {
      db.release();
    }
  }

  // --- threads ---

  async findThread(id: string): Promise<Thread | null> {
    const { rows } = await this.pool.query(
      "SELECT id, agent_a, agent_b, last_message_at, created_at FROM threads WHERE id = $1",
      [id],
    );
    return (rows[0] as Thread | undefined) ?? null;
  }

  async upsertThread(thread: Thread): Promise<void> {
    await this.pool.query(
      `INSERT INTO threads (id, agent_a, agent_b, last_message_at, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET last_message_at = EXCLUDED.last_message_at`,
      [
        thread.id,
        thread.agent_a,
        thread.agent_b,
        thread.last_message_at,
        thread.created_at,
      ],
    );
  }

  async ensureParticipant(
    threadId: string,
    agent: string,
    joinedAt: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO thread_participants (thread_id, agent, joined_at, closed_at)
       VALUES ($1, $2, $3, NULL)
       ON CONFLICT (thread_id, agent) DO NOTHING`,
      [threadId, agent, joinedAt],
    );
  }

  async setParticipantClosed(
    threadId: string,
    agent: string,
    closedAt: string | null,
  ): Promise<void> {
    await this.pool.query(
      "UPDATE thread_participants SET closed_at = $3 WHERE thread_id = $1 AND agent = $2",
      [threadId, agent, closedAt],
    );
  }

  async participantClosedAt(
    threadId: string,
    agent: string,
  ): Promise<string | null> {
    const { rows } = await this.pool.query(
      "SELECT closed_at FROM thread_participants WHERE thread_id = $1 AND agent = $2",
      [threadId, agent],
    );
    return (rows[0]?.closed_at as string | null) ?? null;
  }

  async listThreads(agent: string, openOnly: boolean): Promise<Thread[]> {
    const openFilter = openOnly ? "AND tp.closed_at IS NULL" : "";
    const { rows } = await this.pool.query(
      `SELECT t.id, t.agent_a, t.agent_b, t.last_message_at, t.created_at
       FROM threads t
       JOIN thread_participants tp ON tp.thread_id = t.id AND tp.agent = $1
       WHERE (t.agent_a = $2 OR t.agent_b = $3) ${openFilter}
       ORDER BY COALESCE(t.last_message_at, t.created_at) DESC`,
      [agent, agent, agent],
    );
    return rows as Thread[];
  }

  // --- messages + deliveries ---

  async insertMessage(message: Omit<Message, "seq">): Promise<Message> {
    // Atomic per-thread seq assignment: the thread row is locked FOR UPDATE so
    // concurrent sends to the same thread serialize, then MAX(seq)+1 is
    // computed inside the transaction. Without the lock, two READ COMMITTED
    // statements could read the same MAX and duplicate a seq.
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM threads WHERE id = $1 FOR UPDATE", [
        message.thread_id,
      ]);
      const { rows } = await client.query<MessageRow>(
        `INSERT INTO messages (id, thread_id, sender, content, reply_to, created_at, seq)
         SELECT $1, $2, $3, $4, $5, $6, COALESCE(MAX(seq), 0) + 1 FROM messages WHERE thread_id = $2
         RETURNING id, thread_id, sender, content, reply_to, created_at, seq`,
        [
          message.id,
          message.thread_id,
          message.from_agent,
          message.content,
          message.reply_to,
          message.created_at,
        ],
      );
      await client.query("COMMIT");
      return toMessage(rows[0]!);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async insertDelivery(
    messageId: string,
    delivery: MessageDelivery,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO message_deliveries (message_id, recipient, state, stored_at, delivered_at, read_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        messageId,
        delivery.recipient,
        delivery.state,
        delivery.stored_at,
        delivery.delivered_at,
        delivery.read_at,
      ],
    );
  }

  async listMessages(threadId: string, limit?: number): Promise<Message[]> {
    if (limit !== undefined) {
      const { rows } = await this.pool.query(
        `SELECT ${MESSAGE_COLS} FROM messages m
         WHERE m.thread_id = $1
         ORDER BY m.seq DESC, m.created_at DESC LIMIT $2`,
        [threadId, limit],
      );
      return (rows as MessageRow[]).reverse().map(toMessage);
    }
    const { rows } = await this.pool.query(
      `SELECT ${MESSAGE_COLS} FROM messages m
       WHERE m.thread_id = $1
       ORDER BY m.seq ASC, m.created_at ASC`,
      [threadId],
    );
    return (rows as MessageRow[]).map(toMessage);
  }

  async messagesWithDelivery(
    threadId: string,
    agent: string,
  ): Promise<Array<{ message: Message; delivery: MessageDelivery | null }>> {
    const { rows } = await this.pool.query(
      `SELECT ${MESSAGE_COLS}, ${DELIVERY_COLS}
       FROM messages m
       LEFT JOIN message_deliveries d ON d.message_id = m.id AND d.recipient = $2
       WHERE m.thread_id = $1
       ORDER BY m.seq ASC, m.created_at ASC`,
      [threadId, agent],
    );
    return (rows as MessageDeliveryJoin[]).map((row) => ({
      message: toMessage(row),
      delivery: row.state === null ? null : toDelivery(row),
    }));
  }

  async deliveryReport(threadId: string): Promise<MessageDeliveryReport[]> {
    const { rows } = await this.pool.query(
      `SELECT ${MESSAGE_COLS}, ${DELIVERY_COLS}
       FROM messages m
       LEFT JOIN message_deliveries d ON d.message_id = m.id
       WHERE m.thread_id = $1
       ORDER BY m.seq ASC, m.created_at ASC`,
      [threadId],
    );
    const byMessage = new Map<string, MessageDeliveryReport>();
    for (const row of rows as MessageDeliveryJoin[]) {
      let report = byMessage.get(row.id);
      if (!report) {
        report = { message: toMessage(row), deliveries: [] };
        byMessage.set(row.id, report);
      }
      if (row.state !== null) report.deliveries.push(toDelivery(row));
    }
    return [...byMessage.values()];
  }

  async deliverTo(
    recipient: string,
    at: string,
  ): Promise<Array<{ message: Message; delivery: MessageDelivery }>> {
    // Capture stored rows, transition them to delivered, return them.
    const { rows } = await this.pool.query(
      `SELECT ${MESSAGE_COLS}, ${DELIVERY_COLS}
       FROM message_deliveries d
       JOIN messages m ON m.id = d.message_id
       WHERE d.recipient = $1 AND d.state = 'stored'
       ORDER BY m.seq ASC, m.created_at ASC`,
      [recipient],
    );
    if (rows.length === 0) return [];
    const ids = (rows as MessageDeliveryJoin[]).map((r) => r.id);
    await this.pool.query(
      `UPDATE message_deliveries SET state = 'delivered', delivered_at = $2
       WHERE recipient = $1 AND message_id = ANY($3::text[])`,
      [recipient, at, ids],
    );
    return (rows as MessageDeliveryJoin[]).map((row) => ({
      message: toMessage(row),
      delivery: {
        recipient: row.recipient!,
        state: "delivered" as const,
        stored_at: row.stored_at!,
        delivered_at: at,
        read_at: row.read_at,
      },
    }));
  }

  async markThreadRead(
    threadId: string,
    agent: string,
    at: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE message_deliveries SET state = 'read', read_at = $3
       WHERE message_id IN (SELECT id FROM messages WHERE thread_id = $1)
         AND recipient = $2 AND state != 'read'`,
      [threadId, agent, at],
    );
  }

  async markMessageRead(
    messageId: string,
    agent: string,
    at: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE message_deliveries SET state = 'read', read_at = $3
       WHERE message_id = $1 AND recipient = $2 AND state != 'read'`,
      [messageId, agent, at],
    );
  }

  // --- counts ---

  async countUnread(threadId: string, agent: string): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM message_deliveries
       WHERE message_id IN (SELECT id FROM messages WHERE thread_id = $1)
         AND recipient = $2 AND state != 'read'`,
      [threadId, agent],
    );
    return (rows[0] as { n: number }).n;
  }

  async countMessages(threadId: string): Promise<number> {
    const { rows } = await this.pool.query(
      "SELECT COUNT(*)::int AS n FROM messages WHERE thread_id = $1",
      [threadId],
    );
    return (rows[0] as { n: number }).n;
  }
}
