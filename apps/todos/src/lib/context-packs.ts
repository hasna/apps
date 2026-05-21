import type { Database } from "bun:sqlite";
import { listComments } from "../db/comments.js";
import { getDatabase } from "../db/database.js";
import { getPlan } from "../db/plans.js";
import { getProject } from "../db/projects.js";
import { getTaskTraceability } from "../db/task-commits.js";
import { listTaskFiles, type TaskFile } from "../db/task-files.js";
import { getTaskDependencies, getTaskDependents } from "../db/task-graph.js";
import { getTaskRunLedger, listTaskRuns } from "../db/task-runs.js";
import { getTask, listTasks } from "../db/tasks.js";
import type { Plan, Project, Task, TaskComment } from "../types/index.js";
import { TaskNotFoundError } from "../types/index.js";
import { redactEvidenceText, redactValue } from "./redaction.js";

export type AgentContextPackFormat = "json" | "markdown";
export type AgentContextPackProfile = "codex" | "claude" | "takumi" | "generic";

export interface CreateAgentContextPackInput {
  task_id: string;
  agent_id?: string;
  profile?: AgentContextPackProfile;
  run_id?: string;
  comment_limit?: number;
  file_limit?: number;
  verification_limit?: number;
  run_limit?: number;
  dependency_limit?: number;
  plan_task_limit?: number;
  max_text_chars?: number;
  stale_after_hours?: number;
  now?: string | Date;
}

export interface AgentContextPackTask {
  id: string;
  short_id: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assigned_to: string | null;
  agent_id: string | null;
  project_id: string | null;
  plan_id: string | null;
  task_list_id: string | null;
  tags: string[];
  due_at: string | null;
  estimated_minutes: number | null;
  updated_at: string;
  metadata_keys: string[];
}

export interface AgentContextPackRelatedTask {
  id: string;
  short_id: string | null;
  title: string;
  status: string;
  priority: string;
}

export interface AgentContextPack {
  schema_version: 1;
  profile: AgentContextPackProfile;
  as_of: string;
  agent_id: string | null;
  task: AgentContextPackTask;
  project: Pick<Project, "id" | "name" | "path" | "description"> | null;
  plan: (Pick<Plan, "id" | "name" | "description" | "status" | "agent_id"> & { tasks: AgentContextPackRelatedTask[]; omitted_tasks: number }) | null;
  acceptance_criteria: string[];
  dependencies: {
    upstream: AgentContextPackRelatedTask[];
    downstream: AgentContextPackRelatedTask[];
    omitted_upstream: number;
    omitted_downstream: number;
  };
  comments: {
    recent: Array<Pick<TaskComment, "agent_id" | "type" | "progress_pct" | "created_at"> & { content: string }>;
    omitted: number;
  };
  relevant_files: Array<Pick<TaskFile, "path" | "status" | "agent_id" | "note" | "updated_at"> & { sources: string[] }>;
  traceability: {
    commits: Array<{ sha: string; message: string | null; files_changed: string[] | null; committed_at: string | null }>;
    git_refs: Array<{ ref_type: string; name: string; url: string | null; provider: string | null }>;
    verifications: Array<{ command: string; status: string; output_summary: string | null; artifact_path: string | null; run_at: string }>;
    omitted_verifications: number;
  };
  runs: {
    items: Array<{
      id: string;
      title: string | null;
      status: string;
      summary: string | null;
      agent_id: string | null;
      started_at: string;
      completed_at: string | null;
      events: Array<{ event_type: string; message: string | null; created_at: string }>;
      commands: Array<{ command: string; status: string; output_summary: string | null; artifact_path: string | null }>;
      files: Array<{ path: string; status: string; note: string | null }>;
      artifacts: Array<{ path: string; artifact_type: string | null; description: string | null; sha256: string | null }>;
    }>;
    omitted: number;
  };
  prompt_bundle: {
    target: AgentContextPackProfile;
    instructions: string[];
    suggested_prompt: string;
  };
  limits: Required<Pick<CreateAgentContextPackInput, "comment_limit" | "file_limit" | "verification_limit" | "run_limit" | "dependency_limit" | "plan_task_limit" | "max_text_chars" | "stale_after_hours">>;
  warnings: string[];
}

