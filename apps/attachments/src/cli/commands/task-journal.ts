import { Command } from "commander";
import type { Attachment } from "../../core/db";
import { resolveStore, type Store } from "../../core/store";
import { serviceConfig, readTodosTask, requestTodosJson, todosTaskUrl, todoRecord } from "../../core/todos";

export interface TaskJournalOptions {
  todosUrl?: string;
  format?: "markdown" | "compact" | "json";
}

export interface TaskHistoryEntry {
  timestamp: string;
  action: string;
  actor?: string;
  details?: string;
  progress?: number;
}

export interface TaskMeta {
  id: string;
  subject?: string;
  status?: string;
  assignee?: string;
  created_at?: string;
}

export interface TaskJournal {
  task: TaskMeta;
  history: TaskHistoryEntry[];
  attachments: Attachment[];
}

/** Fetch the current hosted task envelope; failures never become partial data. */
export async function fetchTaskMeta(
  taskId: string,
  todosUrl: string,
  fetchFn: typeof fetch = fetch
): Promise<TaskMeta> {
  const task = await readTodosTask(taskId, todosUrl, fetchFn);
  return {
    id: task.id,
    subject: typeof task.title === "string" ? task.title : task.id,
    status: typeof task.status === "string" ? task.status : undefined,
    assignee: typeof task.assigned_to === "string" ? task.assigned_to : undefined,
    created_at: typeof task.created_at === "string" ? task.created_at : undefined,
  };
}

/** Only an acknowledged empty history is an empty result. */
export async function fetchTaskHistory(
  taskId: string,
  todosUrl: string,
  fetchFn: typeof fetch = fetch
): Promise<TaskHistoryEntry[]> {
  const data = await requestTodosJson(todosTaskUrl(todosUrl, taskId, "history"), taskId, {}, fetchFn);
  if (!Array.isArray(data.history) || data.count !== data.history.length) throw new Error("Invalid Todos history response.");
  return data.history.map((value: unknown) => {
    const entry = todoRecord(value, "history entry");
    if (typeof entry.created_at !== "string" || !entry.created_at || typeof entry.action !== "string" || !entry.action) {
      throw new Error("Invalid Todos history entry.");
    }
    return {
      timestamp: entry.created_at,
      action: entry.action,
      actor: typeof entry.agent_id === "string" ? entry.agent_id : undefined,
      details: typeof entry.field === "string" ? `${entry.field}: ${entry.old_value ?? ""} → ${entry.new_value ?? ""}` : undefined,
      progress: undefined,
    };
  });
}

/**
 * Query the HTTPS service for attachments associated with a task.
 * Checks tag = "task:TASK-ID" format.
 */
export function findTaskAttachments(
  taskId: string,
  store: Store
): Promise<Attachment[]> {
  const tag = `task:${taskId}`;
  return store.list({ tag, includeExpired: true });
}

/**
 * Build the full task journal by aggregating todos history + remote attachments.
 */
export async function buildTaskJournal(
  taskId: string,
  options: {
    todosUrl?: string;
    dbPath?: string;
  },
  fetchFn: typeof fetch = fetch,
  storeFactory?: () => Store
): Promise<{ journal: TaskJournal; todosReachable: boolean }> {
  const todosUrl = options.todosUrl ?? (await serviceConfig("TODOS")).url;

  // Resolve short references once, then use the canonical identity throughout.
  const task = await fetchTaskMeta(taskId, todosUrl, fetchFn);
  const history = await fetchTaskHistory(task.id, todosUrl, fetchFn);

  // Query the configured Attachments HTTPS authority only after Todos succeeds.
  const store = storeFactory ? storeFactory() : resolveStore();
  let attachments: Attachment[] = [];
  try {
    attachments = await findTaskAttachments(task.id, store);
  } finally {
    store.close();
  }

  return {
    journal: { task, history, attachments },
    todosReachable: true,
  };
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}

