import { getDatabase, now, uuid, shortUuid } from "./database.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GoldenAnswerRow {
  id: string;
  short_id: string;
  project_id: string | null;
  question: string;
  golden_answer: string;
  constraints: string; // JSON array
  endpoint: string;
  judge_model: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
}

export interface GoldenCheckResultRow {
  id: string;
  golden_id: string;
  response: string;
  similarity_score: number | null;
  passed: number;
  drift_detected: number;
  judge_model: string | null;
  provider: string | null;
  created_at: string;
}

export interface GoldenAnswer {
  id: string;
  shortId: string;
  projectId: string | null;
  question: string;
  goldenAnswer: string;
  constraints: string[];
  endpoint: string;
  judgeModel: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface GoldenCheckResult {
  id: string;
  goldenId: string;
  response: string;
  similarityScore: number | null;
  passed: boolean;
  driftDetected: boolean;
  judgeModel: string | null;
  provider: string | null;
  createdAt: string;
}

export interface CreateGoldenAnswerInput {
  projectId?: string;
  question: string;
  goldenAnswer: string;
  constraints?: string[];
  endpoint: string;
  judgeModel?: string;
  enabled?: boolean;
}

export interface UpdateGoldenAnswerInput {
  question?: string;
  goldenAnswer?: string;
  constraints?: string[];
  endpoint?: string;
  judgeModel?: string;
  enabled?: boolean;
}

export interface CreateGoldenCheckResultInput {
  goldenId: string;
  response: string;
  similarityScore?: number;
  passed: boolean;
  driftDetected?: boolean;
  judgeModel?: string;
  provider?: string;
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function goldenFromRow(row: GoldenAnswerRow): GoldenAnswer {
  return {
    id: row.id,
    shortId: row.short_id,
    projectId: row.project_id,
    question: row.question,
    goldenAnswer: row.golden_answer,
    constraints: JSON.parse(row.constraints) as string[],
    endpoint: row.endpoint,
    judgeModel: row.judge_model,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function checkResultFromRow(row: GoldenCheckResultRow): GoldenCheckResult {
  return {
    id: row.id,
    goldenId: row.golden_id,
    response: row.response,
    similarityScore: row.similarity_score,
    passed: row.passed === 1,
    driftDetected: row.drift_detected === 1,
    judgeModel: row.judge_model,
    provider: row.provider,
    createdAt: row.created_at,
  };
}

// ─── GoldenAnswer CRUD ────────────────────────────────────────────────────────

export function createGoldenAnswer(input: CreateGoldenAnswerInput): GoldenAnswer {
  const db = getDatabase();
  const id = uuid();
  const short_id = shortUuid();
  const timestamp = now();

  db.query(`
    INSERT INTO golden_answers (id, short_id, project_id, question, golden_answer, constraints, endpoint, judge_model, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    short_id,
    input.projectId ?? null,
    input.question,
    input.goldenAnswer,
    JSON.stringify(input.constraints ?? []),
    input.endpoint,
    input.judgeModel ?? null,
    input.enabled === false ? 0 : 1,
    timestamp,
    timestamp,
  );

  return getGoldenAnswer(id)!;
}

export function getGoldenAnswer(id: string): GoldenAnswer | null {
  const db = getDatabase();

  let row = db.query("SELECT * FROM golden_answers WHERE id = ?").get(id) as GoldenAnswerRow | null;
  if (row) return goldenFromRow(row);

  row = db.query("SELECT * FROM golden_answers WHERE short_id = ?").get(id) as GoldenAnswerRow | null;
  if (row) return goldenFromRow(row);

  return null;
}

export function listGoldenAnswers(filter?: { projectId?: string; enabled?: boolean }): GoldenAnswer[] {
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

  let sql = "SELECT * FROM golden_answers";
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at DESC";

  const rows = db.query(sql).all(...params) as GoldenAnswerRow[];
  return rows.map(goldenFromRow);
}

export function updateGoldenAnswer(id: string, input: UpdateGoldenAnswerInput): GoldenAnswer | null {
  const db = getDatabase();
  const timestamp = now();

  const sets: string[] = ["updated_at = ?"];
  const params: (string | number | null)[] = [timestamp];

  if (input.question !== undefined) { sets.push("question = ?"); params.push(input.question); }
  if (input.goldenAnswer !== undefined) { sets.push("golden_answer = ?"); params.push(input.goldenAnswer); }
  if (input.constraints !== undefined) { sets.push("constraints = ?"); params.push(JSON.stringify(input.constraints)); }
  if (input.endpoint !== undefined) { sets.push("endpoint = ?"); params.push(input.endpoint); }
  if (input.judgeModel !== undefined) { sets.push("judge_model = ?"); params.push(input.judgeModel); }
  if (input.enabled !== undefined) { sets.push("enabled = ?"); params.push(input.enabled ? 1 : 0); }

  params.push(id);

  db.query(`UPDATE golden_answers SET ${sets.join(", ")} WHERE id = ? OR short_id = ?`).run(...params, id);

  return getGoldenAnswer(id);
}

export function deleteGoldenAnswer(id: string): boolean {
  const db = getDatabase();
  const result = db.query("DELETE FROM golden_answers WHERE id = ? OR short_id = ?").run(id, id);
  return (result.changes ?? 0) > 0;
}

// ─── GoldenCheckResult CRUD ───────────────────────────────────────────────────

export function createGoldenCheckResult(input: CreateGoldenCheckResultInput): GoldenCheckResult {
  const db = getDatabase();
  const id = uuid();
  const timestamp = now();

  db.query(`
    INSERT INTO golden_check_results (id, golden_id, response, similarity_score, passed, drift_detected, judge_model, provider, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.goldenId,
    input.response,
    input.similarityScore ?? null,
    input.passed ? 1 : 0,
    input.driftDetected ? 1 : 0,
    input.judgeModel ?? null,
    input.provider ?? null,
    timestamp,
  );

  return listGoldenCheckResults(input.goldenId, { limit: 1 })[0]!;
}

export function listGoldenCheckResults(
  goldenId: string,
  options?: { limit?: number; since?: string }
): GoldenCheckResult[] {
  const db = getDatabase();
  const params: (string | number)[] = [goldenId];
  let sql = "SELECT * FROM golden_check_results WHERE golden_id = ?";

  if (options?.since) {
    sql += " AND created_at >= ?";
    params.push(options.since);
  }

  sql += " ORDER BY created_at DESC";

  if (options?.limit) {
    sql += " LIMIT ?";
    params.push(options.limit);
  }

  const rows = db.query(sql).all(...params) as GoldenCheckResultRow[];
  return rows.map(checkResultFromRow);
}

export function getLatestGoldenCheckResult(goldenId: string): GoldenCheckResult | null {
  const results = listGoldenCheckResults(goldenId, { limit: 1 });
  return results[0] ?? null;
}
