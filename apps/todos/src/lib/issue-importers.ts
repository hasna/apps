/**
 * Local external issue importers — GitHub, Linear, and Jira JSON exports.
 * No hosted API or connector auth required.
 */

import { existsSync, readFileSync } from "node:fs";
import type { Database } from "bun:sqlite";
import { getDatabase, now } from "../db/database.js";
import { createTask, listTasks, type Task } from "../db/tasks.js";
import type { CreateTaskInput, TaskPriority } from "../types/index.js";
import { findDuplicateCandidates } from "./task-dedupe.js";

export const ISSUE_IMPORT_SCHEMA = "todos.issue_import.v1";

export const ISSUE_SOURCES = ["github", "linear", "jira", "auto"] as const;
export type IssueSource = (typeof ISSUE_SOURCES)[number];
export type ResolvedIssueSource = Exclude<IssueSource, "auto">;

export interface NormalizedExternalIssue {
  source: ResolvedIssueSource;
  external_ref: string;
  external_id: string;
  title: string;
  description?: string;
  status?: string;
  priority: TaskPriority;
  tags: string[];
  url?: string;
  raw_metadata: Record<string, unknown>;
}

export interface IssueImportInput {
  file_path?: string;
  json?: string;
  source?: IssueSource;
  project_id?: string;
  task_list_id?: string;
  agent_id?: string;
  tags?: string[];
}

export interface IssueImportPreviewItem {
  external_ref: string;
  external_id: string;
  title: string;
  duplicate_of: { task_id: string; short_id: string | null; title: string; score: number } | null;
  create_task_input: CreateTaskInput;
}

export interface IssueImportPreview {
  schema_version: typeof ISSUE_IMPORT_SCHEMA;
  source: ResolvedIssueSource;
  file_path?: string;
  issue_count: number;
  duplicate_count: number;
  new_count: number;
  issues: IssueImportPreviewItem[];
}

export interface IssueImportOptions {
  dry_run?: boolean;
  skip_dedupe?: boolean;
  force?: boolean;
}

export interface IssueImportResult {
  schema_version: typeof ISSUE_IMPORT_SCHEMA;
  dry_run: boolean;
  source: ResolvedIssueSource;
  created: Task[];
  skipped_duplicates: Array<{ external_ref: string; task_id: string; title: string }>;
  errors: string[];
}

const GITHUB_LABEL_PRIORITY: Record<string, TaskPriority> = {
  critical: "critical",
  "priority:critical": "critical",
  high: "high",
  "priority:high": "high",
  urgent: "high",
  low: "low",
  "priority:low": "low",
};

const JIRA_PRIORITY: Record<string, TaskPriority> = {
  highest: "critical",
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
  lowest: "low",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function labelNames(labels: unknown): string[] {
  if (!Array.isArray(labels)) return [];
  return labels
    .map((label) => {
      if (typeof label === "string") return label;
      const rec = asRecord(label);
      return typeof rec?.name === "string" ? rec.name : null;
    })
    .filter((name): name is string => !!name);
}

function priorityFromLabels(labels: string[]): TaskPriority {
  for (const label of labels) {
    const mapped = GITHUB_LABEL_PRIORITY[label.toLowerCase()];
    if (mapped) return mapped;
  }
  return "medium";
}

function priorityFromLinear(value: unknown): TaskPriority {
  if (typeof value !== "number") return "medium";
  if (value <= 1) return "critical";
  if (value === 2) return "high";
  if (value === 3) return "medium";
  if (value >= 4) return "low";
  return "medium";
}

function priorityFromJira(value: unknown): TaskPriority {
  const rec = asRecord(value);
  const name = typeof rec?.name === "string" ? rec.name.toLowerCase() : "";
  return JIRA_PRIORITY[name] ?? "medium";
}

function parseGitHubRepoFromUrl(url: string): string | null {
  const match = url.match(/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/);
  return match ? `${match[1]}#${match[2]}` : null;
}

function normalizeGitHubIssue(raw: Record<string, unknown>): NormalizedExternalIssue | null {
  const number = typeof raw.number === "number" ? raw.number : null;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!number || !title) return null;

  const url =
    (typeof raw.html_url === "string" && raw.html_url) ||
    (typeof raw.url === "string" && raw.url.includes("github.com") ? raw.url : undefined);
  const repoRef = url ? parseGitHubRepoFromUrl(url) : null;
  const external_id = String(number);
  const external_ref = repoRef ? `github:${repoRef}` : `github:#${number}`;
  const labels = labelNames(raw.labels);
  const state = typeof raw.state === "string" ? raw.state : undefined;

  return {
    source: "github",
    external_ref,
    external_id,
    title: `[GH#${number}] ${title}`,
    description: typeof raw.body === "string" ? raw.body.slice(0, 8000) : undefined,
    status: state,
    priority: priorityFromLabels(labels),
    tags: [...labels.slice(0, 10), "github-import"],
    url,
    raw_metadata: {
      github_number: number,
      github_state: state,
      github_labels: labels,
      github_url: url,
    },
  };
}

