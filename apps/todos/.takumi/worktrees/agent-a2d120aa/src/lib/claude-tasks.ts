import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listTasks, getTask, createTask, updateTask } from "../db/tasks.js";
import type { Task, TaskStatus } from "../types/index.js";
import type { SyncPrefer, SyncResult } from "./sync-types.js";
import { getTaskPrefixConfig } from "./config.js";
import {
  HOME,
  appendSyncConflict,
  ensureDir,
  getFileMtimeMs,
  listJsonFiles,
  parseTimestamp,
  readHighWaterMark,
  readJsonFile,
  writeHighWaterMark,
  writeJsonFile,
} from "./sync-utils.js";

interface ClaudeTask {
  id: string;
  subject: string;
  description: string;
  activeForm: string;
  status: "pending" | "in_progress" | "completed";
  owner: string;
  blocks: string[];
  blockedBy: string[];
  metadata: Record<string, unknown>;
}

function getTaskListDir(taskListId: string): string {
  return join(HOME, ".claude", "tasks", taskListId);
}

function readClaudeTask(dir: string, filename: string): ClaudeTask | null {
  return readJsonFile<ClaudeTask>(join(dir, filename));
}

function writeClaudeTask(dir: string, task: ClaudeTask): void {
  writeJsonFile(join(dir, `${task.id}.json`), task);
}

function toClaudeStatus(status: TaskStatus): ClaudeTask["status"] {
  if (status === "pending" || status === "in_progress" || status === "completed") {
    return status;
  }
  // failed and cancelled map to completed
  return "completed";
}

function toSqliteStatus(status: ClaudeTask["status"]): TaskStatus {
  return status;
}

function readPrefixCounter(dir: string): number {
  const path = join(dir, ".prefix-counter");
  if (!existsSync(path)) return 0;
  const val = parseInt(readFileSync(path, "utf-8").trim(), 10);
  return isNaN(val) ? 0 : val;
}

function writePrefixCounter(dir: string, value: number): void {
  writeFileSync(join(dir, ".prefix-counter"), String(value));
}

function formatPrefixedSubject(title: string, prefix: string, counter: number): string {
  const padded = String(counter).padStart(5, "0");
  return `${prefix}-${padded}: ${title}`;
}

function taskToClaudeTask(task: Task, claudeTaskId: string, existingMeta?: Record<string, unknown>): ClaudeTask {
  return {
    id: claudeTaskId,
    subject: task.title,
    description: task.description || "",
    activeForm: "",
    status: toClaudeStatus(task.status),
    owner: task.assigned_to || task.agent_id || "",
    blocks: [],
    blockedBy: [],
    metadata: {
      ...(existingMeta || {}),
      todos_id: task.id,
      priority: task.priority,
      todos_updated_at: task.updated_at,
      todos_version: task.version,
    },
  };
}


/**
 * Push all SQLite tasks to a Claude Code task list directory.
 */
