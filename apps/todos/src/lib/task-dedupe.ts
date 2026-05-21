import type { Database } from "bun:sqlite";
import type { Task } from "../types/index.js";
import { logTaskChange } from "../db/audit.js";
import { getDatabase, now } from "../db/database.js";
import { addTaskRelationship } from "../db/task-relationships.js";
import { getTask, listTasks, updateTask } from "../db/tasks.js";

export interface FindDuplicateTasksOptions {
  threshold?: number;
  limit?: number;
  include_archived?: boolean;
}

export interface DuplicateTaskCandidate {
  primary_task: Task;
  duplicate_task: Task;
  score: number;
  reasons: string[];
}

export interface MergeDuplicateTaskInput {
  primary_task_id: string;
  duplicate_task_id: string;
  agent_id?: string;
  reason?: string;
}

export interface TaskMergeMovedCounts {
  comments: number;
  dependencies: number;
  dependents: number;
  runs: number;
  run_events: number;
  run_commands: number;
  run_artifacts: number;
  files: number;
  inbox_items: number;
  verifications: number;
  history: number;
  relationships: number;
  git_refs: number;
  commits: number;
  checklists: number;
}

export interface TaskMergeResult {
  primary_task: Task;
  archived_duplicate: Task;
  relationship_id: string;
  moved: TaskMergeMovedCounts;
}

interface TaskFingerprint {
  task: Task;
  title: string;
  body: string;
  text: string;
  tokens: Set<string>;
  sourceKeys: Set<string>;
  stackKeys: Set<string>;
}

const DEFAULT_THRESHOLD = 0.74;
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "with",
]);

const GITHUB_ISSUE_RE = /https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/(?:issues|pull)\/(\d+)/gi;
const URL_RE = /https?:\/\/[^\s)\]]+/gi;
const STACK_FRAME_RE = /\bat\s+([^\s(]+)(?:\s+\(([^)]+)\)|\s+([^\s]+))?/i;
const PY_STACK_RE = /File\s+"([^"]+)",\s+line\s+\d+,\s+in\s+([^\s]+)/i;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function normalizeText(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[`"'()[\]{}.,:;!?/#\\_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): Set<string> {
  const tokens = new Set<string>();
  for (const token of normalizeText(value).split(" ")) {
    if (token.length < 3 || STOP_WORDS.has(token)) continue;
    tokens.add(token);
  }
  return tokens;
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/[.,;:)\]]+$/g, "").replace(/\/+$/g, "").toLowerCase();
}

function addSourceKeys(keys: Set<string>, value: unknown): void {
  const raw = asString(value);
  if (!raw) return;

  const githubMatches = raw.matchAll(GITHUB_ISSUE_RE);
  for (const match of githubMatches) {
    keys.add(`github:${match[1]!.toLowerCase()}/${match[2]!.toLowerCase()}#${match[3]}`);
  }

  const urls = raw.match(URL_RE) || [];
  for (const url of urls) keys.add(`url:${normalizeUrl(url)}`);

  if (raw.startsWith("github:")) keys.add(raw.toLowerCase());
}

function sourceKeysFor(task: Task): Set<string> {
  const keys = new Set<string>();
  const metadata = asObject(task.metadata);
  for (const key of [
    "github_url",
    "github_issue_url",
    "github_pr_url",
    "source_url",
    "url",
    "external_url",
    "issue_url",
  ]) {
    addSourceKeys(keys, metadata[key]);
  }
  if (metadata["github_owner"] && metadata["github_repo"] && metadata["github_number"]) {
    const owner = asString(metadata["github_owner"]);
    const repo = asString(metadata["github_repo"]);
    const number = asString(metadata["github_number"]);
    if (owner && repo && number) keys.add(`github:${owner.toLowerCase()}/${repo.toLowerCase()}#${number}`);
  }
  addSourceKeys(keys, `${task.title}\n${task.description || ""}`);
  return keys;
}

function stackKeysFor(task: Task): Set<string> {
  const keys = new Set<string>();
  const lines = `${task.title}\n${task.description || ""}`.split(/\r?\n/);
  let errorLine: string | null = null;
  const frames: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!errorLine && /^[A-Z][A-Za-z0-9_]*(Error|Exception|Failure)?:/.test(line)) {
      errorLine = normalizeText(line).slice(0, 120);
    }
    const jsFrame = line.match(STACK_FRAME_RE);
    if (jsFrame) {
      const fn = normalizeText(jsFrame[1]);
      const loc = normalizeStackLocation(jsFrame[2] || jsFrame[3] || "");
      if (fn || loc) frames.push(`${fn}@${loc}`);
      continue;
    }
    const pyFrame = line.match(PY_STACK_RE);
    if (pyFrame) {
      frames.push(`${normalizeText(pyFrame[2])}@${normalizeStackLocation(pyFrame[1] || "")}`);
    }
  }

  if (frames.length > 0) {
    const frameKey = frames.slice(0, 4).join("|");
    keys.add(`stack:${errorLine || "error"}:${frameKey}`);
  }
  return keys;
}

