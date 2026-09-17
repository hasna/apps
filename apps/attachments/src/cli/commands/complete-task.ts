import { Command } from "commander";
import { resolveStore, type Store } from "../../core/store";
import { serviceConfig, readTodosTask, requestTodosJson, todosTaskUrl, taskWriteVersion, taskMetadata, taskFromEnvelope, todoRecord } from "../../core/todos";
import { isDeepStrictEqual } from "node:util";

export interface CompleteTaskOptions {
  file?: string[];
  todosUrl?: string;
  expiry?: string;
  notes?: string;
}

export interface CompleteTaskResult {
  task_id: string;
  attachment_ids: string[];
  links: Array<string | null>;
}

/**
 * One evidence entry as persisted into the todos task metadata. This is the
 * exact shape `resolve-evidence` reads back from `metadata._evidence.attachments`,
 * so the two commands share a single contract.
 */
interface EvidenceAttachmentEntry {
  id: string;
  link: string | null;
  filename: string;
  size: number;
}

/**
 * Uploads files and completes a todos task with those attachments recorded as
 * retrievable evidence. Uses native fetch — no todos-sdk dependency required.
 *
 * Evidence is merged with an explicit write version before calling the v1
 * completion action. These are separate writes: a failure can leave uploaded
 * files or persisted evidence, so callers must reconcile before retrying.
 */
export async function completeTaskWithFiles(
  taskId: string,
  filePaths: string[],
  options: {
    todosUrl?: string;
    expiry?: string;
    notes?: string;
  },
  storeFactory: () => Store = () => resolveStore(),
  fetchFn: typeof fetch = fetch
): Promise<CompleteTaskResult> {
  const todosUrl = options.todosUrl ?? serviceConfig("TODOS").url;

  // Preflight the task and writable metadata before uploading any bytes.
  const task = await readTodosTask(taskId, todosUrl, fetchFn);
  const version = taskWriteVersion(task);
  const existingMetadata = taskMetadata(task);
  const existingEvidence = existingMetadata._evidence === undefined ? {} : todoRecord(existingMetadata._evidence, "evidence");
  if (existingEvidence.attachments !== undefined && !Array.isArray(existingEvidence.attachments)) throw new Error("Invalid Todos evidence attachments.");
  const priorAttachments = (existingEvidence.attachments as unknown[] | undefined) ?? [];
  if (task.status === "completed" || task.status === "cancelled") throw new Error("Task is already terminal; no attachments uploaded.");

  // Upload each file and collect the evidence entries.
  const attachment_ids: string[] = [];
  const links: Array<string | null> = [];
  const evidence: EvidenceAttachmentEntry[] = [];

  try {
    const store = storeFactory();
    try {
      for (const filePath of filePaths) {
        const attachment = await store.uploadFile(filePath, { expiry: options.expiry });
        attachment_ids.push(attachment.id);
        links.push(attachment.link);
        evidence.push({
          id: attachment.id,
          link: attachment.link,
          filename: attachment.filename,
          size: attachment.size,
        });
      }
    } finally {
      store.close();
    }

    const mergedMetadata: Record<string, unknown> = {
      ...existingMetadata,
      _evidence: {
        ...existingEvidence,
        attachments: [...priorAttachments, ...evidence],
        completed_at: new Date().toISOString(),
        ...(options.notes !== undefined ? { notes: options.notes } : {}),
      },
    };

    // Persist merged evidence with the observed version; never retry a conflict.
    const saved = taskFromEnvelope(await requestTodosJson(todosTaskUrl(todosUrl, task.id), task.id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version, metadata: mergedMetadata }),
    }, fetchFn));
    if (saved.id !== task.id || taskWriteVersion(saved) <= version || !isDeepStrictEqual(saved.metadata, mergedMetadata)) {
      throw new Error("Todos evidence acknowledgement does not match; reconcile before retrying.");
    }

    // Completion evidence merge behavior varies between server backends.
    // Keep this body empty so the descriptors just acknowledged remain intact.
    const completed = taskFromEnvelope(await requestTodosJson(todosTaskUrl(todosUrl, task.id, "complete"), task.id, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }, fetchFn));
    if (completed.id !== task.id || completed.status !== "completed" || taskWriteVersion(completed) <= taskWriteVersion(saved) || !isDeepStrictEqual(taskMetadata(completed)._evidence, mergedMetadata._evidence)) {
      throw new Error("Todos completion acknowledgement does not match; reconcile before retrying.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Task completion failed.";
    throw new Error(`${message} Reconcile task ${task.id} before retrying; uploaded attachment IDs: ${attachment_ids.join(", ") || "none acknowledged"}.`);
  }

  return { task_id: task.id, attachment_ids, links };
}

export function registerCompleteTask(program: Command): void {
  program
    .command("complete-task")
    .description("Upload files and complete a todos task with them as evidence")
    .argument("<task-id>", "Task ID to complete (e.g. TASK-001)")
    .requiredOption("--file <path>", "File to upload (repeatable)", (v: string, acc: string[]) => [...acc, v], [] as string[])
    .option(
      "--todos-url <url>",
      "Todos REST server base URL",
      undefined
    )
    .option("--expiry <time>", "Link expiry: e.g. 24h, 7d, never")
    .option("--notes <text>", "Completion notes to attach")
    .action(async (taskId: string, options: CompleteTaskOptions) => {
      const files = options.file ?? [];
      if (files.length === 0) {
        process.stderr.write("Error: at least one --file is required\n");
        process.exit(1);
      }

      const todosUrl = options.todosUrl ?? serviceConfig("TODOS").url;

      try {
        const result = await completeTaskWithFiles(taskId, files, {
          todosUrl,
          expiry: options.expiry,
          notes: options.notes,
        });
        process.stdout.write(
          `✓ Uploaded ${result.attachment_ids.length} file${result.attachment_ids.length === 1 ? "" : "s"} and completed task ${taskId}\n`
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Error: ${message}\n`);
        process.exit(1);
      }
    });
}
