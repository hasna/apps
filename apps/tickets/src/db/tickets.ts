import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid, resolveTicketId } from "./database.ts";
import { incrementTicketCounter } from "./projects.ts";
import { generateShortId } from "../lib/short-id.ts";
import { assertValidTransition } from "../lib/state-machine.ts";
import type {
  Ticket, TicketType, TicketStatus, Resolution,
  Priority, Severity, TicketSource, TicketFilters,
} from "../types/index.ts";
import {
  NotFoundError, ValidationError, VersionConflictError,
} from "../types/index.ts";

// ── Raw DB row → Ticket ──────────────────────────────────────────────────────

interface RawTicket {
  id: string;
  short_id: string;
  project_id: string;
  workspace_id: string | null;
  title: string;
  description: string | null;
  type: string;
  status: string;
  resolution: string | null;
  priority: string;
  severity: string | null;
  reporter_id: string | null;
  assignee_id: string | null;
  milestone_id: string | null;
  labels: string;
  custom_fields: string;
  source: string;
  external_id: string | null;
  external_url: string | null;
  is_ai_opened: number;
  ai_confidence: number | null;
  ai_reasoning: string | null;
  due_date: string | null;
  sla_minutes: number | null;
  sla_breached: number;
  duplicate_of: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  closed_at: string | null;
}

function rowToTicket(row: RawTicket): Ticket {
  return {
    id: row.id,
    short_id: row.short_id,
    project_id: row.project_id,
    workspace_id: row.workspace_id,
    title: row.title,
    description: row.description,
    type: row.type as TicketType,
    status: row.status as TicketStatus,
    resolution: (row.resolution ?? null) as Resolution | null,
    priority: row.priority as Priority,
    severity: (row.severity ?? null) as Severity | null,
    reporter_id: row.reporter_id,
    assignee_id: row.assignee_id,
    milestone_id: row.milestone_id,
    labels: JSON.parse(row.labels ?? "[]") as string[],
    custom_fields: JSON.parse(row.custom_fields ?? "{}") as Record<string, unknown>,
    source: row.source as TicketSource,
    external_id: row.external_id,
    external_url: row.external_url,
    is_ai_opened: row.is_ai_opened === 1,
    ai_confidence: row.ai_confidence,
    ai_reasoning: row.ai_reasoning,
    due_date: row.due_date,
    sla_minutes: row.sla_minutes,
    sla_breached: row.sla_breached === 1,
    duplicate_of: row.duplicate_of,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    resolved_at: row.resolved_at,
    closed_at: row.closed_at,
  };
}

// ── Create ───────────────────────────────────────────────────────────────────

export interface CreateTicketOptions {
  project_id: string;
  title: string;
  description?: string;
  type?: TicketType;
  priority?: Priority;
  severity?: Severity;
  reporter_id?: string;
  assignee_id?: string;
  milestone_id?: string;
  labels?: string[];
  custom_fields?: Record<string, unknown>;
  source?: TicketSource;
  external_id?: string;
  external_url?: string;
  is_ai_opened?: boolean;
  ai_confidence?: number;
  ai_reasoning?: string;
  due_date?: string;
  sla_minutes?: number;
  workspace_id?: string;
}

