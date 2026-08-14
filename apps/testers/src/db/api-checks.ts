import { getDatabase, now, uuid, shortUuid } from "./database.js";
import {
  ApiCheck,
  ApiCheckResult,
  ApiCheckRow,
  ApiCheckResultRow,
  ApiCheckFilter,
  CreateApiCheckInput,
  UpdateApiCheckInput,
  apiCheckFromRow,
  apiCheckResultFromRow,
  ApiCheckNotFoundError,
  VersionConflictError,
} from "../types/index.js";

export function createApiCheck(input: CreateApiCheckInput): ApiCheck {
  const db = getDatabase();
  const id = uuid();
  const shortId = shortUuid();
  const createdAt = now();

  db.query(
    `INSERT INTO api_checks (id, short_id, project_id, name, description, method, url, headers, body, expected_status, expected_body_contains, expected_response_time_ms, timeout_ms, tags, enabled, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(
    id,
    shortId,
    input.projectId ?? null,
    input.name,
    input.description ?? "",
    input.method ?? "GET",
    input.url,
    JSON.stringify(input.headers ?? {}),
    input.body ?? null,
    input.expectedStatus ?? 200,
    input.expectedBodyContains ?? null,
    input.expectedResponseTimeMs ?? null,
    input.timeoutMs ?? 10000,
    JSON.stringify(input.tags ?? []),
    input.enabled !== false ? 1 : 0,
    createdAt,
    createdAt,
  );

  return apiCheckFromRow(db.query("SELECT * FROM api_checks WHERE id = ?").get(id) as ApiCheckRow);
}

export function getApiCheck(id: string): ApiCheck | null {
  const db = getDatabase();
  const row = (
    db.query("SELECT * FROM api_checks WHERE id = ? OR short_id = ?").get(id, id)
  ) as ApiCheckRow | null;
  return row ? apiCheckFromRow(row) : null;
}

export function listApiChecks(filter?: ApiCheckFilter): ApiCheck[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: (string | number | null)[] = [];

  if (filter?.projectId) {
    conditions.push("project_id = ?");
    params.push(filter.projectId);
  }
  if (filter?.enabled !== undefined) {
    conditions.push("enabled = ?");
    params.push(filter.enabled ? 1 : 0);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = filter?.limit ? `LIMIT ${filter.limit}` : "";
  const offset = filter?.offset ? `OFFSET ${filter.offset}` : "";

  const rows = db
    .query(`SELECT * FROM api_checks ${where} ORDER BY created_at DESC ${limit} ${offset}`)
    .all(...params) as ApiCheckRow[];

  let checks = rows.map(apiCheckFromRow);

  // Filter by tags (in-memory since tags are JSON)
  if (filter?.tags && filter.tags.length > 0) {
    checks = checks.filter((c) =>
      filter.tags!.some((t) => c.tags.includes(t))
    );
  }

  return checks;
}

export function updateApiCheck(
  id: string,
  updates: UpdateApiCheckInput,
  version: number,
): ApiCheck {
  const db = getDatabase();
  const existing = getApiCheck(id);
  if (!existing) throw new ApiCheckNotFoundError(id);
  if (existing.version !== version) throw new VersionConflictError("api_check", id);

  const fields: string[] = [];
  const params: (string | number | null)[] = [];

  if (updates.name !== undefined) { fields.push("name = ?"); params.push(updates.name); }
  if (updates.description !== undefined) { fields.push("description = ?"); params.push(updates.description); }
  if (updates.method !== undefined) { fields.push("method = ?"); params.push(updates.method); }
  if (updates.url !== undefined) { fields.push("url = ?"); params.push(updates.url); }
  if (updates.headers !== undefined) { fields.push("headers = ?"); params.push(JSON.stringify(updates.headers)); }
  if (updates.body !== undefined) { fields.push("body = ?"); params.push(updates.body ?? null); }
  if (updates.expectedStatus !== undefined) { fields.push("expected_status = ?"); params.push(updates.expectedStatus); }
  if (updates.expectedBodyContains !== undefined) { fields.push("expected_body_contains = ?"); params.push(updates.expectedBodyContains ?? null); }
  if (updates.expectedResponseTimeMs !== undefined) { fields.push("expected_response_time_ms = ?"); params.push(updates.expectedResponseTimeMs ?? null); }
  if (updates.timeoutMs !== undefined) { fields.push("timeout_ms = ?"); params.push(updates.timeoutMs); }
  if (updates.tags !== undefined) { fields.push("tags = ?"); params.push(JSON.stringify(updates.tags)); }
  if (updates.enabled !== undefined) { fields.push("enabled = ?"); params.push(updates.enabled ? 1 : 0); }

  fields.push("version = ?"); params.push(version + 1);
  fields.push("updated_at = ?"); params.push(now());
  params.push(existing.id);

  db.query(`UPDATE api_checks SET ${fields.join(", ")} WHERE id = ?`).run(...params);
  return apiCheckFromRow(db.query("SELECT * FROM api_checks WHERE id = ?").get(existing.id) as ApiCheckRow);
}

export function deleteApiCheck(id: string): boolean {
  const db = getDatabase();
  const check = getApiCheck(id);
  if (!check) return false;
  db.query("DELETE FROM api_checks WHERE id = ?").run(check.id);
  return true;
}

export function countApiChecks(filter?: ApiCheckFilter): number {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: (string | number | null)[] = [];

  if (filter?.projectId) { conditions.push("project_id = ?"); params.push(filter.projectId); }
  if (filter?.enabled !== undefined) { conditions.push("enabled = ?"); params.push(filter.enabled ? 1 : 0); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = db.query(`SELECT COUNT(*) as count FROM api_checks ${where}`).get(...params) as { count: number };
  return result.count;
}

// ─── api_check_results ────────────────────────────────────────────────────────

export function createApiCheckResult(input: {
  checkId: string;
  runId?: string;
  status: "passed" | "failed" | "error";
  statusCode?: number;
  responseTimeMs?: number;
  responseBody?: string;
  responseHeaders?: Record<string, string>;
  error?: string;
  assertionsPassed?: string[];
  assertionsFailed?: string[];
  metadata?: Record<string, unknown>;
}): ApiCheckResult {
  const db = getDatabase();
  const id = uuid();
  const createdAt = now();

  db.query(
    `INSERT INTO api_check_results (id, check_id, run_id, status, status_code, response_time_ms, response_body, response_headers, error, assertions_passed, assertions_failed, metadata, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.checkId,
    input.runId ?? null,
    input.status,
    input.statusCode ?? null,
    input.responseTimeMs ?? null,
    input.responseBody ?? null,
    JSON.stringify(input.responseHeaders ?? {}),
    input.error ?? null,
    JSON.stringify(input.assertionsPassed ?? []),
    JSON.stringify(input.assertionsFailed ?? []),
    input.metadata ? JSON.stringify(input.metadata) : null,
    createdAt,
  );

  return apiCheckResultFromRow(
    db.query("SELECT * FROM api_check_results WHERE id = ?").get(id) as ApiCheckResultRow
  );
}

export function getApiCheckResult(id: string): ApiCheckResult | null {
  const db = getDatabase();
  const row = db.query("SELECT * FROM api_check_results WHERE id = ?").get(id) as ApiCheckResultRow | null;
  return row ? apiCheckResultFromRow(row) : null;
}

export function listApiCheckResults(
  checkId: string,
  opts?: { limit?: number; offset?: number },
): ApiCheckResult[] {
  const db = getDatabase();
  const limit = opts?.limit ? `LIMIT ${opts.limit}` : "";
  const offset = opts?.offset ? `OFFSET ${opts.offset}` : "";
  const rows = db
    .query(`SELECT * FROM api_check_results WHERE check_id = ? ORDER BY created_at DESC ${limit} ${offset}`)
    .all(checkId) as ApiCheckResultRow[];
  return rows.map(apiCheckResultFromRow);
}

export function getLatestApiCheckResult(checkId: string): ApiCheckResult | null {
  const db = getDatabase();
  const row = db
    .query("SELECT * FROM api_check_results WHERE check_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(checkId) as ApiCheckResultRow | null;
  return row ? apiCheckResultFromRow(row) : null;
}

export function countApiCheckResults(checkId: string): number {
  const db = getDatabase();
  const result = db
    .query("SELECT COUNT(*) as count FROM api_check_results WHERE check_id = ?")
    .get(checkId) as { count: number };
  return result.count;
}
