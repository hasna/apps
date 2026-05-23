/**
 * Saved search filters/views and unified local search across OSS entities.
 */

import type { Database } from "bun:sqlite";
import { getDatabase, now, uuid } from "../db/database.js";
import { searchTasks, type SearchOptions } from "./search.js";
import { listProjects } from "../db/projects.js";
import { listPlans } from "../db/plans.js";
import { listAgentRuns } from "./agent-run-dispatcher.js";
import type { Task } from "../types/index.js";

export const SAVED_VIEWS_SCHEMA = "todos.saved_views.v1";

export type SearchEntityType = "task" | "project" | "plan" | "comment" | "run" | "all";

export interface SavedView {
  schema_version: typeof SAVED_VIEWS_SCHEMA;
  id: string;
  name: string;
  slug: string;
  entity_type: SearchEntityType;
  filters: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface UnifiedSearchInput {
  query?: string;
  entity_types?: SearchEntityType[];
  task_filters?: SearchOptions;
  limit?: number;
  offset?: number;
}

export interface SearchHit {
  entity_type: SearchEntityType;
  id: string;
  title: string;
  snippet: string;
  score: number;
  data: Record<string, unknown>;
}

export interface UnifiedSearchResult {
  schema_version: typeof SAVED_VIEWS_SCHEMA;
  query: string;
  total: number;
  hits: SearchHit[];
  limit: number;
  offset: number;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function rowToView(row: Record<string, unknown>): SavedView {
  return {
    schema_version: SAVED_VIEWS_SCHEMA,
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    entity_type: row.entity_type as SearchEntityType,
    filters: JSON.parse(row.filters as string),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export function createSavedView(
  input: { name: string; entity_type?: SearchEntityType; filters?: Record<string, unknown>; slug?: string },
  db?: Database,
): SavedView {
  const d = db || getDatabase();
  const id = uuid();
  const ts = now();
  const slug = input.slug ?? slugify(input.name);

  d.run(
    `INSERT INTO saved_views (id, name, slug, entity_type, filters, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.name, slug, input.entity_type ?? "task", JSON.stringify(input.filters ?? {}), ts, ts],
  );

  return getSavedView(id, d)!;
}

export function getSavedView(idOrSlug: string, db?: Database): SavedView | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM saved_views WHERE id = ? OR slug = ?").get(idOrSlug, idOrSlug) as Record<string, unknown> | null;
  return row ? rowToView(row) : null;
}

export function listSavedViews(db?: Database): SavedView[] {
  const d = db || getDatabase();
  const rows = d.query("SELECT * FROM saved_views ORDER BY name ASC").all() as Record<string, unknown>[];
  return rows.map(rowToView);
}

export function deleteSavedView(idOrSlug: string, db?: Database): boolean {
  const d = db || getDatabase();
  const result = d.run("DELETE FROM saved_views WHERE id = ? OR slug = ?", [idOrSlug, idOrSlug]);
  return result.changes > 0;
}

function taskToHit(task: Task, query: string, index: number): SearchHit {
  const q = query.toLowerCase();
  let score = 100 - index;
  if (q && task.title.toLowerCase().includes(q)) score += 50;
  if (q && task.description?.toLowerCase().includes(q)) score += 20;
  return {
    entity_type: "task",
    id: task.id,
    title: task.short_id ? `${task.short_id} ${task.title}` : task.title,
    snippet: (task.description ?? "").slice(0, 120),
    score,
    data: { status: task.status, priority: task.priority, project_id: task.project_id },
  };
}

export function unifiedSearch(input: UnifiedSearchInput = {}, db?: Database): UnifiedSearchResult {
  const d = db || getDatabase();
  const query = input.query?.trim() ?? "";
  const types = input.entity_types ?? ["task"];
  const limit = input.limit ?? 50;
  const offset = input.offset ?? 0;
  const hits: SearchHit[] = [];

  if (types.includes("task") || types.includes("all")) {
    const tasks = searchTasks({ ...input.task_filters, query: query || undefined }, undefined, undefined, d);
    hits.push(...tasks.map((t, i) => taskToHit(t, query, i)));
  }

  if (types.includes("project") || types.includes("all")) {
    const projects = listProjects(d);
    for (const p of projects) {
      if (query && !p.name.toLowerCase().includes(query.toLowerCase()) && !p.path.toLowerCase().includes(query.toLowerCase())) continue;
      hits.push({
        entity_type: "project",
        id: p.id,
        title: p.name,
        snippet: p.path,
        score: 80,
        data: { path: p.path },
      });
    }
  }

  if (types.includes("plan") || types.includes("all")) {
    for (const p of listPlans(undefined, d)) {
      if (query && !p.name.toLowerCase().includes(query.toLowerCase())) continue;
      hits.push({
        entity_type: "plan",
        id: p.id,
        title: p.name,
        snippet: p.description ?? "",
        score: 70,
        data: { status: p.status, project_id: p.project_id },
      });
    }
  }

  if (types.includes("run") || types.includes("all")) {
    for (const r of listAgentRuns({ limit: 100 }, d)) {
      if (query && !r.adapter.toLowerCase().includes(query.toLowerCase()) && !r.id.includes(query)) continue;
      hits.push({
        entity_type: "run",
        id: r.id,
        title: `Run ${r.adapter}`,
        snippet: r.status,
        score: 60,
        data: { status: r.status, task_id: r.task_id },
      });
    }
  }

  if (types.includes("comment") || types.includes("all")) {
    const rows = d.query(
      `SELECT c.id, c.content, c.task_id FROM task_comments c
       WHERE ? = '' OR c.content LIKE ? ORDER BY c.created_at DESC LIMIT 100`,
    ).all(query, `%${query}%`) as { id: string; content: string; task_id: string }[];
    for (const c of rows) {
      hits.push({
        entity_type: "comment",
        id: c.id,
        title: `Comment on ${c.task_id.slice(0, 8)}`,
        snippet: c.content.slice(0, 120),
        score: 55,
        data: { task_id: c.task_id },
      });
    }
  }

  hits.sort((a, b) => b.score - a.score);
  const total = hits.length;
  const page = hits.slice(offset, offset + limit);

  return {
    schema_version: SAVED_VIEWS_SCHEMA,
    query,
    total,
    hits: page,
    limit,
    offset,
  };
}

export function runSavedView(viewRef: string, overrides: UnifiedSearchInput = {}, db?: Database): UnifiedSearchResult {
  const view = getSavedView(viewRef, db);
  if (!view) throw new Error(`Saved view not found: ${viewRef}`);

  const filters = view.filters as SearchOptions;
  const entityTypes = view.entity_type === "all" ? undefined : [view.entity_type];

  return unifiedSearch({
    ...overrides,
    entity_types: overrides.entity_types ?? entityTypes,
    task_filters: { ...filters, ...overrides.task_filters },
  }, db);
}

export function getBuiltinSavedViews(): Array<Omit<SavedView, "id" | "created_at" | "updated_at">> {
  return [
    { schema_version: SAVED_VIEWS_SCHEMA, name: "My pending", slug: "my-pending", entity_type: "task", filters: { status: "pending" } },
    { schema_version: SAVED_VIEWS_SCHEMA, name: "Blocked tasks", slug: "blocked", entity_type: "task", filters: { is_blocked: true } },
    { schema_version: SAVED_VIEWS_SCHEMA, name: "Critical open", slug: "critical-open", entity_type: "task", filters: { status: ["pending", "in_progress"], priority: "critical" } },
  ];
}