export function createTicket(options: CreateTicketOptions, db?: Database): Ticket {
  const database = db ?? getDatabase();

  if (!options.title.trim()) throw new ValidationError("Ticket title is required");
  if (options.title.length > 255) throw new ValidationError("Title must be 255 characters or less");

  const counter = incrementTicketCounter(options.project_id, database);

  // Get prefix from project
  const proj = database.query<{ ticket_prefix: string; workspace_id: string | null }, [string]>(
    "SELECT ticket_prefix, workspace_id FROM projects WHERE id = ?"
  ).get(options.project_id);
  if (!proj) throw new NotFoundError("Project", options.project_id);

  const id = uuid();
  const short_id = generateShortId(proj.ticket_prefix, counter);
  const n = now();

  database.run(
    `INSERT INTO tickets
       (id, short_id, project_id, workspace_id, title, description, type, status, priority,
        severity, reporter_id, assignee_id, milestone_id, labels, custom_fields, source,
        external_id, external_url, is_ai_opened, ai_confidence, ai_reasoning,
        due_date, sla_minutes, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      id, short_id, options.project_id,
      options.workspace_id ?? proj.workspace_id ?? null,
      options.title.trim(),
      options.description ?? null,
      options.type ?? "bug",
      options.priority ?? "none",
      options.severity ?? null,
      options.reporter_id ?? null,
      options.assignee_id ?? null,
      options.milestone_id ?? null,
      JSON.stringify(options.labels ?? []),
      JSON.stringify(options.custom_fields ?? {}),
      options.source ?? "api",
      options.external_id ?? null,
      options.external_url ?? null,
      options.is_ai_opened ? 1 : 0,
      options.ai_confidence ?? null,
      options.ai_reasoning ?? null,
      options.due_date ?? null,
      options.sla_minutes ?? null,
      n, n,
    ]
  );

  return getTicketById(id, database);
}

// ── Read ─────────────────────────────────────────────────────────────────────

export function getTicketById(idOrShortId: string, db?: Database): Ticket {
  const database = db ?? getDatabase();
  const resolved = resolveTicketId(database, idOrShortId);
  if (!resolved) throw new NotFoundError("Ticket", idOrShortId);
  const row = database.query<RawTicket, [string]>("SELECT * FROM tickets WHERE id = ?").get(resolved);
  if (!row) throw new NotFoundError("Ticket", idOrShortId);
  return rowToTicket(row);
}

export function listTickets(filters: TicketFilters = {}, db?: Database): { tickets: Ticket[]; total: number } {
  const database = db ?? getDatabase();

  const conditions: string[] = [];
  const params: (string | number | null)[] = [];

  if (filters.project_id) { conditions.push("t.project_id = ?"); params.push(filters.project_id); }
  if (filters.workspace_id) { conditions.push("t.workspace_id = ?"); params.push(filters.workspace_id); }
  if (filters.assignee_id) { conditions.push("t.assignee_id = ?"); params.push(filters.assignee_id); }
  if (filters.reporter_id) { conditions.push("t.reporter_id = ?"); params.push(filters.reporter_id); }
  if (filters.milestone_id) { conditions.push("t.milestone_id = ?"); params.push(filters.milestone_id); }
  if (filters.source) { conditions.push("t.source = ?"); params.push(filters.source); }
  if (filters.is_ai_opened !== undefined) { conditions.push("t.is_ai_opened = ?"); params.push(filters.is_ai_opened ? 1 : 0); }
  if (filters.sla_breached !== undefined) { conditions.push("t.sla_breached = ?"); params.push(filters.sla_breached ? 1 : 0); }
  if (filters.created_after) { conditions.push("t.created_at >= ?"); params.push(filters.created_after); }
  if (filters.created_before) { conditions.push("t.created_at <= ?"); params.push(filters.created_before); }
  if (filters.updated_after) { conditions.push("t.updated_at >= ?"); params.push(filters.updated_after); }

  if (filters.status) {
    const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
    conditions.push(`t.status IN (${statuses.map(() => "?").join(",")})`);
    params.push(...statuses);
  }
  if (filters.priority) {
    const priorities = Array.isArray(filters.priority) ? filters.priority : [filters.priority];
    conditions.push(`t.priority IN (${priorities.map(() => "?").join(",")})`);
    params.push(...priorities);
  }
  if (filters.type) {
    const types = Array.isArray(filters.type) ? filters.type : [filters.type];
    conditions.push(`t.type IN (${types.map(() => "?").join(",")})`);
    params.push(...types);
  }

  // Label filter — JSON array contains
  if (filters.label) {
    conditions.push("t.labels LIKE ?");
    params.push(`%"${filters.label}"%`);
  }

  // Full-text search via FTS5
  if (filters.search) {
    conditions.push(`t.id IN (
      SELECT ticket_id FROM tickets_fts WHERE tickets_fts MATCH ?
    )`);
    params.push(filters.search.replace(/"/g, '""'));
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const sort = filters.sort ?? "created_at";
  const order = filters.order ?? "desc";
  const allowedSorts = ["created_at", "updated_at", "priority", "status"];
  const safeSort = allowedSorts.includes(sort) ? sort : "created_at";

  const countRow = database.query<{ count: number }, typeof params>(
    `SELECT COUNT(*) as count FROM tickets t ${where}`
  ).get(...params);
  const total = countRow?.count ?? 0;

  const page = filters.page ?? 1;
  const per_page = Math.min(filters.per_page ?? 25, 100);
  const offset = (page - 1) * per_page;

  const rows = database.query<RawTicket, typeof params>(
    `SELECT t.* FROM tickets t ${where} ORDER BY t.${safeSort} ${order.toUpperCase()} LIMIT ${per_page} OFFSET ${offset}`
  ).all(...params);

  return { tickets: rows.map(rowToTicket), total };
}

// ── Update ───────────────────────────────────────────────────────────────────

export interface UpdateTicketOptions {
  title?: string;
  description?: string;
  type?: TicketType;
  priority?: Priority;
  severity?: Severity;
  assignee_id?: string | null;
  milestone_id?: string | null;
  labels?: string[];
  custom_fields?: Record<string, unknown>;
  due_date?: string | null;
  sla_minutes?: number | null;
  external_id?: string | null;
  external_url?: string | null;
  version?: number; // required for optimistic locking
}

export function updateTicket(idOrShortId: string, options: UpdateTicketOptions, db?: Database): Ticket {
  const database = db ?? getDatabase();
  const ticket = getTicketById(idOrShortId, database);

  // Optimistic locking
  if (options.version !== undefined && options.version !== ticket.version) {
    throw new VersionConflictError(ticket.short_id, options.version, ticket.version);
  }

  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (options.title !== undefined) { sets.push("title = ?"); params.push(options.title.trim()); }
  if (options.description !== undefined) { sets.push("description = ?"); params.push(options.description); }
  if (options.type !== undefined) { sets.push("type = ?"); params.push(options.type); }
  if (options.priority !== undefined) { sets.push("priority = ?"); params.push(options.priority); }
  if (options.severity !== undefined) { sets.push("severity = ?"); params.push(options.severity); }
  if ("assignee_id" in options) { sets.push("assignee_id = ?"); params.push(options.assignee_id ?? null); }
  if ("milestone_id" in options) { sets.push("milestone_id = ?"); params.push(options.milestone_id ?? null); }
  if (options.labels !== undefined) { sets.push("labels = ?"); params.push(JSON.stringify(options.labels)); }
  if (options.custom_fields !== undefined) { sets.push("custom_fields = ?"); params.push(JSON.stringify(options.custom_fields)); }
  if ("due_date" in options) { sets.push("due_date = ?"); params.push(options.due_date ?? null); }
  if ("sla_minutes" in options) { sets.push("sla_minutes = ?"); params.push(options.sla_minutes ?? null); }
  if ("external_id" in options) { sets.push("external_id = ?"); params.push(options.external_id ?? null); }
  if ("external_url" in options) { sets.push("external_url = ?"); params.push(options.external_url ?? null); }

  if (sets.length === 0) return ticket;

  sets.push("updated_at = ?", "version = version + 1");
  params.push(now(), ticket.id);

  database.run(`UPDATE tickets SET ${sets.join(", ")} WHERE id = ?`, params);
  return getTicketById(ticket.id, database);
}

// ── Status transitions ───────────────────────────────────────────────────────

export interface CloseTicketOptions {
  resolution: Resolution;
  duplicate_of?: string;
  version?: number;
}

export function closeTicket(idOrShortId: string, options: CloseTicketOptions, db?: Database): Ticket {
  const database = db ?? getDatabase();
  const ticket = getTicketById(idOrShortId, database);

  if (options.version !== undefined && options.version !== ticket.version) {
    throw new VersionConflictError(ticket.short_id, options.version, ticket.version);
  }

  assertValidTransition(ticket.status, "closed");

  const n = now();
  database.run(
    `UPDATE tickets
     SET status = 'closed', resolution = ?, duplicate_of = ?, closed_at = ?,
         updated_at = ?, version = version + 1
     WHERE id = ?`,
    [options.resolution, options.duplicate_of ?? null, n, n, ticket.id]
  );
  return getTicketById(ticket.id, database);
}

export function resolveTicket(idOrShortId: string, resolution: Resolution, db?: Database): Ticket {
  const database = db ?? getDatabase();
  const ticket = getTicketById(idOrShortId, database);
  assertValidTransition(ticket.status, "resolved");
  const n = now();
  database.run(
    `UPDATE tickets SET status = 'resolved', resolution = ?, resolved_at = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
    [resolution, n, n, ticket.id]
  );
  return getTicketById(ticket.id, database);
}

