import { Database } from "bun:sqlite";
import { decayLearnings, searchLearnings, type ContactLearning } from "../db/learnings.js";
import { getDatabase } from "../db/database.js";

export function runMaintenance(db?: Database): { decayed: number; stale_learnings: number } {
  const _db = db || getDatabase();
  const decayed = decayLearnings(_db);
  const stale = searchLearnings("", {}, _db).filter((l) => l.confidence < 30).length;
  return { decayed, stale_learnings: stale };
}

export function getStaleLearnings(
  daysOld = 30,
  minConfidence = 40,
  db?: Database,
): ContactLearning[] {
  const _db = db || getDatabase();
  const cutoff = new Date(Date.now() - daysOld * 86400000).toISOString();
  return (
    _db
      .query(
        `SELECT * FROM contact_learnings WHERE created_at<? AND confidence<? ORDER BY confidence ASC LIMIT 50`,
      )
      .all(cutoff, minConfidence) as Array<Record<string, unknown>>
  ).map((r) => ({ ...(r as unknown as ContactLearning), tags: JSON.parse((r["tags"] as string) || "[]") }));
}
