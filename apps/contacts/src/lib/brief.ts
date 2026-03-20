import { Database } from "bun:sqlite";
import { getDatabase } from "../db/database.js";
import { getContact } from "../db/contacts.js";
import { listNotes } from "../db/notes.js";
import { listContactTasks } from "../db/contact-tasks.js";
import { listCompanyRelationships } from "../db/relationships.js";
import { getContactTimeline } from "./timeline.js";

export function generateBrief(contactId: string, db?: Database): string {
  const _db = db || getDatabase();
  const contact = getContact(contactId, _db);
  const notes = listNotes(contactId, _db);
  const allTasks = listContactTasks({ contact_id: contactId }, _db);
  const tasks = allTasks.filter(t => !['completed', 'cancelled'].includes(t.status));
  const overdueTasks = allTasks.filter(t => t.deadline && t.deadline < new Date().toISOString() && !['completed', 'cancelled'].includes(t.status));
  const companyRels = listCompanyRelationships({ contact_id: contactId }, _db);
  const recentTimeline = getContactTimeline(contactId, 5, _db);
  const daysSince = contact.last_contacted_at
    ? Math.floor((Date.now() - new Date(contact.last_contacted_at).getTime()) / 86400000)
    : null;

  const lines: string[] = [];
  lines.push(`# ${contact.display_name}`);
  if (contact.job_title) lines.push(`**Role:** ${contact.job_title}${contact.company_id ? ` (linked to company)` : ''}`);
  if (contact.emails?.length) {
    const primary = contact.emails.find(e => e.is_primary) || contact.emails[0];
    if (primary) lines.push(`**Email:** ${primary.address}`);
  }
  if (contact.phones?.length) {
    const primary = contact.phones.find(p => p.is_primary) || contact.phones[0];
    if (primary) lines.push(`**Phone:** ${primary.number}`);
  }
  if (contact.preferred_contact_method) lines.push(`**Preferred contact:** ${contact.preferred_contact_method}`);
  lines.push('');
  lines.push(`## Status`);
  lines.push(`- Last contacted: ${daysSince !== null ? `${daysSince} days ago` : 'never'}`);
  lines.push(`- Status: ${contact.status || 'active'}`);
  if (contact.follow_up_at) lines.push(`- Follow-up scheduled: ${contact.follow_up_at}`);
  if (overdueTasks.length) lines.push(`- OVERDUE TASKS: ${overdueTasks.length}`);
  if (companyRels.length) {
    lines.push('');
    lines.push(`## Entity Relationships`);
    for (const r of companyRels) lines.push(`- ${r.relationship_type} — ${r.notes || ''}`);
  }
  if (tasks.length) {
    lines.push('');
    lines.push(`## Open Tasks`);
    for (const t of tasks) lines.push(`- [${t.priority}] ${t.title}${t.deadline ? ` (due ${t.deadline})` : ''}`);
  }
  if (notes.length) {
    lines.push('');
    lines.push(`## Recent Notes`);
    for (const n of notes.slice(0, 3)) lines.push(`**${n.created_at.slice(0, 10)}:** ${n.body}`);
  }
  if (recentTimeline.length) {
    lines.push('');
    lines.push(`## Recent Activity`);
    for (const item of recentTimeline) lines.push(`- ${item.date.slice(0, 10)} ${item.title}`);
  }
  if (contact.notes) {
    lines.push('');
    lines.push(`## Background Notes`);
    lines.push(contact.notes);
  }

  return lines.join('\n');
}
