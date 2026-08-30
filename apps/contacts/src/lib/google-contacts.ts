/**
 * Google Contacts sync — bidirectional sync between local DB and Google Contacts
 * via the connect-googlecontacts connector.
 *
 * Auth: connect-googlecontacts auth login   (run once per profile)
 * Install: bun install -g @hasnaxyz/connect-googlecontacts
 *
 * Data format: Google People API
 *   https://developers.google.com/people/api/rest/v1/people
 */

import type { ContactWithDetails, CreateContactInput } from "../types/index.js";
import { runConnector, ConnectorRunOptions } from "./connector.js";
import { parseName, domainToCompany } from "./gmail-import.js";

// ─── Google People API types ──────────────────────────────────────────────────

interface PeopleName {
  displayName?: string;
  givenName?: string;
  familyName?: string;
  middleName?: string;
}

interface PeopleEmail {
  value?: string;
  type?: string;
  formattedType?: string;
}

interface PeoplePhone {
  value?: string;
  type?: string;
  formattedType?: string;
}

interface PeopleOrg {
  name?: string;
  title?: string;
  department?: string;
}

interface PeopleAddress {
  streetAddress?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  type?: string;
}

interface PeopleBio {
  value?: string;
}

interface PeopleUrl {
  value?: string;
  type?: string;
}

export interface GooglePerson {
  resourceName: string;
  etag?: string;
  names?: PeopleName[];
  emailAddresses?: PeopleEmail[];
  phoneNumbers?: PeoplePhone[];
  organizations?: PeopleOrg[];
  addresses?: PeopleAddress[];
  biographies?: PeopleBio[];
  urls?: PeopleUrl[];
  birthdays?: Array<{ date?: { year?: number; month?: number; day?: number } }>;
}

// ─── Public option types ──────────────────────────────────────────────────────

export interface GoogleContactsSyncOptions extends ConnectorRunOptions {
  /** Max contacts to pull per page (connector handles pagination automatically) */
  page_size?: number;
  /** Only import contacts matching this query */
  query?: string;
}

export interface GoogleContactsPushOptions extends ConnectorRunOptions {
  /** If true, update existing Google contact if resourceName is stored in custom_fields */
  update_existing?: boolean;
}

export interface SyncResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: string[];
}

// ─── Mapping: Google → local ──────────────────────────────────────────────────

/**
 * Convert a Google People API person to a CreateContactInput.
 */
export function googlePersonToContactInput(person: GooglePerson): CreateContactInput {
  const name = person.names?.[0];
  const primaryEmail = person.emailAddresses?.[0]?.value;

  const nameParts = name?.givenName || name?.familyName
    ? { first_name: name.givenName, last_name: name.familyName }
    : primaryEmail
    ? parseName(name?.displayName ?? primaryEmail.split("@")[0] ?? "")
    : {};

  const emails = (person.emailAddresses ?? [])
    .filter((e) => e.value)
    .map((e, i) => ({
      address: e.value!.toLowerCase(),
      type: normalizeEmailType(e.type),
      is_primary: i === 0,
    }));

  const phones = (person.phoneNumbers ?? [])
    .filter((p) => p.value)
    .map((p, i) => ({
      number: p.value!,
      type: normalizePhoneType(p.type),
      is_primary: i === 0,
    }));

  const org = person.organizations?.[0];
  const website = person.urls?.[0]?.value;

  const birthday = (() => {
    const b = person.birthdays?.[0]?.date;
    if (!b?.year || !b?.month || !b?.day) return undefined;
    const mm = String(b.month).padStart(2, "0");
    const dd = String(b.day).padStart(2, "0");
    return `${b.year}-${mm}-${dd}`;
  })();

  const notes = person.biographies?.map((b) => b.value).filter(Boolean).join("\n\n") || undefined;

  return {
    ...nameParts,
    display_name: name?.displayName ?? (nameParts.first_name ? `${nameParts.first_name} ${nameParts.last_name ?? ""}`.trim() : primaryEmail?.split("@")[0] ?? "Unknown"),
    job_title: org?.title,
    notes,
    birthday,
    website,
    source: "import",
    emails,
    phones,
    // Store Google resource name for future update sync
    custom_fields: { google_resource_name: person.resourceName },
  };
}

function normalizeEmailType(type?: string): "work" | "personal" | "other" {
  if (!type) return "work";
  const t = type.toLowerCase();
  if (t === "work" || t === "home" || t === "personal") return t === "home" ? "personal" : "work";
  return "other";
}

