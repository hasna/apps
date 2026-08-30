import type { ContactsDatabase } from "./database.js";
import { getDatabase, uuid, now } from "./database.js";

export interface JobHistoryEntry {
  id: string;
  contact_id: string;
  company_id?: string | null;
  company_name: string;
  title?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  is_current: boolean;
  inferred: boolean;
  source?: string | null;
  created_at: string;
}

export interface CreateJobEntryInput {
  company_name: string;
  title?: string;
  company_id?: string;
  start_date?: string;
  end_date?: string;
  is_current?: boolean;
  inferred?: boolean;
  source?: string;
}

function rowToJob(r: Record<string, unknown>): JobHistoryEntry {
  return { ...(r as unknown as JobHistoryEntry), is_current: !!r["is_current"], inferred: !!r["inferred"] };
}

export function addJobEntry(
  contactId: string,
  input: CreateJobEntryInput,
  db?: ContactsDatabase,
): JobHistoryEntry {
  const _db = db || getDatabase();
  if (input.is_current) {
    _db
      .query(
        `UPDATE job_history SET is_current=0, end_date=COALESCE(end_date,?) WHERE contact_id=? AND is_current=1`,
      )
      .run(new Date().toISOString().slice(0, 10), contactId);
  }
  const id = uuid();
  _db
    .query(
      `INSERT INTO job_history(id,contact_id,company_id,company_name,title,start_date,end_date,is_current,inferred,source,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      contactId,
      input.company_id || null,
      input.company_name,
      input.title || null,
      input.start_date || null,
      input.end_date || null,
      input.is_current ? 1 : 0,
      input.inferred ? 1 : 0,
      input.source || null,
      now(),
    );
  return rowToJob(
    _db.query(`SELECT * FROM job_history WHERE id=?`).get(id) as unknown as Record<string, unknown>,
  );
}

export function getJobHistory(contactId: string, db?: ContactsDatabase): JobHistoryEntry[] {
  const _db = db || getDatabase();
  return (
    _db
      .query(
        `SELECT * FROM job_history WHERE contact_id=? ORDER BY is_current DESC, start_date DESC`,
      )
      .all(contactId) as Record<string, unknown>[]
  ).map(rowToJob);
}

export function getCurrentRole(contactId: string, db?: ContactsDatabase): JobHistoryEntry | null {
  const _db = db || getDatabase();
  const r = _db
    .query(`SELECT * FROM job_history WHERE contact_id=? AND is_current=1`)
    .get(contactId);
  return r ? rowToJob(r as Record<string, unknown>) : null;
}

export function getPreviousEmployers(contactId: string, db?: ContactsDatabase): JobHistoryEntry[] {
  const _db = db || getDatabase();
  return (
    _db
      .query(
        `SELECT * FROM job_history WHERE contact_id=? AND is_current=0 ORDER BY start_date DESC`,
      )
      .all(contactId) as Record<string, unknown>[]
  ).map(rowToJob);
}