function normalizeLinearIssue(raw: Record<string, unknown>): NormalizedExternalIssue | null {
  const identifier = typeof raw.identifier === "string" ? raw.identifier.trim() : "";
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!identifier || !title) return null;

  const stateRec = asRecord(raw.state);
  const state = typeof raw.state === "string" ? raw.state : typeof stateRec?.name === "string" ? stateRec.name : undefined;
  const url = typeof raw.url === "string" ? raw.url : undefined;
  const labelSource = asRecord(raw.labels);
  const labels = labelNames(Array.isArray(labelSource?.nodes) ? labelSource.nodes : raw.labels);

  return {
    source: "linear",
    external_ref: `linear:${identifier}`,
    external_id: identifier,
    title: `[${identifier}] ${title}`,
    description: typeof raw.description === "string" ? raw.description.slice(0, 8000) : undefined,
    status: state,
    priority: priorityFromLinear(raw.priority),
    tags: [...labels.slice(0, 10), "linear-import"],
    url,
    raw_metadata: {
      linear_identifier: identifier,
      linear_id: raw.id,
      linear_state: state,
      linear_priority: raw.priority,
      linear_url: url,
    },
  };
}

function normalizeJiraIssue(raw: Record<string, unknown>): NormalizedExternalIssue | null {
  const key = typeof raw.key === "string" ? raw.key.trim() : "";
  const fields = asRecord(raw.fields);
  if (!key || !fields) return null;

  const summary = typeof fields.summary === "string" ? fields.summary.trim() : "";
  if (!summary) return null;

  const statusRec = asRecord(fields.status);
  const status = typeof statusRec?.name === "string" ? statusRec.name : undefined;
  const labels = labelNames(fields.labels);
  const description =
    typeof fields.description === "string"
      ? fields.description.slice(0, 8000)
      : typeof asRecord(fields.description)?.content === "string"
        ? String(asRecord(fields.description)?.content).slice(0, 8000)
        : undefined;

  return {
    source: "jira",
    external_ref: `jira:${key}`,
    external_id: key,
    title: `[${key}] ${summary}`,
    description,
    status,
    priority: priorityFromJira(fields.priority),
    tags: [...labels.slice(0, 10), "jira-import"],
    url: typeof raw.self === "string" ? raw.self : undefined,
    raw_metadata: {
      jira_key: key,
      jira_status: status,
      jira_priority: asRecord(fields.priority)?.name,
      jira_id: raw.id,
    },
  };
}

function looksLikeJiraIssue(raw: Record<string, unknown>): boolean {
  return typeof raw.key === "string" && !!asRecord(raw.fields)?.summary;
}

function looksLikeLinearIssue(raw: Record<string, unknown>): boolean {
  if (typeof raw.identifier !== "string") return false;
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(raw.identifier)) return false;
  return (
    typeof raw.teamId === "string" ||
    typeof raw.team === "object" ||
    typeof raw.priority === "number" ||
    (typeof raw.url === "string" && raw.url.includes("linear.app"))
  );
}

function looksLikeGitHubIssue(raw: Record<string, unknown>): boolean {
  return (
    typeof raw.number === "number" &&
    typeof raw.title === "string" &&
    (typeof raw.html_url === "string" ||
      (typeof raw.url === "string" && raw.url.includes("github.com/issues/")) ||
      Array.isArray(raw.labels))
  );
}

