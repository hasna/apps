import type { Database } from "bun:sqlite";
import { getDatabase } from "../db/database.js";
import { redactEvidenceText, redactValue } from "./redaction.js";

export type LocalActivityTimelineEntityType = "all" | "task" | "project" | "plan" | "run";
export type LocalActivityTimelineOrder = "asc" | "desc";
export type LocalActivityTimelineSource =
  | "comment"
  | "task_history"
  | "run_event"
  | "run_command"
  | "run_artifact";

export interface LocalActivityTimelineOptions {
  entity_type?: LocalActivityTimelineEntityType;
  entity_id?: string;
  task_id?: string;
  project_id?: string;
  plan_id?: string;
  run_id?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
  order?: LocalActivityTimelineOrder;
}

export interface LocalActivityTimelineEntry {
  id: string;
  source: LocalActivityTimelineSource;
  event_type: string;
  entity_type: "task" | "run";
  entity_id: string;
  task_id: string;
  project_id: string | null;
  plan_id: string | null;
  run_id: string | null;
  agent_id: string | null;
  created_at: string;
  title: string;
  message: string | null;
  metadata: Record<string, unknown>;
}

export interface LocalActivityTimelinePage {
  entries: LocalActivityTimelineEntry[];
  total: number;
  limit: number;
  offset: number;
  order: LocalActivityTimelineOrder;
  filters: Required<Pick<LocalActivityTimelineOptions, "entity_type">> & Omit<LocalActivityTimelineOptions, "limit" | "offset" | "order">;
}

interface TimelineRow {
  id: string;
  source: LocalActivityTimelineSource;
  event_type: string;
  entity_type: "task" | "run";
  entity_id: string;
  task_id: string;
  project_id: string | null;
  plan_id: string | null;
  run_id: string | null;
  agent_id: string | null;
  created_at: string;
  title: string;
  message: string | null;
  metadata_json: string | null;
}

function clampLimit(value: number | undefined): number {
  if (!Number.isFinite(value || 0) || !value || value < 1) return 50;
  return Math.min(Math.floor(value), 500);
}

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function toEntry(row: TimelineRow): LocalActivityTimelineEntry {
  return {
    id: row.id,
    source: row.source,
    event_type: row.event_type,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    task_id: row.task_id,
    project_id: row.project_id,
    plan_id: row.plan_id,
    run_id: row.run_id,
    agent_id: row.agent_id,
    created_at: row.created_at,
    title: redactEvidenceText(row.title),
    message: row.message ? redactEvidenceText(row.message) : null,
    metadata: redactValue(parseMetadata(row.metadata_json)),
  };
}

function sourceRank(source: LocalActivityTimelineSource): number {
  return {
    task_history: 0,
    comment: 1,
    run_event: 2,
    run_command: 3,
    run_artifact: 4,
  }[source];
}

function compareEntries(order: LocalActivityTimelineOrder) {
  return (a: LocalActivityTimelineEntry, b: LocalActivityTimelineEntry): number => {
    const time = a.created_at.localeCompare(b.created_at);
    if (time !== 0) return order === "asc" ? time : -time;
    const rank = sourceRank(a.source) - sourceRank(b.source);
    if (rank !== 0) return rank;
    return a.id.localeCompare(b.id);
  };
}

function matchesOptions(entry: LocalActivityTimelineEntry, options: LocalActivityTimelineOptions): boolean {
  if (options.task_id && entry.task_id !== options.task_id) return false;
  if (options.project_id && entry.project_id !== options.project_id) return false;
  if (options.plan_id && entry.plan_id !== options.plan_id) return false;
  if (options.run_id && entry.run_id !== options.run_id) return false;
  if (options.since && entry.created_at < options.since) return false;
  if (options.until && entry.created_at > options.until) return false;

  if (!options.entity_id || !options.entity_type || options.entity_type === "all") return true;
  if (options.entity_type === "task") return entry.task_id === options.entity_id;
  if (options.entity_type === "project") return entry.project_id === options.entity_id;
  if (options.entity_type === "plan") return entry.plan_id === options.entity_id;
  if (options.entity_type === "run") return entry.run_id === options.entity_id;
  return true;
}