function normalizePhoneType(type?: string): "mobile" | "work" | "home" | "fax" | "whatsapp" | "other" {
  if (!type) return "mobile";
  const t = type.toLowerCase();
  if (t === "mobile" || t === "cell") return "mobile";
  if (t === "work") return "work";
  if (t === "home") return "home";
  if (t === "fax") return "fax";
  return "other";
}

// ─── Mapping: local → Google ──────────────────────────────────────────────────

/**
 * Convert a local ContactWithDetails to Google People API create/update args.
 * Returns the CLI flags for `connect-googlecontacts contacts create`.
 */
export function contactToGoogleArgs(contact: ContactWithDetails): string[] {
  const args: string[] = [];

  const displayName = contact.display_name;
  if (displayName) args.push("--name", displayName);
  if (contact.first_name) args.push("--given-name", contact.first_name);
  if (contact.last_name) args.push("--family-name", contact.last_name);

  const primaryEmail = contact.emails.find((e) => e.is_primary) ?? contact.emails[0];
  if (primaryEmail) args.push("--email", primaryEmail.address);

  const primaryPhone = contact.phones.find((p) => p.is_primary) ?? contact.phones[0];
  if (primaryPhone) args.push("--phone", primaryPhone.number);

  if (contact.job_title) args.push("--title", contact.job_title);
  if (contact.company) args.push("--company", contact.company.name);
  if (contact.notes) args.push("--notes", contact.notes);
  if (contact.website) args.push("--url", contact.website);

  return args;
}

// ─── List / search ────────────────────────────────────────────────────────────

/**
 * List all contacts from Google Contacts.
 */
export async function listGoogleContacts(
  opts: GoogleContactsSyncOptions = {}
): Promise<GooglePerson[]> {
  const args = ["contacts", "list"];
  if (opts.page_size) args.push("--page-size", String(opts.page_size));

  const raw = await runConnector("googlecontacts", args, opts);
  return normalizeGoogleContactsResponse(raw);
}

/**
 * Search contacts in Google Contacts.
 */
export async function searchGoogleContacts(
  query: string,
  opts: ConnectorRunOptions = {}
): Promise<GooglePerson[]> {
  const raw = await runConnector("googlecontacts", ["contacts", "search", query], opts);
  return normalizeGoogleContactsResponse(raw);
}

function normalizeGoogleContactsResponse(raw: unknown): GooglePerson[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw as GooglePerson[];
  const obj = raw as Record<string, unknown>;
  // People API: { connections: [...] }
  if (Array.isArray(obj["connections"])) return obj["connections"] as GooglePerson[];
  // Some connectors wrap in { contacts: [...] }
  if (Array.isArray(obj["contacts"])) return obj["contacts"] as GooglePerson[];
  return [];
}

// ─── Push to Google ───────────────────────────────────────────────────────────

/**
 * Create a new contact in Google Contacts from a local contact.
 * Returns the Google resource name (e.g. "people/c12345").
 */
export async function pushContactToGoogle(
  contact: ContactWithDetails,
  opts: GoogleContactsPushOptions = {}
): Promise<{ resourceName: string; action: "created" | "updated" }> {
  const googleResourceName = contact.custom_fields?.["google_resource_name"] as string | undefined;

  if (googleResourceName && opts.update_existing) {
    const args = ["contacts", "update", googleResourceName, ...contactToGoogleArgs(contact)];
    const result = await runConnector("googlecontacts", args, opts) as GooglePerson;
    return { resourceName: result?.resourceName ?? googleResourceName, action: "updated" };
  }

  const args = ["contacts", "create", ...contactToGoogleArgs(contact)];
  const result = await runConnector("googlecontacts", args, opts) as GooglePerson;
  return { resourceName: result?.resourceName ?? "", action: "created" };
}

// ─── Full sync (Google → local) ───────────────────────────────────────────────

/**
 * Sync all Google Contacts into the local database.
 * Caller is responsible for the actual upsert (pass a db upsert function).
 * Returns structured CreateContactInput objects ready for upsert.
 */
export async function pullGoogleContactsAsInputs(
  opts: GoogleContactsSyncOptions = {}
): Promise<CreateContactInput[]> {
  const people = opts.query
    ? await searchGoogleContacts(opts.query, opts)
    : await listGoogleContacts(opts);

  return people
    .filter((p) => p.emailAddresses?.some((e) => e.value))
    .map(googlePersonToContactInput);
}