export function detectIssueExportSource(data: unknown): ResolvedIssueSource {
  const items = extractIssueRecords(data);
  if (items.length === 0) throw new Error("No issues found in export JSON");

  const first = items[0]!;
  if (looksLikeJiraIssue(first)) return "jira";
  if (looksLikeLinearIssue(first)) return "linear";
  if (looksLikeGitHubIssue(first)) return "github";

  throw new Error("Unable to detect issue export source (expected GitHub, Linear, or Jira JSON)");
}

function extractIssueRecords(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.map(asRecord).filter((item): item is Record<string, unknown> => !!item);
  }

  const root = asRecord(data);
  if (!root) return [];

  const dataNode = asRecord(root.data);
  const issuesNode = asRecord(root.issues);
  const nestedIssues = asRecord(dataNode?.issues);
  const nodes = nestedIssues?.nodes ?? issuesNode?.nodes ?? root.issues ?? dataNode?.issues;

  if (Array.isArray(nodes)) {
    return nodes.map(asRecord).filter((item): item is Record<string, unknown> => !!item);
  }

  if (looksLikeGitHubIssue(root) || looksLikeLinearIssue(root) || looksLikeJiraIssue(root)) {
    return [root];
  }

  return [];
}

export function parseIssueExport(data: unknown, source: IssueSource = "auto"): NormalizedExternalIssue[] {
  const resolved = source === "auto" ? detectIssueExportSource(data) : source;
  const records = extractIssueRecords(data);
  if (records.length === 0) throw new Error("No issues found in export JSON");

  const normalized: NormalizedExternalIssue[] = [];
  for (const record of records) {
    let issue: NormalizedExternalIssue | null = null;
    if (resolved === "github") issue = normalizeGitHubIssue(record);
    else if (resolved === "linear") issue = normalizeLinearIssue(record);
    else issue = normalizeJiraIssue(record);
    if (issue) normalized.push(issue);
  }

  if (normalized.length === 0) {
    throw new Error(`No valid ${resolved} issues found in export JSON`);
  }

  return normalized;
}

