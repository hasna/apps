import type { HasnaStorageClient } from "@hasna/contracts/client/storage";
import {
  TASK_STATUSES,
  TASK_PRIORITIES,
  type Task,
  type PlanComment,
} from "../types/index.js";
import { redactEvidenceText } from "../lib/redaction.js";
const incomplete = () =>
  new Error(
    "REMOTE_PLAN_READ_INCOMPLETE: upgrade the Todos API for complete plan tasks and history; no artifact was written",
  );
/** Explicit versioned evidence prevents older APIs silently ignoring archived/subtask filters. */
export async function readCompletePlanTasks(
  client: HasnaStorageClient,
  planId: string,
  includeArchived = false,
): Promise<Task[]> {
  const tasks: Task[] = [];
  const ids = new Set<string>();
  let total: number | undefined;
  do {
    const raw = await client.transport.get<any>("/tasks", {
      query: {
        plan_read_contract: "1",
        plan_id: planId,
        include_subtasks: "true",
        include_archived: String(includeArchived),
        limit: 200,
        offset: tasks.length,
      },
    });
    const selection = raw?.selection;
    if (
      !raw ||
      !Array.isArray(raw.tasks) ||
      raw.count !== raw.tasks.length ||
      !Number.isSafeInteger(raw.total) ||
      raw.total < 0 ||
      raw.total > 10000 ||
      !selection ||
      selection.schema_version !== 1 ||
      selection.plan_id !== planId ||
      selection.include_subtasks !== true ||
      selection.include_archived !== includeArchived ||
      (total !== undefined && raw.total !== total)
    )
      throw incomplete();
    total = raw.total;
    if (
      tasks.length + raw.tasks.length > total! ||
      (!raw.tasks.length && tasks.length < total!)
    )
      throw incomplete();
    for (const row of raw.tasks) {
      if (
        !row ||
        typeof row.id !== "string" ||
        !row.id ||
        ids.has(row.id) ||
        row.plan_id !== planId ||
        typeof row.title !== "string" ||
        !TASK_STATUSES.includes(row.status) ||
        !TASK_PRIORITIES.includes(row.priority) ||
        (!includeArchived && row.archived_at != null)
      )
        throw incomplete();
      ids.add(row.id);
      tasks.push(row);
    }
  } while (tasks.length < total!);
  return tasks;
}
export async function readCompletePlanComments(
  client: HasnaStorageClient,
  planId: string,
): Promise<PlanComment[]> {
  const raw = await client.transport.get<any>(
    `/plans/${encodeURIComponent(planId)}/comments`,
    { query: { plan_read_contract: "1" } },
  );
  if (
    !raw ||
    !Array.isArray(raw.comments) ||
    !Number.isSafeInteger(raw.count) ||
    raw.count !== raw.comments.length ||
    raw.count > 10000 ||
    raw.history_selection?.schema_version !== 1 ||
    raw.history_selection?.plan_id !== planId ||
    raw.history_selection?.complete !== true
  )
    throw incomplete();
  const ids = new Set<string>();
  return raw.comments.map((row: any) => {
    if (
      !row ||
      typeof row.id !== "string" ||
      !row.id ||
      ids.has(row.id) ||
      row.plan_id !== planId ||
      typeof row.content !== "string" ||
      typeof row.created_at !== "string" ||
      !Number.isFinite(Date.parse(row.created_at)) ||
      !["comment", "progress", "note"].includes(row.type) ||
      (row.agent_id !== null && typeof row.agent_id !== "string") ||
      (row.session_id !== null && typeof row.session_id !== "string") ||
      (row.progress_pct !== null &&
        (typeof row.progress_pct !== "number" ||
          !Number.isFinite(row.progress_pct) ||
          row.progress_pct < 0 ||
          row.progress_pct > 100))
    )
      throw incomplete();
    ids.add(row.id);
    return { ...row, content: redactEvidenceText(row.content) };
  });
}
