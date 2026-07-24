import type { Database } from "bun:sqlite";
import type { Plan, Task } from "../types/index.js";
import { getDatabase, now } from "../db/database.js";
import { getPlan, listPlans } from "../db/plans.js";
import { getProject } from "../db/projects.js";
import { getTaskCommits, getTaskVerifications, type TaskCommit, type TaskVerification } from "../db/task-commits.js";
import { listTasks } from "../db/tasks.js";

export interface GenerateReleaseNotesInput {
  project_id?: string;
  plan_id?: string;
  task_ids?: string[];
  tag?: string;
  since?: string;
  until?: string;
  title?: string;
  version?: string;
  generated_at?: string;
}

export interface ReleaseNotesScope {
  project_id: string | null;
  project_name: string | null;
  plan_id: string | null;
  plan_name: string | null;
  task_ids: string[];
  tag: string | null;
  since: string | null;
  until: string | null;
}

export interface ReleaseNotesTask {
  id: string;
  short_id: string | null;
  title: string;
  description: string | null;
  priority: Task["priority"];
  project_id: string | null;
  plan_id: string | null;
  tags: string[];
  completed_at: string | null;
  breaking_changes: string[];
  migration_notes: string[];
  commits: TaskCommit[];
  verifications: TaskVerification[];
}

export interface ReleaseNotesPlan {
  id: string;
  name: string;
  status: Plan["status"];
  task_count: number;
  completed_count: number;
}

export interface ReleaseNotesDocument {
  schema_version: 1;
  generated_at: string;
  title: string;
  version: string | null;
  local_only: true;
  scope: ReleaseNotesScope;
  summary: {
    tasks: number;
    plans: number;
    commits: number;
    verifications: number;
    passed_verifications: number;
    breaking_changes: number;
    migration_notes: number;
  };
  plans: ReleaseNotesPlan[];
  tasks: ReleaseNotesTask[];
  commits: TaskCommit[];
  verifications: TaskVerification[];
  breaking_changes: Array<{ task_id: string; title: string; note: string }>;
  migration_notes: Array<{ task_id: string; title: string; note: string }>;
  warnings: string[];
}

function asTextArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  }
  if (value === true) return ["Marked as breaking change"];
  return [];
}

function metadataNotes(task: Task, key: "breaking" | "migration"): string[] {
  const metadata = task.metadata || {};
  if (key === "breaking") {
    return [
      ...asTextArray(metadata["breaking_change"]),
      ...asTextArray(metadata["breaking_changes"]),
    ];
  }
  return [
    ...asTextArray(metadata["migration_note"]),
    ...asTextArray(metadata["migration_notes"]),
  ];
}

function inWindow(task: Task, input: GenerateReleaseNotesInput): boolean {
  const completed = task.completed_at || task.updated_at;
  if (input.since && completed < input.since) return false;
  if (input.until && completed > input.until) return false;
  return true;
}