export function loadIssueExportFromFile(path: string): unknown {
  if (!existsSync(path)) throw new Error(`File not found: ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function loadIssueExportInput(input: IssueImportInput): { data: unknown; file_path?: string } {
  if (input.file_path) {
    return { data: loadIssueExportFromFile(input.file_path), file_path: input.file_path };
  }
  if (input.json) {
    return { data: JSON.parse(input.json) as unknown };
  }
  throw new Error("Provide file_path or json");
}

function findIssueDuplicate(
  createInput: CreateTaskInput,
  db: Database,
): IssueImportPreviewItem["duplicate_of"] {
  const externalRef = createInput.metadata?.external_ref;
  const externalId = createInput.metadata?.external_id;
  const tasks = listTasks({ limit: 1000 }, db).filter(
    (t) => !["cancelled", "archived", "completed"].includes(t.status),
  );

  for (const task of tasks) {
    const meta = task.metadata ?? {};
    if (externalRef && meta.external_ref === externalRef) {
      return { task_id: task.id, short_id: task.short_id, title: task.title, score: 1 };
    }
    if (externalId && meta.external_id === externalId) {
      return { task_id: task.id, short_id: task.short_id, title: task.title, score: 1 };
    }
  }

  const candidates = findDuplicateCandidates({ threshold: 0.85, limit: 5 }, db);
  for (const candidate of candidates) {
    const other = candidate.primary_task;
    if (!other) continue;
    if (other.title.toLowerCase() === createInput.title.toLowerCase()) {
      return { task_id: other.id, short_id: other.short_id, title: other.title, score: candidate.score };
    }
  }

  return null;
}

function issueToCreateTaskInput(
  issue: NormalizedExternalIssue,
  input: IssueImportInput,
): CreateTaskInput {
  const tags = [...new Set([...(input.tags ?? []), ...issue.tags, issue.source])].slice(0, 15);
  return {
    title: issue.title,
    description: issue.description,
    project_id: input.project_id,
    task_list_id: input.task_list_id,
    agent_id: input.agent_id,
    priority: issue.priority,
    tags,
    status: "pending",
    metadata: {
      ...issue.raw_metadata,
      import_source: issue.source,
      external_ref: issue.external_ref,
      external_id: issue.external_id,
      external_url: issue.url,
      external_status: issue.status,
      imported_at: now(),
    },
  };
}

export function previewIssueImport(input: IssueImportInput, db?: Database): IssueImportPreview {
  const d = db || getDatabase();
  const loaded = loadIssueExportInput(input);
  const source = input.source === "auto" || !input.source ? detectIssueExportSource(loaded.data) : input.source;
  const issues = parseIssueExport(loaded.data, source);

  const previewItems: IssueImportPreviewItem[] = issues.map((issue) => {
    const create_task_input = issueToCreateTaskInput(issue, input);
    const duplicate_of = findIssueDuplicate(create_task_input, d);
    return {
      external_ref: issue.external_ref,
      external_id: issue.external_id,
      title: issue.title,
      duplicate_of,
      create_task_input,
    };
  });

  const duplicate_count = previewItems.filter((item) => item.duplicate_of).length;

  return {
    schema_version: ISSUE_IMPORT_SCHEMA,
    source,
    file_path: loaded.file_path,
    issue_count: previewItems.length,
    duplicate_count,
    new_count: previewItems.length - duplicate_count,
    issues: previewItems,
  };
}

export function importIssues(
  input: IssueImportInput,
  options: IssueImportOptions = {},
  db?: Database,
): IssueImportResult {
  const d = db || getDatabase();
  const preview = previewIssueImport(input, d);
  const result: IssueImportResult = {
    schema_version: ISSUE_IMPORT_SCHEMA,
    dry_run: !!options.dry_run,
    source: preview.source,
    created: [],
    skipped_duplicates: [],
    errors: [],
  };

  if (options.dry_run) return result;

  for (const item of preview.issues) {
    try {
      if (item.duplicate_of && !options.skip_dedupe && !options.force) {
        result.skipped_duplicates.push({
          external_ref: item.external_ref,
          task_id: item.duplicate_of.task_id,
          title: item.duplicate_of.title,
        });
        continue;
      }

      const task = createTask(item.create_task_input, d);
      result.created.push(task);
    } catch (e) {
      result.errors.push(`${item.external_ref}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return result;
}

export function formatIssueImportPreviewText(preview: IssueImportPreview): string {
  const lines = [
    `Source: ${preview.source}`,
    `Issues: ${preview.issue_count} (${preview.new_count} new, ${preview.duplicate_count} duplicates)`,
  ];
  if (preview.file_path) lines.push(`File: ${preview.file_path}`);

  for (const item of preview.issues) {
    lines.push("");
    lines.push(`- ${item.external_ref}: ${item.title}`);
    if (item.duplicate_of) {
      lines.push(
        `  duplicate of ${item.duplicate_of.short_id ?? item.duplicate_of.task_id.slice(0, 8)} — ${item.duplicate_of.title}`,
      );
    } else {
      lines.push("  new");
    }
  }

  return lines.join("\n");
}

export function getIssueImportDocs(): string {
  return `# Local External Issue Importers

Import GitHub, Linear, or Jira issues from JSON export files — no hosted API required.

## Supported formats
- **GitHub**: \`gh issue list --json number,title,body,labels,state,url\` or single issue API JSON
- **Linear**: issue export JSON (array, \`{ issues: [...] }\`, or GraphQL \`data.issues.nodes\`)
- **Jira**: REST search/export JSON with \`issues[].key\` and \`fields.summary\`

## Dedupe
Tasks store \`metadata.external_ref\` (e.g. \`github:owner/repo#42\`, \`linear:ENG-123\`, \`jira:PROJ-1\`).
Re-importing the same export skips existing open tasks unless \`--force\`.

## CLI
\`\`\`bash
todos import issues ./issues.json --project <id>
todos import issues ./linear.json --source linear --dry-run
\`\`\`
`;
}
