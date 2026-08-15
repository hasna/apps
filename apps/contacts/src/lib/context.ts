import { getDatabase } from "../db/database.js";
import type { ContactsDatabase } from "../db/database.js";
import { getContact } from "../db/contacts.js";
import { listNotes } from "../db/notes.js";
import { getLearnings } from "../db/learnings.js";

export function getContactCard(contactId: string, db?: ContactsDatabase): object {
  const _db = db || getDatabase();
  const c = getContact(contactId, _db);
  const emails = c.emails as Array<{ address: string; is_primary?: boolean }> | undefined;
  const phones = c.phones as Array<{ number: string; is_primary?: boolean }> | undefined;
  const company = c.company as { name?: string } | undefined;
  return {
    id: c.id,
    display_name: c.display_name,
    job_title: c.job_title,
    company: company?.name,
    primary_email: emails?.find(e => e.is_primary)?.address || emails?.[0]?.address,
    primary_phone: phones?.find(p => p.is_primary)?.number || phones?.[0]?.number,
  };
}

export function getContactBrief(contactId: string, taskContext?: string, db?: ContactsDatabase): object {
  const _db = db || getDatabase();
  const c = getContact(contactId, _db);
  const notes = listNotes(contactId, _db).slice(0, 3);
  const learnings = getLearnings(contactId, { min_importance: 7 }, _db).slice(0, 5);
  const ctx = (taskContext ?? '').toLowerCase();
  const lastContactedAt = c.last_contacted_at as string | null | undefined;
  const daysSince = lastContactedAt ? Math.floor((Date.now() - new Date(lastContactedAt).getTime()) / 86400000) : null;
  const company = c.company as { name?: string } | undefined;
  const brief: Record<string, unknown> = {
    id: c.id,
    display_name: c.display_name,
    job_title: c.job_title,
    company: company?.name,
    status: c.status,
    last_contacted: daysSince !== null ? `${daysSince}d ago` : 'never',
    relationship_health: (c as unknown as Record<string, unknown>).relationship_health,
    engagement_status: (c as unknown as Record<string, unknown>).engagement_status,
    preferred_contact: (c as unknown as Record<string, unknown>).preferred_contact_method || (c as unknown as Record<string, unknown>).preferred_channel,
  };
  if (ctx.includes('meeting') || ctx.includes('call') || ctx.includes('prep')) {
    brief.recent_notes = notes.map((n) => ({ date: (n.created_at as string)?.slice(0, 10), content: n.body }));
    brief.key_learnings = learnings.map(l => l.content);
  }
  if (ctx.includes('outreach') || ctx.includes('email')) {
    brief.preferred_channel = (c as unknown as Record<string, unknown>).preferred_channel;
    brief.follow_up_at = (c as unknown as Record<string, unknown>).follow_up_at;
  }
  if (ctx.includes('deal')) {
    const dealCompany = c.company as { name?: string; domain?: string } | undefined;
    brief.company_details = dealCompany ? { name: dealCompany.name, domain: dealCompany.domain } : null;
  }
  if (learnings.length) brief.top_learnings = learnings.map(l => l.content);
  return brief;
}

export async function assembleContext(contactIds: string[], format: 'meeting_prep' | 'deal_review' | 'outreach' | 'research' = 'meeting_prep', db?: ContactsDatabase): Promise<object> {
  const _db = db || getDatabase();
  const briefs = contactIds.map(id => {
    try { return getContactBrief(id, format, _db); }
    catch { return { id, error: 'not found' }; }
  });
  return { format, contact_count: contactIds.length, assembled_at: new Date().toISOString(), contacts: briefs };
}
