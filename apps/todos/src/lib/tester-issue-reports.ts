import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { getDatabase, now } from "../db/database.js";
import { createTask, listTasks, updateTask } from "../db/tasks.js";
import type { Task, TaskPriority, TaskStatus } from "../types/index.js";
import { redactEvidenceText, redactValue } from "./redaction.js";

export const TESTERS_ISSUE_REPORT_SCHEMA_VERSION = "testers.issue_report.v1";
export const TESTERS_ISSUE_REPORT_RESULT_SCHEMA_VERSION = "todos.tester_issue_report_result.v1";
export const TESTERS_ISSUE_REPORT_BATCH_RESULT_SCHEMA_VERSION = "todos.tester_issue_report_batch_result.v1";

export type TesterIssueSeverity = "low" | "medium" | "high" | "critical";
export type TesterIssueKind =
  | "assertion_failure"
  | "runtime_error"
  | "console_error"
  | "network_error"
  | "visual_regression"
  | "accessibility"
  | "performance"
  | "broken_link"
  | "security"
  | "unknown";

export interface TesterIssueReportSource {
  tool?: string;
  run_id?: string;
  result_id?: string;
  scenario_id?: string;
  scenario_name?: string;
  project_id?: string;
  url?: string;
  page_url?: string;
  artifact_url?: string;
  screenshot_url?: string;
  commit?: string;
  branch?: string;
}

export interface TesterIssueReportTarget {
  url?: string;
  route?: string;
  selector?: string;
  component?: string;
  browser?: string;
  viewport?: string;
}

export interface TesterIssueFailure {
  message?: string;
  expected?: string;
  actual?: string;
  stack?: string;
  reasoning?: string;
  steps?: string[];
}

export interface TesterIssueArtifact {
  kind?: string;
  label?: string;
  path?: string;
  url?: string;
}

export interface TesterIssueEvidence {
  logs?: string[];
  screenshots?: TesterIssueArtifact[];
  artifacts?: TesterIssueArtifact[];
}

export interface TesterIssueReportV1 {
  schema_version: typeof TESTERS_ISSUE_REPORT_SCHEMA_VERSION;
  id?: string;
  fingerprint?: string;
  title: string;
  summary?: string | null;
  kind?: TesterIssueKind | string;
  severity?: TesterIssueSeverity | string;
  source?: TesterIssueReportSource;
  target?: TesterIssueReportTarget;
  failure?: TesterIssueFailure;
  evidence?: TesterIssueEvidence;
  labels?: string[];
  metadata?: Record<string, unknown>;
  occurred_at?: string;
}

export interface UpsertTesterIssueReportInput {
  report: TesterIssueReportV1 | unknown;
  project_id?: string;
  task_list_id?: string;
  agent_id?: string;
  assigned_to?: string;
  default_priority?: TaskPriority;
  apply?: boolean;
  update_existing?: boolean;
}

export type TesterIssueReportAction = "preview" | "matched" | "created" | "updated" | "regressed";

export interface UpsertTesterIssueReportResult {
  schema_version: typeof TESTERS_ISSUE_REPORT_RESULT_SCHEMA_VERSION;
  local_only: true;
  dry_run: boolean;
  processed_at: string;
  action: TesterIssueReportAction;
  fingerprint: string;
  report: TesterIssueReportV1;
  task: Task | null;
  warnings: string[];
  commands: string[];
}

export interface UpsertTesterIssueReportsResult {
  schema_version: typeof TESTERS_ISSUE_REPORT_BATCH_RESULT_SCHEMA_VERSION;
  local_only: true;
  dry_run: boolean;
  processed_at: string;
  results: UpsertTesterIssueReportResult[];
  summary: Record<TesterIssueReportAction, number> & { total: number };
}

type AnyRecord = Record<string, unknown>;

const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "critical"];
const SEVERITIES = new Set<TesterIssueSeverity>(PRIORITIES);
const KINDS = new Set<TesterIssueKind>([
  "assertion_failure",
  "runtime_error",
  "console_error",
  "network_error",
  "visual_regression",
  "accessibility",
  "performance",
  "broken_link",
  "security",
  "unknown",
]);

