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

export type AgentContextPackFormat = "json" | "markdown" | "compact-json" | "compact-markdown";
export type AgentContextPackProfile = "codex" | "claude" | "takumi" | "generic";
export type AgentContextPackSection =
  | "project"
  | "plan"
  | "acceptance_criteria"
  | "dependencies"
  | "comments"
  | "relevant_files"
  | "traceability"
  | "runs";

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
  summary_char_limit?: number;
  stale_after_hours?: number;
  token_budget?: number;
  include_sections?: string[];
  exclude_sections?: string[];
  compact?: boolean;
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
  context_budget: {
    estimation: "chars_div_4";
    token_budget: number | null;
    original_estimated_tokens: number;
    estimated_tokens: number;
    compact: boolean;
    included_sections: AgentContextPackSection[];
    excluded_sections: AgentContextPackSection[];
    omitted_sections: AgentContextPackSection[];
    summaries: Array<{ section: AgentContextPackSection; reason: string; text: string; estimated_tokens_saved: number }>;
  };
  limits: Required<Pick<CreateAgentContextPackInput, "comment_limit" | "file_limit" | "verification_limit" | "run_limit" | "dependency_limit" | "plan_task_limit" | "max_text_chars" | "summary_char_limit" | "stale_after_hours">>;
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
  summary_char_limit: 480,
  stale_after_hours: 72,
} as const;

const ALL_CONTEXT_SECTIONS: AgentContextPackSection[] = [
  "project",
  "plan",
  "acceptance_criteria",
  "dependencies",
  "comments",
  "relevant_files",
  "traceability",
  "runs",
];

const BUDGET_TRIM_ORDER: AgentContextPackSection[] = [
  "runs",
  "traceability",
  "comments",
  "relevant_files",
  "dependencies",
  "plan",
  "acceptance_criteria",
  "project",
];

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
    summary_char_limit: clamp(input.summary_char_limit, DEFAULT_LIMITS.summary_char_limit, 4000),
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

function normalizeSections(values: string[] | undefined): AgentContextPackSection[] {
  if (!values?.length) return [];
  const aliases: Record<string, AgentContextPackSection> = {
    acceptance: "acceptance_criteria",
    criteria: "acceptance_criteria",
    deps: "dependencies",
    dependency: "dependencies",
    files: "relevant_files",
    file: "relevant_files",
    verification: "traceability",
    verifications: "traceability",
    runs: "runs",
    run: "runs",
    comments: "comments",
    comment: "comments",
    project: "project",
    plan: "plan",
  };
  const sections = new Set<AgentContextPackSection>();
  for (const value of values) {
    for (const raw of value.split(",")) {
      const key = raw.trim().toLowerCase().replace(/-/g, "_");
      const section = ALL_CONTEXT_SECTIONS.includes(key as AgentContextPackSection) ? key as AgentContextPackSection : aliases[key];
      if (section) sections.add(section);
    }
  }
  return [...sections].sort((a, b) => ALL_CONTEXT_SECTIONS.indexOf(a) - ALL_CONTEXT_SECTIONS.indexOf(b));
}

function estimateTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return Math.max(1, Math.ceil((text || "").length / 4));
}

function summarizeStrings(values: string[], maxChars: number): string {
  return truncate(values.filter(Boolean).join("; "), maxChars) || "No local details were available before this section was omitted.";
}

function summarizeSection(pack: AgentContextPack, section: AgentContextPackSection, maxChars: number): string {
  if (section === "project") return pack.project ? summarizeStrings([`Project ${pack.project.name}`, pack.project.path, pack.project.description || ""], maxChars) : "No project was attached.";
  if (section === "plan") {
    if (!pack.plan) return "No plan was attached.";
    return summarizeStrings([
      `Plan ${pack.plan.name} is ${pack.plan.status}`,
      `${pack.plan.tasks.length} listed plan tasks`,
      ...pack.plan.tasks.slice(0, 4).map((task) => `${task.status} ${task.short_id || task.id.slice(0, 8)} ${task.title}`),
    ], maxChars);
  }
  if (section === "acceptance_criteria") return summarizeStrings([`${pack.acceptance_criteria.length} acceptance criteria`, ...pack.acceptance_criteria.slice(0, 4)], maxChars);
  if (section === "dependencies") return summarizeStrings([
    `${pack.dependencies.upstream.length} upstream dependencies`,
    `${pack.dependencies.downstream.length} downstream dependents`,
    ...pack.dependencies.upstream.slice(0, 3).map((task) => `upstream ${task.status} ${task.title}`),
    ...pack.dependencies.downstream.slice(0, 3).map((task) => `downstream ${task.status} ${task.title}`),
  ], maxChars);
  if (section === "comments") return summarizeStrings([
    `${pack.comments.recent.length} recent comments`,
    ...pack.comments.recent.slice(-3).map((comment) => `${comment.created_at} ${comment.agent_id || "unknown"}: ${comment.content}`),
  ], maxChars);
  if (section === "relevant_files") return summarizeStrings([
    `${pack.relevant_files.length} relevant files`,
    ...pack.relevant_files.slice(0, 8).map((file) => `${file.status} ${file.path}`),
  ], maxChars);
  if (section === "traceability") return summarizeStrings([
    `${pack.traceability.commits.length} commits`,
    `${pack.traceability.git_refs.length} git refs`,
    `${pack.traceability.verifications.length} verifications`,
    ...pack.traceability.verifications.slice(0, 4).map((verification) => `${verification.status} ${verification.command}`),
  ], maxChars);
  return summarizeStrings([
    `${pack.runs.items.length} run ledgers`,
    ...pack.runs.items.slice(0, 4).map((run) => `${run.status} ${run.id.slice(0, 8)}${run.summary ? ` ${run.summary}` : ""}`),
  ], maxChars);
}