function normalizeStackLocation(value: string): string {
  return value
    .replace(/:\d+(?::\d+)?/g, "")
    .replace(/^file:\/\//, "")
    .toLowerCase()
    .trim();
}

function fingerprint(task: Task): TaskFingerprint {
  const body = task.description || "";
  const text = `${task.title}\n${body}`;
  return {
    task,
    title: normalizeText(task.title),
    body: normalizeText(body),
    text: normalizeText(text),
    tokens: tokenize(text),
    sourceKeys: sourceKeysFor(task),
    stackKeys: stackKeysFor(task),
  };
}

function intersects(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) if (right.has(value)) return true;
  return false;
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection++;
  return intersection / (left.size + right.size - intersection);
}

function scorePair(left: TaskFingerprint, right: TaskFingerprint): { score: number; reasons: string[] } {
  const scores: number[] = [];
  const reasons: string[] = [];

  if (intersects(left.sourceKeys, right.sourceKeys)) {
    scores.push(1);
    reasons.push("matching source or imported issue URL");
  }
  if (intersects(left.stackKeys, right.stackKeys)) {
    scores.push(0.92);
    reasons.push("matching stack trace signature");
  }
  if (left.title && left.title === right.title) {
    scores.push(0.88);
    reasons.push("exact normalized title match");
  }

  const tokenScore = jaccard(left.tokens, right.tokens);
  if (tokenScore >= 0.5) {
    scores.push(tokenScore);
    reasons.push(`similar task text (${tokenScore.toFixed(2)})`);
  }

  const score = scores.length > 0 ? Math.max(...scores) : tokenScore;
  return { score: Number(score.toFixed(3)), reasons };
}

function olderFirst(left: Task, right: Task): [Task, Task] {
  if (left.created_at < right.created_at) return [left, right];
  if (right.created_at < left.created_at) return [right, left];
  return left.id < right.id ? [left, right] : [right, left];
}

export function findDuplicateTasks(options: FindDuplicateTasksOptions = {}, db?: Database): DuplicateTaskCandidate[] {
  const d = db || getDatabase();
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const fingerprints = listTasks({
    include_archived: Boolean(options.include_archived),
    limit: options.limit ?? 1000,
  }, d).map(fingerprint);
  const candidates: DuplicateTaskCandidate[] = [];

  for (let i = 0; i < fingerprints.length; i++) {
    for (let j = i + 1; j < fingerprints.length; j++) {
      const left = fingerprints[i]!;
      const right = fingerprints[j]!;
      const { score, reasons } = scorePair(left, right);
      if (score < threshold || reasons.length === 0) continue;
      const [primary, duplicate] = olderFirst(left.task, right.task);
      candidates.push({ primary_task: primary, duplicate_task: duplicate, score, reasons });
    }
  }

  return candidates.sort((a, b) => b.score - a.score || a.primary_task.created_at.localeCompare(b.primary_task.created_at) || a.duplicate_task.id.localeCompare(b.duplicate_task.id));
}

function updateRows(db: Database, table: string, column: string, fromId: string, toId: string): number {
  const row = db.query(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`).get(fromId) as { count: number };
  db.run(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ?`, [toId, fromId]);
  return row.count;
}

function insertDependency(db: Database, taskId: string, dependsOn: string): boolean {
  if (taskId === dependsOn) return false;
  const existing = db.query("SELECT task_id FROM task_dependencies WHERE task_id = ? AND depends_on = ?").get(taskId, dependsOn) as { task_id: string } | null;
  if (existing) return false;
  db.run(
    "INSERT OR IGNORE INTO task_dependencies (task_id, depends_on) VALUES (?, ?)",
    [taskId, dependsOn],
  );
  return true;
}

function moveDependencies(db: Database, primaryId: string, duplicateId: string): { dependencies: number; dependents: number } {
  let dependencies = 0;
  let dependents = 0;

  const deps = db.query("SELECT depends_on FROM task_dependencies WHERE task_id = ?").all(duplicateId) as { depends_on: string }[];
  for (const dep of deps) {
    if (insertDependency(db, primaryId, dep.depends_on)) dependencies++;
  }
  db.run("DELETE FROM task_dependencies WHERE task_id = ?", [duplicateId]);

  const blockers = db.query("SELECT task_id FROM task_dependencies WHERE depends_on = ?").all(duplicateId) as { task_id: string }[];
  for (const blocker of blockers) {
    if (insertDependency(db, blocker.task_id, primaryId)) dependents++;
  }
  db.run("DELETE FROM task_dependencies WHERE depends_on = ?", [duplicateId]);

  return { dependencies, dependents };
}