function timelineRows(db: Database): TimelineRow[] {
  const comments = db.query(`
    SELECT c.id,
      'comment' AS source,
      c.type AS event_type,
      'task' AS entity_type,
      c.task_id AS entity_id,
      c.task_id,
      t.project_id,
      t.plan_id,
      NULL AS run_id,
      c.agent_id,
      c.created_at,
      'comment' AS title,
      c.content AS message,
      json_object('session_id', c.session_id, 'progress_pct', c.progress_pct) AS metadata_json
    FROM task_comments c
    JOIN tasks t ON t.id = c.task_id
  `).all() as TimelineRow[];

  const history = db.query(`
    SELECT h.id,
      'task_history' AS source,
      h.action AS event_type,
      'task' AS entity_type,
      h.task_id AS entity_id,
      h.task_id,
      t.project_id,
      t.plan_id,
      NULL AS run_id,
      h.agent_id,
      h.created_at,
      h.action AS title,
      CASE
        WHEN h.field IS NULL THEN h.action
        WHEN h.old_value IS NOT NULL AND h.new_value IS NOT NULL THEN h.field || ': ' || h.old_value || ' -> ' || h.new_value
        WHEN h.new_value IS NOT NULL THEN h.field || ': ' || h.new_value
        ELSE h.field
      END AS message,
      json_object('field', h.field, 'old_value', h.old_value, 'new_value', h.new_value) AS metadata_json
    FROM task_history h
    JOIN tasks t ON t.id = h.task_id
  `).all() as TimelineRow[];

  const runEvents = db.query(`
    SELECT e.id,
      'run_event' AS source,
      e.event_type AS event_type,
      'run' AS entity_type,
      e.run_id AS entity_id,
      e.task_id,
      t.project_id,
      t.plan_id,
      e.run_id,
      e.agent_id,
      e.created_at,
      e.event_type AS title,
      e.message AS message,
      e.data AS metadata_json
    FROM task_run_events e
    JOIN tasks t ON t.id = e.task_id
  `).all() as TimelineRow[];

  const runCommands = db.query(`
    SELECT c.id,
      'run_command' AS source,
      c.status AS event_type,
      'run' AS entity_type,
      c.run_id AS entity_id,
      c.task_id,
      t.project_id,
      t.plan_id,
      c.run_id,
      c.agent_id,
      c.created_at,
      c.status || ' command' AS title,
      c.command AS message,
      json_object('status', c.status, 'exit_code', c.exit_code, 'output_summary', c.output_summary, 'artifact_path', c.artifact_path) AS metadata_json
    FROM task_run_commands c
    JOIN tasks t ON t.id = c.task_id
  `).all() as TimelineRow[];

  const runArtifacts = db.query(`
    SELECT a.id,
      'run_artifact' AS source,
      COALESCE(a.artifact_type, 'artifact') AS event_type,
      'run' AS entity_type,
      a.run_id AS entity_id,
      a.task_id,
      t.project_id,
      t.plan_id,
      a.run_id,
      a.agent_id,
      a.created_at,
      'artifact' AS title,
      COALESCE(a.description, a.path) AS message,
      json_object('path', a.path, 'artifact_type', a.artifact_type, 'size_bytes', a.size_bytes, 'sha256', a.sha256, 'metadata', a.metadata) AS metadata_json
    FROM task_run_artifacts a
    JOIN tasks t ON t.id = a.task_id
  `).all() as TimelineRow[];

  return [...comments, ...history, ...runEvents, ...runCommands, ...runArtifacts];
}

export function getLocalActivityTimeline(
  options: LocalActivityTimelineOptions = {},
  db?: Database,
): LocalActivityTimelinePage {
  const d = getDatabase(db);
  const order = options.order || "desc";
  const limit = clampLimit(options.limit);
  const offset = Math.max(0, Math.floor(options.offset || 0));
  const entityType = options.entity_type || "all";
  const filters = { ...options, entity_type: entityType };
  const entries = timelineRows(d)
    .map(toEntry)
    .filter((entry) => matchesOptions(entry, filters))
    .sort(compareEntries(order));

  return {
    entries: entries.slice(offset, offset + limit),
    total: entries.length,
    limit,
    offset,
    order,
    filters,
  };
}
