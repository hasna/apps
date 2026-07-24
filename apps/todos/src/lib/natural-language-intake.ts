import type { Database } from "bun:sqlite";
import { createPlan } from "../db/plans.js";
import { createProject } from "../db/projects.js";
import { addDependency } from "../db/task-graph.js";
import { createTask } from "../db/tasks.js";
import type { Plan, Project, Task, TaskPriority } from "../types/index.js";
import { getDatabase } from "../db/database.js";
import { redactEvidenceText } from "./redaction.js";

export interface NaturalLanguageProjectPreview {
  name: string;
  description: string | null;
  path: string;
}

export interface NaturalLanguagePlanPreview {
  name: string;
  description: string | null;
}

export interface NaturalLanguageDependencyPreview {
  task_title: string;
  depends_on_title: string;
  resolved: boolean;
}

export interface NaturalLanguageTaskPreview {
  title: string;
  description: string | null;
  priority: TaskPriority;
  tags: string[];
  assigned_to: string | null;
  due_at: string | null;
  depends_on: string[];
  acceptance_criteria: string[];
}

export interface NaturalLanguageIntakeInput {
  text: string;
  project_id?: string;
  task_list_id?: string;
  default_priority?: TaskPriority;
  reference_date?: string;
  apply?: boolean;
}

export interface NaturalLanguageIntakePreview {
  schema_version: 1;
  local_only: true;
  dry_run: boolean;
  source_text: string;
  project_id: string | null;
  task_list_id: string | null;
  detected_project_name: string | null;
  detected_plan_name: string | null;
  project: NaturalLanguageProjectPreview | null;
  plan: NaturalLanguagePlanPreview | null;
  tasks: NaturalLanguageTaskPreview[];
  dependencies: NaturalLanguageDependencyPreview[];
  acceptance_criteria: string[];
  created_project: Project | null;
  created_plan: Plan | null;
  created_tasks: Task[];
  warnings: string[];
  commands: string[];
}

const PRIORITIES = new Set<TaskPriority>(["low", "medium", "high", "critical"]);

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripBullet(value: string): string {
  return value
    .replace(/^\s*[-*]\s+\[[ xX]\]\s+/, "")
    .replace(/^\s*[-*]\s+/, "")
    .replace(/^\s*\d+[.)]\s+/, "")
    .trim();
}

function splitItems(text: string): string[] {
  return text
    .split(/\r?\n|;/)
    .map(stripBullet)
    .map(compact)
    .filter(Boolean);
}

function parsePriority(line: string, fallback: TaskPriority): TaskPriority {
  const explicit = line.match(/\b(?:priority[:= ]+|p:)(critical|high|medium|low)\b/i)?.[1]?.toLowerCase();
  if (explicit && PRIORITIES.has(explicit as TaskPriority)) return explicit as TaskPriority;
  if (/\b(p0|urgent|blocker|critical)\b/i.test(line)) return "critical";
  if (/\b(p1|high)\b/i.test(line)) return "high";
  if (/\b(p3|low)\b/i.test(line)) return "low";
  return fallback;
}

function parseAssignee(line: string): string | null {
  const mention = line.match(/(?:^|\s)@([a-zA-Z0-9._-]+)/)?.[1];
  if (mention) return mention;
  return line.match(/\bassign(?:ed)?\s+(?:to\s+)?([a-zA-Z0-9._-]+)/i)?.[1] || null;
}

