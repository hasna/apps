import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join, basename } from 'path';

export interface ContactInfo {
  // Required fields
  nameFirst: string;
  nameLast: string;
  email: string;
  phone: string; // Format: +1.5551234567
  address1: string;
  city: string;
  state: string;
  postalCode: string;
  country: string; // 2-letter code (US, UK, CA, etc.)

  // Optional fields
  nameMiddle?: string;
  organization?: string;
  jobTitle?: string;
  address2?: string;
  fax?: string;
}

export interface StoredContact extends ContactInfo {
  name: string; // Contact identifier/name
  createdAt: string;
  updatedAt: string;
}

const CONFIG_DIR = join(homedir(), '.connect', 'connect-brandsight');
const CONTACTS_DIR = join(CONFIG_DIR, 'contacts');
const DEFAULT_CONTACT_FILE = join(CONFIG_DIR, 'default-contact.txt');

export function ensureContactsDir(): void {
  if (!existsSync(CONTACTS_DIR)) {
    mkdirSync(CONTACTS_DIR, { recursive: true });
  }
}

function getContactFilePath(name: string): string {
  // Sanitize name for filesystem
  const safeName = name.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  return join(CONTACTS_DIR, `${safeName}.json`);
}

export function saveContact(name: string, contact: ContactInfo): StoredContact {
  ensureContactsDir();

  const filePath = getContactFilePath(name);
  const now = new Date().toISOString();

  const existing = existsSync(filePath);
  const storedContact: StoredContact = {
    ...contact,
    name,
    createdAt: existing ? loadContact(name)?.createdAt || now : now,
    updatedAt: now,
  };

  writeFileSync(filePath, JSON.stringify(storedContact, null, 2));
  return storedContact;
}

export function loadContact(name: string): StoredContact | null {
  ensureContactsDir();

  const filePath = getContactFilePath(name);

  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export function listContacts(): StoredContact[] {
  ensureContactsDir();

  const files = readdirSync(CONTACTS_DIR).filter(f => f.endsWith('.json'));

  return files.map(file => {
    try {
      const content = readFileSync(join(CONTACTS_DIR, file), 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }).filter(Boolean) as StoredContact[];
}

export function deleteContact(name: string): boolean {
  ensureContactsDir();

  const filePath = getContactFilePath(name);

  if (!existsSync(filePath)) {
    return false;
  }

  unlinkSync(filePath);

  // Clear default if this was the default contact
  if (getDefaultContactName() === name) {
    clearDefaultContact();
  }

  return true;
}

export function setDefaultContact(name: string): boolean {
  ensureContactsDir();

  // Verify contact exists
  if (!loadContact(name)) {
    return false;
  }

  writeFileSync(DEFAULT_CONTACT_FILE, name);
  return true;
}

export function getDefaultContactName(): string | null {
  if (!existsSync(DEFAULT_CONTACT_FILE)) {
    return null;
  }

  try {
    return readFileSync(DEFAULT_CONTACT_FILE, 'utf-8').trim() || null;
  } catch {
    return null;
  }
}

export function getDefaultContact(): StoredContact | null {
  const name = getDefaultContactName();
  if (!name) return null;
  return loadContact(name);
}

export function clearDefaultContact(): void {
  if (existsSync(DEFAULT_CONTACT_FILE)) {
    unlinkSync(DEFAULT_CONTACT_FILE);
  }
}

// Convert StoredContact to GoDaddy Contact format
export function toGoDaddyContact(contact: StoredContact | ContactInfo): {
  nameFirst: string;
  nameLast: string;
  nameMiddle?: string;
  email: string;
  phone: string;
  fax?: string;
  organization?: string;
  jobTitle?: string;
  addressMailing: {
    address1: string;
    address2?: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
} {
  return {
    nameFirst: contact.nameFirst,
    nameLast: contact.nameLast,
    nameMiddle: contact.nameMiddle,
    email: contact.email,
    phone: contact.phone,
    fax: contact.fax,
    organization: contact.organization,
    jobTitle: contact.jobTitle,
    addressMailing: {
      address1: contact.address1,
      address2: contact.address2,
      city: contact.city,
      state: contact.state,
      postalCode: contact.postalCode,
      country: contact.country,
    },
  };
}

// Validate phone format (+1.5551234567)
export function validatePhone(phone: string): boolean {
  return /^\+\d{1,3}\.\d{6,14}$/.test(phone);
}

// Validate country code (2-letter)
export function validateCountry(country: string): boolean {
  return /^[A-Z]{2}$/i.test(country);
}

// Validate email
export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
