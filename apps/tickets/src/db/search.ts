import type { Database } from "bun:sqlite";
import { getDatabase } from "./database.ts";
import type { Ticket, TicketFilters } from "../types/index.ts";
import { listTickets } from "./tickets.ts";

interface FtsRow {
  ticket_id: string;
  rank: number;
}

/**
 * Full-text search over ticket title + description using SQLite FTS5 BM25.
 * Returns tickets ranked by relevance, with optional project scoping.
 */
export function searchTickets(
  query: string,
  filters: Omit<TicketFilters, "search"> = {},
  db?: Database
): { tickets: Ticket[]; total: number } {
  if (!query.trim()) return listTickets(filters, db);
  return listTickets({ ...filters, search: query }, db);
}

/**
 * Find tickets with similar titles to detect potential duplicates.
 * Returns up to `limit` tickets ordered by BM25 relevance score.
 */
export function getSimilarTickets(
  title: string,
  projectId?: string,
  limit = 5,
  db?: Database
): SimilarTicket[] {
  const database = db ?? getDatabase();
  if (!title.trim()) return [];

  // Build FTS query from title words — require at least one word to match
  const words = title
    .trim()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 8);

  if (words.length === 0) return [];

  // Use OR for partial matching (any word hits), rank by BM25
  const ftsQuery = words.map((w) => `${w}*`).join(" OR ");

  const projectFilter = projectId ? "AND t.project_id = ?" : "";
  const params: (string | number)[] = [ftsQuery];
  if (projectId) params.push(projectId);
  params.push(limit);

  interface RawRow {
    id: string;
    short_id: string;
    title: string;
    status: string;
    priority: string;
    rank: number;
  }

  const rows = database.query<RawRow, typeof params>(
    `SELECT t.id, t.short_id, t.title, t.status, t.priority,
            bm25(tickets_fts) as rank
     FROM tickets_fts
     JOIN tickets t ON t.id = tickets_fts.ticket_id
     WHERE tickets_fts MATCH ?
     ${projectFilter}
     ORDER BY rank
     LIMIT ?`
  ).all(...params);

  return rows.map((r) => ({
    id: r.id,
    short_id: r.short_id,
    title: r.title,
    status: r.status,
    priority: r.priority,
    score: Math.abs(r.rank), // BM25 returns negative values; higher abs = more relevant
  }));
}

export interface SimilarTicket {
  id: string;
  short_id: string;
  title: string;
  status: string;
  priority: string;
  score: number;
}

/**
 * Rebuild the FTS index for a specific ticket (call after manual DB edits).
 */
export function rebuildFtsForTicket(ticketId: string, db?: Database): void {
  const database = db ?? getDatabase();
  interface TRow { id: string; title: string; description: string | null }
  const ticket = database.query<TRow, [string]>(
    "SELECT id, title, description FROM tickets WHERE id = ?"
  ).get(ticketId);
  if (!ticket) return;

  database.run("DELETE FROM tickets_fts WHERE ticket_id = ?", [ticketId]);
  database.run(
    `INSERT INTO tickets_fts(rowid, ticket_id, title, description)
     SELECT rowid, id, title, COALESCE(description, '') FROM tickets WHERE id = ?`,
    [ticketId]
  );
}
