/**
 * Local duplicate detection and merge workflows for tasks.
 */

import type { Database } from "bun:sqlite";
import { getDatabase, now } from "../db/database.js";
import { getTask, listTasks, updateTask, deleteTask, type Task } from "../db/tasks.js";
import { setTaskStatus } from "../db/task-status.js";
import { logTaskChange } from "../db/audit.js";
import { addTaskRelationship } from "../db/task-relationships.js";
import { getTaskCommits } from "../db/task-commits.js";
import { getTaskLabels, assignLabelToTask } from "../db/labels.js";
import { addTaskFile } from "../db/task-files.js";

export const DEDUPE_SCHEMA_VERSION = "todos.dedupe.v1";

export interface DuplicateSignal {
  type: "title" | "description" | "files" | "commits" | "external_ref" | "metadata";
  score: number;
  detail: string;
}

export interface DuplicateCandidate {
  task_a_id: string;
  task_b_id: string;
  score: number;
  signals: DuplicateSignal[];
}

export interface FindDuplicatesFilter {
  project_id?: string;
  task_id?: string;
  min_score?: number;
  limit?: number;
}

export interface MergeTasksInput {
  primary_id: string;
  secondary_id: string;
  agent_id?: string;
  delete_secondary?: boolean;
  dry_run?: boolean;
}

export interface MergeTasksResult {
  primary_id: string;
  secondary_id: string;
  merged: string[];
  dry_run: boolean;
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\[[^\]]+\]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenSet(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function getExternalRef(task: Task): string | null {
  const meta = task.metadata ?? {};
  const ref = meta.external_id ?? meta.external_ref ?? meta.source_id;
  return ref ? String(ref) : null;
}

function loadTaskPairs(filter: FindDuplicatesFilter, db: Database): Task[][] {
  if (filter.task_id) {
    const anchor = getTask(filter.task_id, db);
    if (!anchor) return [];
    const others = listTasks({ limit: 500 }, db).filter(
      (t) => t.id !== anchor.id && !["cancelled", "archived"].includes(t.status),
    );
    return others.map((other) => [anchor, other]);
  }

  const tasks = listTasks({ limit: 500 }, db).filter(
    (t) => !["cancelled", "archived"].includes(t.status),
  );
  if (filter.project_id) {
    const scoped = tasks.filter((t) => t.project_id === filter.project_id);
    const pairs: Task[][] = [];
    for (let i = 0; i < scoped.length; i++) {
      for (let j = i + 1; j < scoped.length; j++) pairs.push([scoped[i]!, scoped[j]!]);
    }
    return pairs;
  }

  const pairs: Task[][] = [];
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) pairs.push([tasks[i]!, tasks[j]!]);
  }
  return pairs;
}

function sharedFiles(taskA: string, taskB: string, db: Database): string[] {
  const rows = db.query(
    `SELECT a.path FROM task_files a
     JOIN task_files b ON a.path = b.path
     WHERE a.task_id = ? AND b.task_id = ? AND a.status != 'removed' AND b.status != 'removed'`,
  ).all(taskA, taskB) as { path: string }[];
  return rows.map((r) => r.path);
}

function sharedCommits(taskA: string, taskB: string, db: Database): string[] {
  const a = new Set(getTaskCommits(taskA, db).map((c) => c.sha));
  const b = getTaskCommits(taskB, db).map((c) => c.sha);
  return b.filter((sha) => a.has(sha));
}

export function scoreDuplicatePair(taskA: Task, taskB: Task, db?: Database): DuplicateCandidate | null {
  const d = db || getDatabase();
  const signals: DuplicateSignal[] = [];

  const normA = normalizeTitle(taskA.title);
  const normB = normalizeTitle(taskB.title);
  if (normA && normA === normB) {
    signals.push({ type: "title", score: 1, detail: `Exact normalized title: ${normA}` });
  } else if (normA && normB) {
    const sim = jaccard(tokenSet(normA), tokenSet(normB));
    if (sim >= 0.8) signals.push({ type: "title", score: sim * 0.9, detail: `Title similarity ${(sim * 100).toFixed(0)}%` });
  }

  const descA = taskA.description || "";
  const descB = taskB.description || "";
  if (descA && descB) {
    const sim = jaccard(tokenSet(descA), tokenSet(descB));
    if (sim >= 0.6) signals.push({ type: "description", score: sim * 0.7, detail: `Description similarity ${(sim * 100).toFixed(0)}%` });
  }

  const files = sharedFiles(taskA.id, taskB.id, d);
  if (files.length > 0) {
    signals.push({ type: "files", score: Math.min(0.85, 0.4 + files.length * 0.1), detail: `Shared files: ${files.slice(0, 5).join(", ")}` });
  }

  const commits = sharedCommits(taskA.id, taskB.id, d);
  if (commits.length > 0) {
    signals.push({ type: "commits", score: 0.95, detail: `Shared commits: ${commits.map((s) => s.slice(0, 7)).join(", ")}` });
  }

  const refA = getExternalRef(taskA);
  const refB = getExternalRef(taskB);
  if (refA && refB && refA === refB) {
    signals.push({ type: "external_ref", score: 1, detail: `External ref: ${refA}` });
  }

  if (!signals.length) return null;

  const score = Math.min(1, signals.reduce((sum, s) => sum + s.score, 0) / signals.length + (signals.length > 1 ? 0.1 : 0));
  return { task_a_id: taskA.id, task_b_id: taskB.id, score, signals };
}

