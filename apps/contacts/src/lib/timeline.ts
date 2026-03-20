import { Database } from "bun:sqlite";
import { getDatabase } from "../db/database.js";

export type TimelineItemType =
  | 'note'
  | 'event'
  | 'task_created'
  | 'task_completed'
  | 'vendor_comm'
  | 'interaction'
  | 'relationship_added'
  | 'deal_created'
  | 'deal_stage_changed';

export interface TimelineItem {
  date: string;
  type: TimelineItemType;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
}

export function getContactTimeline(contactId: string, limit = 50, db?: Database): TimelineItem[] {
  const _db = db || getDatabase();
  const items: TimelineItem[] = [];

  // Notes
  const notes = _db.query(`SELECT * FROM contact_notes WHERE contact_id = ? ORDER BY created_at DESC LIMIT 50`).all(contactId) as { id: string; created_at: string; body: string }[];
  for (const n of notes) {
    items.push({ date: n.created_at, type: 'note', title: 'Note', body: n.body });
  }

  // Events (where contact_id is in contact_ids JSON array)
  const events = _db.query(`SELECT * FROM events WHERE contact_ids LIKE ? ORDER BY event_date DESC LIMIT 50`).all(`%${contactId}%`) as { id: string; event_date: string; type: string; title: string; notes: string | null; outcome: string | null; duration_min: number | null }[];
  for (const e of events) {
    items.push({ date: e.event_date, type: 'event', title: `${e.type}: ${e.title}`, body: e.notes ?? undefined, metadata: { outcome: e.outcome, duration_min: e.duration_min } });
  }

  // Contact tasks
  const tasks = _db.query(`SELECT * FROM contact_tasks WHERE contact_id = ? ORDER BY created_at DESC LIMIT 30`).all(contactId) as { id: string; title: string; created_at: string; updated_at: string; status: string; deadline: string | null; priority: string }[];
  for (const t of tasks) {
    items.push({ date: t.created_at, type: 'task_created', title: `Task created: ${t.title}`, metadata: { deadline: t.deadline, priority: t.priority } });
    if (t.status === 'completed') {
      items.push({ date: t.updated_at, type: 'task_completed', title: `Task completed: ${t.title}` });
    }
  }

  // Vendor comms
  const comms = _db.query(`SELECT vc.*, co.name as company_name FROM vendor_communications vc JOIN companies co ON vc.company_id = co.id WHERE vc.contact_id = ? ORDER BY vc.comm_date DESC LIMIT 20`).all(contactId) as { id: string; comm_date: string; type: string; company_name: string; subject: string | null }[];
  for (const c of comms) {
    items.push({ date: c.comm_date, type: 'vendor_comm', title: `${c.type} — ${c.company_name}`, body: c.subject ?? undefined });
  }

  // Activity log
  const activity = _db.query(`SELECT * FROM activity_log WHERE contact_id = ? ORDER BY created_at DESC LIMIT 30`).all(contactId) as { id: string; created_at: string; action: string; details: string | null }[];
  for (const a of activity) {
    items.push({ date: a.created_at, type: 'interaction', title: a.action, body: a.details ?? undefined });
  }

  return items.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}
