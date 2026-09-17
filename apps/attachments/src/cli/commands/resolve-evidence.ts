import { Command } from "commander";
import { resolveStore } from "../../core/store";
import { serviceConfig, readTodosTask, taskMetadata, todoRecord } from "../../core/todos";

export interface ResolveEvidenceOptions {
  todosUrl?: string;
  format?: "compact" | "json";
}

export interface EvidenceAttachmentEntry {
  id: string;
  link: string | null;
  filename: string;
  size: number;
}

export interface ResolvedAttachment {
  id: string;
  filename: string;
  link: string | null;
  size: number;
}

/**
 * Fetches a task from the todos REST API and extracts evidence attachment IDs,
 * then resolves each ID on the configured Attachments HTTPS authority.
 */
export async function resolveEvidence(
  taskId: string,
  options: {
    todosUrl?: string;
  },
  fetchFn: typeof fetch = fetch
): Promise<ResolvedAttachment[]> {
  const todosUrl = options.todosUrl ?? serviceConfig("TODOS").url;
  const task = await readTodosTask(taskId, todosUrl, fetchFn);
  const metadata = taskMetadata(task);
  const evidence = metadata._evidence === undefined ? undefined : todoRecord(metadata._evidence, "evidence");
  if (evidence?.attachments !== undefined && !Array.isArray(evidence.attachments)) throw new Error("Invalid Todos evidence attachments.");
  const attachments = evidence?.attachments as EvidenceAttachmentEntry[] | undefined;

  if (!attachments || attachments.length === 0) {
    return [];
  }

  // Resolve each attachment ID via the store to get a current link
  const store = resolveStore();
  const resolved: ResolvedAttachment[] = [];
  try {
    for (const entry of attachments) {
      if (!entry || typeof entry.id !== "string" || !entry.id.trim()) throw new Error("Invalid Todos evidence attachment identity.");
      const record = await store.get(entry.id);
      if (record) {
        resolved.push({
          id: record.id,
          filename: record.filename,
          link: record.link,
          size: record.size,
        });
      } else {
        throw new Error(`Attachment not found on the configured authority: ${entry.id}`);
      }
    }
  } finally {
    store.close();
  }

  return resolved;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function registerResolveEvidence(program: Command): void {
  program
    .command("resolve-evidence")
    .description("Resolve attachment links from a completed todos task's evidence")
    .argument("<task-id>", "Task ID (e.g. TASK-001)")
    .option(
      "--todos-url <url>",
      "Todos REST server base URL",
      undefined
    )
    .option(
      "--format <format>",
      "Output format: compact or json",
      "compact"
    )
    .action(async (taskId: string, options: ResolveEvidenceOptions) => {
      const todosUrl = options.todosUrl ?? serviceConfig("TODOS").url;
      const format = options.format ?? "compact";

      try {
        const resolved = await resolveEvidence(taskId, { todosUrl });

        if (resolved.length === 0) {
          process.stdout.write(`No attachments found in evidence for task ${taskId}\n`);
          return;
        }

        if (format === "json") {
          process.stdout.write(JSON.stringify(resolved, null, 2) + "\n");
        } else {
          for (const att of resolved) {
            const link = att.link ?? "(no link)";
            process.stdout.write(`${att.id} ${att.filename} ${link} (${formatSize(att.size)})\n`);
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`Error: ${message}\n`);
        process.exit(1);
      }
    });
}
