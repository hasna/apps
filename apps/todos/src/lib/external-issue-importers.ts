import type { Database } from "bun:sqlite";
import { createInboxItem, type InboxItem } from "../db/inbox.js";
import { getDatabase, now } from "../db/database.js";
import { createTask, listTasks } from "../db/tasks.js";
import type { Task, TaskPriority } from "../types/index.js";
import { fetchGitHubIssue, issueToTask, parseGitHubUrl, type GitHubIssue } from "./github.js";
import { findDuplicateTasks, type DuplicateTaskCandidate } from "./task-dedupe.js";
import { redactEvidenceText, redactValue } from "./redaction.js";

export const EXTERNAL_ISSUE_IMPORT_SCHEMA_VERSION = 1;

export type ExternalIssueProvider = "github" | "linear" | "jira" | "url";

export interface ExternalIssueRecord {
  provider: ExternalIssueProvider;
  external_id: string;
  key: string | null;
  title: string;
  body: string | null;
  url: string | null;
  state: string | null;
  labels: string[];
  assignee: string | null;
  priority: TaskPriority | null;
  metadata: Record<string, unknown>;
}

export interface ExternalIssueImportInput {
  provider?: ExternalIssueProvider;
  text?: string;
  json?: unknown;
  source_url?: string;
  source_name?: string;
  project_id?: string;
  task_list_id?: string;
  agent_id?: string;
  default_priority?: TaskPriority;
  apply?: boolean;
  allow_network?: boolean;
  create_inbox?: boolean;
  dedupe?: boolean;
}

export interface ExternalIssueExistingMatch {
  issue: ExternalIssueRecord;
  task: Task;
  reason: string;
}

export interface ExternalIssueImportResult {
  schema_version: 1;
  local_only: true;
  network_used: boolean;
  dry_run: boolean;
  imported_at: string;
  source: {
    provider: ExternalIssueProvider | null;
    source_url: string | null;
    source_name: string | null;
  };
  issues: ExternalIssueRecord[];
  created_tasks: Task[];
  inbox_items: InboxItem[];
  existing_matches: ExternalIssueExistingMatch[];
  duplicate_candidates: DuplicateTaskCandidate[];
  warnings: string[];
  commands: string[];
}

type AnyRecord = Record<string, unknown>;

const PRIORITIES = new Set<TaskPriority>(["low", "medium", "high", "critical"]);

function asObject(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stableId(provider: ExternalIssueProvider, key: string | null, url: string | null, title: string): string {
  return key || url || `${provider}:${compact(title).toLowerCase().slice(0, 80)}`;
}

function normalizeUrl(value: string | null): string | null {
  return value ? value.trim().replace(/[.,;:)\]]+$/g, "").replace(/\/+$/g, "") : null;
}