function moveFiles(db: Database, primaryId: string, duplicateId: string): number {
  const rows = db.query("SELECT * FROM task_files WHERE task_id = ? ORDER BY path").all(duplicateId) as Array<{
    id: string;
    path: string;
    status: string;
    agent_id: string | null;
    note: string | null;
  }>;
  let moved = 0;
  for (const row of rows) {
    const existing = db.query("SELECT id, note FROM task_files WHERE task_id = ? AND path = ?").get(primaryId, row.path) as { id: string; note: string | null } | null;
    if (existing) {
      const note = [existing.note, row.note].filter(Boolean).join("\n");
      db.run(
        "UPDATE task_files SET status = ?, agent_id = COALESCE(?, agent_id), note = ?, updated_at = ? WHERE id = ?",
        [row.status, row.agent_id, note || null, now(), existing.id],
      );
      db.run("DELETE FROM task_files WHERE id = ?", [row.id]);
    } else {
      db.run("UPDATE task_files SET task_id = ?, updated_at = ? WHERE id = ?", [primaryId, now(), row.id]);
    }
    moved++;
  }
  return moved;
}

function moveRelationships(db: Database, primaryId: string, duplicateId: string): number {
  const rows = db.query("SELECT * FROM task_relationships WHERE source_task_id = ? OR target_task_id = ?").all(duplicateId, duplicateId) as Array<{
    id: string;
    source_task_id: string;
    target_task_id: string;
    relationship_type: string;
    metadata: string | null;
    created_by: string | null;
  }>;
  let moved = 0;
  for (const row of rows) {
    const source = row.source_task_id === duplicateId ? primaryId : row.source_task_id;
    const target = row.target_task_id === duplicateId ? primaryId : row.target_task_id;
    if (source === target) {
      db.run("DELETE FROM task_relationships WHERE id = ?", [row.id]);
      continue;
    }
    const existing = db.query(
      "SELECT id FROM task_relationships WHERE source_task_id = ? AND target_task_id = ? AND relationship_type = ?",
    ).get(source, target, row.relationship_type) as { id: string } | null;
    if (existing) {
      db.run("DELETE FROM task_relationships WHERE id = ?", [row.id]);
      continue;
    }
    db.run("UPDATE task_relationships SET source_task_id = ?, target_task_id = ? WHERE id = ?", [source, target, row.id]);
    moved++;
  }
  return moved;
}

function moveGitRefs(db: Database, primaryId: string, duplicateId: string): number {
  const rows = db.query("SELECT id, ref_type, name FROM task_git_refs WHERE task_id = ?").all(duplicateId) as Array<{ id: string; ref_type: string; name: string }>;
  let moved = 0;
  for (const row of rows) {
    const exists = db.query("SELECT id FROM task_git_refs WHERE task_id = ? AND ref_type = ? AND name = ?").get(primaryId, row.ref_type, row.name) as { id: string } | null;
    if (exists) continue;
    db.run("UPDATE task_git_refs SET task_id = ?, updated_at = ? WHERE id = ?", [primaryId, now(), row.id]);
    moved++;
  }
  return moved;
}

function moveChecklists(db: Database, primaryId: string, duplicateId: string): number {
  const max = db.query("SELECT COALESCE(MAX(position), -1) AS position FROM task_checklists WHERE task_id = ?").get(primaryId) as { position: number };
  const rows = db.query("SELECT id, position FROM task_checklists WHERE task_id = ? ORDER BY position, created_at").all(duplicateId) as Array<{ id: string; position: number }>;
  let moved = 0;
  for (const [index, row] of rows.entries()) {
    db.run("UPDATE task_checklists SET task_id = ?, position = ?, updated_at = ? WHERE id = ?", [primaryId, max.position + index + 1, now(), row.id]);
    moved++;
  }
  return moved;
}

function countMovedStandaloneVerifications(db: Database, duplicateId: string): number {
  const runCommands = db.query("SELECT command FROM task_run_commands WHERE task_id = ?").all(duplicateId) as { command: string }[];
  const generatedCommands = new Set(runCommands.map((row) => row.command));
  const rows = db.query("SELECT command FROM task_verifications WHERE task_id = ?").all(duplicateId) as { command: string }[];
  return rows.filter((row) => !generatedCommands.has(row.command)).length;
}

function mergeTaskMetadata(primary: Task, duplicate: Task, input: MergeDuplicateTaskInput, mergedAt: string): Record<string, unknown> {
  const mergedDuplicates = Array.isArray(primary.metadata["merged_duplicates"])
    ? [...primary.metadata["merged_duplicates"] as unknown[]]
    : [];
  mergedDuplicates.push({
    id: duplicate.id,
    title: duplicate.title,
    status: duplicate.status,
    merged_at: mergedAt,
    merged_by: input.agent_id || null,
    reason: input.reason || null,
  });
  return {
    ...primary.metadata,
    merged_duplicates: mergedDuplicates,
  };
}

