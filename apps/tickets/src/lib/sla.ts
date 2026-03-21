import { getDatabase, now } from "../db/database.ts";
import { appendActivity } from "../db/activity.ts";
import { notifySlaBreached } from "../email/notifications.ts";
import type { Ticket } from "../types/index.ts";

interface SlaBreachRow {
  id: string; short_id: string; title: string; sla_minutes: number; created_at: string;
  assignee_id: string | null; type: string; status: string; priority: string;
  severity: string | null; reporter_id: string | null; project_id: string;
  workspace_id: string | null; description: string | null; resolution: string | null;
  labels: string; custom_fields: string; source: string; external_id: string | null;
  external_url: string | null; is_ai_opened: number; ai_confidence: number | null;
  ai_reasoning: string | null; due_date: string | null; sla_breached: number;
  duplicate_of: string | null; version: number; updated_at: string;
  resolved_at: string | null; closed_at: string | null; milestone_id: string | null;
}

/**
 * Find tickets that have exceeded their SLA and mark them as breached.
 * Appends an activity entry and enqueues a notification email for each breach.
 */
export function checkSlaBreaches(): { breached: number } {
  const database = getDatabase();
  const n = now();

  // SQLite datetime arithmetic: sla_minutes added to created_at
  const rows = database.query<SlaBreachRow, []>(
    `SELECT t.*, a.email as assignee_email
     FROM tickets t
     LEFT JOIN agents a ON a.id = t.assignee_id
     WHERE t.sla_minutes IS NOT NULL
       AND t.sla_breached = 0
       AND t.status NOT IN ('closed', 'resolved')
       AND datetime(t.created_at, '+' || t.sla_minutes || ' minutes') < datetime(?)`
  ).all(n) as SlaBreachRow[];

  if (rows.length === 0) return { breached: 0 };

  // Batch update all breached tickets
  const ids = rows.map((r) => `'${r.id}'`).join(",");
  database.run(`UPDATE tickets SET sla_breached = 1, updated_at = ? WHERE id IN (${ids})`, [n]);

  for (const row of rows) {
    const ticket = rowToTicket(row);

    // Activity log
    appendActivity({
      ticket_id: row.id,
      action: "sla_breached",
      to_value: `${row.sla_minutes} minutes exceeded`,
      is_ai_action: false,
    });

    // Email notification to assignee
    const assigneeEmail = (row as SlaBreachRow & { assignee_email?: string }).assignee_email;
    if (assigneeEmail) notifySlaBreached(ticket, assigneeEmail);
  }

  return { breached: rows.length };
}

function rowToTicket(row: SlaBreachRow): Ticket {
  return {
    id: row.id, short_id: row.short_id, project_id: row.project_id,
    workspace_id: row.workspace_id, title: row.title, description: row.description,
    type: row.type as Ticket["type"], status: row.status as Ticket["status"],
    resolution: (row.resolution ?? null) as Ticket["resolution"],
    priority: row.priority as Ticket["priority"],
    severity: (row.severity ?? null) as Ticket["severity"],
    reporter_id: row.reporter_id, assignee_id: row.assignee_id,
    milestone_id: row.milestone_id,
    labels: JSON.parse(row.labels ?? "[]") as string[],
    custom_fields: JSON.parse(row.custom_fields ?? "{}") as Record<string, unknown>,
    source: row.source as Ticket["source"],
    external_id: row.external_id, external_url: row.external_url,
    is_ai_opened: row.is_ai_opened === 1,
    ai_confidence: row.ai_confidence, ai_reasoning: row.ai_reasoning,
    due_date: row.due_date, sla_minutes: row.sla_minutes,
    sla_breached: false, // we just set it
    duplicate_of: row.duplicate_of, version: row.version,
    created_at: row.created_at, updated_at: row.updated_at,
    resolved_at: row.resolved_at, closed_at: row.closed_at,
  };
}

/** Start the SLA checker — runs on startup and every 5 minutes. */
export function startSlaChecker(): void {
  // Run immediately on startup
  try { checkSlaBreaches(); } catch { /* non-fatal */ }

  // Then every 5 minutes
  setInterval(() => {
    try { checkSlaBreaches(); } catch { /* non-fatal */ }
  }, 5 * 60 * 1000);
}
