import { getDatabase, now as _now } from "../db/database.js";
import type { ContactsDatabase } from "../db/database.js";

export async function ingestMeetingParticipants(
  event: {
    title: string;
    event_date: string;
    attendees: Array<{ name: string; email: string }>;
    context?: string;
  },
  db?: ContactsDatabase,
): Promise<{ created: number; updated: number; contact_ids: string[] }> {
  const { findOrCreateContact } = await import('../db/contacts.js');
  const { logEvent } = await import('../db/events.js');
  const _db = db || getDatabase();
  let created = 0;
  let updated = 0;
  const ids: string[] = [];
  for (const a of event.attendees) {
    try {
      const nameParts = a.name.split(' ');
      const result = await findOrCreateContact(
        {
          display_name: a.name,
          first_name: nameParts[0],
          last_name: nameParts.slice(1).join(' ') || undefined,
          emails: [{ address: a.email, type: 'work' as const, is_primary: true }],
          source: 'import' as const,
        },
        _db,
      );
      ids.push(result.contact.id);
      if (result.created) created++;
      else updated++;
    } catch { /* skip */ }
  }
  if (ids.length) {
    try {
      logEvent(
        {
          title: event.title,
          type: 'meeting' as const,
          event_date: event.event_date,
          contact_ids: ids,
          notes: event.context,
        },
        _db,
      );
    } catch { /* non-fatal */ }
  }
  return { created, updated, contact_ids: ids };
}