function mergeTaskDescription(primary: Task, duplicate: Task): string | null {
  if (!duplicate.description) return primary.description;
  if (!primary.description) return duplicate.description;
  if (primary.description.includes(duplicate.description)) return primary.description;
  return `${primary.description}\n\nMerged duplicate context from ${duplicate.short_id || duplicate.id.slice(0, 8)}:\n${duplicate.description}`;
}

export function mergeDuplicateTask(input: MergeDuplicateTaskInput, db?: Database): TaskMergeResult {
  const d = db || getDatabase();
  if (input.primary_task_id === input.duplicate_task_id) {
    throw new Error("Cannot merge a task into itself");
  }

  const tx = d.transaction(() => {
    const primary = getTask(input.primary_task_id, d);
    const duplicate = getTask(input.duplicate_task_id, d);
    if (!primary) throw new Error(`Primary task not found: ${input.primary_task_id}`);
    if (!duplicate) throw new Error(`Duplicate task not found: ${input.duplicate_task_id}`);

    const mergedAt = now();
    const moved: TaskMergeMovedCounts = {
      comments: 0,
      dependencies: 0,
      dependents: 0,
      runs: 0,
      run_events: 0,
      run_commands: 0,
      run_artifacts: 0,
      files: 0,
      inbox_items: 0,
      verifications: 0,
      history: 0,
      relationships: 0,
      git_refs: 0,
      commits: 0,
      checklists: 0,
    };

    const mergedTags = [...new Set([...primary.tags, ...duplicate.tags, "merged-duplicate"])];
    updateTask(primary.id, {
      version: primary.version,
      tags: mergedTags,
      metadata: mergeTaskMetadata(primary, duplicate, input, mergedAt),
      description: mergeTaskDescription(primary, duplicate) ?? undefined,
    }, d);

    moved.comments = updateRows(d, "task_comments", "task_id", duplicate.id, primary.id);
    const depCounts = moveDependencies(d, primary.id, duplicate.id);
    moved.dependencies = depCounts.dependencies;
    moved.dependents = depCounts.dependents;
    moved.files = moveFiles(d, primary.id, duplicate.id);
    moved.checklists = moveChecklists(d, primary.id, duplicate.id);
    moved.inbox_items = updateRows(d, "inbox_items", "task_id", duplicate.id, primary.id);
    const standaloneVerifications = countMovedStandaloneVerifications(d, duplicate.id);
    moved.runs = updateRows(d, "task_runs", "task_id", duplicate.id, primary.id);
    moved.run_events = updateRows(d, "task_run_events", "task_id", duplicate.id, primary.id);
    moved.run_commands = updateRows(d, "task_run_commands", "task_id", duplicate.id, primary.id);
    moved.run_artifacts = updateRows(d, "task_run_artifacts", "task_id", duplicate.id, primary.id);
    moved.verifications = standaloneVerifications;
    updateRows(d, "task_verifications", "task_id", duplicate.id, primary.id);
    moved.history = updateRows(d, "task_history", "task_id", duplicate.id, primary.id);
    moved.relationships = moveRelationships(d, primary.id, duplicate.id);
    moved.git_refs = moveGitRefs(d, primary.id, duplicate.id);
    moved.commits = updateRows(d, "task_commits", "task_id", duplicate.id, primary.id);

    const relationship = addTaskRelationship({
      source_task_id: primary.id,
      target_task_id: duplicate.id,
      relationship_type: "duplicates",
      metadata: {
        merged_at: mergedAt,
        merged_by: input.agent_id || null,
        reason: input.reason || null,
      },
      created_by: input.agent_id,
    }, d);

    const duplicateTags = [...new Set([...duplicate.tags, "duplicate", "merged"])];
    updateTask(duplicate.id, {
      version: getTask(duplicate.id, d)!.version,
      status: "cancelled",
      tags: duplicateTags,
      metadata: {
        ...duplicate.metadata,
        merged_into: primary.id,
        merged_at: mergedAt,
        merged_by: input.agent_id || null,
        merge_reason: input.reason || null,
      },
    }, d);
    d.run("UPDATE tasks SET archived_at = ?, updated_at = ? WHERE id = ?", [mergedAt, mergedAt, duplicate.id]);

    logTaskChange(primary.id, "merge_duplicate", "duplicate_task_id", null, duplicate.id, input.agent_id || null, d);
    logTaskChange(duplicate.id, "merged_into", "primary_task_id", null, primary.id, input.agent_id || null, d);

    return {
      primary_task: getTask(primary.id, d)!,
      archived_duplicate: getTask(duplicate.id, d)!,
      relationship_id: relationship.id,
      moved,
    };
  });

  return tx();
}
