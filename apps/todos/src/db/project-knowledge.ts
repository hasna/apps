import type { Database } from "bun:sqlite";
import { getDatabase, now, resolvePartialId, uuid } from "./database.js";
import { saveSnapshot, type SnapshotType } from "./snapshots.js";
import { redactEvidenceText, redactValue } from "../lib/redaction.js";

export type KnowledgeRecordType = "decision" | "architecture_note" | "tradeoff" | "context_snapshot";
export type KnowledgeExportFormat = "json" | "markdown";

export interface ProjectKnowledgeRecord {
  id: string;
  record_type: KnowledgeRecordType;
  title: string;
  content: string | null;
  decision: string | null;
  rationale: string | null;
  alternatives: string[];
  task_id: string | null;
  project_id: string | null;
  plan_id: string | null;
  agent_id: string | null;
  snapshot_id: string | null;
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateKnowledgeRecordInput {
  record_type: KnowledgeRecordType;
  title: string;
  content?: string;
  decision?: string;
  rationale?: string;
  alternatives?: string[];
  task_id?: string;
  project_id?: string;
  plan_id?: string;
  agent_id?: string;
  snapshot_id?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ListKnowledgeRecordsOptions {
  record_type?: KnowledgeRecordType;
  task_id?: string;
  project_id?: string;
  plan_id?: string;
  agent_id?: string;
  snapshot_id?: string;
  tag?: string;
  limit?: number;
}

export interface SearchKnowledgeRecordsOptions extends ListKnowledgeRecordsOptions {
  query: string;
}

export interface CreateKnowledgeSnapshotInput {
  title?: string;
  snapshot_type?: SnapshotType;
  summary: string;
  task_id?: string;
  project_id?: string;
  agent_id?: string;
  files_open?: string[];
  attempts?: string[];
  blockers?: string[];
  next_steps?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface KnowledgeExportReport {
  schema_version: 1;
  local_only: true;
  no_network: true;
  generated_at: string;
  filters: Omit<ListKnowledgeRecordsOptions, "limit"> & { query?: string | null };
  count: number;
  records: ProjectKnowledgeRecord[];
}

interface KnowledgeRecordRow {
  id: string;
  record_type: string;
  title: string;
  content: string | null;
  decision: string | null;
  rationale: string | null;
  alternatives: string | null;
  task_id: string | null;
  project_id: string | null;
  plan_id: string | null;
  agent_id: string | null;
  snapshot_id: string | null;
  tags: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

const VALID_TYPES = new Set<KnowledgeRecordType>([
  "decision",
  "architecture_note",
  "tradeoff",
  "context_snapshot",
]);

function parseArray(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseObject(value: string | null | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function normalizeTags(tags: string[] | undefined): string[] {
  return [...new Set((tags || []).map((tag) => tag.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function normalizeText(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function assertType(recordType: KnowledgeRecordType): void {
  if (!VALID_TYPES.has(recordType)) throw new Error(`Invalid knowledge record type: ${recordType}`);
}

function clampLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || !limit || limit < 1) return 50;
  return Math.min(Math.floor(limit), 500);
}

function rowToKnowledgeRecord(row: KnowledgeRecordRow): ProjectKnowledgeRecord {
  return {
    id: row.id,
    record_type: row.record_type as KnowledgeRecordType,
    title: redactEvidenceText(row.title),
    content: row.content ? redactEvidenceText(row.content) : null,
    decision: row.decision ? redactEvidenceText(row.decision) : null,
    rationale: row.rationale ? redactEvidenceText(row.rationale) : null,
    alternatives: parseArray(row.alternatives).map((item) => redactEvidenceText(item)),
    task_id: row.task_id,
    project_id: row.project_id,
    plan_id: row.plan_id,
    agent_id: row.agent_id,
    snapshot_id: row.snapshot_id,
    tags: parseArray(row.tags),
    metadata: redactValue(parseObject(row.metadata)) as Record<string, unknown>,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function resolveKnownId(table: "tasks" | "projects" | "plans", value: string | undefined, db: Database): string | null {
  if (!value) return null;
  return resolvePartialId(db, table, value) || value;
}

export function createKnowledgeRecord(input: CreateKnowledgeRecordInput, db?: Database): ProjectKnowledgeRecord {
  assertType(input.record_type);
  const title = input.title.trim();
  if (!title) throw new Error("Knowledge record title is required");
  const d = getDatabase(db);
  const timestamp = now();
  const id = uuid();
  d.run(
    `INSERT INTO project_knowledge_records (
      id, record_type, title, content, decision, rationale, alternatives,
      task_id, project_id, plan_id, agent_id, snapshot_id, tags, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.record_type,
      title,
      normalizeText(input.content),
      normalizeText(input.decision),
      normalizeText(input.rationale),
      JSON.stringify(input.alternatives || []),
      resolveKnownId("tasks", input.task_id, d),
      resolveKnownId("projects", input.project_id, d),
      resolveKnownId("plans", input.plan_id, d),
      input.agent_id || null,
      input.snapshot_id || null,
      JSON.stringify(normalizeTags(input.tags)),
      JSON.stringify(input.metadata || {}),
      timestamp,
      timestamp,
    ],
  );
  return getKnowledgeRecord(id, d)!;
}

export function getKnowledgeRecord(id: string, db?: Database): ProjectKnowledgeRecord | null {
  const d = getDatabase(db);
  const resolved = resolvePartialId(d, "project_knowledge_records", id) || id;
  const row = d.query("SELECT * FROM project_knowledge_records WHERE id = ?").get(resolved) as KnowledgeRecordRow | null;
  return row ? rowToKnowledgeRecord(row) : null;
}

function buildFilters(options: ListKnowledgeRecordsOptions, db: Database): { where: string; params: any[] } {
  const conditions: string[] = [];
  const params: any[] = [];
  if (options.record_type) {
    assertType(options.record_type);
    conditions.push("record_type = ?");
    params.push(options.record_type);
  }
  const taskId = resolveKnownId("tasks", options.task_id, db);
  if (taskId) { conditions.push("task_id = ?"); params.push(taskId); }
  const projectId = resolveKnownId("projects", options.project_id, db);
  if (projectId) { conditions.push("project_id = ?"); params.push(projectId); }
  const planId = resolveKnownId("plans", options.plan_id, db);
  if (planId) { conditions.push("plan_id = ?"); params.push(planId); }
  if (options.agent_id) { conditions.push("agent_id = ?"); params.push(options.agent_id); }
  if (options.snapshot_id) { conditions.push("snapshot_id = ?"); params.push(options.snapshot_id); }
  if (options.tag) { conditions.push("EXISTS (SELECT 1 FROM json_each(project_knowledge_records.tags) WHERE value = ?)"); params.push(options.tag); }
  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

export function listKnowledgeRecords(options: ListKnowledgeRecordsOptions = {}, db?: Database): ProjectKnowledgeRecord[] {
  const d = getDatabase(db);
  const { where, params } = buildFilters(options, d);
  params.push(clampLimit(options.limit));
  return (d.query(`SELECT * FROM project_knowledge_records ${where} ORDER BY updated_at DESC, created_at DESC LIMIT ?`).all(...params) as KnowledgeRecordRow[])
    .map(rowToKnowledgeRecord);
}

export function searchKnowledgeRecords(options: SearchKnowledgeRecordsOptions, db?: Database): ProjectKnowledgeRecord[] {
  const query = options.query.trim();
  if (!query) return listKnowledgeRecords(options, db);
  const d = getDatabase(db);
  const { where, params } = buildFilters(options, d);
  const searchClause = `(
    lower(title) LIKE ?
    OR lower(coalesce(content, '')) LIKE ?
    OR lower(coalesce(decision, '')) LIKE ?
    OR lower(coalesce(rationale, '')) LIKE ?
    OR lower(tags) LIKE ?
  )`;
  const normalized = `%${query.toLowerCase()}%`;
  const searchParams = [normalized, normalized, normalized, normalized, normalized];
  const combinedWhere = where ? `${where} AND ${searchClause}` : `WHERE ${searchClause}`;
  return (d.query(`SELECT * FROM project_knowledge_records ${combinedWhere} ORDER BY updated_at DESC, created_at DESC LIMIT ?`)
    .all(...params, ...searchParams, clampLimit(options.limit)) as KnowledgeRecordRow[])
    .map(rowToKnowledgeRecord);
}

export function createKnowledgeSnapshot(input: CreateKnowledgeSnapshotInput, db?: Database): { snapshot_id: string; record: ProjectKnowledgeRecord } {
  const d = getDatabase(db);
  const snapshot = saveSnapshot({
    agent_id: input.agent_id,
    task_id: input.task_id,
    project_id: input.project_id,
    snapshot_type: input.snapshot_type || "checkpoint",
    plan_summary: input.summary,
    files_open: input.files_open,
    attempts: input.attempts,
    blockers: input.blockers,
    next_steps: input.next_steps,
    metadata: input.metadata,
  }, d);
  const record = createKnowledgeRecord({
    record_type: "context_snapshot",
    title: input.title || `Context snapshot ${snapshot.id.slice(0, 8)}`,
    content: input.summary,
    task_id: input.task_id,
    project_id: input.project_id,
    agent_id: input.agent_id,
    snapshot_id: snapshot.id,
    tags: normalizeTags(["context", ...(input.tags || [])]),
    metadata: {
      ...(input.metadata || {}),
      snapshot_type: snapshot.snapshot_type,
      files_open: snapshot.files_open,
      attempts: snapshot.attempts,
      blockers: snapshot.blockers,
      next_steps: snapshot.next_steps,
    },
  }, d);
  return { snapshot_id: snapshot.id, record };
}

export function createKnowledgeExportReport(
  options: ListKnowledgeRecordsOptions & { query?: string },
  db?: Database,
): KnowledgeExportReport {
  const records = options.query
    ? searchKnowledgeRecords({ ...options, query: options.query }, db)
    : listKnowledgeRecords(options, db);
  const { limit: _limit, ...filters } = options;
  return {
    schema_version: 1,
    local_only: true,
    no_network: true,
    generated_at: now(),
    filters: { ...filters, query: options.query || null },
    count: records.length,
    records,
  };
}

export function renderKnowledgeExportMarkdown(report: KnowledgeExportReport): string {
  const lines = [
    "# Project Knowledge",
    "",
    `Generated: ${report.generated_at}`,
    `Records: ${report.count}`,
    "",
  ];
  for (const record of report.records) {
    lines.push(`## ${record.title}`, "");
    lines.push(`- Type: ${record.record_type}`);
    if (record.project_id) lines.push(`- Project: ${record.project_id}`);
    if (record.task_id) lines.push(`- Task: ${record.task_id}`);
    if (record.plan_id) lines.push(`- Plan: ${record.plan_id}`);
    if (record.agent_id) lines.push(`- Agent: ${record.agent_id}`);
    if (record.tags.length > 0) lines.push(`- Tags: ${record.tags.join(", ")}`);
    lines.push("");
    if (record.decision) lines.push("Decision:", "", record.decision, "");
    if (record.rationale) lines.push("Rationale:", "", record.rationale, "");
    if (record.alternatives.length > 0) {
      lines.push("Alternatives:");
      for (const alternative of record.alternatives) lines.push(`- ${alternative}`);
      lines.push("");
    }
    if (record.content) lines.push(record.content, "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