function providerFromUrl(url: string | null): ExternalIssueProvider | null {
  if (!url) return null;
  if (parseGitHubUrl(url)) return "github";
  if (/linear\.app\//i.test(url)) return "linear";
  if (/\/browse\/[A-Z][A-Z0-9]+-\d+/i.test(url) || /atlassian\.net/i.test(url)) return "jira";
  return "url";
}

function providerFromInput(input: ExternalIssueImportInput): ExternalIssueProvider | null {
  return input.provider || providerFromUrl(input.source_url || null);
}

function labelNames(value: unknown): string[] {
  const labels = asArray(value);
  if (labels.length === 0) return [];
  return labels
    .map((item) => {
      if (typeof item === "string") return item;
      const record = asObject(item);
      return asString(record["name"]) || asString(record["title"]) || asString(record["value"]);
    })
    .filter((item): item is string => Boolean(item))
    .map((item) => item.toLowerCase())
    .slice(0, 12);
}

function labelsFromLinear(record: AnyRecord): string[] {
  const labels = asObject(record["labels"]);
  if (Array.isArray(labels["nodes"])) return labelNames(labels["nodes"]);
  return labelNames(record["labels"]);
}

function priorityFromLabels(labels: string[], fallback: TaskPriority): TaskPriority {
  for (const label of labels.map((item) => item.toLowerCase())) {
    if (/\b(critical|p0|blocker|urgent)\b/.test(label)) return "critical";
    if (/\b(high|p1)\b/.test(label)) return "high";
    if (/\b(low|p3)\b/.test(label)) return "low";
  }
  return fallback;
}

function priorityFromValue(value: unknown, fallback: TaskPriority): TaskPriority {
  const raw = asString(value)?.toLowerCase();
  if (!raw) return fallback;
  if (PRIORITIES.has(raw as TaskPriority)) return raw as TaskPriority;
  if (/\b(highest|critical|blocker|p0)\b/.test(raw)) return "critical";
  if (/\bhigh|p1\b/.test(raw)) return "high";
  if (/\blow|lowest|p3\b/.test(raw)) return "low";
  return fallback;
}

function githubRecord(input: AnyRecord, fallback: TaskPriority): ExternalIssueRecord {
  const labels = labelNames(input["labels"]);
  const number = asString(input["number"]) || parseGitHubUrl(asString(input["html_url"]) || asString(input["url"]) || "")?.number.toString() || "unknown";
  const url = normalizeUrl(asString(input["html_url"]) || asString(input["url"]));
  const repo = parseGitHubUrl(url || "") || null;
  return {
    provider: "github",
    external_id: number,
    key: repo ? `${repo.owner}/${repo.repo}#${number}` : `github#${number}`,
    title: asString(input["title"]) || `GitHub issue ${number}`,
    body: asString(input["body"]),
    url,
    state: asString(input["state"]),
    labels,
    assignee: asString(asObject(input["assignee"])["login"]) || asString(input["assignee"]),
    priority: priorityFromLabels(labels, fallback),
    metadata: redactValue(input) as Record<string, unknown>,
  };
}

function linearRecord(input: AnyRecord, fallback: TaskPriority): ExternalIssueRecord {
  const labels = labelsFromLinear(input);
  const state = asString(asObject(input["state"])["name"]) || asString(input["state"]);
  const key = asString(input["identifier"]) || asString(input["key"]) || asString(input["id"]);
  const priority = priorityFromValue(input["priorityLabel"] || input["priority"], priorityFromLabels(labels, fallback));
  return {
    provider: "linear",
    external_id: asString(input["id"]) || key || "unknown",
    key,
    title: asString(input["title"]) || asString(input["name"]) || `Linear issue ${key || "unknown"}`,
    body: asString(input["description"]) || asString(input["body"]),
    url: normalizeUrl(asString(input["url"])),
    state,
    labels,
    assignee: asString(asObject(input["assignee"])["name"]) || asString(asObject(input["assignee"])["displayName"]) || asString(input["assignee"]),
    priority,
    metadata: redactValue(input) as Record<string, unknown>,
  };
}

function jiraDescription(value: unknown): string | null {
  if (typeof value === "string") return value;
  const doc = asObject(value);
  const content = asArray(doc["content"]);
  const text = content.flatMap((block) => asArray(asObject(block)["content"]))
    .map((node) => asString(asObject(node)["text"]))
    .filter(Boolean)
    .join("\n");
  return text || null;
}

function jiraRecord(input: AnyRecord, fallback: TaskPriority): ExternalIssueRecord {
  const fields = asObject(input["fields"]);
  const labels = labelNames(fields["labels"]);
  const key = asString(input["key"]) || asString(input["id"]);
  const priority = priorityFromValue(asObject(fields["priority"])["name"] || input["priority"], priorityFromLabels(labels, fallback));
  return {
    provider: "jira",
    external_id: asString(input["id"]) || key || "unknown",
    key,
    title: asString(fields["summary"]) || asString(input["summary"]) || asString(input["title"]) || `Jira issue ${key || "unknown"}`,
    body: jiraDescription(fields["description"]) || asString(input["description"]),
    url: normalizeUrl(asString(input["self"]) || asString(input["url"])),
    state: asString(asObject(fields["status"])["name"]) || asString(input["status"]),
    labels,
    assignee: asString(asObject(fields["assignee"])["displayName"]) || asString(input["assignee"]),
    priority,
    metadata: redactValue(input) as Record<string, unknown>,
  };
}

function urlRecord(url: string, title?: string, body?: string, fallback: TaskPriority = "medium"): ExternalIssueRecord {
  const normalized = normalizeUrl(url)!;
  const github = parseGitHubUrl(normalized);
  if (github) {
    return {
      provider: "github",
      external_id: String(github.number),
      key: `${github.owner}/${github.repo}#${github.number}`,
      title: title || `GitHub issue ${github.owner}/${github.repo}#${github.number}`,
      body: body || null,
      url: normalized,
      state: null,
      labels: [],
      assignee: null,
      priority: fallback,
      metadata: { url: normalized },
    };
  }
  return {
    provider: providerFromUrl(normalized) || "url",
    external_id: normalized,
    key: null,
    title: title || normalized,
    body: body || null,
    url: normalized,
    state: null,
    labels: [],
    assignee: null,
    priority: fallback,
    metadata: { url: normalized },
  };
}

function recordFromProvider(provider: ExternalIssueProvider, input: AnyRecord, fallback: TaskPriority): ExternalIssueRecord {
  if (provider === "github") return githubRecord(input, fallback);
  if (provider === "linear") return linearRecord(input, fallback);
  if (provider === "jira") return jiraRecord(input, fallback);
  const url = asString(input["url"]) || asString(input["source_url"]) || asString(input["html_url"]) || asString(input["self"]);
  return urlRecord(
    url || asString(input["title"]) || "external issue",
    asString(input["title"]) ?? undefined,
    asString(input["body"]) || asString(input["description"]) || undefined,
    fallback,
  );
}

function recordsFromJson(value: unknown, provider: ExternalIssueProvider | null, fallback: TaskPriority): ExternalIssueRecord[] {
  const root = asObject(value);
  const rawItems = Array.isArray(value)
    ? value
    : Array.isArray(root["issues"])
      ? root["issues"]
      : Array.isArray(root["items"])
        ? root["items"]
        : Array.isArray(root["nodes"])
          ? root["nodes"]
          : [value];

  return rawItems
    .map((item) => {
      const record = asObject(item);
      const detected = provider || providerFromUrl(asString(record["url"]) || asString(record["html_url"]) || asString(record["self"]) || null) || "url";
      return recordFromProvider(detected, record, fallback);
    })
    .filter((item) => Boolean(item.title));
}

function parseKeyValueBlocks(text: string, fallback: TaskPriority): ExternalIssueRecord[] {
  const blocks = text.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const records: ExternalIssueRecord[] = [];
  for (const block of blocks) {
    const values: Record<string, string> = {};
    for (const line of block.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z][A-Za-z _-]{1,24})\s*:\s*(.+)\s*$/);
      if (match) values[match[1]!.toLowerCase().replace(/\s+/g, "_")] = match[2]!.trim();
    }
    if (!values["title"] && !values["url"]) continue;
    const provider = providerFromUrl(values["url"] || null) || (values["provider"] as ExternalIssueProvider | undefined) || "url";
    records.push({
      provider,
      external_id: values["id"] || values["key"] || values["url"] || values["title"]!,
      key: values["key"] || null,
      title: values["title"] || values["url"]!,
      body: values["body"] || values["description"] || null,
      url: normalizeUrl(values["url"] || null),
      state: values["state"] || values["status"] || null,
      labels: (values["labels"] || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean),
      assignee: values["assignee"] || null,
      priority: priorityFromValue(values["priority"], fallback),
      metadata: { raw: redactEvidenceText(block) },
    });
  }
  return records;
}

