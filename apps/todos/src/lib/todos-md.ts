/**
 * Local todos.md markdown import, export, and watch sync.
 * File format is local-only — no hosted todos.md API dependency.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, watch } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { getDatabase, now } from "../db/database.js";
import { createTask, listTasks, updateTask, getTask, type Task } from "../db/tasks.js";
import { setTaskStatus } from "../db/task-status.js";

export const TODOS_MD_VERSION = 1;
export const TODOS_MD_SCHEMA = "todos.md.v1";

export interface TodosMdFrontmatter {
  todos_md_version: number;
  project?: string;
  exported_at?: string;
  source_path?: string;
}

export interface TodosMdTaskLine {
  status: "pending" | "in_progress" | "completed" | "cancelled";
  title: string;
  id?: string;
  short_id?: string;
  priority?: string;
  tags?: string[];
  assigned_to?: string;
}

export interface TodosMdDocument {
  frontmatter: TodosMdFrontmatter;
  sections: Record<string, TodosMdTaskLine[]>;
}

export interface ImportTodosMdResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export interface ExportTodosMdOptions {
  project_id?: string;
  path?: string;
  include_completed?: boolean;
}

export interface SyncTodosMdResult {
  path: string;
  imported: ImportTodosMdResult;
  exported: boolean;
  hash: string;
}

function defaultPath(cwd?: string): string {
  return join(cwd || process.cwd(), "todos.md");
}

function parseFrontmatter(raw: string): { frontmatter: TodosMdFrontmatter; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: { todos_md_version: TODOS_MD_VERSION }, body: raw };
  }

  const fm: TodosMdFrontmatter = { todos_md_version: TODOS_MD_VERSION };
  for (const line of match[1]!.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key === "todos_md_version") fm.todos_md_version = parseInt(value, 10);
    else if (key === "project") fm.project = value;
    else if (key === "exported_at") fm.exported_at = value;
    else if (key === "source_path") fm.source_path = value;
  }
  return { frontmatter: fm, body: match[2]! };
}

function parseMetaSuffix(raw: string): Partial<TodosMdTaskLine> {
  const meta: Partial<TodosMdTaskLine> = {};
  const parts = raw.split("|").map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    if (part.startsWith("id:")) meta.id = part.slice(3).trim();
    else if (part.startsWith("short:")) meta.short_id = part.slice(6).trim();
    else if (part.startsWith("priority:")) meta.priority = part.slice(9).trim();
    else if (part.startsWith("tags:")) meta.tags = part.slice(5).split(",").map((t) => t.trim()).filter(Boolean);
    else if (part.startsWith("@")) meta.assigned_to = part.slice(1).trim();
  }
  return meta;
}

export function parseTodosMd(content: string): TodosMdDocument {
  const { frontmatter, body } = parseFrontmatter(content);
  const sections: Record<string, TodosMdTaskLine[]> = {};
  let current = "pending";

  for (const line of body.split("\n")) {
    const heading = line.match(/^##\s+([a-z_]+)\s*$/i);
    if (heading) {
      current = heading[1]!.toLowerCase();
      sections[current] = sections[current] ?? [];
      continue;
    }

    const item = line.match(/^-\s+\[( |x|X|-)\]\s+(.+)$/);
    if (!item) continue;

    const mark = item[1]!;
    let rest = item[2]!.trim();
    let status: TodosMdTaskLine["status"] = current as TodosMdTaskLine["status"];
    if (mark === "x" || mark === "X") status = "completed";
    if (mark === "-") status = "cancelled";

    let title = rest;
    const pipeIdx = rest.indexOf("|");
    const meta: Partial<TodosMdTaskLine> = {};
    if (pipeIdx >= 0) {
      title = rest.slice(0, pipeIdx).trim();
      Object.assign(meta, parseMetaSuffix(rest.slice(pipeIdx + 1)));
    }

    const bold = title.match(/^\*\*(.+?)\*\*\s*(.*)$/);
    if (bold) {
      meta.short_id = meta.short_id ?? bold[1]!.trim();
      title = bold[2]!.trim() || bold[1]!.trim();
    }

    const hashTags = [...title.matchAll(/#([a-z0-9_-]+)/gi)].map((m) => m[1]!);
    if (hashTags.length) {
      title = title.replace(/#([a-z0-9_-]+)/gi, "").trim();
      meta.tags = [...(meta.tags ?? []), ...hashTags];
    }

    sections[current] = sections[current] ?? [];
    sections[current]!.push({
      status,
      title,
      ...meta,
    });
  }

  return { frontmatter, sections };
}

function taskToLine(task: Task): string {
  const checked = task.status === "completed" ? "x" : task.status === "cancelled" ? "-" : " ";
  const meta: string[] = [];
  if (task.id) meta.push(`id:${task.id}`);
  if (task.short_id) meta.push(`short:${task.short_id}`);
  meta.push(`priority:${task.priority}`);
  if (task.tags?.length) meta.push(`tags:${task.tags.join(",")}`);
  if (task.assigned_to) meta.push(`@${task.assigned_to}`);
  const prefix = task.short_id ? `**${task.short_id}** ` : "";
  return `- [${checked}] ${prefix}${task.title} | ${meta.join(" | ")}`;
}

export function serializeTodosMd(doc: TodosMdDocument): string {
  const fm = doc.frontmatter;
  const lines = [
    "---",
    `todos_md_version: ${fm.todos_md_version ?? TODOS_MD_VERSION}`,
    fm.project ? `project: ${fm.project}` : null,
    fm.exported_at ? `exported_at: ${fm.exported_at}` : null,
    fm.source_path ? `source_path: ${fm.source_path}` : null,
    "---",
    "",
    "# Tasks",
    "",
  ].filter(Boolean) as string[];

  const order = ["pending", "in_progress", "blocked", "approved", "completed", "cancelled", "failed"];
  const keys = [...new Set([...order, ...Object.keys(doc.sections)])];

  for (const section of keys) {
    const tasks = doc.sections[section];
    if (!tasks?.length) continue;
    lines.push(`## ${section}`, "");
    for (const t of tasks) {
      const checked = t.status === "completed" ? "x" : t.status === "cancelled" ? "-" : " ";
      const meta: string[] = [];
      if (t.id) meta.push(`id:${t.id}`);
      if (t.short_id) meta.push(`short:${t.short_id}`);
      if (t.priority) meta.push(`priority:${t.priority}`);
      if (t.tags?.length) meta.push(`tags:${t.tags.join(",")}`);
      if (t.assigned_to) meta.push(`@${t.assigned_to}`);
      const prefix = t.short_id ? `**${t.short_id}** ` : "";
      lines.push(`- [${checked}] ${prefix}${t.title}${meta.length ? ` | ${meta.join(" | ")}` : ""}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function exportTodosMd(options: ExportTodosMdOptions = {}, db?: Database): string {
  const d = db || getDatabase();
  const filter: Record<string, unknown> = { limit: 1000 };
  if (options.project_id) filter.project_id = options.project_id;
  if (!options.include_completed) filter.status = ["pending", "in_progress", "blocked", "approved"];

  const tasks = listTasks(filter as any, d);
  const sections: Record<string, TodosMdTaskLine[]> = {};
  for (const task of tasks) {
    const section = task.status;
    sections[section] = sections[section] ?? [];
    sections[section]!.push({
      status: task.status as TodosMdTaskLine["status"],
      title: task.title,
      id: task.id,
      short_id: task.short_id ?? undefined,
      priority: task.priority,
      tags: task.tags,
      assigned_to: task.assigned_to ?? undefined,
    });
  }

  const content = serializeTodosMd({
    frontmatter: {
      todos_md_version: TODOS_MD_VERSION,
      exported_at: now(),
      source_path: options.path ?? defaultPath(),
    },
    sections,
  });

  const outPath = resolve(options.path ?? defaultPath());
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, content, "utf8");
  return content;
}

export function importTodosMd(path?: string, db?: Database): ImportTodosMdResult {
  const d = db || getDatabase();
  const filePath = resolve(path ?? defaultPath());
  if (!existsSync(filePath)) throw new Error(`todos.md not found: ${filePath}`);

  const doc = parseTodosMd(readFileSync(filePath, "utf8"));
  const result: ImportTodosMdResult = { created: 0, updated: 0, skipped: 0, errors: [] };

  for (const [section, lines] of Object.entries(doc.sections)) {
    for (const line of lines) {
      try {
        const status = (line.status || section) as TodosMdTaskLine["status"];
        if (line.id) {
          const existing = getTask(line.id, d);
          if (existing) {
            let changed = false;
            if (existing.status !== status) {
              setTaskStatus(existing.id, status, undefined, d);
              changed = true;
            }
            const refreshed = getTask(existing.id, d)!;
            if (refreshed.title !== line.title) {
              updateTask(existing.id, { title: line.title, version: refreshed.version }, d);
              changed = true;
            }
            if (changed) result.updated++;
            else result.skipped++;
            continue;
          }
        }

        createTask({
          title: line.title,
          status,
          priority: (line.priority as any) ?? "medium",
          tags: line.tags,
          assigned_to: line.assigned_to,
        }, d);
        result.created++;
      } catch (e) {
        result.errors.push(`${line.title}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return result;
}

function fileHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

let watchStop: (() => void) | null = null;

export function syncTodosMd(path?: string, db?: Database): SyncTodosMdResult {
  const filePath = resolve(path ?? defaultPath());
  const imported = existsSync(filePath) ? importTodosMd(filePath, db) : { created: 0, updated: 0, skipped: 0, errors: [] };
  exportTodosMd({ path: filePath }, db);
  return {
    path: filePath,
    imported,
    exported: true,
    hash: fileHash(filePath),
  };
}

export function startTodosMdWatch(path?: string, intervalMs = 2000, db?: Database): () => void {
  stopTodosMdWatch();
  const filePath = resolve(path ?? defaultPath());
  if (!existsSync(filePath)) exportTodosMd({ path: filePath }, db);

  let lastHash = fileHash(filePath);
  const watcher = watch(filePath, { persistent: false }, () => {
    try {
      const next = fileHash(filePath);
      if (next !== lastHash) {
        importTodosMd(filePath, db);
        lastHash = next;
      }
    } catch {
      // ignore transient read errors during save
    }
  });

  watchStop = () => watcher.close();
  return watchStop;
}

export function stopTodosMdWatch(): void {
  if (watchStop) {
    watchStop();
    watchStop = null;
  }
}

export function tasksToDocument(tasks: Task[]): TodosMdDocument {
  const sections: Record<string, TodosMdTaskLine[]> = {};
  for (const task of tasks) {
    sections[task.status] = sections[task.status] ?? [];
    sections[task.status]!.push({
      status: task.status as TodosMdTaskLine["status"],
      title: task.title,
      id: task.id,
      short_id: task.short_id ?? undefined,
      priority: task.priority,
      tags: task.tags,
      assigned_to: task.assigned_to ?? undefined,
    });
  }
  return { frontmatter: { todos_md_version: TODOS_MD_VERSION }, sections };
}

export { taskToLine };
