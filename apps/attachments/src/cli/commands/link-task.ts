import { Command } from "commander";
import { resolveStore } from "../../core/store";
import { serviceConfig, readTodosTask, requestTodosJson, todosTaskUrl, taskWriteVersion, taskMetadata, taskFromEnvelope } from "../../core/todos";
import { isDeepStrictEqual } from "node:util";

export interface LinkTaskOptions {
  todosUrl?: string;
}

export interface AttachmentMetaEntry {
  id: string;
  link: string | null;
  filename: string;
  size: number;
}

/**
 * Calls the todos REST API to patch task metadata with attachment info.
 * Uses native fetch — no todos-sdk dependency required.
 */
export async function linkAttachmentToTask(
  attachmentId: string,
  taskId: string,
  todosUrl: string,
  fetchFn: typeof fetch = fetch
): Promise<void> {
  const store = resolveStore();
  let att: Awaited<ReturnType<typeof store.get>>;
  try {
    att = await store.get(attachmentId);
  } finally {
    store.close();
  }

  if (!att) {
    throw new Error(`Attachment not found: ${attachmentId}`);
  }

  const entry: AttachmentMetaEntry = {
    id: att.id,
    link: att.link,
    filename: att.filename,
    size: att.size,
  };

  const task = await readTodosTask(taskId, todosUrl, fetchFn);
  const version = taskWriteVersion(task);
  const metadata = taskMetadata(task);
  if (metadata._attachments !== undefined && !Array.isArray(metadata._attachments)) throw new Error("Invalid Todos attachment metadata.");
  const prior = (metadata._attachments as unknown[] | undefined) ?? [];
  // Re-linking one attachment replaces only that entry; it never drops siblings.
  const merged = { ...metadata, _attachments: [...prior.filter(item => !(item && typeof item === "object" && "id" in item && item.id === entry.id)), entry] };
  const result = await requestTodosJson(todosTaskUrl(todosUrl, task.id), task.id, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version, metadata: merged }),
  }, fetchFn);
  const saved = taskFromEnvelope(result);
  if (saved.id !== task.id || taskWriteVersion(saved) <= version || !isDeepStrictEqual(saved.metadata, merged)) {
    throw new Error("Todos attachment write acknowledgement does not match; reconcile before retrying.");
  }
}

export function registerLinkTask(program: Command): void {
  program
    .command("link-task")
    .description("Link an attachment to a todos task")
    .argument("<attachment-id>", "Attachment ID (att_xxx)")
    .argument("<task-id>", "Task ID (e.g. TASK-001)")
    .option(
      "--todos-url <url>",
      "Todos REST server base URL",
      undefined
    )
    .action(async (attachmentId: string, taskId: string, options: LinkTaskOptions) => {
      const todosUrl = options.todosUrl ?? (await serviceConfig("TODOS")).url;

      try {
        await linkAttachmentToTask(attachmentId, taskId, todosUrl);
        process.stdout.write(`✓ Linked ${attachmentId} → task ${taskId}\n`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Error: ${message}\n`);
        process.exit(1);
      }
    });
}
