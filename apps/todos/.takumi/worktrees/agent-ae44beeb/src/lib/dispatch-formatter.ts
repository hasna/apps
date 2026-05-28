import type { Task, TaskPriority } from "../types/index.ts";

const DESCRIPTION_MAX = 200;

const PRIORITY_BADGE: Record<TaskPriority, string> = {
  critical: "[CRITICAL]",
  high: "[HIGH]",
  medium: "[MEDIUM]",
  low: "[LOW]",
};

export interface FormatOpts {
  /** Include task description (truncated to 200 chars). Default: true */
  includeDescription?: boolean;
  /** Include priority badge. Default: true */
  includePriority?: boolean;
  /** Include tags. Default: false */
  includeTags?: boolean;
  /** Heading override for task list dispatches */
  listName?: string;
}

/**
 * Format a single task into a compact one-liner.
 * e.g. "[HIGH] APP-00001: Fix the login bug"
 */
export function formatSingleTask(task: Task, opts: FormatOpts = {}): string {
  const { includePriority = true, includeDescription = true, includeTags = false } = opts;
  const lines: string[] = [];

  const badge = includePriority ? `${PRIORITY_BADGE[task.priority]} ` : "";
  const id = task.short_id ? `${task.short_id}: ` : "";
  lines.push(`${badge}${id}${task.title}`);

  if (includeDescription && task.description) {
    const desc =
      task.description.length > DESCRIPTION_MAX
        ? task.description.slice(0, DESCRIPTION_MAX) + "…"
        : task.description;
    lines.push(`  ${desc}`);
  }

  if (includeTags && task.tags.length > 0) {
    lines.push(`  tags: ${task.tags.join(", ")}`);
  }

  return lines.join("\n");
}

/**
 * Format multiple tasks into a numbered list with optional header.
 */
export function formatDispatchMessage(tasks: Task[], opts: FormatOpts = {}): string {
  if (tasks.length === 0) return "(no tasks)";

  if (tasks.length === 1) {
    const header = opts.listName ? `── ${opts.listName} ──\n` : "";
    return header + formatSingleTask(tasks[0]!, opts);
  }

  const lines: string[] = [];

  if (opts.listName) {
    lines.push(`── ${opts.listName} (${tasks.length} tasks) ──`);
    lines.push("");
  }

  tasks.forEach((task, i) => {
    const { includePriority = true, includeDescription = true, includeTags = false } = opts;
    const badge = includePriority ? `${PRIORITY_BADGE[task.priority]} ` : "";
    const id = task.short_id ? `${task.short_id}: ` : "";
    lines.push(`${i + 1}. ${badge}${id}${task.title}`);

    if (includeDescription && task.description) {
      const desc =
        task.description.length > DESCRIPTION_MAX
          ? task.description.slice(0, DESCRIPTION_MAX) + "…"
          : task.description;
      lines.push(`   ${desc}`);
    }

    if (includeTags && task.tags.length > 0) {
      lines.push(`   tags: ${task.tags.join(", ")}`);
    }
  });

  return lines.join("\n");
}
