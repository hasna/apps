/**
 * Local-first inbox intake — GitHub issues, CI logs, feedback, errors, files → tasks.
 * No connector auth or hosted services required.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { getDatabase, now } from "../db/database.js";
import { createTask, getTask, listTasks, type Task } from "../db/tasks.js";
import type { CreateTaskInput, TaskPriority } from "../types/index.js";
import { parseGitHubUrl, fetchGitHubIssue } from "./github.js";
import { scanAndRedactText, redactText } from "./secret-redaction.js";
import { findDuplicateCandidates } from "./task-dedupe.js";

export const INBOX_INTAKE_SCHEMA = "todos.inbox_intake.v1";

export const INTAKE_SOURCE_TYPES = [
  "github_issue",
  "ci_log",
  "feedback",
  "error_paste",
  "file",
  "text",
] as const;

export type IntakeSourceType = (typeof INTAKE_SOURCE_TYPES)[number];

export const INTAKE_TRIAGE_STATUSES = ["preview", "triaged", "duplicate", "created"] as const;
export type IntakeTriageStatus = (typeof INTAKE_TRIAGE_STATUSES)[number];

export interface IntakeInput {
  source_type?: IntakeSourceType;
  text?: string;
  file_path?: string;
  github_url?: string;
  title?: string;
  project_id?: string;
  task_list_id?: string;
  agent_id?: string;
  tags?: string[];
  priority?: TaskPriority;
}

export interface IntakePreview {
  schema_version: typeof INBOX_INTAKE_SCHEMA;
  source_type: IntakeSourceType;
  triage_status: IntakeTriageStatus;
  title: string;
  description: string;
  redacted: boolean;
  secret_match_count: number;
  suggested_tags: string[];
  suggested_priority: TaskPriority;
  source_metadata: Record<string, unknown>;
  source_fingerprint: string;
  duplicate_of: { task_id: string; short_id: string | null; title: string; score: number } | null;
  create_task_input: CreateTaskInput;
}

export interface IntakeResult {
  schema_version: typeof INBOX_INTAKE_SCHEMA;
  preview: IntakePreview;
  task: Task | null;
  skipped_duplicate: boolean;
}

export interface IntakeOptions {
  dry_run?: boolean;
  skip_dedupe?: boolean;
  force?: boolean;
}

function fingerprint(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function loadRawContent(input: IntakeInput): { raw: string; source_type: IntakeSourceType; metadata: Record<string, unknown> } {
  if (input.github_url) {
    const parsed = parseGitHubUrl(input.github_url);
    if (!parsed) throw new Error(`Invalid GitHub issue URL: ${input.github_url}`);
    try {
      const issue = fetchGitHubIssue(parsed.owner, parsed.repo, parsed.number);
      return {
        raw: [issue.title, issue.body ?? ""].filter(Boolean).join("\n\n"),
        source_type: "github_issue",
        metadata: {
          github_url: issue.url,
          github_number: issue.number,
          github_state: issue.state,
          github_labels: issue.labels,
          external_ref: `github:${parsed.owner}/${parsed.repo}#${parsed.number}`,
        },
      };
    } catch {
      return {
        raw: input.text ?? input.github_url,
        source_type: "github_issue",
        metadata: { github_url: input.github_url, fetch_failed: true },
      };
    }
  }

  if (input.file_path) {
    if (!existsSync(input.file_path)) throw new Error(`File not found: ${input.file_path}`);
    const raw = readFileSync(input.file_path, "utf8");
    const name = basename(input.file_path).toLowerCase();
    const source_type: IntakeSourceType =
      input.source_type ??
      (name.includes("ci") || name.endsWith(".log") ? "ci_log" : "file");
    return {
      raw,
      source_type,
      metadata: { file_path: input.file_path, file_name: basename(input.file_path) },
    };
  }

  const text = input.text?.trim();
  if (!text) throw new Error("Provide --text, --file, or --github");

  const source_type = input.source_type ?? detectSourceType(text);
  return { raw: text, source_type, metadata: {} };
}

export function detectSourceType(text: string): IntakeSourceType {
  if (/github\.com\/[^/]+\/[^/]+\/issues\/\d+/.test(text)) return "github_issue";
  if (/^(FAIL|ERROR|✗|✖|FAILED|Tests failed)/im.test(text) && /\n/.test(text)) return "ci_log";
  if (/^(Error|TypeError|ReferenceError|SyntaxError|panic:|fatal:)/im.test(text)) return "error_paste";
  if (/^(feedback|support|user report|bug report)/im.test(text)) return "feedback";
  return "text";
}

export function parseCiLog(text: string): { title: string; failures: string[]; job?: string } {
  const lines = text.split(/\r?\n/);
  const failures: string[] = [];
  let job: string | undefined;

  for (const line of lines) {
    if (/^##?\s*(.+)/.test(line) && !job) job = line.replace(/^#+\s*/, "").trim();
    if (/FAIL|✗|✖|FAILED|Error:|AssertionError|expect\(/.test(line)) {
      failures.push(line.trim().slice(0, 200));
    }
  }

  const title = failures[0]?.slice(0, 120)
    ?? job
    ?? "CI failure";
  return { title: `[CI] ${title}`, failures: failures.slice(0, 20), job };
}

