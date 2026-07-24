/**
 * Local ADR-style decision records and project knowledge snapshots.
 * Fully offline; portable Markdown/JSON export.
 */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "../db/database.js";
import { getProject } from "../db/projects.js";
import { listPlans } from "../db/plans.js";

export const DECISION_RECORD_SCHEMA = "todos.decision_record.v1";
export const KNOWLEDGE_SNAPSHOT_SCHEMA = "todos.knowledge_snapshot.v1";

export const DECISION_STATUSES = ["proposed", "accepted", "deprecated", "superseded", "rejected"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const KNOWLEDGE_SNAPSHOT_SOURCES = ["manual", "auto", "import"] as const;
export type KnowledgeSnapshotSource = (typeof KNOWLEDGE_SNAPSHOT_SOURCES)[number];

export interface DecisionAlternative {
  title: string;
  description?: string;
  rejected_reason?: string;
}

export interface DecisionRecord {
  schema_version: typeof DECISION_RECORD_SCHEMA;
  id: string;
  project_id: string | null;
  task_id: string | null;
  plan_id: string | null;
  agent_id: string | null;
  sequence_num: number;
  short_ref: string;
  title: string;
  status: DecisionStatus;
  context: string | null;
  decision: string;
  consequences: string | null;
  alternatives: DecisionAlternative[];
  tags: string[];
  supersedes_id: string | null;
  superseded_by_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateDecisionRecordInput {
  project_id?: string;
  task_id?: string;
  plan_id?: string;
  agent_id?: string;
  title: string;
  status?: DecisionStatus;
  context?: string;
  decision: string;
  consequences?: string;
  alternatives?: DecisionAlternative[];
  tags?: string[];
  supersedes_id?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateDecisionRecordInput {
  title?: string;
  context?: string;
  decision?: string;
  consequences?: string;
  alternatives?: DecisionAlternative[];
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface ListDecisionRecordsFilter {
  project_id?: string;
  task_id?: string;
  plan_id?: string;
  status?: DecisionStatus;
  tag?: string;
  limit?: number;
  offset?: number;
}

export interface KnowledgeSnapshotDecisionSummary {
  id: string;
  short_ref: string;
  title: string;
  status: DecisionStatus;
  decision: string;
  tags: string[];
}

export interface KnowledgeSnapshotPayload {
  schema_version: typeof KNOWLEDGE_SNAPSHOT_SCHEMA;
  captured_at: string;
  project: { id: string; name: string; path: string; description: string | null } | null;
  summary: string | null;
  decisions: KnowledgeSnapshotDecisionSummary[];
  active_plans: Array<{ id: string; name: string; status: string }>;
  topics: string[];
  conventions: string[];
  notes: string | null;
}

export interface KnowledgeSnapshotRecord {
  schema_version: typeof KNOWLEDGE_SNAPSHOT_SCHEMA;
  id: string;
  project_id: string | null;
  title: string;
  summary: string | null;
  content_hash: string;
  snapshot: KnowledgeSnapshotPayload;
  decision_ids: string[];
  topics: string[];
  source: KnowledgeSnapshotSource;
  created_at: string;
}

export interface CaptureKnowledgeSnapshotInput {
  project_id: string;
  title?: string;
  summary?: string;
  notes?: string;
  conventions?: string[];
  topics?: string[];
  source?: KnowledgeSnapshotSource;
  include_statuses?: DecisionStatus[];
}

export interface ListKnowledgeSnapshotsFilter {
  project_id?: string;
  limit?: number;
  offset?: number;
}

function parseJsonArray<T>(raw: string | null | undefined, fallback: T[] = []): T[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as T[] : fallback;
  } catch {
    return fallback;
  }
}

function nextSequenceNum(projectId: string | null | undefined, db: Database): number {
  if (!projectId) return 1;
  const row = db.query(
    "SELECT COALESCE(MAX(sequence_num), 0) + 1 AS next FROM decision_records WHERE project_id = ?",
  ).get(projectId) as { next: number };
  return row.next;
}

function buildShortRef(projectId: string | null | undefined, sequenceNum: number, db: Database): string {
  if (!projectId) return `ADR-${String(sequenceNum).padStart(5, "0")}`;
  const project = getProject(projectId, db);
  const prefix = project?.task_prefix ?? "ADR";
  return `${prefix}-${String(sequenceNum).padStart(5, "0")}`;
}

function rowToDecisionRecord(row: Record<string, unknown>): DecisionRecord {
  return {
    schema_version: DECISION_RECORD_SCHEMA,
    id: row.id as string,
    project_id: (row.project_id as string) ?? null,
    task_id: (row.task_id as string) ?? null,
    plan_id: (row.plan_id as string) ?? null,
    agent_id: (row.agent_id as string) ?? null,
    sequence_num: row.sequence_num as number,
    short_ref: row.short_ref as string,
    title: row.title as string,
    status: row.status as DecisionStatus,
    context: (row.context as string) ?? null,
    decision: row.decision as string,
    consequences: (row.consequences as string) ?? null,
    alternatives: parseJsonArray<DecisionAlternative>(row.alternatives as string),
    tags: parseJsonArray<string>(row.tags as string),
    supersedes_id: (row.supersedes_id as string) ?? null,
    superseded_by_id: (row.superseded_by_id as string) ?? null,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : {},
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function stableSnapshotHash(payload: KnowledgeSnapshotPayload): string {
  const { captured_at: _capturedAt, ...rest } = payload;
  return createHash("sha256").update(JSON.stringify(rest)).digest("hex");
}

export function createDecisionRecord(input: CreateDecisionRecordInput, db?: Database): DecisionRecord {
  const d = getDatabase(db);
  const id = uuid();
  const ts = now();
  const sequenceNum = nextSequenceNum(input.project_id, d);
  const shortRef = buildShortRef(input.project_id, sequenceNum, d);
  const status = input.status ?? "proposed";

  d.run(
    `INSERT INTO decision_records (
      id, project_id, task_id, plan_id, agent_id, sequence_num, short_ref,
      title, status, context, decision, consequences, alternatives, tags,
      supersedes_id, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.project_id ?? null,
      input.task_id ?? null,
      input.plan_id ?? null,
      input.agent_id ?? null,
      sequenceNum,
      shortRef,
      input.title,
      status,
      input.context ?? null,
      input.decision,
      input.consequences ?? null,
      JSON.stringify(input.alternatives ?? []),
      JSON.stringify(input.tags ?? []),
      input.supersedes_id ?? null,
      JSON.stringify(input.metadata ?? {}),
      ts,
      ts,
    ],
  );

  if (input.supersedes_id) {
    d.run(
      `UPDATE decision_records SET status = 'superseded', superseded_by_id = ?, updated_at = ? WHERE id = ?`,
      [id, ts, input.supersedes_id],
    );
  }

  return getDecisionRecord(id, d)!;
}

export function getDecisionRecord(id: string, db?: Database): DecisionRecord | null {
  const d = getDatabase(db);
  const row = d.query("SELECT * FROM decision_records WHERE id = ?").get(id) as Record<string, unknown> | null;
  return row ? rowToDecisionRecord(row) : null;
}

export function getDecisionRecordByRef(shortRef: string, db?: Database): DecisionRecord | null {
  const d = getDatabase(db);
  const row = d.query("SELECT * FROM decision_records WHERE short_ref = ?").get(shortRef) as Record<string, unknown> | null;
  return row ? rowToDecisionRecord(row) : null;
}

export function listDecisionRecords(filter: ListDecisionRecordsFilter = {}, db?: Database): DecisionRecord[] {
  const d = getDatabase(db);
  const conditions: string[] = ["1=1"];
  const params: unknown[] = [];

  if (filter.project_id) {
    conditions.push("project_id = ?");
    params.push(filter.project_id);
  }
  if (filter.task_id) {
    conditions.push("task_id = ?");
    params.push(filter.task_id);
  }
  if (filter.plan_id) {
    conditions.push("plan_id = ?");
    params.push(filter.plan_id);
  }
  if (filter.status) {
    conditions.push("status = ?");
    params.push(filter.status);
  }
  if (filter.tag) {
    conditions.push("tags LIKE ?");
    params.push(`%"${filter.tag}"%`);
  }

  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;
  const sql = `SELECT * FROM decision_records WHERE ${conditions.join(" AND ")} ORDER BY sequence_num DESC LIMIT ? OFFSET ?`;
  const rows = d.query(sql).all(...[...params, limit, offset] as any) as Record<string, unknown>[];
  return rows.map(rowToDecisionRecord);
}

export function updateDecisionRecord(id: string, input: UpdateDecisionRecordInput, db?: Database): DecisionRecord {
  const d = getDatabase(db);
  const existing = getDecisionRecord(id, d);
  if (!existing) throw new Error(`Decision record not found: ${id}`);

  const ts = now();
  d.run(
    `UPDATE decision_records SET
      title = ?, context = ?, decision = ?, consequences = ?,
      alternatives = ?, tags = ?, metadata = ?, updated_at = ?
     WHERE id = ?`,
    [
      input.title ?? existing.title,
      input.context !== undefined ? input.context : existing.context,
      input.decision ?? existing.decision,
      input.consequences !== undefined ? input.consequences : existing.consequences,
      JSON.stringify(input.alternatives ?? existing.alternatives),
      JSON.stringify(input.tags ?? existing.tags),
      JSON.stringify(input.metadata ?? existing.metadata),
      ts,
      id,
    ],
  );

  return getDecisionRecord(id, d)!;
}

export function setDecisionStatus(id: string, status: DecisionStatus, db?: Database): DecisionRecord {
  if (!DECISION_STATUSES.includes(status)) {
    throw new Error(`Invalid decision status: ${status}`);
  }

  const d = getDatabase(db);
  const existing = getDecisionRecord(id, d);
  if (!existing) throw new Error(`Decision record not found: ${id}`);

  d.run(`UPDATE decision_records SET status = ?, updated_at = ? WHERE id = ?`, [status, now(), id]);
  return getDecisionRecord(id, d)!;
}

export function supersedeDecisionRecord(
  id: string,
  input: Omit<CreateDecisionRecordInput, "supersedes_id">,
  db?: Database,
): { previous: DecisionRecord; replacement: DecisionRecord } {
  const d = getDatabase(db);
  const previous = getDecisionRecord(id, d);
  if (!previous) throw new Error(`Decision record not found: ${id}`);

  const replacement = createDecisionRecord(
    {
      ...input,
      project_id: input.project_id ?? previous.project_id ?? undefined,
      task_id: input.task_id ?? previous.task_id ?? undefined,
      plan_id: input.plan_id ?? previous.plan_id ?? undefined,
      agent_id: input.agent_id ?? previous.agent_id ?? undefined,
      tags: input.tags ?? previous.tags,
      supersedes_id: id,
      status: input.status ?? "accepted",
    },
    d,
  );

  return {
    previous: getDecisionRecord(id, d)!,
    replacement,
  };
}

export function formatDecisionRecordMarkdown(record: DecisionRecord): string {
  const lines = [
    `# ${record.short_ref}: ${record.title}`,
    "",
    `- **Status:** ${record.status}`,
    `- **Created:** ${record.created_at}`,
    `- **Updated:** ${record.updated_at}`,
  ];

  if (record.project_id) lines.push(`- **Project:** ${record.project_id.slice(0, 8)}`);
  if (record.task_id) lines.push(`- **Task:** ${record.task_id.slice(0, 8)}`);
  if (record.agent_id) lines.push(`- **Author:** ${record.agent_id}`);
  if (record.supersedes_id) lines.push(`- **Supersedes:** ${record.supersedes_id.slice(0, 8)}`);
  if (record.superseded_by_id) lines.push(`- **Superseded by:** ${record.superseded_by_id.slice(0, 8)}`);
  if (record.tags.length) lines.push(`- **Tags:** ${record.tags.join(", ")}`);

  lines.push("", "## Context", "", record.context ?? "_No context recorded._");
  lines.push("", "## Decision", "", record.decision);
  lines.push("", "## Consequences", "", record.consequences ?? "_No consequences recorded._");

  lines.push("", "## Alternatives");
  if (record.alternatives.length) {
    for (const alt of record.alternatives) {
      lines.push(`### ${alt.title}`);
      if (alt.description) lines.push("", alt.description);
      if (alt.rejected_reason) lines.push("", `_Rejected:_ ${alt.rejected_reason}`);
      lines.push("");
    }
  } else {
    lines.push("", "_No alternatives recorded._");
  }

  return lines.join("\n") + "\n";
}

export function exportDecisionRecord(
  id: string,
  outputPath?: string,
  format: "json" | "markdown" = "markdown",
  db?: Database,
): { path: string; content: string } {
  const record = getDecisionRecord(id, db);
  if (!record) throw new Error(`Decision record not found: ${id}`);

  const content = format === "markdown" ? formatDecisionRecordMarkdown(record) : JSON.stringify(record, null, 2);
  const path = outputPath ?? join(process.cwd(), ".todos", "decisions", `${record.short_ref}.${format === "markdown" ? "md" : "json"}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return { path, content };
}

export function buildKnowledgeSnapshotPayload(
  input: CaptureKnowledgeSnapshotInput,
  db?: Database,
): KnowledgeSnapshotPayload {
  const d = getDatabase(db);
  const project = getProject(input.project_id, d);
  if (!project) throw new Error(`Project not found: ${input.project_id}`);

  const includeStatuses = input.include_statuses ?? ["accepted", "proposed"];
  const decisions = listDecisionRecords({ project_id: input.project_id, limit: 500 }, d)
    .filter((record) => includeStatuses.includes(record.status))
    .map((record) => ({
      id: record.id,
      short_ref: record.short_ref,
      title: record.title,
      status: record.status,
      decision: record.decision,
      tags: record.tags,
    }));

  const activePlans = listPlans(input.project_id, d)
    .filter((plan) => plan.status === "active")
    .map((plan) => ({ id: plan.id, name: plan.name, status: plan.status }));

  const topics = input.topics ?? [...new Set(decisions.flatMap((record) => record.tags))];
  const conventions = input.conventions ?? [];
  if (project.description && !conventions.length) {
    conventions.push(project.description);
  }

  return {
    schema_version: KNOWLEDGE_SNAPSHOT_SCHEMA,
    captured_at: new Date().toISOString(),
    project: {
      id: project.id,
      name: project.name,
      path: project.path,
      description: project.description ?? null,
    },
    summary: input.summary ?? null,
    decisions,
    active_plans: activePlans,
    topics,
    conventions,
    notes: input.notes ?? null,
  };
}

export function captureKnowledgeSnapshot(input: CaptureKnowledgeSnapshotInput, db?: Database): KnowledgeSnapshotRecord {
  const d = getDatabase(db);
  const payload = buildKnowledgeSnapshotPayload(input, d);
  const contentHash = stableSnapshotHash(payload);
  const id = uuid();
  const ts = now();
  const title = input.title ?? `Knowledge snapshot — ${payload.project?.name ?? input.project_id.slice(0, 8)}`;
  const decisionIds = payload.decisions.map((record) => record.id);

  d.run(
    `INSERT INTO knowledge_snapshots (
      id, project_id, title, summary, content_hash, snapshot, decision_ids, topics, source, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.project_id,
      title,
      input.summary ?? null,
      contentHash,
      JSON.stringify(payload),
      JSON.stringify(decisionIds),
      JSON.stringify(payload.topics),
      input.source ?? "auto",
      ts,
    ],
  );

  return getKnowledgeSnapshot(id, d)!;
}

function rowToKnowledgeSnapshot(row: Record<string, unknown>): KnowledgeSnapshotRecord {
  return {
    schema_version: KNOWLEDGE_SNAPSHOT_SCHEMA,
    id: row.id as string,
    project_id: (row.project_id as string) ?? null,
    title: row.title as string,
    summary: (row.summary as string) ?? null,
    content_hash: row.content_hash as string,
    snapshot: JSON.parse(row.snapshot as string) as KnowledgeSnapshotPayload,
    decision_ids: parseJsonArray<string>(row.decision_ids as string),
    topics: parseJsonArray<string>(row.topics as string),
    source: row.source as KnowledgeSnapshotSource,
    created_at: row.created_at as string,
  };
}

export function getKnowledgeSnapshot(id: string, db?: Database): KnowledgeSnapshotRecord | null {
  const d = getDatabase(db);
  const row = d.query("SELECT * FROM knowledge_snapshots WHERE id = ?").get(id) as Record<string, unknown> | null;
  return row ? rowToKnowledgeSnapshot(row) : null;
}

export function listKnowledgeSnapshots(filter: ListKnowledgeSnapshotsFilter = {}, db?: Database): KnowledgeSnapshotRecord[] {
  const d = getDatabase(db);
  const conditions: string[] = ["1=1"];
  const params: unknown[] = [];

  if (filter.project_id) {
    conditions.push("project_id = ?");
    params.push(filter.project_id);
  }

  const limit = filter.limit ?? 50;
  const offset = filter.offset ?? 0;
  const sql = `SELECT * FROM knowledge_snapshots WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  const rows = d.query(sql).all(...[...params, limit, offset] as any) as Record<string, unknown>[];
  return rows.map(rowToKnowledgeSnapshot);
}

export function formatKnowledgeSnapshotMarkdown(record: KnowledgeSnapshotRecord): string {
  const snap = record.snapshot;
  const lines = [
    `# ${record.title}`,
    "",
    `- **Snapshot ID:** ${record.id.slice(0, 8)}`,
    `- **Captured:** ${snap.captured_at}`,
    `- **Source:** ${record.source}`,
    `- **Hash:** ${record.content_hash.slice(0, 12)}…`,
  ];

  if (snap.project) {
    lines.push(`- **Project:** ${snap.project.name} (${snap.project.path})`);
  }
  if (record.summary || snap.summary) {
    lines.push("", "## Summary", "", record.summary ?? snap.summary ?? "");
  }

  lines.push("", "## Topics", "", snap.topics.length ? snap.topics.map((topic) => `- ${topic}`).join("\n") : "_None_");
  lines.push("", "## Conventions", "", snap.conventions.length ? snap.conventions.map((item) => `- ${item}`).join("\n") : "_None_");
  lines.push("", "## Active Plans");
  if (snap.active_plans.length) {
    for (const plan of snap.active_plans) lines.push(`- ${plan.name} (${plan.status})`);
  } else {
    lines.push("", "_None_");
  }

  lines.push("", "## Decisions");
  if (snap.decisions.length) {
    for (const decision of snap.decisions) {
      lines.push(`### ${decision.short_ref}: ${decision.title}`, "", `- Status: ${decision.status}`, "", decision.decision, "");
    }
  } else {
    lines.push("", "_No decisions included._");
  }

  if (snap.notes) {
    lines.push("", "## Notes", "", snap.notes);
  }

  return lines.join("\n") + "\n";
}

export function exportKnowledgeSnapshot(
  id: string,
  outputPath?: string,
  format: "json" | "markdown" = "markdown",
  db?: Database,
): { path: string; content: string } {
  const record = getKnowledgeSnapshot(id, db);
  if (!record) throw new Error(`Knowledge snapshot not found: ${id}`);

  const content = format === "markdown" ? formatKnowledgeSnapshotMarkdown(record) : JSON.stringify(record, null, 2);
  const slug = record.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const path = outputPath ?? join(process.cwd(), ".todos", "knowledge", `${slug || record.id.slice(0, 8)}.${format === "markdown" ? "md" : "json"}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
  return { path, content };
}

export function getDecisionRecordsDocs(): string {
  return `# Decision records and knowledge snapshots

Local ADR-style decision records plus point-in-time project knowledge snapshots.

## Decision record lifecycle

1. \`createDecisionRecord\` — capture context, decision, consequences, alternatives
2. \`setDecisionStatus\` — move through proposed → accepted/rejected/deprecated
3. \`supersedeDecisionRecord\` — create replacement and mark previous superseded
4. \`exportDecisionRecord\` — Markdown or JSON under \`.todos/decisions/\`

## Knowledge snapshots

\`captureKnowledgeSnapshot\` bundles accepted/proposed decisions, active plans, topics, and conventions for a project.

Schema versions:
- \`${DECISION_RECORD_SCHEMA}\`
- \`${KNOWLEDGE_SNAPSHOT_SCHEMA}\`
`;
}