function collectPlans(tasks: Task[], input: GenerateReleaseNotesInput, db: Database): ReleaseNotesPlan[] {
  const taskPlanIds = new Set(tasks.map((task) => task.plan_id).filter((id): id is string => Boolean(id)));
  if (input.plan_id) taskPlanIds.add(input.plan_id);

  const plans = input.project_id
    ? listPlans(input.project_id, db).filter((plan) => taskPlanIds.has(plan.id))
    : [...taskPlanIds].map((id) => getPlan(id, db)).filter((plan): plan is Plan => Boolean(plan));

  return plans
    .map((plan) => {
      const planTasks = tasks.filter((task) => task.plan_id === plan.id);
      return {
        id: plan.id,
        name: plan.name,
        status: plan.status,
        task_count: planTasks.length,
        completed_count: planTasks.filter((task) => task.status === "completed").length,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function generateReleaseNotes(input: GenerateReleaseNotesInput = {}, db?: Database): ReleaseNotesDocument {
  const d = getDatabase(db);
  const project = input.project_id ? getProject(input.project_id, d) : null;
  const plan = input.plan_id ? getPlan(input.plan_id, d) : null;
  const filters = {
    status: "completed" as const,
    project_id: input.project_id,
    plan_id: input.plan_id,
    ids: input.task_ids,
    tags: input.tag ? [input.tag] : undefined,
    include_archived: true,
  };

  const tasks = listTasks(filters, d)
    .filter((task) => inWindow(task, input))
    .sort((left, right) => (right.completed_at || right.updated_at).localeCompare(left.completed_at || left.updated_at));

  const releaseTasks: ReleaseNotesTask[] = tasks.map((task) => ({
    id: task.id,
    short_id: task.short_id,
    title: task.title,
    description: task.description,
    priority: task.priority,
    project_id: task.project_id,
    plan_id: task.plan_id,
    tags: task.tags,
    completed_at: task.completed_at,
    breaking_changes: metadataNotes(task, "breaking"),
    migration_notes: metadataNotes(task, "migration"),
    commits: getTaskCommits(task.id, d),
    verifications: getTaskVerifications(task.id, d),
  }));

  const commits = releaseTasks.flatMap((task) => task.commits);
  const verifications = releaseTasks.flatMap((task) => task.verifications);
  const breakingChanges = releaseTasks.flatMap((task) => (
    task.breaking_changes.map((note) => ({ task_id: task.id, title: task.title, note }))
  ));
  const migrationNotes = releaseTasks.flatMap((task) => (
    task.migration_notes.map((note) => ({ task_id: task.id, title: task.title, note }))
  ));
  const warnings: string[] = [];
  if (input.project_id && !project) warnings.push(`project not found: ${input.project_id}`);
  if (input.plan_id && !plan) warnings.push(`plan not found: ${input.plan_id}`);
  if (releaseTasks.length === 0) warnings.push("no completed tasks matched the release-note scope");

  return {
    schema_version: 1,
    generated_at: input.generated_at || now(),
    title: input.title || "Release Notes",
    version: input.version || null,
    local_only: true,
    scope: {
      project_id: input.project_id || null,
      project_name: project?.name || null,
      plan_id: input.plan_id || null,
      plan_name: plan?.name || null,
      task_ids: input.task_ids || [],
      tag: input.tag || null,
      since: input.since || null,
      until: input.until || null,
    },
    summary: {
      tasks: releaseTasks.length,
      plans: new Set(releaseTasks.map((task) => task.plan_id).filter(Boolean)).size,
      commits: commits.length,
      verifications: verifications.length,
      passed_verifications: verifications.filter((verification) => verification.status === "passed").length,
      breaking_changes: breakingChanges.length,
      migration_notes: migrationNotes.length,
    },
    plans: collectPlans(tasks, input, d),
    tasks: releaseTasks,
    commits,
    verifications,
    breaking_changes: breakingChanges,
    migration_notes: migrationNotes,
    warnings,
  };
}

function bullet(lines: string[]): string {
  return lines.length ? lines.map((line) => `- ${line}`).join("\n") : "- None";
}

export function renderReleaseNotesMarkdown(document: ReleaseNotesDocument): string {
  const lines: string[] = [];
  lines.push(`# ${document.title}`);
  if (document.version) lines.push("", `Version: ${document.version}`);
  lines.push("", `Generated: ${document.generated_at}`);
  lines.push("", "## Summary");
  lines.push(`- Completed tasks: ${document.summary.tasks}`);
  lines.push(`- Plans: ${document.summary.plans}`);
  lines.push(`- Linked commits: ${document.summary.commits}`);
  lines.push(`- Verification records: ${document.summary.verifications} (${document.summary.passed_verifications} passed)`);
  lines.push(`- Breaking changes: ${document.summary.breaking_changes}`);
  lines.push(`- Migration notes: ${document.summary.migration_notes}`);

  if (document.plans.length > 0) {
    lines.push("", "## Plans");
    for (const plan of document.plans) {
      lines.push(`- ${plan.name} (${plan.status}) - ${plan.completed_count}/${plan.task_count} completed`);
    }
  }

  lines.push("", "## Completed Tasks");
  if (document.tasks.length === 0) {
    lines.push("- None");
  } else {
    for (const task of document.tasks) {
      const id = task.short_id || task.id.slice(0, 8);
      const suffix = task.completed_at ? ` - ${task.completed_at}` : "";
      lines.push(`- ${id} ${task.title} [${task.priority}]${suffix}`);
      for (const commit of task.commits) {
        lines.push(`  - commit ${commit.sha.slice(0, 12)}${commit.message ? `: ${commit.message}` : ""}`);
      }
      for (const verification of task.verifications) {
        lines.push(`  - verification ${verification.status}: ${verification.command}`);
      }
    }
  }

  lines.push("", "## Breaking Changes");
  lines.push(bullet(document.breaking_changes.map((item) => `${item.title}: ${item.note}`)));
  lines.push("", "## Migration Notes");
  lines.push(bullet(document.migration_notes.map((item) => `${item.title}: ${item.note}`)));

  if (document.warnings.length > 0) {
    lines.push("", "## Warnings");
    lines.push(bullet(document.warnings));
  }

  return `${lines.join("\n")}\n`;
}