function asObject(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {};
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function stringArray(value: unknown, limit = 20): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => asString(item)).filter((item): item is string => Boolean(item)))]
    .slice(0, limit);
}

function objectArray(value: unknown, limit = 20): AnyRecord[] {
  if (!Array.isArray(value)) return [];
  return value.map(asObject).filter((item) => Object.keys(item).length > 0).slice(0, limit);
}

function cleanKey(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "");
}

function truncate(value: string | null | undefined, max: number): string | undefined {
  if (!value) return undefined;
  const redacted = redactEvidenceText(value).trim();
  if (!redacted) return undefined;
  return redacted.length > max ? `${redacted.slice(0, max - 3)}...` : redacted;
}

function normalizeText(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[`"'()[\]{}.,:;!?/#\\_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrlPattern(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    return `${url.origin.toLowerCase()}${url.pathname.replace(/\/+$/, "") || "/"}`;
  } catch {
    return value.split(/[?#]/, 1)[0]!.replace(/\/+$/, "").toLowerCase();
  }
}

function normalizeKind(value: unknown): TesterIssueKind | string {
  const raw = cleanKey(asString(value) || "unknown").replace(/-/g, "_");
  return KINDS.has(raw as TesterIssueKind) ? raw as TesterIssueKind : raw || "unknown";
}

function normalizeSeverity(value: unknown, fallback: TaskPriority): TesterIssueSeverity {
  const raw = cleanKey(asString(value) || fallback);
  if (SEVERITIES.has(raw as TesterIssueSeverity)) return raw as TesterIssueSeverity;
  if (/^(p0|blocker|urgent|highest)$/.test(raw)) return "critical";
  if (/^(p1|major)$/.test(raw)) return "high";
  if (/^(p3|minor|info)$/.test(raw)) return "low";
  return fallback;
}

function reportSource(input: AnyRecord): TesterIssueReportSource | undefined {
  const source = asObject(input["source"]);
  const normalized: TesterIssueReportSource = {
    tool: asString(source["tool"]) || asString(input["tool"]) || "testers",
    run_id: asString(source["run_id"]) || asString(input["run_id"]) || undefined,
    result_id: asString(source["result_id"]) || asString(input["result_id"]) || undefined,
    scenario_id: asString(source["scenario_id"]) || asString(input["scenario_id"]) || undefined,
    scenario_name: asString(source["scenario_name"]) || asString(input["scenario_name"]) || undefined,
    project_id: asString(source["project_id"]) || asString(input["project_id"]) || undefined,
    url: asString(source["url"]) || asString(input["url"]) || undefined,
    page_url: asString(source["page_url"]) || asString(input["page_url"]) || undefined,
    artifact_url: asString(source["artifact_url"]) || undefined,
    screenshot_url: asString(source["screenshot_url"]) || undefined,
    commit: asString(source["commit"]) || undefined,
    branch: asString(source["branch"]) || undefined,
  };
  return Object.values(normalized).some(Boolean) ? normalized : undefined;
}

function reportTarget(input: AnyRecord): TesterIssueReportTarget | undefined {
  const target = asObject(input["target"]);
  const normalized: TesterIssueReportTarget = {
    url: asString(target["url"]) || asString(input["target_url"]) || undefined,
    route: asString(target["route"]) || undefined,
    selector: asString(target["selector"]) || undefined,
    component: asString(target["component"]) || undefined,
    browser: asString(target["browser"]) || undefined,
    viewport: asString(target["viewport"]) || undefined,
  };
  return Object.values(normalized).some(Boolean) ? normalized : undefined;
}

function reportFailure(input: AnyRecord): TesterIssueFailure | undefined {
  const failure = asObject(input["failure"]);
  const steps = stringArray(failure["steps"] ?? input["steps"], 50);
  const normalized: TesterIssueFailure = {
    message: truncate(asString(failure["message"]) || asString(input["error"]) || asString(input["message"]), 1000),
    expected: truncate(asString(failure["expected"]), 1000),
    actual: truncate(asString(failure["actual"]), 1000),
    stack: truncate(asString(failure["stack"]) || asString(input["stack"]), 3000),
    reasoning: truncate(asString(failure["reasoning"]) || asString(input["reasoning"]), 1500),
    steps: steps.length > 0 ? steps.map((step) => truncate(step, 400)!).filter(Boolean) : undefined,
  };
  return Object.values(normalized).some(Boolean) ? normalized : undefined;
}

function artifactArray(value: unknown): TesterIssueArtifact[] {
  return objectArray(value, 12).map((item) => ({
    kind: asString(item["kind"]) || undefined,
    label: asString(item["label"]) || asString(item["name"]) || undefined,
    path: asString(item["path"]) || asString(item["file_path"]) || undefined,
    url: asString(item["url"]) || undefined,
  })).filter((item) => item.kind || item.label || item.path || item.url);
}

function reportEvidence(input: AnyRecord): TesterIssueEvidence | undefined {
  const evidence = asObject(input["evidence"]);
  const logs = stringArray(evidence["logs"], 8).map((log) => truncate(log, 1000)!).filter(Boolean);
  const screenshots = artifactArray(evidence["screenshots"] ?? input["screenshots"]);
  const artifacts = artifactArray(evidence["artifacts"] ?? input["artifacts"]);
  const normalized: TesterIssueEvidence = {
    logs: logs.length > 0 ? logs : undefined,
    screenshots: screenshots.length > 0 ? screenshots : undefined,
    artifacts: artifacts.length > 0 ? artifacts : undefined,
  };
  return Object.values(normalized).some(Boolean) ? normalized : undefined;
}

export function normalizeTesterIssueReport(value: unknown, fallbackPriority: TaskPriority = "medium"): TesterIssueReportV1 {
  const input = asObject(value);
  if (input["schema_version"] !== TESTERS_ISSUE_REPORT_SCHEMA_VERSION) {
    throw new Error(`Expected schema_version ${TESTERS_ISSUE_REPORT_SCHEMA_VERSION}`);
  }

  const failure = reportFailure(input);
  const source = reportSource(input);
  const target = reportTarget(input);
  const title = truncate(
    asString(input["title"])
      || asString(input["summary"])
      || failure?.message
      || source?.scenario_name
      || "Tester issue report",
    220,
  );
  if (!title) throw new Error("Tester issue report requires a title");

  const labels = [
    ...stringArray(input["labels"], 20),
    ...stringArray(input["tags"], 20),
  ].map(cleanKey).filter(Boolean);

  const report: TesterIssueReportV1 = {
    schema_version: TESTERS_ISSUE_REPORT_SCHEMA_VERSION,
    id: asString(input["id"]) || undefined,
    fingerprint: asString(input["fingerprint"]) || undefined,
    title,
    summary: truncate(asString(input["summary"]), 1000) ?? null,
    kind: normalizeKind(input["kind"] ?? input["type"]),
    severity: normalizeSeverity(input["severity"] ?? input["priority"], fallbackPriority),
    source,
    target,
    failure,
    evidence: reportEvidence(input),
    labels: labels.length > 0 ? [...new Set(labels)].slice(0, 20) : undefined,
    metadata: redactValue(asObject(input["metadata"])),
    occurred_at: asString(input["occurred_at"]) || asString(input["timestamp"]) || undefined,
  };

  return redactValue(report);
}

export function fingerprintTesterIssueReport(report: TesterIssueReportV1): string {
  if (report.fingerprint) return `testers:${cleanKey(report.fingerprint)}`;

  const stackTop = report.failure?.stack?.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  const url = normalizeUrlPattern(report.target?.url || report.source?.page_url || report.source?.url || "");
  const raw = [
    report.kind || "unknown",
    report.source?.project_id || "",
    report.source?.scenario_id || report.source?.scenario_name || "",
    url,
    report.target?.route || "",
    report.target?.selector || report.target?.component || "",
    normalizeText(report.failure?.message || report.summary || report.title).slice(0, 240),
    normalizeText(stackTop).slice(0, 160),
  ].join("::");

  return `testers:${createHash("sha256").update(raw).digest("hex").slice(0, 16)}`;
}

function priorityForSeverity(severity: TesterIssueSeverity, fallback: TaskPriority): TaskPriority {
  return PRIORITIES.includes(severity as TaskPriority) ? severity as TaskPriority : fallback;
}

function maxPriority(left: TaskPriority, right: TaskPriority): TaskPriority {
  return PRIORITIES.indexOf(right) > PRIORITIES.indexOf(left) ? right : left;
}

function taskTitle(report: TesterIssueReportV1): string {
  const title = report.title.replace(/^BUG:\s*/i, "").replace(/^\[testers\]\s*/i, "");
  return `BUG: [testers] ${title}`.slice(0, 240);
}

function evidenceLines(report: TesterIssueReportV1): string[] {
  const lines: string[] = [];
  for (const item of report.evidence?.screenshots || []) {
    lines.push(`Screenshot: ${item.label || item.kind || item.path || item.url}${item.path ? ` (${item.path})` : item.url ? ` (${item.url})` : ""}`);
  }
  for (const item of report.evidence?.artifacts || []) {
    lines.push(`Artifact: ${item.label || item.kind || item.path || item.url}${item.path ? ` (${item.path})` : item.url ? ` (${item.url})` : ""}`);
  }
  for (const log of report.evidence?.logs || []) lines.push(`Log: ${log}`);
  return lines.slice(0, 12);
}

function taskDescription(report: TesterIssueReportV1, fingerprint: string): string {
  const failure = report.failure;
  const lines = [
    "Tester issue report.",
    "",
    `Schema: ${report.schema_version}`,
    `Fingerprint: ${fingerprint}`,
    `Kind: ${report.kind || "unknown"}`,
    `Severity: ${report.severity || "medium"}`,
    report.source?.run_id ? `Run: ${report.source.run_id}` : null,
    report.source?.result_id ? `Result: ${report.source.result_id}` : null,
    report.source?.scenario_name || report.source?.scenario_id ? `Scenario: ${report.source.scenario_name || report.source.scenario_id}` : null,
    report.target?.url || report.source?.page_url || report.source?.url ? `URL: ${report.target?.url || report.source?.page_url || report.source?.url}` : null,
    report.target?.route ? `Route: ${report.target.route}` : null,
    report.target?.selector ? `Selector: ${report.target.selector}` : null,
    report.occurred_at ? `Occurred at: ${report.occurred_at}` : null,
    "",
    report.summary ? `Summary:\n${report.summary}` : null,
    failure?.message ? `Failure:\n${failure.message}` : null,
    failure?.expected ? `Expected:\n${failure.expected}` : null,
    failure?.actual ? `Actual:\n${failure.actual}` : null,
    failure?.reasoning ? `Reasoning:\n${failure.reasoning}` : null,
    failure?.steps?.length ? `Steps:\n${failure.steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}` : null,
    evidenceLines(report).length ? `Evidence:\n${evidenceLines(report).map((line) => `- ${line}`).join("\n")}` : null,
    failure?.stack ? `Stack:\n${failure.stack}` : null,
  ].filter((line): line is string => line !== null);

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").slice(0, 6000);
}

function taskTags(report: TesterIssueReportV1): string[] {
  return [...new Set([
    "bug",
    "testers",
    "tester-report",
    report.kind ? cleanKey(String(report.kind)).replace(/_/g, "-") : "unknown",
    ...(report.labels || []),
  ].filter(Boolean))].slice(0, 16);
}

function storedReportSummary(report: TesterIssueReportV1): Record<string, unknown> {
  return {
    id: report.id ?? null,
    title: report.title,
    kind: report.kind ?? "unknown",
    severity: report.severity ?? "medium",
    run_id: report.source?.run_id ?? null,
    result_id: report.source?.result_id ?? null,
    scenario_id: report.source?.scenario_id ?? null,
    scenario_name: report.source?.scenario_name ?? null,
    url: report.target?.url ?? report.source?.page_url ?? report.source?.url ?? null,
    occurred_at: report.occurred_at ?? null,
  };
}

function testerMetadata(
  report: TesterIssueReportV1,
  fingerprint: string,
  previous: Record<string, unknown> | null,
  timestamp: string,
): Record<string, unknown> {
  const occurrenceCount = typeof previous?.["occurrence_count"] === "number"
    ? previous["occurrence_count"] as number + 1
    : 1;
  const previousRecent = previous?.["recent_reports"];
  const recent = Array.isArray(previousRecent) ? previousRecent : [];
  return {
    schema_version: TESTERS_ISSUE_REPORT_SCHEMA_VERSION,
    fingerprint,
    first_seen_at: asString(previous?.["first_seen_at"]) || timestamp,
    last_seen_at: timestamp,
    occurrence_count: occurrenceCount,
    latest_report: storedReportSummary(report),
    recent_reports: [...recent.slice(-4), storedReportSummary(report)],
  };
}

function sourceMetadata(report: TesterIssueReportV1): Record<string, unknown> {
  const url = report.target?.url || report.source?.page_url || report.source?.url || null;
  return {
    ...(url ? { source_url: url, external_url: url, issue_url: url } : {}),
    ...(report.source?.run_id ? { tester_run_id: report.source.run_id } : {}),
    ...(report.source?.result_id ? { tester_result_id: report.source.result_id } : {}),
    ...(report.source?.scenario_id ? { tester_scenario_id: report.source.scenario_id } : {}),
    ...(report.source?.project_id ? { tester_project_id: report.source.project_id } : {}),
  };
}

function findExistingTask(
  fingerprint: string,
  input: Pick<UpsertTesterIssueReportInput, "project_id" | "task_list_id">,
  db: Database,
): Task | null {
  for (const task of listTasks({
    include_archived: true,
    project_id: input.project_id,
    task_list_id: input.task_list_id,
  }, db)) {
    const metadata = task.metadata || {};
    const tester = asObject(metadata["tester_issue_report"]);
    if (tester["fingerprint"] === fingerprint) return task;
    if (metadata["tester_issue_fingerprint"] === fingerprint) return task;
    if (metadata["external_ref"] === fingerprint) return task;
  }
  return null;
}

function commandsFor(task: Task | null): string[] {
  return [
    "todos issues report --file tester-report.json --apply --json",
    task ? `todos show ${task.id.slice(0, 8)}` : `todos list --tags tester-report --json`,
    `todos dedupe scan --threshold 0.8 --json`,
  ];
}

function updateExistingTask(
  task: Task,
  report: TesterIssueReportV1,
  fingerprint: string,
  input: UpsertTesterIssueReportInput,
  timestamp: string,
  db: Database,
): { action: TesterIssueReportAction; task: Task } {
  if (input.update_existing === false) return { action: "matched", task };

  const previous = asObject(task.metadata["tester_issue_report"]);
  const severityPriority = priorityForSeverity(report.severity as TesterIssueSeverity, input.default_priority || "medium");
  const nextStatus: TaskStatus = task.status === "completed" || task.status === "cancelled" ? "pending" : task.status;
  const action: TesterIssueReportAction = nextStatus !== task.status ? "regressed" : "updated";
  const updated = updateTask(task.id, {
    version: task.version,
    title: taskTitle(report),
    description: taskDescription(report, fingerprint),
    priority: maxPriority(task.priority, severityPriority),
    status: nextStatus,
    completed_at: nextStatus !== task.status ? null : undefined,
    tags: [...new Set([...task.tags, ...taskTags(report)])],
    metadata: {
      ...task.metadata,
      ...sourceMetadata(report),
      external_ref: fingerprint,
      tester_issue_fingerprint: fingerprint,
      tester_issue_report: testerMetadata(report, fingerprint, previous, timestamp),
    },
    ...(input.assigned_to !== undefined ? { assigned_to: input.assigned_to } : {}),
    task_type: task.task_type || "bug",
  }, db);
  return { action, task: updated };
}

export function upsertTesterIssueReport(
  input: UpsertTesterIssueReportInput,
  db?: Database,
): UpsertTesterIssueReportResult {
  const d = db || getDatabase();
  const timestamp = now();
  const warnings: string[] = [];
  const report = normalizeTesterIssueReport(input.report, input.default_priority || "medium");
  const fingerprint = fingerprintTesterIssueReport(report);
  const existing = findExistingTask(fingerprint, input, d);

  if (!input.apply) {
    const action: TesterIssueReportAction = existing ? "matched" : "preview";
    return {
      schema_version: TESTERS_ISSUE_REPORT_RESULT_SCHEMA_VERSION,
      local_only: true,
      dry_run: true,
      processed_at: timestamp,
      action,
      fingerprint,
      report,
      task: existing,
      warnings,
      commands: commandsFor(existing),
    };
  }

  if (existing) {
    const updated = updateExistingTask(existing, report, fingerprint, input, timestamp, d);
    return {
      schema_version: TESTERS_ISSUE_REPORT_RESULT_SCHEMA_VERSION,
      local_only: true,
      dry_run: false,
      processed_at: timestamp,
      action: updated.action,
      fingerprint,
      report,
      task: updated.task,
      warnings,
      commands: commandsFor(updated.task),
    };
  }

  const priority = priorityForSeverity(report.severity as TesterIssueSeverity, input.default_priority || "medium");
  const task = createTask({
    title: taskTitle(report),
    description: taskDescription(report, fingerprint),
    priority,
    status: "pending",
    tags: taskTags(report),
    metadata: {
      ...sourceMetadata(report),
      external_ref: fingerprint,
      tester_issue_fingerprint: fingerprint,
      tester_issue_report: testerMetadata(report, fingerprint, null, timestamp),
      tester_issue_report_raw: redactValue({
        ...report,
        evidence: report.evidence ? {
          screenshots: report.evidence.screenshots,
          artifacts: report.evidence.artifacts,
        } : undefined,
      }),
    },
    project_id: input.project_id,
    task_list_id: input.task_list_id,
    agent_id: input.agent_id,
    assigned_to: input.assigned_to,
    task_type: "bug",
  }, d);

  return {
    schema_version: TESTERS_ISSUE_REPORT_RESULT_SCHEMA_VERSION,
    local_only: true,
    dry_run: false,
    processed_at: timestamp,
    action: "created",
    fingerprint,
    report,
    task,
    warnings,
    commands: commandsFor(task),
  };
}

export function upsertTesterIssueReports(
  input: Omit<UpsertTesterIssueReportInput, "report"> & { reports: unknown[] },
  db?: Database,
): UpsertTesterIssueReportsResult {
  const d = db || getDatabase();
  const run = () => input.reports.map((report) => upsertTesterIssueReport({ ...input, report }, d));
  const results = input.apply ? d.transaction(run)() : run();
  const summary: UpsertTesterIssueReportsResult["summary"] = {
    total: results.length,
    preview: 0,
    matched: 0,
    created: 0,
    updated: 0,
    regressed: 0,
  };
  for (const result of results) summary[result.action]++;
  return {
    schema_version: TESTERS_ISSUE_REPORT_BATCH_RESULT_SCHEMA_VERSION,
    local_only: true,
    dry_run: !input.apply,
    processed_at: now(),
    results,
    summary,
  };
}

export function readTesterIssueReportsPayload(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asObject(value);
  if (Array.isArray(record["reports"])) return record["reports"];
  if (Array.isArray(record["issues"])) return record["issues"];
  return [value];
}
