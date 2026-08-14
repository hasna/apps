import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { getConfigDir } from './config';

export interface Contact {
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

function getContactsDir(): string {
  const dir = join(getConfigDir(), 'contacts');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function emailToFilename(email: string): string {
  return email.toLowerCase().replace(/[^a-z0-9]/g, '_') + '.json';
}

export function saveContact(contact: Contact): void {
  const contactsDir = getContactsDir();
  const filename = emailToFilename(contact.email);
  const filepath = join(contactsDir, filename);

  const now = new Date().toISOString();
  const existing = getContact(contact.email);

  const data: Contact = {
    ...contact,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  writeFileSync(filepath, JSON.stringify(data, null, 2));
}

export function getContact(email: string): Contact | null {
  const contactsDir = getContactsDir();
  const filename = emailToFilename(email);
  const filepath = join(contactsDir, filename);

  if (!existsSync(filepath)) {
    return null;
  }

  try {
    const content = readFileSync(filepath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function getAllContacts(): Contact[] {
  const contactsDir = getContactsDir();
  const files = readdirSync(contactsDir).filter(f => f.endsWith('.json'));

  const contacts: Contact[] = [];
  for (const file of files) {
    try {
      const content = readFileSync(join(contactsDir, file), 'utf-8');
      contacts.push(JSON.parse(content));
    } catch {
      // Skip invalid files
    }
  }

  return contacts.sort((a, b) => a.email.localeCompare(b.email));
}

export function deleteContact(email: string): boolean {
  const contactsDir = getContactsDir();
  const filename = emailToFilename(email);
  const filepath = join(contactsDir, filename);

  if (existsSync(filepath)) {
    unlinkSync(filepath);
    return true;
  }
  return false;
}

export function searchContacts(query: string): Contact[] {
  const contacts = getAllContacts();
  const q = query.toLowerCase();

  return contacts.filter(c =>
    c.email.toLowerCase().includes(q) ||
    c.name?.toLowerCase().includes(q) ||
    c.firstName?.toLowerCase().includes(q) ||
    c.lastName?.toLowerCase().includes(q) ||
    c.company?.toLowerCase().includes(q)
  );
}

/**
 * Format email with display name: "First Last <email@example.com>"
 */
export function formatEmailWithName(email: string, fallbackName?: string): string {
  const contact = getContact(email);

  let displayName = fallbackName;

  if (contact) {
    if (contact.name) {
      displayName = contact.name;
    } else if (contact.firstName || contact.lastName) {
      displayName = [contact.firstName, contact.lastName].filter(Boolean).join(' ');
    }
  }

  if (displayName) {
    return `"${displayName}" <${email}>`;
  }

  return email;
}

/**
 * Get or create contact, returning formatted email
 */
export function getOrCreateContact(email: string, name?: string): Contact {
  let contact = getContact(email);

  if (!contact) {
    const nameParts = name?.split(' ') || [];
    contact = {
      email,
      name,
      firstName: nameParts[0],
      lastName: nameParts.slice(1).join(' ') || undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    saveContact(contact);
  }

  return contact;
}
