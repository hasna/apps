import { getDb } from "./db.js";
import type { Message, Attachment, SendMessageOptions, ReadMessagesOptions, SearchMessagesOptions } from "../types.js";
import { randomUUID } from "crypto";
import { mkdirSync, copyFileSync, statSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";

function parseMessage(row: Record<string, unknown>): Message {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata as string);
    } catch {
      metadata = null;
    }
  }

  let attachments: Attachment[] | null = null;
  if (row.attachments) {
    try {
      attachments = JSON.parse(row.attachments as string);
    } catch {
      attachments = null;
    }
  }

  return {
    ...row,
    metadata,
    attachments,
    blocking: !!(row.blocking as number),
  } as Message;
}

function getAttachmentsDir(): string {
  if (process.env.CONVERSATIONS_ATTACHMENTS_DIR) return process.env.CONVERSATIONS_ATTACHMENTS_DIR;
  return join(homedir(), ".conversations", "attachments");
}

function guessMimeType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    txt: "text/plain", md: "text/markdown", json: "application/json",
    js: "text/javascript", ts: "text/typescript", py: "text/x-python",
    html: "text/html", css: "text/css", xml: "application/xml",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    svg: "image/svg+xml", webp: "image/webp",
    pdf: "application/pdf", zip: "application/zip", gz: "application/gzip",
    csv: "text/csv", yaml: "text/yaml", yml: "text/yaml",
  };
  return mimeMap[ext || ""] || "application/octet-stream";
}

export function sendMessage(opts: SendMessageOptions): Message {
  const db = getDb();
  const explicitSession = opts.session_id && opts.session_id.trim().length > 0 ? opts.session_id : undefined;
  const sessionId = explicitSession
    ?? (opts.space ? `space:${opts.space}` : `${[opts.from, opts.to].sort().join("-")}-${randomUUID().slice(0, 8)}`);
  const metadata = opts.metadata ? JSON.stringify(opts.metadata) : null;
  const normalizedPriority = (opts.priority === "low" || opts.priority === "normal" || opts.priority === "high" || opts.priority === "urgent")
    ? opts.priority
    : "normal";

  const blocking = opts.blocking ? 1 : 0;

  const stmt = db.prepare(`
    INSERT INTO messages (session_id, from_agent, to_agent, space, content, priority, working_dir, repository, branch, metadata, blocking)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `);

  const row = stmt.get(
    sessionId,
    opts.from,
    opts.to,
    opts.space || null,
    opts.content,
    normalizedPriority,
    opts.working_dir || null,
    opts.repository || null,
    opts.branch || null,
    metadata,
    blocking
  ) as Record<string, unknown>;

  const message = parseMessage(row);

  // Handle file attachments
  if (opts.attachments && opts.attachments.length > 0) {
    const attachmentsDir = join(getAttachmentsDir(), String(message.id));
    mkdirSync(attachmentsDir, { recursive: true });

    const attachmentInfos: Attachment[] = [];
    for (const att of opts.attachments) {
      const destPath = join(attachmentsDir, att.name);
      copyFileSync(att.source_path, destPath);
      const stat = statSync(destPath);
      attachmentInfos.push({
        name: att.name,
        path: destPath,
        size: stat.size,
        mime_type: guessMimeType(att.name),
      });
    }

    const attachmentsJson = JSON.stringify(attachmentInfos);
    db.prepare("UPDATE messages SET attachments = ? WHERE id = ?").run(attachmentsJson, message.id);
    message.attachments = attachmentInfos;
  }

  return message;
}

export function readMessages(opts: ReadMessagesOptions = {}): Message[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (opts.session_id) {
    conditions.push("session_id = ?");
    params.push(opts.session_id);
  }
  if (opts.from) {
    conditions.push("from_agent = ?");
    params.push(opts.from);
  }
  if (opts.to) {
    conditions.push("to_agent = ?");
    params.push(opts.to);
  }
  if (opts.space) {
    conditions.push("space = ?");
    params.push(opts.space);
  }
  if (opts.since) {
    conditions.push("created_at > ?");
    params.push(opts.since);
  }
  if (opts.since_id !== undefined) {
    conditions.push("id > ?");
    params.push(opts.since_id);
  }
  if (opts.unread_only) {
    conditions.push("read_at IS NULL");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Number.isFinite(opts.limit) && (opts.limit as number) > 0
    ? `LIMIT ${Math.floor(opts.limit as number)}`
    : "";
  const order = opts.order?.toLowerCase() === "desc" ? "DESC" : "ASC";

  const rows = db.prepare(
    `SELECT * FROM messages ${where} ORDER BY created_at ${order}, id ${order} ${limit}`
  ).all(...params) as Record<string, unknown>[];

  return rows.map(parseMessage);
}

export function markRead(ids: number[], reader: string): number {
  const db = getDb();
  if (ids.length === 0) return 0;

  const placeholders = ids.map(() => "?").join(", ");
  const stmt = db.prepare(
    `UPDATE messages SET read_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE id IN (${placeholders}) AND to_agent = ? AND read_at IS NULL`
  );
  const result = stmt.run(...ids, reader);
  return result.changes;
}

export function markSessionRead(sessionId: string, reader: string): number {
  const db = getDb();
  const stmt = db.prepare(
    `UPDATE messages SET read_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE session_id = ? AND to_agent = ? AND read_at IS NULL`
  );
  const result = stmt.run(sessionId, reader);
  return result.changes;
}

export function markSpaceRead(spaceName: string, reader: string): number {
  const db = getDb();
  const stmt = db.prepare(
    `UPDATE messages SET read_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE space = ? AND from_agent != ? AND read_at IS NULL`
  );
  const result = stmt.run(spaceName, reader);
  return result.changes;
}

export function getMessageById(id: number): Message | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as Record<string, unknown> | null;
  return row ? parseMessage(row) : null;
}