function sectionValue(pack: AgentContextPack, section: AgentContextPackSection): unknown {
  if (section === "acceptance_criteria") return pack.acceptance_criteria;
  if (section === "relevant_files") return pack.relevant_files;
  return pack[section];
}

function hasSectionContent(pack: AgentContextPack, section: AgentContextPackSection): boolean {
  const value = sectionValue(pack, section);
  if (Array.isArray(value)) return value.length > 0;
  if (!value) return false;
  if (section === "dependencies") return pack.dependencies.upstream.length > 0 || pack.dependencies.downstream.length > 0;
  if (section === "comments") return pack.comments.recent.length > 0;
  if (section === "traceability") return pack.traceability.commits.length > 0 || pack.traceability.git_refs.length > 0 || pack.traceability.verifications.length > 0;
  if (section === "runs") return pack.runs.items.length > 0;
  return true;
}

function omitSection(pack: AgentContextPack, section: AgentContextPackSection): void {
  if (section === "project") pack.project = null;
  else if (section === "plan") pack.plan = null;
  else if (section === "acceptance_criteria") pack.acceptance_criteria = [];
  else if (section === "dependencies") {
    pack.dependencies.omitted_upstream += pack.dependencies.upstream.length;
    pack.dependencies.omitted_downstream += pack.dependencies.downstream.length;
    pack.dependencies.upstream = [];
    pack.dependencies.downstream = [];
  } else if (section === "comments") {
    pack.comments.omitted += pack.comments.recent.length;
    pack.comments.recent = [];
  } else if (section === "relevant_files") {
    pack.relevant_files = [];
  } else if (section === "traceability") {
    pack.traceability.omitted_verifications += pack.traceability.verifications.length;
    pack.traceability.commits = [];
    pack.traceability.git_refs = [];
    pack.traceability.verifications = [];
  } else if (section === "runs") {
    pack.runs.omitted += pack.runs.items.length;
    pack.runs.items = [];
  }
}