export function parseErrorPaste(text: string): { title: string; stack: string } {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const first = lines[0] ?? "Unknown error";
  const title = first.slice(0, 120);
  return { title: `[Error] ${title}`, stack: text.slice(0, 8000) };
}

export function parseFeedback(text: string): { title: string; body: string } {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const titleLine = lines.find((l) => !/^feedback:|^support:/i.test(l)) ?? lines[0] ?? "User feedback";
  return {
    title: `[Feedback] ${titleLine.slice(0, 100)}`,
    body: text.slice(0, 8000),
  };
}

function inferPriority(source_type: IntakeSourceType, text: string, metadata: Record<string, unknown>): TaskPriority {
  if (metadata.github_labels && Array.isArray(metadata.github_labels)) {
    const labels = (metadata.github_labels as string[]).map((l) => l.toLowerCase());
    if (labels.some((l) => /critical|urgent|p0|sev-?0/.test(l))) return "critical";
    if (labels.some((l) => /high|p1|sev-?1/.test(l))) return "high";
    if (labels.some((l) => /low|p3|minor/.test(l))) return "low";
  }
  if (source_type === "ci_log" || source_type === "error_paste") return "high";
  if (/critical|urgent|blocker|production/i.test(text)) return "critical";
  if (/minor|nice-to-have|cosmetic/i.test(text)) return "low";
  return "medium";
}

function buildTitleAndDescription(
  source_type: IntakeSourceType,
  raw: string,
  titleOverride?: string,
): { title: string; description: string; extra: Record<string, unknown> } {
  switch (source_type) {
    case "ci_log": {
      const parsed = parseCiLog(raw);
      return {
        title: titleOverride ?? parsed.title,
        description: parsed.failures.length
          ? `CI failures:\n\n${parsed.failures.map((f) => `- ${f}`).join("\n")}`
          : raw.slice(0, 8000),
        extra: { ci_job: parsed.job, failure_count: parsed.failures.length },
      };
    }
    case "error_paste": {
      const parsed = parseErrorPaste(raw);
      return {
        title: titleOverride ?? parsed.title,
        description: parsed.stack,
        extra: { error_first_line: parsed.title },
      };
    }
    case "feedback": {
      const parsed = parseFeedback(raw);
      return {
        title: titleOverride ?? parsed.title,
        description: parsed.body,
        extra: {},
      };
    }
    case "github_issue": {
      if (titleOverride) {
        return { title: titleOverride, description: raw.slice(0, 8000), extra: {} };
      }
      const [titleLine, ...rest] = raw.split(/\n\n/);
      return {
        title: titleLine?.slice(0, 200) ?? "GitHub issue",
        description: rest.join("\n\n").slice(0, 8000) || undefined,
        extra: {},
      } as { title: string; description: string; extra: Record<string, unknown> };
    }
    default:
      return {
        title: titleOverride ?? raw.split(/\n/)[0]!.slice(0, 200),
        description: raw.includes("\n") ? raw.slice(0, 8000) : "",
        extra: {},
      };
  }
}

function findIntakeDuplicate(
  createInput: CreateTaskInput,
  sourceFingerprint: string,
  db: Database,
): IntakePreview["duplicate_of"] {
  const metaRef = createInput.metadata?.external_ref ?? createInput.metadata?.source_fingerprint;
  const tasks = listTasks({ limit: 500 }, db).filter(
    (t) => !["cancelled", "archived", "completed"].includes(t.status),
  );

  for (const t of tasks) {
    const m = t.metadata ?? {};
    if (m.source_fingerprint === sourceFingerprint) {
      return { task_id: t.id, short_id: t.short_id, title: t.title, score: 1 };
    }
    if (metaRef && (m.external_ref === metaRef || m.source_fingerprint === sourceFingerprint)) {
      return { task_id: t.id, short_id: t.short_id, title: t.title, score: 1 };
    }
  }

  const candidates = findDuplicateCandidates({ threshold: 0.75, limit: 5 }, db);
  for (const c of candidates) {
    const other = c.primary_task;
    if (!other) continue;
    const normNew = createInput.title.toLowerCase();
    const normOther = other.title.toLowerCase();
    if (normNew === normOther || c.score >= 0.85) {
      return { task_id: other.id, short_id: other.short_id, title: other.title, score: c.score };
    }
  }

  return null;
}

