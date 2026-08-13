import { getDatabase, now, uuid } from "../db/database.js";
import { appendAuditEvent } from "../db/audit.js";
import { clampLimit, clampOffset } from "../db/crud.js";
import { entityScopeFilter, type AuthorizationContext } from "./authorization.js";
import { authorize } from "./authorization-scopes.js";
import { ReviewNotFoundError, ValidationError, type AccessReview, type ReviewStatus } from "../types/index.js";

interface ReviewRow {
  id: string;
  entity_id: string;
  name: string;
  status: ReviewStatus;
  scheduled_at: string;
  due_at: string | null;
  scope_filter: string | null;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
  updated_at: string;
  version: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toReview(row: ReviewRow): AccessReview {
  return { ...row };
}

export interface ScheduleReviewInput {
  entity_id: string;
  name: string;
  scheduled_at?: string;
  due_at?: string | null;
  scope_filter?: string | null;
}

export function scheduleReview(input: ScheduleReviewInput, ctx?: AuthorizationContext): AccessReview {
  if (!input.name?.trim()) throw new ValidationError("Review name is required.");
  if (!input.entity_id || !UUID_RE.test(input.entity_id)) throw new ValidationError("entity_id must be a UUIDv4 home-entity reference.");
  authorize("review", ctx, { entity_id: input.entity_id, resource: "access_review" });

  const db = getDatabase();
  const id = uuid();
  const ts = now();
  db.query(
    `INSERT INTO access_reviews (id, entity_id, name, status, scheduled_at, due_at, scope_filter, completed_at, completed_by, created_at, updated_at, version)
     VALUES (?, ?, ?, 'scheduled', ?, ?, ?, NULL, NULL, ?, ?, 1)`,
  ).run(id, input.entity_id, input.name.trim(), input.scheduled_at ?? ts, input.due_at ?? null, input.scope_filter ?? null, ts, ts);
  appendAuditEvent(db, {
    entity_id: input.entity_id,
    event_type: "review.scheduled",
    actor: ctx?.actor_id ?? null,
    payload: { review_id: id, name: input.name.trim() },
  });
  return getReview(id, ctx);
}

export function getReview(id: string, ctx?: AuthorizationContext): AccessReview {
  const db = getDatabase();
  const row = db.query("SELECT * FROM access_reviews WHERE id = ?").get(id) as ReviewRow | null;
  if (!row) throw new ReviewNotFoundError(id);
  authorize("read", ctx, { entity_id: row.entity_id, resource: "access_review" });
  return toReview(row);
}

export interface ListReviewsFilter {
  entity_id?: string;
  status?: ReviewStatus;
  limit?: number;
  offset?: number;
}

export function listReviews(filter: ListReviewsFilter = {}, ctx?: AuthorizationContext): AccessReview[] {
  authorize("read", ctx, filter.entity_id ? { entity_id: filter.entity_id, resource: "access_review" } : { resource: "access_review" });
  const db = getDatabase();
  const clauses: string[] = [];
  const params: (string | number | null)[] = [];
  if (filter.entity_id) {
    clauses.push("entity_id = ?");
    params.push(filter.entity_id);
  }
  if (filter.status) {
    clauses.push("status = ?");
    params.push(filter.status);
  }
  const scope = entityScopeFilter(ctx);
  if (scope) {
    clauses.push(scope.clause);
    params.push(...scope.params);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .query(`SELECT * FROM access_reviews ${where} ORDER BY scheduled_at DESC LIMIT ? OFFSET ?`)
    .all(...params, clampLimit(filter.limit), clampOffset(filter.offset)) as ReviewRow[];
  return rows.map(toReview);
}

export function setReviewStatus(id: string, status: ReviewStatus, ctx?: AuthorizationContext, completedBy?: string): AccessReview {
  const db = getDatabase();
  const existing = getReview(id, ctx);
  authorize("review", ctx, { entity_id: existing.entity_id, resource: "access_review" });
  const completedAt = status === "completed" ? now() : null;
  db.query(
    "UPDATE access_reviews SET status = ?, completed_at = ?, completed_by = ?, updated_at = ?, version = version + 1 WHERE id = ?",
  ).run(status, completedAt, status === "completed" ? completedBy ?? ctx?.actor_id ?? null : null, now(), id);
  appendAuditEvent(db, {
    entity_id: existing.entity_id,
    event_type: `review.${status}`,
    actor: ctx?.actor_id ?? null,
    payload: { review_id: id, status },
  });
  return getReview(id, ctx);
}