const DEFAULT_LIMITS = {
  comment_limit: 8,
  file_limit: 24,
  verification_limit: 10,
  run_limit: 3,
  dependency_limit: 12,
  plan_task_limit: 20,
  max_text_chars: 6000,
  stale_after_hours: 72,
} as const;

function clamp(value: number | undefined, fallback: number, max: number): number {
  if (!Number.isFinite(value) || !value || value < 1) return fallback;
  return Math.min(Math.floor(value), max);
}

function limits(input: CreateAgentContextPackInput): AgentContextPack["limits"] {
  return {
    comment_limit: clamp(input.comment_limit, DEFAULT_LIMITS.comment_limit, 50),
    file_limit: clamp(input.file_limit, DEFAULT_LIMITS.file_limit, 200),
    verification_limit: clamp(input.verification_limit, DEFAULT_LIMITS.verification_limit, 100),
    run_limit: clamp(input.run_limit, DEFAULT_LIMITS.run_limit, 20),
    dependency_limit: clamp(input.dependency_limit, DEFAULT_LIMITS.dependency_limit, 100),
    plan_task_limit: clamp(input.plan_task_limit, DEFAULT_LIMITS.plan_task_limit, 100),
    max_text_chars: clamp(input.max_text_chars, DEFAULT_LIMITS.max_text_chars, 50000),
    stale_after_hours: clamp(input.stale_after_hours, DEFAULT_LIMITS.stale_after_hours, 24 * 365),
  };
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (!value) return value ?? null;
  const redacted = redactEvidenceText(value);
  return redacted.length > max ? `${redacted.slice(0, Math.max(0, max - 12))}... [truncated]` : redacted;
}

function taskSummary(task: Task | null): AgentContextPackRelatedTask | null {
  if (!task) return null;
  return {
    id: task.id,
    short_id: task.short_id,
    title: redactEvidenceText(task.title),
    status: task.status,
    priority: task.priority,
  };
}

function acceptanceCriteria(task: Task, maxText: number): string[] {
  const metadata = task.metadata || {};
  const raw = metadata["acceptance_criteria"] ?? metadata["acceptanceCriteria"] ?? metadata["criteria"];
  if (Array.isArray(raw)) return raw.map((item) => truncate(String(item), maxText)).filter((item): item is string => Boolean(item));
  if (typeof raw === "string") {
    return raw
      .split(/\r?\n/)
      .map((line) => line.replace(/^[-*]\s*/, "").trim())
      .filter(Boolean)
      .map((line) => truncate(line, maxText))
      .filter((item): item is string => Boolean(item));
  }
  return [];
}

function latestTimestamp(values: Array<string | null | undefined>, fallback: string): string {
  const times = values
    .filter((value): value is string => Boolean(value))
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));
  if (times.length === 0) return fallback;
  return new Date(Math.max(...times)).toISOString();
}

function addFile(files: Map<string, AgentContextPack["relevant_files"][number]>, path: string | null | undefined, source: string, base?: Partial<AgentContextPack["relevant_files"][number]>): void {
  if (!path) return;
  const existing = files.get(path);
  if (existing) {
    if (!existing.sources.includes(source)) existing.sources.push(source);
    return;
  }
  files.set(path, {
    path,
    status: base?.status || "active",
    agent_id: base?.agent_id ?? null,
    note: truncate(base?.note, 240),
    updated_at: base?.updated_at || "",
    sources: [source],
  });
}