export function previewInboxIntake(input: IntakeInput, db?: Database): IntakePreview {
  const d = db || getDatabase();
  const { raw, source_type, metadata } = loadRawContent(input);
  const scan = scanAndRedactText(raw);
  const safeText = scan.redacted_text ?? redactText(raw);
  const { title, description, extra } = buildTitleAndDescription(source_type, safeText, input.title);
  const source_fingerprint = fingerprint(`${source_type}:${title}:${safeText.slice(0, 500)}`);

  const suggested_priority = input.priority ?? inferPriority(source_type, safeText, metadata);
  const suggested_tags = [
    "intake",
    source_type.replace(/_/g, "-"),
    ...(input.tags ?? []),
  ];

  const source_metadata: Record<string, unknown> = {
    ...metadata,
    ...extra,
    intake_source: source_type,
    intake_at: now(),
    source_fingerprint,
    triage_status: "preview" as IntakeTriageStatus,
  };

  const create_task_input: CreateTaskInput = {
    title,
    description,
    project_id: input.project_id,
    task_list_id: input.task_list_id,
    agent_id: input.agent_id,
    priority: suggested_priority,
    tags: [...new Set(suggested_tags)].slice(0, 15),
    metadata: source_metadata,
    status: "pending",
  };

  const duplicate_of = findIntakeDuplicate(create_task_input, source_fingerprint, d);

  return {
    schema_version: INBOX_INTAKE_SCHEMA,
    source_type,
    triage_status: duplicate_of ? "duplicate" : "preview",
    title,
    description: description ?? "",
    redacted: !scan.clean,
    secret_match_count: scan.matches.length,
    suggested_tags: create_task_input.tags ?? [],
    suggested_priority,
    source_metadata,
    source_fingerprint,
    duplicate_of,
    create_task_input,
  };
}

export function createInboxIntake(
  input: IntakeInput,
  options: IntakeOptions = {},
  db?: Database,
): IntakeResult {
  const d = db || getDatabase();
  const preview = previewInboxIntake(input, d);

  if (options.dry_run) {
    return { schema_version: INBOX_INTAKE_SCHEMA, preview, task: null, skipped_duplicate: false };
  }

  if (preview.duplicate_of && !options.skip_dedupe && !options.force) {
    const existing = getTask(preview.duplicate_of.task_id, d)!;
    return {
      schema_version: INBOX_INTAKE_SCHEMA,
      preview: { ...preview, triage_status: "duplicate" },
      task: existing,
      skipped_duplicate: true,
    };
  }

  const createInput = {
    ...preview.create_task_input,
    metadata: {
      ...preview.create_task_input.metadata,
      triage_status: "created" as IntakeTriageStatus,
      intake_created_at: now(),
    },
  };

  const task = createTask(createInput, d);
  return {
    schema_version: INBOX_INTAKE_SCHEMA,
    preview: { ...preview, triage_status: "created" },
    task,
    skipped_duplicate: false,
  };
}

export function formatIntakePreviewText(preview: IntakePreview): string {
  const lines = [
    `Source: ${preview.source_type}`,
    `Triage: ${preview.triage_status}`,
    `Title: ${preview.title}`,
    `Priority: ${preview.suggested_priority}`,
    `Tags: ${preview.suggested_tags.join(", ")}`,
    `Redacted: ${preview.redacted ? `yes (${preview.secret_match_count} matches)` : "no"}`,
    `Fingerprint: ${preview.source_fingerprint}`,
  ];
  if (preview.duplicate_of) {
    lines.push(`Duplicate of: ${preview.duplicate_of.short_id ?? preview.duplicate_of.task_id.slice(0, 8)} (${(preview.duplicate_of.score * 100).toFixed(0)}%) — ${preview.duplicate_of.title}`);
  }
  if (preview.description) {
    lines.push("", "Description:", preview.description.slice(0, 500));
  }
  return lines.join("\n");
}