function recordsFromText(text: string, provider: ExternalIssueProvider | null, fallback: TaskPriority): ExternalIssueRecord[] {
  const redacted = redactEvidenceText(text);
  try {
    return recordsFromJson(JSON.parse(redacted), provider, fallback);
  } catch {}

  const keyed = parseKeyValueBlocks(redacted, fallback);
  if (keyed.length > 0) return keyed;

  const urls = Array.from(new Set(Array.from(redacted.matchAll(/https?:\/\/[^\s)\]]+/g)).map((match) => normalizeUrl(match[0])!)));
  if (urls.length > 0) return urls.map((url) => urlRecord(url, undefined, redacted, fallback));

  const firstLine = redacted.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "External issue";
  return [{
    provider: provider || "url",
    external_id: compact(firstLine).toLowerCase().slice(0, 120),
    key: null,
    title: compact(firstLine).slice(0, 200),
    body: redacted,
    url: null,
    state: null,
    labels: [],
    assignee: null,
    priority: fallback,
    metadata: { raw: redacted },
  }];
}

function githubIssueToRecord(issue: GitHubIssue, fallback: TaskPriority): ExternalIssueRecord {
  const taskInput = issueToTask(issue);
  return {
    provider: "github",
    external_id: String(issue.number),
    key: parseGitHubUrl(issue.url) ? `${parseGitHubUrl(issue.url)!.owner}/${parseGitHubUrl(issue.url)!.repo}#${issue.number}` : `github#${issue.number}`,
    title: issue.title,
    body: issue.body,
    url: normalizeUrl(issue.url),
    state: issue.state,
    labels: issue.labels.map((label) => label.toLowerCase()),
    assignee: issue.assignee,
    priority: taskInput.priority || fallback,
    metadata: taskInput.metadata || {},
  };
}

