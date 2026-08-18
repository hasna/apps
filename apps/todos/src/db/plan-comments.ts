import type { Database } from "bun:sqlite";
import type { CreatePlanCommentInput, PlanComment } from "../types/index.js";
import { PlanNotFoundError } from "../types/index.js";
import { getDatabase, now, uuid } from "./database.js";
import { getPlan } from "./plans.js";
import { sanitizePreWriteText } from "../lib/prewrite-secrets.js";

/**
 * Plan-row comment surface (todos task 04ee08fd). Plans previously had no
 * comment surface, so `todos comment <plan-id>` 404'd with "task not found"
 * and plan-level outcomes could not be recorded on the plan row. This module
 * mirrors db/comments.ts but binds rows to plans; the two tables are separate
 * by design so neither list verb can surface the other's rows.
 */

export function addPlanComment(
  input: CreatePlanCommentInput,
  db?: Database,
): PlanComment {
  const d = db || getDatabase();

  // Verify the plan exists — parity with task comments, which throw
  // TaskNotFoundError instead of silently writing an orphan row.
  if (!getPlan(input.plan_id, d)) {
    throw new PlanNotFoundError(input.plan_id);
  }

  const id = uuid();
  const timestamp = now();

  d.run(
    `INSERT INTO plan_comments (id, plan_id, agent_id, session_id, content, type, progress_pct, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.plan_id,
      input.agent_id || null,
      input.session_id || null,
      sanitizePreWriteText(input.content, "comment.content"),
      input.type || 'comment',
      input.progress_pct ?? null,
      timestamp,
    ],
  );

  return getPlanComment(id, d)!;
}

export function getPlanComment(id: string, db?: Database): PlanComment | null {
  const d = db || getDatabase();
  return d
    .query("SELECT * FROM plan_comments WHERE id = ?")
    .get(id) as PlanComment | null;
}

export function listPlanComments(planId: string, db?: Database): PlanComment[] {
  const d = db || getDatabase();
  return d
    .query(
      // Mirror listComments: insertion-order semantics for same-clock comments.
      "SELECT * FROM plan_comments WHERE plan_id = ? ORDER BY created_at, rowid",
    )
    .all(planId) as PlanComment[];
}

export function deletePlanComment(id: string, db?: Database): boolean {
  const d = db || getDatabase();
  const result = d.run("DELETE FROM plan_comments WHERE id = ?", [id]);
  return result.changes > 0;
}