function profileInstructions(profile: AgentContextPackProfile): string[] {
  const shared = [
    "Use only the local evidence in this context pack unless the user asks for fresh external research.",
    "Execute the task against the plan, record commands and run evidence, and update task status only after verification.",
    "Respect approval gates, policy packs, workspace trust, and runner sandbox checks before risky work.",
  ];
  if (profile === "codex") return ["For Codex, pair this pack with /goal or a task-specific execution prompt.", ...shared];
  if (profile === "claude") return ["For Claude Code, paste this pack before asking Claude to plan and execute the task.", ...shared];
  if (profile === "takumi") return ["For Takumi, use this pack as the run-start brief and keep evidence in the local run ledger.", ...shared];
  return shared;
}

function promptFor(profile: AgentContextPackProfile, task: AgentContextPackTask): string {
  const target = profile === "generic" ? "agent" : profile;
  return `You are ${target}. Execute task ${task.short_id || task.id.slice(0, 8)}: ${task.title}. Use the local context pack below as the source of truth. Build a plan, run the needed verification, record evidence, and report completion with changed files and commands.`;
}

export function createAgentContextPack(input: CreateAgentContextPackInput, db?: Database): AgentContextPack {
  const d = db || getDatabase();
  const task = getTask(input.task_id, d);
  if (!task) throw new TaskNotFoundError(input.task_id);
  const limit = limits(input);
  const project = task.project_id ? getProject(task.project_id, d) : null;
  const plan = task.plan_id ? getPlan(task.plan_id, d) : null;
  const planTasks = task.plan_id ? listTasks({ plan_id: task.plan_id, limit: limit.plan_task_limit + 1 }, d) : [];
  const upstream = getTaskDependencies(task.id, d).map((dep) => taskSummary(getTask(dep.depends_on, d))).filter((item): item is AgentContextPackRelatedTask => Boolean(item));
  const downstream = getTaskDependents(task.id, d).map((dep) => taskSummary(getTask(dep.task_id, d))).filter((item): item is AgentContextPackRelatedTask => Boolean(item));
  const comments = listComments(task.id, d);
  const traceability = getTaskTraceability(task.id, d);
  const taskFiles = listTaskFiles(task.id, d);
  const runs = input.run_id ? [getTaskRunLedger(input.run_id, d).run] : listTaskRuns(task.id, d);
  const selectedRuns = runs.slice(0, limit.run_limit);
  const ledgers = selectedRuns.map((run) => getTaskRunLedger(run.id, d));
  const fileMap = new Map<string, AgentContextPack["relevant_files"][number]>();
  for (const file of taskFiles) addFile(fileMap, file.path, "task_file", file);
  for (const commit of traceability.commits) for (const file of commit.files_changed || []) addFile(fileMap, file, "commit");
  for (const ledger of ledgers) for (const file of ledger.files) addFile(fileMap, file.path, "run_file", file);

  const recentComments = comments.slice(-limit.comment_limit);
  const verifications = traceability.verifications.slice(0, limit.verification_limit);
  const relevantFiles = [...fileMap.values()].sort((a, b) => a.path.localeCompare(b.path)).slice(0, limit.file_limit);
  const asOf = latestTimestamp([
    task.updated_at,
    project?.updated_at,
    plan?.updated_at,
    ...comments.map((comment) => comment.created_at),
    ...traceability.verifications.map((verification) => verification.run_at),
    ...selectedRuns.map((run) => run.updated_at),
    ...taskFiles.map((file) => file.updated_at),
  ], task.updated_at);
  const warnings: string[] = [];
  const now = input.now ? new Date(input.now) : new Date();
  if (Date.parse(task.updated_at) < now.getTime() - limit.stale_after_hours * 60 * 60 * 1000) {
    warnings.push(`task state is older than ${limit.stale_after_hours} hours`);
  }
  if (comments.length > recentComments.length) warnings.push(`${comments.length - recentComments.length} older comments omitted`);
  if (traceability.verifications.length > verifications.length) warnings.push(`${traceability.verifications.length - verifications.length} older verifications omitted`);
  if (runs.length > selectedRuns.length) warnings.push(`${runs.length - selectedRuns.length} older runs omitted`);
  if (fileMap.size > relevantFiles.length) warnings.push(`${fileMap.size - relevantFiles.length} relevant files omitted`);

  const contextTask: AgentContextPackTask = {
    id: task.id,
    short_id: task.short_id,
    title: redactEvidenceText(task.title),
    description: truncate(task.description, limit.max_text_chars),
    status: task.status,
    priority: task.priority,
    assigned_to: task.assigned_to,
    agent_id: task.agent_id,
    project_id: task.project_id,
    plan_id: task.plan_id,
    task_list_id: task.task_list_id,
    tags: task.tags || [],
    due_at: task.due_at,
    estimated_minutes: task.estimated_minutes,
    updated_at: task.updated_at,
    metadata_keys: Object.keys(task.metadata || {}).sort(),
  };

  return redactValue({
    schema_version: 1 as const,
    profile: input.profile || "generic",
    as_of: asOf,
    agent_id: input.agent_id ?? null,
    task: contextTask,
    project: project ? { id: project.id, name: project.name, path: project.path, description: project.description } : null,
    plan: plan ? {
      id: plan.id,
      name: plan.name,
      description: truncate(plan.description, limit.max_text_chars),
      status: plan.status,
      agent_id: plan.agent_id,
      tasks: planTasks.slice(0, limit.plan_task_limit).map(taskSummary).filter((item): item is AgentContextPackRelatedTask => Boolean(item)),
      omitted_tasks: Math.max(0, planTasks.length - limit.plan_task_limit),
    } : null,
    acceptance_criteria: acceptanceCriteria(task, limit.max_text_chars),
    dependencies: {
      upstream: upstream.slice(0, limit.dependency_limit),
      downstream: downstream.slice(0, limit.dependency_limit),
      omitted_upstream: Math.max(0, upstream.length - limit.dependency_limit),
      omitted_downstream: Math.max(0, downstream.length - limit.dependency_limit),
    },
    comments: {
      recent: recentComments.map((comment) => ({
        agent_id: comment.agent_id,
        type: comment.type,
        progress_pct: comment.progress_pct,
        created_at: comment.created_at,
        content: truncate(comment.content, limit.max_text_chars) || "",
      })),
      omitted: Math.max(0, comments.length - recentComments.length),
    },
    relevant_files: relevantFiles,
    traceability: {
      commits: traceability.commits.map((commit) => ({
        sha: commit.sha,
        message: truncate(commit.message, 240),
        files_changed: commit.files_changed,
        committed_at: commit.committed_at,
      })),
      git_refs: traceability.git_refs.map((ref) => ({ ref_type: ref.ref_type, name: ref.name, url: ref.url, provider: ref.provider })),
      verifications: verifications.map((verification) => ({
        command: verification.command,
        status: verification.status,
        output_summary: truncate(verification.output_summary, limit.max_text_chars),
        artifact_path: verification.artifact_path,
        run_at: verification.run_at,
      })),
      omitted_verifications: Math.max(0, traceability.verifications.length - verifications.length),
    },
    runs: {
      items: ledgers.map((ledger) => ({
        id: ledger.run.id,
        title: ledger.run.title,
        status: ledger.run.status,
        summary: truncate(ledger.run.summary, limit.max_text_chars),
        agent_id: ledger.run.agent_id,
        started_at: ledger.run.started_at,
        completed_at: ledger.run.completed_at,
        events: ledger.events.map((event) => ({ event_type: event.event_type, message: truncate(event.message, 500), created_at: event.created_at })),
        commands: ledger.commands.map((command) => ({ command: command.command, status: command.status, output_summary: truncate(command.output_summary, limit.max_text_chars), artifact_path: command.artifact_path })),
        files: ledger.files.map((file) => ({ path: file.path, status: file.status, note: truncate(file.note, 240) })),
        artifacts: ledger.artifacts.map((artifact) => ({ path: artifact.path, artifact_type: artifact.artifact_type, description: truncate(artifact.description, 240), sha256: artifact.sha256 })),
      })),
      omitted: Math.max(0, runs.length - selectedRuns.length),
    },
    prompt_bundle: {
      target: input.profile || "generic",
      instructions: profileInstructions(input.profile || "generic"),
      suggested_prompt: promptFor(input.profile || "generic", contextTask),
    },
    limits: limit,
    warnings,
  }) as AgentContextPack;
}

