import type { ContactsDatabase } from "./database.js";
import { getDatabase, uuid, now } from "./database.js";

export interface ContactLearning {
  id: string;
  contact_id: string;
  content: string;
  type: "preference" | "fact" | "inference" | "warning" | "signal";
  confidence: number;
  importance: number;
  learned_by?: string | null;
  session_id?: string | null;
  visibility: "private" | "shared" | "human";
  tags: string[];
  confirmed_count: number;
  contradicts_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateLearningInput {
  content: string;
  type?: ContactLearning["type"];
  confidence?: number;
  importance?: number;
  learned_by?: string;
  session_id?: string;
  visibility?: ContactLearning["visibility"];
  tags?: string[];
}

function rowToLearning(r: Record<string, unknown>): ContactLearning {
  return { ...(r as unknown as ContactLearning), tags: JSON.parse((r["tags"] as string) || "[]") };
}

export function saveLearning(
  contactId: string,
  input: CreateLearningInput,
  db?: ContactsDatabase,
): ContactLearning {
  const _db = db || getDatabase();
  const id = uuid();
  _db
    .query(
      `INSERT INTO contact_learnings(id,contact_id,content,type,confidence,importance,learned_by,session_id,visibility,tags,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      contactId,
      input.content,
      input.type || "fact",
      input.confidence ?? 70,
      input.importance ?? 5,
      input.learned_by || null,
      input.session_id || null,
      input.visibility || "shared",
      JSON.stringify(input.tags || []),
      now(),
      now(),
    );
  return rowToLearning(
    _db.query(`SELECT * FROM contact_learnings WHERE id=?`).get(id) as Record<string, unknown>,
  );
}

export function getLearnings(
  contactId: string,
  opts: { type?: string; min_importance?: number; visibility?: string } = {},
  db?: ContactsDatabase,
): ContactLearning[] {
  const _db = db || getDatabase();
  let sql = `SELECT * FROM contact_learnings WHERE contact_id=?`;
  const params: (string | number)[] = [contactId];
  if (opts.type) {
    sql += ` AND type=?`;
    params.push(opts.type);
  }
  if (opts.min_importance) {
    sql += ` AND importance>=?`;
    params.push(opts.min_importance);
  }
  if (opts.visibility) {
    sql += ` AND visibility=?`;
    params.push(opts.visibility);
  }
  sql += ` ORDER BY importance DESC, confidence DESC`;
  return (_db.query(sql).all(...params) as Record<string, unknown>[]).map(rowToLearning);
}

export function searchLearnings(
  query: string,
  opts: { type?: string; contact_id?: string } = {},
  db?: ContactsDatabase,
): Array<ContactLearning & { contact_id: string }> {
  const _db = db || getDatabase();
  let sql = `SELECT * FROM contact_learnings WHERE content LIKE ?`;
  const params: string[] = [`%${query}%`];
  if (opts.type) {
    sql += ` AND type=?`;
    params.push(opts.type);
  }
  if (opts.contact_id) {
    sql += ` AND contact_id=?`;
    params.push(opts.contact_id);
  }
  sql += ` ORDER BY importance DESC, confidence DESC LIMIT 50`;
  return (_db.query(sql).all(...params) as Record<string, unknown>[]).map(
    rowToLearning,
  ) as Array<ContactLearning & { contact_id: string }>;
}

export function confirmLearning(learningId: string, _agentName: string, db?: ContactsDatabase): void {
  const _db = db || getDatabase();
  _db
    .query(
      `UPDATE contact_learnings SET confirmed_count=confirmed_count+1, confidence=MIN(100,confidence+10), updated_at=? WHERE id=?`,
    )
    .run(now(), learningId);
}

export function decayLearnings(db?: ContactsDatabase): number {
  const _db = db || getDatabase();
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  const result = _db
    .query(
      `UPDATE contact_learnings SET confidence=MAX(10,confidence-5), updated_at=? WHERE confirmed_count=0 AND created_at<? AND confidence>10`,
    )
    .run(now(), cutoff);
  return (result as { changes?: number }).changes || 0;
}

export function deleteLearning(learningId: string, db?: ContactsDatabase): void {
  const _db = db || getDatabase();
  _db.query(`DELETE FROM contact_learnings WHERE id=?`).run(learningId);
}