export function reopenTicket(idOrShortId: string, db?: Database): Ticket {
  const database = db ?? getDatabase();
  const ticket = getTicketById(idOrShortId, database);
  assertValidTransition(ticket.status, "open");
  const n = now();
  database.run(
    `UPDATE tickets SET status = 'open', resolution = NULL, resolved_at = NULL, closed_at = NULL, updated_at = ?, version = version + 1 WHERE id = ?`,
    [n, ticket.id]
  );
  return getTicketById(ticket.id, database);
}

export function transitionTicket(idOrShortId: string, status: TicketStatus, db?: Database): Ticket {
  const database = db ?? getDatabase();
  const ticket = getTicketById(idOrShortId, database);
  if (ticket.status === status) return ticket;
  assertValidTransition(ticket.status, status);
  const n = now();
  database.run(
    `UPDATE tickets SET status = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
    [status, n, ticket.id]
  );
  return getTicketById(ticket.id, database);
}

export function assignTicket(idOrShortId: string, assigneeId: string | null, db?: Database): Ticket {
  const database = db ?? getDatabase();
  const ticket = getTicketById(idOrShortId, database);
  const n = now();
  database.run(
    `UPDATE tickets SET assignee_id = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
    [assigneeId, n, ticket.id]
  );
  return getTicketById(ticket.id, database);
}