function bullet(lines: string[]): string {
  return lines.length > 0 ? lines.map((line) => `- ${line}`).join("\n") : "- none";
}

export function renderAgentContextPackMarkdown(pack: AgentContextPack): string {
  const lines = [
    `# Agent Context Pack: ${pack.task.title}`,
    "",
    `Profile: ${pack.profile}`,
    `As of: ${pack.as_of}`,
    pack.agent_id ? `Agent: ${pack.agent_id}` : null,
    "",
    "## Task",
    `- ID: ${pack.task.id}`,
    pack.task.short_id ? `- Short ID: ${pack.task.short_id}` : null,
    `- Status: ${pack.task.status}`,
    `- Priority: ${pack.task.priority}`,
    pack.task.assigned_to ? `- Assigned: ${pack.task.assigned_to}` : null,
    pack.task.due_at ? `- Due: ${pack.task.due_at}` : null,
    pack.task.description ? `\n${pack.task.description}` : null,
    "",
    "## Project And Plan",
    pack.project ? `- Project: ${pack.project.name} (${pack.project.path})` : "- Project: none",
    pack.plan ? `- Plan: ${pack.plan.name} (${pack.plan.status})` : "- Plan: none",
    pack.plan && pack.plan.tasks.length > 0 ? bullet(pack.plan.tasks.map((task) => `${task.status} ${task.short_id || task.id.slice(0, 8)} ${task.title}`)) : null,
    "",
    "## Acceptance Criteria",
    bullet(pack.acceptance_criteria),
    "",
    "## Dependencies",
    "Upstream:",
    bullet(pack.dependencies.upstream.map((task) => `${task.status} ${task.short_id || task.id.slice(0, 8)} ${task.title}`)),
    "Downstream:",
    bullet(pack.dependencies.downstream.map((task) => `${task.status} ${task.short_id || task.id.slice(0, 8)} ${task.title}`)),
    "",
    "## Relevant Files",
    bullet(pack.relevant_files.map((file) => `${file.status} ${file.path} (${file.sources.join(", ")})`)),
    "",
    "## Recent Comments",
    bullet(pack.comments.recent.map((comment) => `${comment.created_at} ${comment.agent_id || "unknown"}: ${comment.content}`)),
    "",
    "## Verification",
    bullet(pack.traceability.verifications.map((verification) => `${verification.status} ${verification.command}${verification.output_summary ? ` - ${verification.output_summary}` : ""}`)),
    "",
    "## Runs",
    bullet(pack.runs.items.map((run) => `${run.status} ${run.id.slice(0, 8)}${run.summary ? ` - ${run.summary}` : ""}`)),
    "",
    "## Prompt Bundle",
    pack.prompt_bundle.suggested_prompt,
    "",
    bullet(pack.prompt_bundle.instructions),
    "",
    "## Warnings",
    bullet(pack.warnings),
  ].filter((line): line is string => line !== null);
  return redactEvidenceText(lines.join("\n"));
}

export function renderAgentContextPack(pack: AgentContextPack, format: AgentContextPackFormat): string {
  return format === "markdown" ? renderAgentContextPackMarkdown(pack) : JSON.stringify(pack, null, 2);
}
