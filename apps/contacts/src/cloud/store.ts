// Contacts cloud store facade.
//
// Resolves the self_hosted (cloud-http) client for the "contacts" app and
// exposes contact CRUD that mirrors the local db.* functions but routes every
// read and write to https://contacts.hasna.xyz/v1 (or the configured
// HASNA_CONTACTS_API_URL). Response envelopes from the /v1 API ({ contact },
// { contacts, count }, { deleted }) are unwrapped here so CLI/SDK callers get
// the same shapes they get from the local store.
//
// getContactsCloud() returns null when the app is in local mode, so callers use:
//   const cloud = getContactsCloud();
//   if (cloud) { ...await cloud.listContacts()... } else { ...listContacts()... }

import { resolveStorageClient, type StorageClient, type QueryParams } from "./http-storage.js";

export interface ContactsListResult {
  contacts: any[];
  total: number;
}

export interface ContactsCloudStore {
  readonly client: StorageClient;
  listContacts(filter: Record<string, unknown>): Promise<ContactsListResult>;
  getContact(id: string): Promise<any | null>;
  createContact(input: Record<string, unknown>): Promise<any>;
  updateContact(id: string, input: Record<string, unknown>): Promise<any>;
  deleteContact(id: string): Promise<boolean>;
  searchContacts(query: string): Promise<any[]>;
}

function pick<T = unknown>(obj: unknown, key: string): T | undefined {
  if (obj && typeof obj === "object") return (obj as Record<string, unknown>)[key] as T;
  return undefined;
}

function stripUndefined(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined) out[k] = v;
  return out;
}

let cached: ContactsCloudStore | null | undefined;

/** Resolve the contacts cloud store, or null when in local mode. Memoized. */
export function getContactsCloud(env: Record<string, string | undefined> = process.env): ContactsCloudStore | null {
  if (cached !== undefined) return cached;
  const resolved = resolveStorageClient("contacts", env);
  if (resolved.transport !== "cloud-http") {
    cached = null;
    return cached;
  }
  const client = resolved.client;
  cached = {
    client,
    async listContacts(filter) {
      const res = await client.list<{ contacts?: any[]; count?: number }>("contacts", {
        query: stripUndefined(filter) as QueryParams,
      });
      return {
        contacts: pick<any[]>(res, "contacts") ?? [],
        total: pick<number>(res, "count") ?? (pick<any[]>(res, "contacts") ?? []).length,
      };
    },
    async getContact(id) {
      const res = await client.get<{ contact?: any }>("contacts", id);
      return res ? (pick(res, "contact") ?? null) : null;
    },
    async createContact(input) {
      const res = await client.create<{ contact?: any }>("contacts", stripUndefined(input));
      return pick(res, "contact") ?? res;
    },
    async updateContact(id, input) {
      const res = await client.update<{ contact?: any }>("contacts", id, stripUndefined(input));
      return pick(res, "contact") ?? res;
    },
    async deleteContact(id) {
      const res = await client.delete<{ deleted?: boolean }>("contacts", id);
      return Boolean(pick(res, "deleted") ?? true);
    },
    async searchContacts(query) {
      const res = await client.list<{ contacts?: any[] }>("contacts", { query: { q: query } });
      return pick<any[]>(res, "contacts") ?? [];
    },
  };
  return cached;
}

/** Test hook: reset the memoized store so a new env can be resolved. */
export function resetContactsCloudCache(): void {
  cached = undefined;
}