// ── Delete ───────────────────────────────────────────────────────────────────

export function deleteTicket(idOrShortId: string, db?: Database): void {
  const database = db ?? getDatabase();
  const resolved = resolveTicketId(database, idOrShortId);
  if (!resolved) throw new NotFoundError("Ticket", idOrShortId);
  const result = database.run("DELETE FROM tickets WHERE id = ?", [resolved]);
  if (result.changes === 0) throw new NotFoundError("Ticket", idOrShortId);
}

// ── Bulk ─────────────────────────────────────────────────────────────────────

export function bulkCreateTickets(items: CreateTicketOptions[], db?: Database): Ticket[] {
  const database = db ?? getDatabase();
  const results: Ticket[] = [];
  for (const item of items) {
    results.push(createTicket(item, database));
  }
  return results;
}

export interface BulkUpdateItem {
  id: string;
  status?: TicketStatus;
  priority?: Priority;
  assignee_id?: string | null;
}

export function bulkUpdateTickets(items: BulkUpdateItem[], db?: Database): Ticket[] {
  const database = db ?? getDatabase();
  const results: Ticket[] = [];
  for (const item of items) {
    const { id, ...updates } = item;
    if (updates.status) {
      results.push(transitionTicket(id, updates.status, database));
    } else {
      results.push(updateTicket(id, updates, database));
    }
  }
  return results;
}