function formatTimestamp(ts: string): string {
  if (!ts) return "??:??";
  try {
    const d = new Date(ts);
    return d.toISOString().slice(11, 16); // HH:MM
  } catch {
    return ts.slice(0, 5);
  }
}

function formatExpiry(expiresAt: number | null): string {
  if (!expiresAt) return "no expiry";
  return `expires: ${new Date(expiresAt).toISOString().slice(0, 10)}`;
}

export function formatMarkdown(journal: TaskJournal, todosReachable: boolean): string {
  const { task, history, attachments } = journal;

  const title = task.subject ?? task.id;
  const lines: string[] = [];

  lines.push(`# Task Journal: ${task.id} — ${title}`);

  const metaParts: string[] = [];
  if (task.status) metaParts.push(`Status: ${task.status}`);
  if (task.assignee) metaParts.push(`Assigned: ${task.assignee}`);
  if (task.created_at) metaParts.push(`Created: ${task.created_at.slice(0, 10)}`);
  if (metaParts.length > 0) lines.push(metaParts.join(" | "));

  if (!todosReachable) {
    lines.push("\n> Note: todos server unreachable — history unavailable");
  }

  lines.push("\n## History");
  if (history.length === 0) {
    lines.push("_(no history available)_");
  } else {
    for (const entry of history) {
      const time = formatTimestamp(entry.timestamp);
      let line = `${time} [${entry.action}]`;
      if (entry.actor) line += ` ${entry.actor}`;
      if (entry.details) line += ` ${entry.details}`;
      if (entry.progress !== undefined) line += ` (${entry.progress}%)`;
      lines.push(line);
    }
  }

  lines.push("\n## Attachments");
  if (attachments.length === 0) {
    lines.push("_(no attachments found)_");
  } else {
    for (const att of attachments) {
      const link = att.link ?? "(no link)";
      const expiry = formatExpiry(att.expiresAt);
      lines.push(`${att.id}  ${att.filename}  ${formatSize(att.size)}  ${link}  (${expiry})`);
    }
  }

  return lines.join("\n");
}

export function formatCompact(journal: TaskJournal, todosReachable: boolean): string {
  const { task, history, attachments } = journal;
  const lines: string[] = [];

  const title = task.subject ?? task.id;
  lines.push(`[${task.id}] ${title}${task.status ? ` (${task.status})` : ""}`);

  if (!todosReachable) lines.push("  todos: unreachable");

  for (const entry of history) {
    const time = formatTimestamp(entry.timestamp);
    let line = `  ${time} ${entry.action}`;
    if (entry.actor) line += ` by ${entry.actor}`;
    lines.push(line);
  }

  for (const att of attachments) {
    lines.push(`  att: ${att.id} ${att.filename} ${formatSize(att.size)}`);
  }

  return lines.join("\n");
}

export function formatJson(journal: TaskJournal): string {
  return JSON.stringify(journal, null, 2);
}

// ---------------------------------------------------------------------------
// CLI registration
// ---------------------------------------------------------------------------

export function registerTaskJournal(program: Command): void {
  program
    .command("task-journal")
    .description("Show full story of a task: history from todos + remote attachments")
    .argument("<task-id>", "Task ID (e.g. TASK-001)")
    .option(
      "--todos-url <url>",
      "Todos REST server base URL",
      undefined
    )
    .option(
      "--format <format>",
      "Output format: markdown, compact, json",
      "markdown"
    )
    .action(async (taskId: string, options: TaskJournalOptions) => {
      const todosUrl = options.todosUrl ?? (await serviceConfig("TODOS")).url;
      const format = options.format ?? "markdown";

      try {
        const { journal, todosReachable } = await buildTaskJournal(taskId, { todosUrl });

        let output: string;
        if (format === "json") {
          output = formatJson(journal);
        } else if (format === "compact") {
          output = formatCompact(journal, todosReachable);
        } else {
          output = formatMarkdown(journal, todosReachable);
        }

        process.stdout.write(output + "\n");
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Error: ${message}\n`);
        process.exit(1);
      }
    });
}
