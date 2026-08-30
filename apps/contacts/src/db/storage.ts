import { getDatabase, getDbPath, type ContactsDatabase } from "./database.js";

export interface StorageTableStatus {
  table: string;
  ok: boolean;
  rows: number | null;
  error?: string;
}

export interface ContactsStorageStatus {
  mode: "local";
  db_path: string;
  tables: StorageTableStatus[];
}

export const CONTACTS_STORAGE_TABLES = [
  "companies",
  "contacts",
  "tags",
  "contact_tags",
  "company_tags",
  "emails",
  "phones",
  "addresses",
  "social_profiles",
  "contact_relationships",
  "activity_log",
  "webhooks",
  "contacts_fts",
  "groups",
  "contact_groups",
  "company_groups",
  "company_relationships",
  "contact_projects",
  "contact_notes",
  "org_members",
  "vendor_communications",
  "contact_tasks",
  "applications",
  "deals",
  "events",
  "contact_field_history",
  "job_history",
  "contact_learnings",
  "contact_locks",
  "contact_agent_activity",
  "contact_identities",
  "contact_field_confidence",
  "org_chart_edges",
  "deal_contact_roles",
  "contact_embeddings",
  "contact_documents",
  "contact_health",
  "feedback",
  "audiences",
  "contact_consent",
  "contact_suppressions",
] as const;

function quoteId(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export function getStorageStatus(db: ContactsDatabase = getDatabase()): ContactsStorageStatus {
  return {
    mode: "local",
    db_path: getDbPath(),
    tables: CONTACTS_STORAGE_TABLES.map((table) => {
      try {
        const row = db.query(`SELECT COUNT(*) as count FROM ${quoteId(table)}`).get() as { count: number };
        return { table, ok: true, rows: row.count };
      } catch (error) {
        return {
          table,
          ok: false,
          rows: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  };
}
