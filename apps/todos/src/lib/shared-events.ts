import { EventsClient } from "@hasna/events";
import type { EventSeverity } from "@hasna/events";
import type { Task } from "../types/index.js";

const SOURCE = "todos";

export type TodosSharedEventType =
  | "task.created"
  | "task.started"
  | "task.completed"
  | "task.failed"
  | "task.assigned"
  | "task.status_changed"
  | "task.unblocked";

export function taskEventData(task: Task, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: task.id,
    task_id: task.id,
    short_id: task.short_id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    project_id: task.project_id,
    parent_id: task.parent_id,
    plan_id: task.plan_id,
    task_list_id: task.task_list_id,
    agent_id: task.agent_id,
    assigned_to: task.assigned_to,
    session_id: task.session_id,
    working_dir: task.working_dir,
    tags: task.tags,
    metadata: task.metadata,
    version: task.version,
    created_at: task.created_at,
    updated_at: task.updated_at,
    started_at: task.started_at,
    completed_at: task.completed_at,
    due_at: task.due_at,
    ...extra,
  };
}

export async function emitSharedTaskEvent(input: {
  type: TodosSharedEventType;
  task: Task;
  data?: Record<string, unknown>;
  message?: string;
  severity?: EventSeverity;
  dedupeKey?: string;
}): Promise<void> {
  const data = taskEventData(input.task, input.data);
  await new EventsClient().emit(
    {
      source: SOURCE,
      type: input.type,
      subject: input.task.id,
      severity: input.severity ?? "info",
      message: input.message ?? `${input.type}: ${input.task.title}`,
      data,
      dedupeKey: input.dedupeKey ?? `${input.type}:${input.task.id}:${input.task.version}`,
      metadata: {
        package: "@hasna/todos",
        task_id: input.task.id,
        project_id: input.task.project_id,
        task_list_id: input.task.task_list_id,
      },
    },
    { deliver: true, dedupe: true },
  );
}

export function emitSharedTaskEventQuiet(input: Parameters<typeof emitSharedTaskEvent>[0]): void {
  emitSharedTaskEvent(input).catch(() => undefined);
}
