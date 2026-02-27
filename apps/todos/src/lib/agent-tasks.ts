import { existsSync } from "node:fs";
import { join } from "node:path";
import { listTasks, getTask, createTask, updateTask } from "../db/tasks.js";
import type { Task, TaskPriority, TaskStatus } from "../types/index.js";
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
import { getAgentTasksDir } from "./config.js";
import type { SyncPrefer, SyncResult } from "./sync-types.js";

interface AgentTask {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigned_to: string;
  tags: string[];
  metadata: Record<string, unknown>;
}

function agentBaseDir(agent: string): string {
  const key = `TODOS_${agent.toUpperCase()}_TASKS_DIR`;
  return process.env[key]
    || getAgentTasksDir(agent)
    || process.env["TODOS_AGENT_TASKS_DIR"]
    || join(HOME, ".todos", "agents");
}

function getTaskListDir(agent: string, taskListId: string): string {
  return join(agentBaseDir(agent), agent, taskListId);
}

function readAgentTask(dir: string, filename: string): AgentTask | null {
  return readJsonFile<AgentTask>(join(dir, filename));
}

function writeAgentTask(dir: string, task: AgentTask): void {
  writeJsonFile(join(dir, `${task.id}.json`), task);
}

function taskToAgentTask(task: Task, externalId: string, existingMeta?: Record<string, unknown>): AgentTask {
  return {
    id: externalId,
    title: task.title,
    description: task.description || "",
    status: task.status,
    priority: task.priority,
    assigned_to: task.assigned_to || task.agent_id || "",
    tags: task.tags || [],
    metadata: {
      ...(existingMeta || {}),
      ...task.metadata,
      todos_id: task.id,
      todos_updated_at: task.updated_at,
      todos_version: task.version,
    },
  };
}

function metadataKey(agent: string): string {
  return `${agent}_task_id`;
}

export function pushToAgentTaskList(
  agent: string,
  taskListId: string,
  projectId?: string,
  options: { prefer?: SyncPrefer } = {},
): SyncResult {
  const dir = getTaskListDir(agent, taskListId);
  if (!existsSync(dir)) ensureDir(dir);

  const filter: Record<string, unknown> = {};
  if (projectId) filter["project_id"] = projectId;
  const tasks = listTasks(filter as any);

  const existingByTodosId = new Map<string, { task: AgentTask; mtimeMs: number | null }>();
  const files = listJsonFiles(dir);
  for (const f of files) {
    const path = join(dir, f);
    const at = readAgentTask(dir, f);
    if (at?.metadata?.["todos_id"]) {
      existingByTodosId.set(at.metadata["todos_id"] as string, { task: at, mtimeMs: getFileMtimeMs(path) });
    }
  }

  let hwm = readHighWaterMark(dir);
  let pushed = 0;
  const errors: string[] = [];
  const metaKey = metadataKey(agent);
  const prefer = options.prefer || "remote";

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
              agent,
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

        const updated = taskToAgentTask(task, existing.task.id, existing.task.metadata);
        writeAgentTask(dir, updated);
        if (recordConflict) {
          const latest = getTask(task.id);
          if (latest) {
            const conflict = {
              agent,
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
        const externalId = String(hwm);
        hwm++;
        const at = taskToAgentTask(task, externalId);
        writeAgentTask(dir, at);

        const current = getTask(task.id);
        if (current) {
          const newMeta = { ...current.metadata, [metaKey]: externalId };
          updateTask(task.id, { version: current.version, metadata: newMeta });
        }
      }
      pushed++;
    } catch (e) {
      errors.push(`push ${task.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  writeHighWaterMark(dir, hwm);
  return { pushed, pulled: 0, errors };
}

export function pullFromAgentTaskList(
  agent: string,
  taskListId: string,
  projectId?: string,
  options: { prefer?: SyncPrefer } = {},
): SyncResult {
  const dir = getTaskListDir(agent, taskListId);
  if (!existsSync(dir)) {
    return { pushed: 0, pulled: 0, errors: [`Task list directory not found: ${dir}`] };
  }

  const files = listJsonFiles(dir);
  let pulled = 0;
  const errors: string[] = [];
  const metaKey = metadataKey(agent);
  const prefer = options.prefer || "remote";

  const allTasks = listTasks({});
  const byExternalId = new Map<string, Task>();
  const byTodosId = new Map<string, Task>();
  for (const t of allTasks) {
    const extId = t.metadata[metaKey];
    if (extId) byExternalId.set(String(extId), t);
    byTodosId.set(t.id, t);
  }

  for (const f of files) {
    try {
      const filePath = join(dir, f);
      const at = readAgentTask(dir, f);
      if (!at) continue;
      if (at.metadata?.["_internal"]) continue;

      const todosId = at.metadata?.["todos_id"] as string | undefined;
      const existingByMapping = byExternalId.get(at.id);
      const existingByTodos = todosId ? byTodosId.get(todosId) : undefined;
      const existing = existingByMapping || existingByTodos;

      if (existing) {
        const lastSyncedAt = parseTimestamp(at.metadata?.["todos_updated_at"]);
        const localUpdatedAt = parseTimestamp(existing.updated_at);
        const remoteUpdatedAt = getFileMtimeMs(filePath);
        let conflictMeta: Record<string, unknown> | null = null;
        if (lastSyncedAt && localUpdatedAt && remoteUpdatedAt && localUpdatedAt > lastSyncedAt && remoteUpdatedAt > lastSyncedAt) {
          const conflict = {
            agent,
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

        updateTask(existing.id, {
          version: existing.version,
          title: at.title,
          description: at.description || undefined,
          status: at.status,
          priority: at.priority,
          assigned_to: at.assigned_to || undefined,
          tags: at.tags || [],
          metadata: { ...(conflictMeta || existing.metadata), ...at.metadata, [metaKey]: at.id },
        });
      } else {
        createTask({
          title: at.title,
          description: at.description || undefined,
          status: at.status,
          priority: at.priority || "medium",
          assigned_to: at.assigned_to || undefined,
          tags: at.tags || [],
          project_id: projectId,
          metadata: { ...at.metadata, [metaKey]: at.id },
        });
      }
      pulled++;
    } catch (e) {
      errors.push(`pull ${f}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { pushed: 0, pulled, errors };
}

export function syncAgentTaskList(
  agent: string,
  taskListId: string,
  projectId?: string,
  options: { prefer?: SyncPrefer } = {},
): SyncResult {
  const pullResult = pullFromAgentTaskList(agent, taskListId, projectId, options);
  const pushResult = pushToAgentTaskList(agent, taskListId, projectId, options);
  return {
    pushed: pushResult.pushed,
    pulled: pullResult.pulled,
    errors: [...pullResult.errors, ...pushResult.errors],
  };
}
