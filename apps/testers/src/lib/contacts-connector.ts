/**
 * Contacts connector — bridges @hasna/contacts with open-testers personas.
 *
 * Allows importing contacts tagged as test users into the personas table,
 * and linking personas back to their source contact via contact_id metadata.
 */

import { createPersona, getPersona, listPersonas, updatePersona } from "../db/personas.js";
import type { Persona } from "../types/index.js";

interface ContactsContact {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  company?: string | null;
  tags?: string[];
  notes?: string | null;
}

function getContactsDb() {
  const { Database } = require("bun:sqlite");
  const { existsSync } = require("fs");
  const { join } = require("path");
  const { homedir } = require("os");

  const envPath = process.env["HASNA_CONTACTS_DB_PATH"] ?? process.env["OPEN_CONTACTS_DB"];
  const dbPath = envPath ?? join(homedir(), ".hasna", "contacts", "contacts.db");
  if (!existsSync(dbPath)) return null;

  const db = new Database(dbPath, { readonly: true });
  return db;
}

/**
 * List contacts that have specific tags from the @hasna/contacts DB.
 * Falls back gracefully if contacts DB is not installed.
 */
export function listContactsByTag(tags: string[]): ContactsContact[] {
  const db = getContactsDb();
  if (!db) return [];

  try {
    const tagConditions = tags.map(() => "tags LIKE ?").join(" OR ");
    const params = tags.map((t) => `%"${t}"%`);
    const rows = db
      .query(`SELECT * FROM contacts WHERE (${tagConditions}) AND archived = 0 ORDER BY created_at DESC`)
      .all(...params) as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: row["id"] as string,
      first_name: row["first_name"] as string | null,
      last_name: row["last_name"] as string | null,
      name: row["name"] as string | null,
      email: (row["emails"] ? (() => { try { return (JSON.parse(row["emails"] as string) as Array<{ email: string }>)[0]?.email; } catch { return null; } })() : null),
      role: row["role"] as string | null,
      company: row["company"] as string | null,
      tags: row["tags"] ? (() => { try { return JSON.parse(row["tags"] as string) as string[]; } catch { return []; } })() : [],
      notes: row["notes"] as string | null,
    }));
  } catch {
    return [];
  } finally {
    db.close();
  }
}

/**
 * Import contacts tagged with given tags as personas.
 * Skips contacts that already have a persona (tracked via persona metadata.contactId).
 * Returns { imported, skipped, personas }.
 */
export function importPersonasFromContacts(options: {
  tags?: string[];
  projectId?: string;
  dryRun?: boolean;
}): { imported: number; skipped: number; personas: Array<{ contactId: string; name: string; personaId?: string }> } {
  const tags = options.tags ?? ["test-user", "tester", "qa"];
  const contacts = listContactsByTag(tags);

  if (contacts.length === 0) {
    return { imported: 0, skipped: 0, personas: [] };
  }

  // Build set of existing personas linked to contacts
  const existing = listPersonas({ projectId: options.projectId });
  const linkedContactIds = new Set(
    existing
      .filter((p) => p.metadata?.contactId)
      .map((p) => p.metadata!.contactId as string)
  );

  const results: Array<{ contactId: string; name: string; personaId?: string }> = [];
  let imported = 0;
  let skipped = 0;

  for (const contact of contacts) {
    const nameFromParts = [contact.first_name, contact.last_name].filter(Boolean).join(" ");
    const contactName = contact.name ?? (nameFromParts || (contact.email ?? contact.id));

    if (linkedContactIds.has(contact.id)) {
      skipped++;
      results.push({ contactId: contact.id, name: contactName });
      continue;
    }

    if (options.dryRun) {
      imported++;
      results.push({ contactId: contact.id, name: contactName });
      continue;
    }

    const persona = createPersona({
      name: contactName,
      role: contact.role ?? "test user",
      description: contact.notes ? contact.notes.slice(0, 200) : `Test user imported from contacts (${contactName})`,
      projectId: options.projectId,
      authEmail: contact.email ?? undefined,
      metadata: {
        contactId: contact.id,
        importedFromContacts: true,
        importedAt: new Date().toISOString(),
      },
    });

    imported++;
    results.push({ contactId: contact.id, name: contactName, personaId: persona.id });
  }

  return { imported, skipped, personas: results };
}

/**
 * Sync a persona's details from its linked contact (if any).
 * Updates name, role, and email from the latest contact data.
 */
export function syncPersonaFromContact(personaId: string): Persona | null {
  const persona = getPersona(personaId);
  if (!persona?.metadata?.contactId) return null;

  const db = getContactsDb();
  if (!db) return null;

  try {
    const contact = db
      .query("SELECT * FROM contacts WHERE id = ?")
      .get(persona.metadata.contactId as string) as Record<string, unknown> | null;
    if (!contact) return null;

    const nameParts = [(contact["first_name"] as string | null), (contact["last_name"] as string | null)].filter(Boolean).join(" ");
    const name = (contact["name"] as string | null) ?? (nameParts || persona.name);

    const updates: Parameters<typeof updatePersona>[1] = {};
    if (name && name !== persona.name) updates.name = name;
    if (contact["role"] && contact["role"] !== persona.role) updates.role = contact["role"] as string;

    if (Object.keys(updates).length === 0) return persona;
    return updatePersona(personaId, updates, persona.version);
  } catch {
    return null;
  } finally {
    db.close();
  }
}