export function markAllRead(agent: string): number {
  const db = getDb();
  const stmt = db.prepare(
    `UPDATE messages SET read_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE to_agent = ? AND read_at IS NULL`
  );
  const result = stmt.run(agent);
  return result.changes;
}

export interface ExportMessagesOptions {
  space?: string;
  session_id?: string;
  from?: string;
  since?: string;
  until?: string;
  format?: "json" | "csv";
}

function escapeCsvField(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportMessages(opts?: ExportMessagesOptions): string {
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (opts?.space) {
    conditions.push("space = ?");
    params.push(opts.space);
  }
  if (opts?.session_id) {
    conditions.push("session_id = ?");
    params.push(opts.session_id);
  }
  if (opts?.from) {
    conditions.push("from_agent = ?");
    params.push(opts.from);
  }
  if (opts?.since) {
    conditions.push("created_at >= ?");
    params.push(opts.since);
  }
  if (opts?.until) {
    conditions.push("created_at <= ?");
    params.push(opts.until);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const rows = db.prepare(
    `SELECT * FROM messages ${where} ORDER BY created_at ASC, id ASC`
  ).all(...params) as Record<string, unknown>[];

  const messages = rows.map(parseMessage);
  const format = opts?.format ?? "json";

  if (format === "csv") {
    const headers = "id,session_id,from_agent,to_agent,space,content,priority,created_at,read_at";
    const lines = messages.map((m) =>
      [
        String(m.id),
        escapeCsvField(m.session_id),
        escapeCsvField(m.from_agent),
        escapeCsvField(m.to_agent),
        escapeCsvField(m.space),
        escapeCsvField(m.content),
        escapeCsvField(m.priority),
        escapeCsvField(m.created_at),
        escapeCsvField(m.read_at),
      ].join(",")
    );
    return [headers, ...lines].join("\n");
  }

  return JSON.stringify(messages, null, 2);
}

export function deleteMessage(id: number, agent: string): boolean {
  const db = getDb();
  const stmt = db.prepare("DELETE FROM messages WHERE id = ? AND from_agent = ?");
  const result = stmt.run(id, agent);
  return result.changes > 0;
}

export function editMessage(id: number, agent: string, newContent: string): Message | null {
  const db = getDb();
  const stmt = db.prepare(
    `UPDATE messages SET content = ?, edited_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE id = ? AND from_agent = ? RETURNING *`
  );
  const row = stmt.get(newContent, id, agent) as Record<string, unknown> | null;
  return row ? parseMessage(row) : null;
}

export function pinMessage(id: number): Message | null {
  const db = getDb();
  const stmt = db.prepare(
    `UPDATE messages SET pinned_at = strftime('%Y-%m-%dT%H:%M:%f', 'now') WHERE id = ? RETURNING *`
  );
  const row = stmt.get(id) as Record<string, unknown> | null;
  return row ? parseMessage(row) : null;
}

export function unpinMessage(id: number): Message | null {
  const db = getDb();
  const stmt = db.prepare(
    `UPDATE messages SET pinned_at = NULL WHERE id = ? RETURNING *`
  );
  const row = stmt.get(id) as Record<string, unknown> | null;
  return row ? parseMessage(row) : null;
}

export function getPinnedMessages(opts?: { space?: string; session_id?: string; limit?: number }): Message[] {
  const db = getDb();
  const conditions: string[] = ["pinned_at IS NOT NULL"];
  const params: (string | number)[] = [];

  if (opts?.space) {
    conditions.push("space = ?");
    params.push(opts.space);
  }
  if (opts?.session_id) {
    conditions.push("session_id = ?");
    params.push(opts.session_id);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;
  const limit = Number.isFinite(opts?.limit) && (opts!.limit as number) > 0
    ? `LIMIT ${Math.floor(opts!.limit as number)}`
    : "";

  const rows = db.prepare(
    `SELECT * FROM messages ${where} ORDER BY pinned_at DESC, id DESC ${limit}`
  ).all(...params) as Record<string, unknown>[];

  return rows.map(parseMessage);
}

export function getUnreadBlockers(agent: string): Message[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM messages
    WHERE blocking = 1 AND read_at IS NULL
    AND (
      to_agent = ?
      OR space IN (SELECT space FROM space_members WHERE agent = ?)
    )
    ORDER BY created_at ASC, id ASC
  `).all(agent, agent) as Record<string, unknown>[];
  return rows.map(parseMessage);
}

export function searchMessages(opts: SearchMessagesOptions): Message[] {
  const db = getDb();
  const conditions: string[] = ["content LIKE ?"];
  const params: (string | number)[] = [`%${opts.query}%`];

  if (opts.space) {
    conditions.push("space = ?");
    params.push(opts.space);
  }
  if (opts.from) {
    conditions.push("from_agent = ?");
    params.push(opts.from);
  }
  if (opts.to) {
    conditions.push("to_agent = ?");
    params.push(opts.to);
  }

  const limit = Number.isFinite(opts.limit) && (opts.limit as number) > 0
    ? Math.floor(opts.limit as number)
    : 50;

  const where = `WHERE ${conditions.join(" AND ")}`;

  const rows = db.prepare(
    `SELECT * FROM messages ${where} ORDER BY created_at DESC, id DESC LIMIT ${limit}`
  ).all(...params) as Record<string, unknown>[];

  return rows.map(parseMessage);
}