function findExistingTask(issue: ExternalIssueRecord, db: Database): ExternalIssueExistingMatch | null {
  const keys = new Set([
    `${issue.provider}:${issue.external_id}`.toLowerCase(),
    issue.key ? `${issue.provider}:${issue.key}`.toLowerCase() : null,
    issue.url ? issue.url.toLowerCase() : null,
  ].filter((item): item is string => Boolean(item)));

  for (const task of listTasks({ include_archived: true, limit: 5000 }, db)) {
    const metadata = task.metadata || {};
    const external = asObject(metadata["external_issue"]);
    const taskKeys = new Set([
      asString(metadata["source_url"])?.toLowerCase(),
      asString(metadata["external_url"])?.toLowerCase(),
      asString(metadata["issue_url"])?.toLowerCase(),
      asString(external["url"])?.toLowerCase(),
      external["provider"] && external["id"] ? `${external["provider"]}:${external["id"]}`.toLowerCase() : null,
      external["provider"] && external["key"] ? `${external["provider"]}:${external["key"]}`.toLowerCase() : null,
      metadata["github_owner"] && metadata["github_repo"] && metadata["github_number"]
        ? `github:${metadata["github_owner"]}/${metadata["github_repo"]}#${metadata["github_number"]}`.toLowerCase()
        : null,
    ].filter((item): item is string => Boolean(item)));
    for (const key of keys) {
      if (taskKeys.has(key)) return { issue, task, reason: `matching source key ${key}` };
    }
  }
  return null;
}

function taskTitle(issue: ExternalIssueRecord): string {
  if (issue.provider === "github") return `[GH ${issue.key || issue.external_id}] ${issue.title}`;
  if (issue.provider === "linear") return `[Linear ${issue.key || issue.external_id}] ${issue.title}`;
  if (issue.provider === "jira") return `[Jira ${issue.key || issue.external_id}] ${issue.title}`;
  return `[URL] ${issue.title}`;
}

function taskDescription(issue: ExternalIssueRecord): string {
  return [
    `External issue provider: ${issue.provider}`,
    issue.key ? `External key: ${issue.key}` : null,
    issue.url ? `Source URL: ${issue.url}` : null,
    issue.state ? `State: ${issue.state}` : null,
    issue.assignee ? `Assignee: ${issue.assignee}` : null,
    issue.body,
  ].filter(Boolean).join("\n\n");
}

function createTaskFromIssue(issue: ExternalIssueRecord, input: ExternalIssueImportInput, db: Database): Task {
  const parsedGitHub = issue.url ? parseGitHubUrl(issue.url) : null;
  const metadata = {
    source_url: issue.url,
    external_url: issue.url,
    issue_url: issue.url,
    external_issue: {
      provider: issue.provider,
      id: issue.external_id,
      key: issue.key,
      url: issue.url,
      state: issue.state,
      imported_at: now(),
    },
    ...(parsedGitHub ? {
      github_url: issue.url,
      github_owner: parsedGitHub.owner,
      github_repo: parsedGitHub.repo,
      github_number: parsedGitHub.number,
    } : {}),
  };
  return createTask({
    title: taskTitle(issue),
    description: taskDescription(issue).slice(0, 4000),
    priority: issue.priority || input.default_priority || "medium",
    tags: Array.from(new Set(["external-issue", issue.provider, ...issue.labels])).slice(0, 10),
    metadata: redactValue(metadata) as Record<string, unknown>,
    project_id: input.project_id,
    task_list_id: input.task_list_id,
    agent_id: input.agent_id,
    status: "pending",
  }, db);
}

