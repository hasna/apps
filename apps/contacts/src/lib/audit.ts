import type { ContactsDatabase } from "../db/database.js";
import type { ContactWithDetails } from "../types/index.js";
import { getDatabase } from "../db/database.js";

export interface AuditResult {
  contact_id: string;
  display_name: string;
  score: number;
  missing: string[];
  suggestions: string[];
}

export function auditContact(contact: ContactWithDetails): AuditResult {
  const missing: string[] = [];
  const suggestions: string[] = [];
  let score = 0;

  if (contact.emails?.length) score += 20;
  else { missing.push('email'); suggestions.push('Add an email address'); }

  if (contact.phones?.length) score += 15;
  else { missing.push('phone'); suggestions.push('Add a phone number'); }

  if (contact.company_id) score += 15;
  else { missing.push('company'); suggestions.push('Link to a company'); }

  if (contact.last_contacted_at) score += 20;
  else { missing.push('last_contacted_at'); suggestions.push('Log a contact interaction'); }

  if (contact.tags?.length) score += 10;
  else { missing.push('tags'); suggestions.push('Add at least one tag'); }

  if (contact.notes) score += 10;
  else { missing.push('notes'); suggestions.push('Add notes'); }

  if (contact.job_title) score += 10;
  else { missing.push('job_title'); suggestions.push('Add a job title'); }

  return { contact_id: contact.id, display_name: contact.display_name, score, missing, suggestions };
}

export async function listContactAudit(db?: ContactsDatabase): Promise<AuditResult[]> {
  const _db = db || getDatabase();
  // Use dynamic import to avoid circular dependency with contacts.ts
  const { listContacts } = await import('../db/contacts.js');
  const { contacts } = listContacts({ limit: 500, include_dnc: true }, _db);
  return contacts.map(auditContact).sort((a, b) => a.score - b.score);
}