export function findDuplicateCandidates(filter: FindDuplicatesFilter = {}, db?: Database): DuplicateCandidate[] {
  const d = db || getDatabase();
  const minScore = filter.min_score ?? 0.65;
  const limit = filter.limit ?? 50;

  const results: DuplicateCandidate[] = [];
  for (const [a, b] of loadTaskPairs(filter, d)) {
    const scored = scoreDuplicatePair(a, b, d);
    if (scored && scored.score >= minScore) results.push(scored);
  }

  return results.sort((x, y) => y.score - x.score).slice(0, limit);
}

export function mergeTasks(input: MergeTasksInput, db?: Database): MergeTasksResult {
  const d = db || getDatabase();
  const primary = getTask(input.primary_id, d);
  const secondary = getTask(input.secondary_id, d);
  if (!primary || !secondary) throw new Error("Primary or secondary task not found");
  if (primary.id === secondary.id) throw new Error("Cannot merge a task with itself");

  const merged: string[] = [];

  if (input.dry_run) {
    return {
      primary_id: primary.id,
      secondary_id: secondary.id,
      merged: ["comments", "commits", "files", "tags", "labels", "dependencies", "history", "relationships"],
      dry_run: true,
    };
  }

  const tx = d.transaction(() => {
    // Comments
    const comments = d.run(
      "UPDATE task_comments SET task_id = ? WHERE task_id = ?",
      [primary.id, secondary.id],
    );
    if (comments.changes) merged.push(`comments:${comments.changes}`);

    // Commits
    const commits = d.run(
      "UPDATE task_commits SET task_id = ? WHERE task_id = ?",
      [primary.id, secondary.id],
    );
    if (commits.changes) merged.push(`commits:${commits.changes}`);

    // Files (skip conflicts)
    const secFiles = d.query("SELECT path, status, agent_id, note FROM task_files WHERE task_id = ?").all(secondary.id) as Array<{ path: string; status: string; agent_id: string | null; note: string | null }>;
    for (const f of secFiles) {
      const exists = d.query("SELECT id FROM task_files WHERE task_id = ? AND path = ?").get(primary.id, f.path);
      if (!exists) {
        addTaskFile({
          task_id: primary.id,
          path: f.path,
          status: f.status as "planned" | "active" | "modified" | "reviewed" | "removed",
          agent_id: f.agent_id ?? undefined,
          note: f.note ?? undefined,
        }, d);
        merged.push(`file:${f.path}`);
      }
    }

    // Tags union
    const secTags = d.query("SELECT tag FROM task_tags WHERE task_id = ?").all(secondary.id) as { tag: string }[];
    for (const { tag } of secTags) {
      d.run("INSERT OR IGNORE INTO task_tags (task_id, tag) VALUES (?, ?)", [primary.id, tag]);
    }
    if (secTags.length) merged.push(`tags:${secTags.length}`);

    // Labels
    for (const label of getTaskLabels(secondary.id, d)) {
      assignLabelToTask(primary.id, label.id, d);
    }

    // Dependencies
    d.run("UPDATE OR IGNORE task_dependencies SET task_id = ? WHERE task_id = ?", [primary.id, secondary.id]);
    d.run("UPDATE OR IGNORE task_dependencies SET depends_on = ? WHERE depends_on = ?", [primary.id, secondary.id]);

    // Subtasks
    d.run("UPDATE tasks SET parent_id = ? WHERE parent_id = ?", [primary.id, secondary.id]);

    // Merge description if primary empty
    if (!primary.description && secondary.description) {
      updateTask(primary.id, { description: secondary.description, version: primary.version }, d);
      merged.push("description");
    }

    addTaskRelationship({
      source_task_id: primary.id,
      target_task_id: secondary.id,
      relationship_type: "duplicates",
      metadata: { merged_at: now(), schema_version: DEDUPE_SCHEMA_VERSION },
    }, d);

    logTaskChange(primary.id, "merge", "secondary_task", secondary.id, primary.id, input.agent_id ?? null, d);
    logTaskChange(secondary.id, "merged_into", "primary_task", secondary.id, primary.id, input.agent_id ?? null, d);

    if (input.delete_secondary) {
      deleteTask(secondary.id, d);
      merged.push("deleted_secondary");
    } else {
      setTaskStatus(secondary.id, "cancelled", input.agent_id, d);
      d.run("UPDATE tasks SET description = ?, updated_at = ? WHERE id = ?", [
        `${secondary.description || ""}\n\n[Merged into ${primary.id}]`.trim(),
        now(),
        secondary.id,
      ]);
      merged.push("cancelled_secondary");
    }
  });

  tx();
  return { primary_id: primary.id, secondary_id: secondary.id, merged, dry_run: false };
}

export function formatDuplicatePreview(candidates: DuplicateCandidate[], db?: Database): string {
  const d = db || getDatabase();
  return candidates.map((c) => {
    const a = getTask(c.task_a_id, d);
    const b = getTask(c.task_b_id, d);
    const lines = [
      `Score ${(c.score * 100).toFixed(0)}% — ${a?.title ?? c.task_a_id} ↔ ${b?.title ?? c.task_b_id}`,
      ...c.signals.map((s) => `  • ${s.type}: ${s.detail}`),
    ];
    return lines.join("\n");
  }).join("\n\n");
}