function inboxBody(issue: ExternalIssueRecord): string {
  return JSON.stringify({
    provider: issue.provider,
    external_id: issue.external_id,
    key: issue.key,
    title: issue.title,
    body: issue.body,
    url: issue.url,
    state: issue.state,
    labels: issue.labels,
    assignee: issue.assignee,
  }, null, 2);
}

export function importExternalIssues(input: ExternalIssueImportInput, db?: Database): ExternalIssueImportResult {
  const d = getDatabase(db);
  const fallbackPriority = input.default_priority || "medium";
  const provider = providerFromInput(input);
  const warnings: string[] = [];
  let networkUsed = false;
  let issues: ExternalIssueRecord[] = [];

  if (input.allow_network && provider === "github" && input.source_url) {
    const parsed = parseGitHubUrl(input.source_url);
    if (parsed) {
      issues = [githubIssueToRecord(fetchGitHubIssue(parsed.owner, parsed.repo, parsed.number), fallbackPriority)];
      networkUsed = true;
    }
  }

  if (issues.length === 0 && input.json !== undefined) {
    issues = recordsFromJson(input.json, provider, fallbackPriority);
  }
  if (issues.length === 0 && input.text) {
    issues = recordsFromText(input.text, provider, fallbackPriority);
  }
  if (issues.length === 0 && input.source_url) {
    issues = [urlRecord(input.source_url, undefined, undefined, fallbackPriority)];
    if (!input.allow_network) warnings.push("Network fetch disabled; imported URL metadata only.");
  }

  issues = issues.map((issue) => ({
    ...issue,
    external_id: stableId(issue.provider, issue.key, issue.url, issue.title),
    body: issue.body ? redactEvidenceText(issue.body) : null,
    title: redactEvidenceText(issue.title),
    metadata: redactValue(issue.metadata) as Record<string, unknown>,
  }));

  const createdTasks: Task[] = [];
  const inboxItems: InboxItem[] = [];
  const existingMatches: ExternalIssueExistingMatch[] = [];

  for (const issue of issues) {
    const existing = input.dedupe === false ? null : findExistingTask(issue, d);
    if (existing) {
      existingMatches.push(existing);
      continue;
    }
    if (!input.apply) continue;
    const task = createTaskFromIssue(issue, input, d);
    createdTasks.push(task);
    if (input.create_inbox !== false) {
      const inbox = createInboxItem({
        title: issue.title,
        body: inboxBody(issue),
        source_type: issue.provider === "github" ? "github_issue" : "other",
        source_name: input.source_name || issue.provider,
        source_url: issue.url || input.source_url,
        metadata: {
          external_issue: {
            provider: issue.provider,
            id: issue.external_id,
            key: issue.key,
            task_id: task.id,
          },
        },
        project_id: input.project_id,
        task_list_id: input.task_list_id,
        priority: issue.priority || fallbackPriority,
        tags: ["external-issue", issue.provider],
        create_task: false,
      }, d);
      d.run("UPDATE inbox_items SET task_id = ? WHERE id = ?", [task.id, inbox.item.id]);
      inboxItems.push({ ...inbox.item, task_id: task.id });
    }
  }

  const duplicateCandidates = input.apply && createdTasks.length > 0
    ? findDuplicateTasks({ threshold: 0.8, include_archived: false }, d).filter((candidate) => (
      createdTasks.some((task) => task.id === candidate.primary_task.id || task.id === candidate.duplicate_task.id)
    ))
    : [];

  return {
    schema_version: EXTERNAL_ISSUE_IMPORT_SCHEMA_VERSION,
    local_only: true,
    network_used: networkUsed,
    dry_run: !input.apply,
    imported_at: now(),
    source: {
      provider,
      source_url: input.source_url || null,
      source_name: input.source_name || null,
    },
    issues,
    created_tasks: createdTasks,
    inbox_items: inboxItems,
    existing_matches: existingMatches,
    duplicate_candidates: duplicateCandidates,
    warnings,
    commands: [
      "todos issues import --file issues.json --provider github --apply --json",
      "todos dedupe scan --threshold 0.8 --json",
    ],
  };
}