function parseTags(line: string): string[] {
  return Array.from(new Set(Array.from(line.matchAll(/#([a-zA-Z0-9._-]+)/g)).map((match) => match[1]!.toLowerCase()))).slice(0, 10);
}

function parseDependencies(line: string): string[] {
  const dependencies: string[] = [];
  for (const match of line.matchAll(/\b(?:depends on|blocked by|after)\s+(.+?)(?=\s+(?:priority|p:|due|assign|@|#|acceptance|ac[:=])\b|$)/gi)) {
    const dependency = cleanTitle(match[1] || "");
    if (dependency) dependencies.push(dependency);
  }
  return Array.from(new Set(dependencies));
}

function parseInlineAcceptance(line: string): string[] {
  const match = line.match(/\b(?:acceptance(?: criteria)?|ac)[:=]\s*(.+)$/i);
  if (!match?.[1]) return [];
  return match[1]
    .split(/\s+\|\s+|,\s+(?=(?:and\s+)?[A-Z]|\w+\s+\w+)/)
    .map(cleanAcceptanceCriterion)
    .filter(Boolean)
    .slice(0, 10);
}

function cleanAcceptanceCriterion(value: string): string {
  return compact(value.replace(/^(?:acceptance(?: criteria)?|ac)[:=]\s*/i, ""));
}

function parseDue(line: string, referenceDate: Date): string | null {
  const iso = line.match(/\bdue[:= ]+(\d{4}-\d{2}-\d{2})\b/i)?.[1];
  if (iso) return new Date(`${iso}T12:00:00.000Z`).toISOString();
  const date = new Date(referenceDate);
  if (/\bdue\s+today\b/i.test(line)) return date.toISOString();
  if (/\bdue\s+tomorrow\b/i.test(line)) {
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString();
  }
  if (/\bdue\s+next\s+week\b/i.test(line)) {
    date.setUTCDate(date.getUTCDate() + 7);
    return date.toISOString();
  }
  return null;
}

function cleanTitle(line: string): string {
  return compact(line
    .replace(/^(?:task|todo)[:=]\s*/i, "")
    .replace(/^add\s+(?:a\s+)?(?:task|todo)\s+/i, "")
    .replace(/\b(?:depends on|blocked by|after)\s+.+?(?=\s+(?:priority|p:|due|assign|@|#|acceptance|ac[:=])\b|$)/ig, "")
    .replace(/\b(?:acceptance(?: criteria)?|ac)[:=]\s*.+$/ig, "")
    .replace(/\bpriority[:= ]+(critical|high|medium|low)\b/ig, "")
    .replace(/\bp[0-3]\b/ig, "")
    .replace(/\b(?:urgent|blocker)\b/ig, "")
    .replace(/\bassign(?:ed)?\s+(?:to\s+)?[a-zA-Z0-9._-]+/ig, "")
    .replace(/(?:^|\s)@[a-zA-Z0-9._-]+/g, "")
    .replace(/#[a-zA-Z0-9._-]+/g, "")
    .replace(/\bdue[:= ]+\d{4}-\d{2}-\d{2}\b/ig, "")
    .replace(/\bdue\s+(today|tomorrow|next\s+week)\b/ig, ""));
}

function detectLabel(lines: string[], label: "project" | "plan"): string | null {
  const direct = lines.map((line) => line.match(new RegExp(`^${label}[:=]\\s*(.+)$`, "i"))?.[1]).find(Boolean);
  if (direct) return compact(direct);
  if (label === "project") return lines.map((line) => line.match(/^create\s+project\s+(.+)$/i)?.[1]).find(Boolean) || null;
  return null;
}

function isAcceptanceLine(line: string): boolean {
  return /^(?:acceptance(?: criteria)?|ac)[:=]/i.test(line);
}

function isTaskCandidate(line: string): boolean {
  return /^(task|todo)[:=]/i.test(line)
    || /^add\s+(a\s+)?(task|todo)\s+/i.test(line)
    || /\b(fix|build|create|update|write|review|test|ship|document|investigate)\b/i.test(line);
}

export function previewNaturalLanguageIntake(input: NaturalLanguageIntakeInput, db?: Database): NaturalLanguageIntakePreview {
  const text = redactEvidenceText(input.text || "");
  const referenceDate = input.reference_date ? new Date(input.reference_date) : new Date();
  const lines = splitItems(text);
  const fallbackPriority = input.default_priority || "medium";
  const detectedProject = detectLabel(lines, "project");
  const detectedPlan = detectLabel(lines, "plan");
  const globalAcceptance = lines.filter(isAcceptanceLine).map(cleanAcceptanceCriterion).filter(Boolean);
  const taskLines = lines.filter((line) => !/^project[:=]/i.test(line) && !/^plan[:=]/i.test(line) && !/^create\s+project\s+/i.test(line) && !isAcceptanceLine(line) && isTaskCandidate(line));
  const tasks = taskLines.map((line, index) => {
    const inlineAcceptance = parseInlineAcceptance(line);
    const acceptance = index === taskLines.length - 1
      ? Array.from(new Set([...inlineAcceptance, ...globalAcceptance]))
      : inlineAcceptance;
    return {
      title: cleanTitle(line).slice(0, 200) || "Untitled local task",
      description: `Parsed from local natural-language intake:\n${line}`,
      priority: parsePriority(line, fallbackPriority),
      tags: parseTags(line),
      assigned_to: parseAssignee(line),
      due_at: parseDue(line, referenceDate),
      depends_on: parseDependencies(line),
      acceptance_criteria: acceptance,
    };
  });
  const taskTitleSet = new Set(tasks.map((task) => task.title.toLowerCase()));
  const dependencies = tasks.flatMap((task) => task.depends_on.map((dependency) => ({
    task_title: task.title,
    depends_on_title: dependency,
    resolved: taskTitleSet.has(dependency.toLowerCase()),
  })));
  const project = detectedProject ? {
    name: detectedProject,
    description: "Parsed from local natural-language intake.",
    path: process.cwd(),
  } : null;
  const plan = detectedPlan ? {
    name: detectedPlan,
    description: "Parsed from local natural-language intake.",
  } : null;
  const warnings: string[] = [];
  if (tasks.length === 0) warnings.push("no task-like lines were detected");
  if (detectedProject && !input.project_id) warnings.push("project name will create a local project only when apply is true");
  if (detectedPlan) warnings.push("plan name will create a local plan only when apply is true");
  for (const dependency of dependencies) {
    if (!dependency.resolved) warnings.push(`dependency "${dependency.depends_on_title}" was not matched to another parsed task`);
  }

  const dryRun = input.apply !== true;
  const d = getDatabase(db);
  const createdProject = !dryRun && project && !input.project_id ? createProject({
    name: project.name,
    path: project.path,
    description: project.description || undefined,
  }, d) : null;
  const resolvedProjectId = input.project_id || createdProject?.id;
  const createdPlan = !dryRun && plan ? createPlan({
    name: plan.name,
    description: plan.description || undefined,
    project_id: resolvedProjectId,
    task_list_id: input.task_list_id,
  }, d) : null;
  const created = dryRun ? [] : tasks.map((task) => createTask({
    title: task.title,
    description: task.description || undefined,
    priority: task.priority,
    tags: task.tags,
    assigned_to: task.assigned_to || undefined,
    due_at: task.due_at || undefined,
    project_id: resolvedProjectId,
    task_list_id: input.task_list_id,
    plan_id: createdPlan?.id,
    metadata: {
      intake_source: "natural_language",
      detected_project_name: detectedProject,
      detected_plan_name: detectedPlan,
      depends_on_titles: task.depends_on,
      acceptance_criteria: task.acceptance_criteria,
    },
  }, d));
  if (!dryRun && created.length > 0) {
    const byTitle = new Map(created.map((task) => [task.title.toLowerCase(), task.id]));
    for (const dependency of dependencies) {
      const taskId = byTitle.get(dependency.task_title.toLowerCase());
      const dependsOnId = byTitle.get(dependency.depends_on_title.toLowerCase());
      if (taskId && dependsOnId) addDependency(taskId, dependsOnId, d);
    }
  }

  return {
    schema_version: 1,
    local_only: true,
    dry_run: dryRun,
    source_text: text,
    project_id: input.project_id || null,
    task_list_id: input.task_list_id || null,
    detected_project_name: detectedProject,
    detected_plan_name: detectedPlan,
    project,
    plan,
    tasks,
    dependencies,
    acceptance_criteria: globalAcceptance,
    created_project: createdProject,
    created_plan: createdPlan,
    created_tasks: created,
    warnings,
    commands: tasks.map((task) => `todos add ${JSON.stringify(task.title)} --priority ${task.priority}${task.tags.length ? ` --tag ${task.tags.join(",")}` : ""}${task.assigned_to ? ` --assign ${task.assigned_to}` : ""}`),
  };
}
