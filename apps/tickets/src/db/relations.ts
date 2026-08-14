import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "./database.ts";
import type { TicketRelation, RelationType } from "../types/index.ts";
import { ValidationError, NotFoundError } from "../types/index.ts";

interface RawRelation {
  id: string;
  ticket_id: string;
  related_ticket_id: string;
  relation_type: string;
  created_by: string | null;
  created_at: string;
}

function rowToRelation(row: RawRelation): TicketRelation {
  return {
    id: row.id,
    ticket_id: row.ticket_id,
    related_ticket_id: row.related_ticket_id,
    relation_type: row.relation_type as RelationType,
    created_by: row.created_by,
    created_at: row.created_at,
  };
}

export function createRelation(
  ticketId: string,
  relatedTicketId: string,
  relationType: RelationType,
  createdBy?: string,
  db?: Database
): TicketRelation {
  const database = db ?? getDatabase();

  if (ticketId === relatedTicketId) {
    throw new ValidationError("A ticket cannot be related to itself");
  }

  // Check both tickets exist
  const t1 = database.query<{ id: string }, [string]>("SELECT id FROM tickets WHERE id = ?").get(ticketId);
  const t2 = database.query<{ id: string }, [string]>("SELECT id FROM tickets WHERE id = ?").get(relatedTicketId);
  if (!t1) throw new NotFoundError("Ticket", ticketId);
  if (!t2) throw new NotFoundError("Ticket", relatedTicketId);

  const id = uuid();
  const n = now();

  try {
    database.run(
      `INSERT INTO ticket_relations (id, ticket_id, related_ticket_id, relation_type, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, ticketId, relatedTicketId, relationType, createdBy ?? null, n]
    );
  } catch {
    throw new ValidationError(`Relation already exists: ${ticketId} ${relationType} ${relatedTicketId}`);
  }

  return { id, ticket_id: ticketId, related_ticket_id: relatedTicketId, relation_type: relationType, created_by: createdBy ?? null, created_at: n };
}

export function listRelations(ticketId: string, db?: Database): TicketRelation[] {
  const database = db ?? getDatabase();
  const rows = database.query<RawRelation, [string, string]>(
    `SELECT * FROM ticket_relations WHERE ticket_id = ? OR related_ticket_id = ? ORDER BY created_at ASC`
  ).all(ticketId, ticketId);
  return rows.map(rowToRelation);
}

export function deleteRelation(id: string, db?: Database): void {
  const database = db ?? getDatabase();
  const result = database.run("DELETE FROM ticket_relations WHERE id = ?", [id]);
  if (result.changes === 0) throw new NotFoundError("Relation", id);
}