function applyContextBudget(pack: AgentContextPack, input: CreateAgentContextPackInput): AgentContextPack {
  const includeSections = normalizeSections(input.include_sections);
  const excludeSections = normalizeSections(input.exclude_sections);
  const omitted = new Set<AgentContextPackSection>();
  const summaries: AgentContextPack["context_budget"]["summaries"] = [];
  const originalEstimatedTokens = estimateTokens({ ...pack, context_budget: undefined });

  function recordOmission(section: AgentContextPackSection, reason: string): void {
    if (omitted.has(section) || !hasSectionContent(pack, section)) return;
    const before = estimateTokens(sectionValue(pack, section));
    const text = summarizeSection(pack, section, pack.limits.summary_char_limit);
    omitSection(pack, section);
    const after = estimateTokens(sectionValue(pack, section));
    omitted.add(section);
    summaries.push({
      section,
      reason,
      text,
      estimated_tokens_saved: Math.max(0, before - after),
    });
  }

  if (includeSections.length > 0) {
    for (const section of ALL_CONTEXT_SECTIONS) {
      if (!includeSections.includes(section)) recordOmission(section, "not selected by include_sections");
    }
  }
  for (const section of excludeSections) recordOmission(section, "excluded by exclude_sections");

  const tokenBudget = input.token_budget && Number.isFinite(input.token_budget) && input.token_budget > 0 ? Math.floor(input.token_budget) : null;
  if (tokenBudget) {
    for (const section of BUDGET_TRIM_ORDER) {
      if (estimateTokens({ ...pack, context_budget: undefined }) <= tokenBudget) break;
      recordOmission(section, `estimated context exceeded token_budget ${tokenBudget}`);
    }
  }

  const estimatedTokens = estimateTokens({ ...pack, context_budget: undefined });
  if (tokenBudget && estimatedTokens > tokenBudget) {
    pack.warnings.push(`context pack estimated at ${estimatedTokens} tokens after pruning still exceeds budget ${tokenBudget}`);
  }
  if (summaries.length > 0) {
    pack.warnings.push(`context budgeting omitted sections: ${summaries.map((summary) => summary.section).join(", ")}`);
  }
  pack.context_budget = {
    estimation: "chars_div_4",
    token_budget: tokenBudget,
    original_estimated_tokens: originalEstimatedTokens,
    estimated_tokens: estimateTokens({ ...pack, context_budget: undefined }),
    compact: Boolean(input.compact),
    included_sections: includeSections.length > 0 ? includeSections : ALL_CONTEXT_SECTIONS,
    excluded_sections: excludeSections,
    omitted_sections: [...omitted],
    summaries,
  };
  return pack;
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

  const pack: AgentContextPack = {
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
    context_budget: {
      estimation: "chars_div_4",
      token_budget: null,
      original_estimated_tokens: 0,
      estimated_tokens: 0,
      compact: Boolean(input.compact),
      included_sections: ALL_CONTEXT_SECTIONS,
      excluded_sections: [],
      omitted_sections: [],
      summaries: [],
    },
    limits: limit,
    warnings,
  };

  const budgeted = applyContextBudget(pack, input);
  const contextBudget = {
    ...budgeted.context_budget,
    summaries: budgeted.context_budget.summaries.map((summary) => ({
      ...summary,
      text: redactEvidenceText(summary.text),
    })),
  };
  const { context_budget: _contextBudget, ...withoutContextBudget } = budgeted;
  const redacted = redactValue(withoutContextBudget) as Omit<AgentContextPack, "context_budget"> as AgentContextPack;
  redacted.context_budget = contextBudget;
  return redacted;
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
    "## Context Budget",
    `- Estimated tokens: ${pack.context_budget.estimated_tokens}`,
    pack.context_budget.token_budget ? `- Token budget: ${pack.context_budget.token_budget}` : "- Token budget: none",
    pack.context_budget.omitted_sections.length > 0 ? `- Omitted sections: ${pack.context_budget.omitted_sections.join(", ")}` : "- Omitted sections: none",
    pack.context_budget.summaries.length > 0 ? bullet(pack.context_budget.summaries.map((summary) => `${summary.section}: ${summary.text}`)) : null,
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

export function renderAgentContextPackCompactMarkdown(pack: AgentContextPack): string {
  const lines = [
    `# Context: ${pack.task.title}`,
    `${pack.task.status} | ${pack.task.priority} | ${pack.task.short_id || pack.task.id.slice(0, 8)}`,
    pack.task.description ? truncate(pack.task.description, Math.min(pack.limits.summary_char_limit, 700)) : null,
    "",
    "## Must Know",
    bullet([
      pack.project ? `Project: ${pack.project.name}` : "Project: none",
      pack.plan ? `Plan: ${pack.plan.name} (${pack.plan.status})` : "Plan: none",
      `${pack.acceptance_criteria.length} acceptance criteria`,
      `${pack.dependencies.upstream.length} upstream dependencies, ${pack.dependencies.downstream.length} downstream dependents`,
      `${pack.relevant_files.length} relevant files`,
      `${pack.traceability.verifications.length} verifications`,
      `${pack.runs.items.length} run ledgers`,
    ]),
    "",
    "## Summaries",
    bullet(pack.context_budget.summaries.map((summary) => `${summary.section}: ${summary.text}`)),
    "",
    "## Prompt",
    pack.prompt_bundle.suggested_prompt,
    "",
    "## Warnings",
    bullet(pack.warnings),
    "",
    `Estimated tokens: ${pack.context_budget.estimated_tokens}${pack.context_budget.token_budget ? ` / ${pack.context_budget.token_budget}` : ""}`,
  ].filter((line): line is string => line !== null);
  return redactEvidenceText(lines.join("\n"));
}

export function renderAgentContextPack(pack: AgentContextPack, format: AgentContextPackFormat, compact = false): string {
  if (format === "compact-markdown") return renderAgentContextPackCompactMarkdown(pack);
  if (format === "compact-json") return JSON.stringify(pack);
  if (format === "markdown") return compact ? renderAgentContextPackCompactMarkdown(pack) : renderAgentContextPackMarkdown(pack);
  return compact ? JSON.stringify(pack) : JSON.stringify(pack, null, 2);
}
