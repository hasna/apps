import { createHash } from "node:crypto";
import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { Task } from "../types/index.js";
import { parseGitHubUrl } from "../lib/github.js";
import { sanitizePreWriteText, sanitizePreWriteValue } from "../lib/prewrite-secrets.js";
import { getDatabase, now, uuid } from "./database.js";
import { createTask, getTask } from "./tasks.js";

export type InboxSourceType = "pasted_error" | "ci_log" | "git_context" | "github_issue" | "file" | "other";
export type InboxStatus = "new" | "triaged" | "ignored";

export interface InboxItem {
  id: string;
  task_id: string | null;
  source_type: InboxSourceType;
  source_name: string | null;
  source_url: string | null;
  title: string;
  body: string | null;
  fingerprint: string;
  status: InboxStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface InboxRow extends Omit<InboxItem, "metadata"> {
  metadata: string | null;
}

export interface CreateInboxItemInput {
  title?: string;
  body: string;
  source_type?: InboxSourceType;
  source_name?: string;
  source_url?: string;
  metadata?: Record<string, unknown>;
  project_id?: string;
  task_list_id?: string;
  priority?: Task["priority"];
  tags?: string[];
  create_task?: boolean;
  status?: InboxStatus;
}

function parseMetadata(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function rowToInboxItem(row: InboxRow): InboxItem {
  return { ...row, metadata: parseMetadata(row.metadata) };
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function fingerprintInboxInput(input: Pick<CreateInboxItemInput, "body" | "source_type" | "source_url">): string {
  const sourceType = input.source_type || detectInboxSourceType(input.body, input.source_url);
  const normalized = compactWhitespace(sanitizePreWriteText(input.body, "inbox.fingerprint")).slice(0, 8000);
  return createHash("sha256").update(`${sourceType}\n${input.source_url || ""}\n${normalized}`).digest("hex");
}

export function detectInboxSourceType(body: string, sourceUrl?: string): InboxSourceType {
  if (sourceUrl && parseGitHubUrl(sourceUrl)) return "github_issue";
  if (parseGitHubUrl(body)) return "github_issue";
  if (/^\s*(diff --git|M\s+|A\s+|D\s+|\?\?\s+)/m.test(body)) return "git_context";
  if (/\b(github actions|workflow|CI|check run|exit code|failed tests?|bun test|pytest|vitest|jest)\b/i.test(body)) return "ci_log";
  if (/\b(error|exception|traceback|stack trace|failed|panic|typeerror|referenceerror)\b/i.test(body)) return "pasted_error";
  return "other";
}

export function deriveInboxTitle(body: string, sourceType: InboxSourceType, sourceUrl?: string): string {
  const github = sourceUrl ? parseGitHubUrl(sourceUrl) : parseGitHubUrl(body);
  if (github) return `GitHub issue ${github.owner}/${github.repo}#${github.number}`;

  const lines = body.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const firstError = lines.find(line => /\b(error|exception|failed|traceback|panic|typeerror|referenceerror)\b/i.test(line));
  const firstUseful = firstError || lines[0] || "Inbox intake";
  const prefix = sourceType === "ci_log" ? "CI failure" : sourceType === "git_context" ? "Git context" : sourceType === "pasted_error" ? "Failure" : "Inbox";
  return `${prefix}: ${compactWhitespace(firstUseful).slice(0, 90)}`;
}

function redactedMetadata(value: Record<string, unknown>): Record<string, unknown> {
  return sanitizePreWriteValue(value, "inbox.metadata");
}

export function createInboxItem(input: CreateInboxItemInput, db?: Database): { item: InboxItem; task: Task | null; duplicate: boolean } {
  const d = db || getDatabase();
  const body = sanitizePreWriteText(input.body, "inbox.body");
  const sourceType = input.source_type || detectInboxSourceType(body, input.source_url);
  const title = sanitizePreWriteText(input.title || deriveInboxTitle(body, sourceType, input.source_url), "inbox.title");
  const fingerprint = fingerprintInboxInput({ body, source_type: sourceType, source_url: input.source_url });
  const existing = d.query("SELECT * FROM inbox_items WHERE fingerprint = ?").get(fingerprint) as InboxRow | null;
  if (existing) {
    const item = rowToInboxItem(existing);
    return { item, task: item.task_id ? getTask(item.task_id, d) : null, duplicate: true };
  }

  const timestamp = now();
  let task: Task | null = null;
  const metadata = {
    ...(input.metadata || {}),
    github: input.source_url ? parseGitHubUrl(input.source_url) : parseGitHubUrl(body),
    intake_source_type: sourceType,
  };

  if (input.create_task !== false) {
    task = createTask({
      title,
      description: [
        `**Inbox source:** ${sourceType}`,
        input.source_name ? `**Source name:** ${sanitizePreWriteText(input.source_name, "inbox.source_name")}` : null,
        input.source_url ? `**Source URL:** ${sanitizePreWriteText(input.source_url, "inbox.source_url")}` : null,
        `**Captured context:**\n\`\`\`\n${body.slice(0, 4000)}\n\`\`\``,
      ].filter(Boolean).join("\n\n"),
      priority: input.priority || (sourceType === "ci_log" ? "high" : "medium"),
      tags: Array.from(new Set(["inbox", sourceType, ...(input.tags || [])])).slice(0, 10),
      metadata: redactedMetadata(metadata),
      project_id: input.project_id,
      task_list_id: input.task_list_id,
      status: "pending",
    }, d);
  }

  const id = uuid();
  d.run(
    "INSERT INTO inbox_items (id, task_id, source_type, source_name, source_url, title, body, fingerprint, status, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      task?.id ?? null,
      sourceType,
      input.source_name ? sanitizePreWriteText(input.source_name, "inbox.source_name") : null,
      input.source_url ? sanitizePreWriteText(input.source_url, "inbox.source_url") : null,
      title,
      body,
      fingerprint,
      input.status || "triaged",
      JSON.stringify(redactedMetadata(metadata)),
      timestamp,
      timestamp,
    ],
  );

  return { item: getInboxItem(id, d)!, task, duplicate: false };
}

export function getInboxItem(id: string, db?: Database): InboxItem | null {
  const d = db || getDatabase();
  const row = d.query("SELECT * FROM inbox_items WHERE id = ? OR id LIKE ?").get(id, `${id}%`) as InboxRow | null;
  return row ? rowToInboxItem(row) : null;
}

export function listInboxItems(opts?: { status?: InboxStatus; source_type?: InboxSourceType; limit?: number }, db?: Database): InboxItem[] {
  const d = db || getDatabase();
  const where: string[] = [];
  const params: SQLQueryBindings[] = [];
  if (opts?.status) { where.push("status = ?"); params.push(opts.status); }
  if (opts?.source_type) { where.push("source_type = ?"); params.push(opts.source_type); }
  const limit = Math.max(1, Math.min(opts?.limit || 50, 200));
  const sql = `SELECT * FROM inbox_items${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC LIMIT ?`;
  return (d.query(sql).all(...params, limit) as InboxRow[]).map(rowToInboxItem);
}