export function pushToClaudeTaskList(
  taskListId: string,
  projectId?: string,
  options: { prefer?: SyncPrefer } = {},
): SyncResult {
  const dir = getTaskListDir(taskListId);
  if (!existsSync(dir)) ensureDir(dir);

  const filter: Record<string, unknown> = {};
  if (projectId) filter["project_id"] = projectId;
  const tasks = listTasks(filter as any);

  // Build map of existing Claude tasks by todos_id
  const existingByTodosId = new Map<string, { task: ClaudeTask; mtimeMs: number | null }>();
  const files = listJsonFiles(dir);
  for (const f of files) {
    const path = join(dir, f);
    const ct = readClaudeTask(dir, f);
    if (ct?.metadata?.["todos_id"]) {
      existingByTodosId.set(ct.metadata["todos_id"] as string, { task: ct, mtimeMs: getFileMtimeMs(path) });
    }
  }

  let hwm = readHighWaterMark(dir);
  let pushed = 0;
  const errors: string[] = [];
  const prefer = options.prefer || "remote";

  // Task prefix support
  const prefixConfig = getTaskPrefixConfig();
  let prefixCounter = prefixConfig ? readPrefixCounter(dir) : 0;
  if (prefixConfig?.start_from && prefixCounter < prefixConfig.start_from) {
    prefixCounter = prefixConfig.start_from - 1;
  }

  for (const task of tasks) {
    try {
      const existing = existingByTodosId.get(task.id);
      if (existing) {
        const lastSyncedAt = parseTimestamp(existing.task.metadata?.["todos_updated_at"]);
        const localUpdatedAt = parseTimestamp(task.updated_at);
        const remoteUpdatedAt = existing.mtimeMs;
        let recordConflict = false;
        if (lastSyncedAt && localUpdatedAt && remoteUpdatedAt && localUpdatedAt > lastSyncedAt && remoteUpdatedAt > lastSyncedAt) {
          if (prefer === "remote") {
            const conflict = {
              agent: "claude",
              direction: "push" as const,
              prefer,
              local_updated_at: task.updated_at,
              remote_updated_at: new Date(remoteUpdatedAt).toISOString(),
              detected_at: new Date().toISOString(),
            };
            const newMeta = appendSyncConflict(task.metadata, conflict);
            updateTask(task.id, { version: task.version, metadata: newMeta });
            errors.push(`conflict push ${task.id}: remote newer`);
            continue;
          }
          recordConflict = true;
        }

        // Update existing Claude task
        const updated = taskToClaudeTask(task, existing.task.id, existing.task.metadata);
        updated.blocks = existing.task.blocks;
        updated.blockedBy = existing.task.blockedBy;
        updated.activeForm = existing.task.activeForm;
        writeClaudeTask(dir, updated);
        if (recordConflict) {
          const latest = getTask(task.id);
          if (latest) {
            const conflict = {
              agent: "claude",
              direction: "push" as const,
              prefer,
              local_updated_at: latest.updated_at,
              remote_updated_at: remoteUpdatedAt ? new Date(remoteUpdatedAt).toISOString() : undefined,
              detected_at: new Date().toISOString(),
            };
            const newMeta = appendSyncConflict(latest.metadata, conflict);
            updateTask(latest.id, { version: latest.version, metadata: newMeta });
          }
        }
      } else {
        // Create new Claude task
        const claudeId = String(hwm);
        hwm++;
        const ct = taskToClaudeTask(task, claudeId);

        // Apply task prefix if configured
        if (prefixConfig) {
          prefixCounter++;
          ct.subject = formatPrefixedSubject(task.title, prefixConfig.prefix, prefixCounter);
        }

        writeClaudeTask(dir, ct);

        // Store the mapping in SQLite metadata
        const current = getTask(task.id);
        if (current) {
          const newMeta = { ...current.metadata, claude_task_id: claudeId };
          updateTask(task.id, { version: current.version, metadata: newMeta });
        }
      }
      pushed++;
    } catch (e) {
      errors.push(`push ${task.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  writeHighWaterMark(dir, hwm);
  if (prefixConfig) writePrefixCounter(dir, prefixCounter);
  return { pushed, pulled: 0, errors };
}

/**
 * Pull tasks from a Claude Code task list into SQLite.
 */
export function pullFromClaudeTaskList(
  taskListId: string,
  projectId?: string,
  options: { prefer?: SyncPrefer } = {},
): SyncResult {
  const dir = getTaskListDir(taskListId);
  if (!existsSync(dir)) {
    return { pushed: 0, pulled: 0, errors: [`Task list directory not found: ${dir}`] };
  }

  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  let pulled = 0;
  const errors: string[] = [];
  const prefer = options.prefer || "remote";

  // Search ALL tasks globally for matching — don't filter by project
  // so we never create duplicates across projects
  const allTasks = listTasks({});
  const byClaudeId = new Map<string, Task>();
  for (const t of allTasks) {
    const cid = t.metadata["claude_task_id"];
    if (cid) byClaudeId.set(String(cid), t);
  }
  const byTodosId = new Map<string, Task>();
  for (const t of allTasks) {
    byTodosId.set(t.id, t);
  }

  for (const f of files) {
    try {
      const filePath = join(dir, f);
      const ct = readClaudeTask(dir, f);
      if (!ct) continue;

      // Skip internal tasks
      if (ct.metadata?.["_internal"]) continue;

      const todosId = ct.metadata?.["todos_id"] as string | undefined;
      const existingByMapping = byClaudeId.get(ct.id);
      const existingByTodos = todosId ? byTodosId.get(todosId) : undefined;
      const existing = existingByMapping || existingByTodos;

      if (existing) {
        const lastSyncedAt = parseTimestamp(ct.metadata?.["todos_updated_at"]);
        const localUpdatedAt = parseTimestamp(existing.updated_at);
        const remoteUpdatedAt = getFileMtimeMs(filePath);
        let conflictMeta: Record<string, unknown> | null = null;
        if (lastSyncedAt && localUpdatedAt && remoteUpdatedAt && localUpdatedAt > lastSyncedAt && remoteUpdatedAt > lastSyncedAt) {
          const conflict = {
            agent: "claude",
            direction: "pull" as const,
            prefer,
            local_updated_at: existing.updated_at,
            remote_updated_at: new Date(remoteUpdatedAt).toISOString(),
            detected_at: new Date().toISOString(),
          };
          conflictMeta = appendSyncConflict(existing.metadata, conflict);
          if (prefer === "local") {
            updateTask(existing.id, { version: existing.version, metadata: conflictMeta });
            errors.push(`conflict pull ${existing.id}: local newer`);
            continue;
          }
        }

        // Update existing SQLite task
        updateTask(existing.id, {
          version: existing.version,
          title: ct.subject,
          description: ct.description || undefined,
          status: toSqliteStatus(ct.status),
          assigned_to: ct.owner || undefined,
          metadata: { ...(conflictMeta || existing.metadata), claude_task_id: ct.id, ...ct.metadata },
        });
      } else {
        // Create new SQLite task
        createTask({
          title: ct.subject,
          description: ct.description || undefined,
          status: toSqliteStatus(ct.status),
          assigned_to: ct.owner || undefined,
          project_id: projectId,
          metadata: { ...ct.metadata, claude_task_id: ct.id },
          priority: (ct.metadata?.["priority"] as any) || "medium",
        });
      }
      pulled++;
    } catch (e) {
      errors.push(`pull ${f}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { pushed: 0, pulled, errors };
}

/**
 * Bidirectional sync: pull first, then push.
 */
export function syncClaudeTaskList(
  taskListId: string,
  projectId?: string,
  options: { prefer?: SyncPrefer } = {},
): SyncResult {
  const pullResult = pullFromClaudeTaskList(taskListId, projectId, options);
  const pushResult = pushToClaudeTaskList(taskListId, projectId, options);
  return {
    pushed: pushResult.pushed,
    pulled: pullResult.pulled,
    errors: [...pullResult.errors, ...pushResult.errors],
  };
}
