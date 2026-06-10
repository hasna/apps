/**
 * Local natural-language task intake — explicit regex/heuristic parsing only.
 * Builds on inbox-intake for redaction, dedupe, and task creation.
 */

import type { Database } from "bun:sqlite";
import { getDatabase, now } from "../db/database.js";
import { createTask, getTask, type Task } from "../db/tasks.js";
import type { CreateTaskInput, TaskPriority, TaskStatus } from "../types/index.js";
import { isValidRecurrenceRule } from "./recurrence.js";
import {
  INBOX_INTAKE_SCHEMA,
  previewInboxIntake,
  formatIntakePreviewText,
  type IntakeInput,
  type IntakeOptions,
  type IntakePreview,
} from "./inbox-intake.js";

export const NL_INTAKE_SCHEMA = "todos.nl_intake.v1";

const DAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const PRIORITY_PATTERNS: Array<{ re: RegExp; priority: TaskPriority; label: string }> = [
  { re: /\b(?:critical|urgent|blocker|p0|sev-?0)\b/i, priority: "critical", label: "critical" },
  { re: /\bhigh\s+priority\b/i, priority: "high", label: "high" },
  { re: /\b(?:high|important|p1|sev-?1)\b/i, priority: "high", label: "high" },
  { re: /\blow\s+priority\b/i, priority: "low", label: "low" },
  { re: /\b(?:low|minor|p3|nice-to-have)\b/i, priority: "low", label: "low" },
  { re: /\bmedium\s+priority\b/i, priority: "medium", label: "medium" },
  { re: /\b(?:medium|normal|p2)\b/i, priority: "medium", label: "medium" },
];

const PREFIX_PATTERNS = [
  /^(?:please\s+)?(?:add|create|make|file|log|open|track)\s+(?:a\s+)?(?:new\s+)?(?:task|todo|item)\s*:\s*/i,
  /^(?:please\s+)?(?:add|create|make|file|log|open|track)\s+(?:a\s+)?(?:new\s+)?(?:task|todo|item)\s+(?:to\s+|for\s+)?/i,
  /^(?:please\s+)?(?:remind me to|remember to|need to)\s+/i,
  /^(?:task|todo)\s*:\s*/i,
];

export interface ParsedNlFields {
  title: string;
  description?: string;
  priority?: TaskPriority;
  due_at?: string;
  tags: string[];
  recurrence_rule?: string;
  assigned_to?: string;
  status?: TaskStatus;
}

export interface NlIntakeExplain {
  field: string;
  value: string;
  source: string;
}

export interface NlIntakeInput {
  text: string;
  project_id?: string;
  task_list_id?: string;
  agent_id?: string;
  assigned_to?: string;
  tags?: string[];
  priority?: TaskPriority;
}

export interface NlIntakePreview {
  schema_version: typeof NL_INTAKE_SCHEMA;
  dry_run: true;
  parsed: ParsedNlFields;
  explain: NlIntakeExplain[];
  intake: IntakePreview;
}

export interface NlIntakeResult {
  schema_version: typeof NL_INTAKE_SCHEMA;
  dry_run: boolean;
  parsed: ParsedNlFields;
  explain: NlIntakeExplain[];
  intake: IntakePreview;
  task: Task | null;
  skipped_duplicate: boolean;
}

export interface ParseNaturalLanguageOptions {
  now?: Date;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(17, 0, 0, 0);
  return x;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

function nextWeekday(base: Date, weekday: number): Date {
  const d = new Date(base);
  const current = d.getDay();
  let diff = weekday - current;
  if (diff <= 0) diff += 7;
  d.setDate(d.getDate() + diff);
  return d;
}

function extractDueDate(text: string, base: Date): { due_at?: string; source?: string } {
  const iso = text.match(/\b(?:due|by)\s+(\d{4}-\d{2}-\d{2})\b/i);
  if (iso) {
    return { due_at: endOfDay(new Date(iso[1]!)).toISOString(), source: iso[0] };
  }

  if (/\b(?:due\s+)?(?:today|tonight|eod|end of day)\b/i.test(text)) {
    return { due_at: endOfDay(base).toISOString(), source: "today" };
  }

  const tomorrow = text.match(/\b(?:due\s+)?tomorrow\b/i);
  if (tomorrow) {
    return { due_at: endOfDay(addDays(base, 1)).toISOString(), source: tomorrow[0] };
  }

  const inMatch = text.match(/\b(?:due\s+)?in\s+(\d+)\s+(day|days|week|weeks)\b/i);
  if (inMatch) {
    const n = parseInt(inMatch[1]!, 10);
    const unit = inMatch[2]!.toLowerCase();
    const days = unit.startsWith("week") ? n * 7 : n;
    return { due_at: endOfDay(addDays(base, days)).toISOString(), source: inMatch[0] };
  }

  const nextWeek = text.match(/\b(?:due\s+)?next\s+week\b/i);
  if (nextWeek) {
    return { due_at: endOfDay(addDays(base, 7)).toISOString(), source: nextWeek[0] };
  }

  const nextMonth = text.match(/\b(?:due\s+)?next\s+month\b/i);
  if (nextMonth) {
    const d = new Date(base);
    d.setMonth(d.getMonth() + 1);
    return { due_at: endOfDay(d).toISOString(), source: nextMonth[0] };
  }

  const nextDay = text.match(/\b(?:due\s+)?next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/i);
  if (nextDay) {
    const weekday = DAY_NAMES[nextDay[1]!.toLowerCase()];
    if (weekday !== undefined) {
      return { due_at: endOfDay(nextWeekday(base, weekday)).toISOString(), source: nextDay[0] };
    }
  }

  const thisDay = text.match(/\b(?:due\s+)?(?:this|on)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/i);
  if (thisDay) {
    const weekday = DAY_NAMES[thisDay[1]!.toLowerCase()];
    if (weekday !== undefined) {
      const d = new Date(base);
      const diff = weekday - d.getDay();
      if (diff >= 0) d.setDate(d.getDate() + diff);
      else d.setDate(d.getDate() + diff + 7);
      return { due_at: endOfDay(d).toISOString(), source: thisDay[0] };
    }
  }

  return {};
}

function extractRecurrence(text: string): { recurrence_rule?: string; source?: string } {
  const explicit = text.match(/\b(?:recurring|repeat)\s+(every\s+[a-z0-9,\s-]+)/i);
  if (explicit) {
    const rule = explicit[1]!.trim().toLowerCase();
    if (isValidRecurrenceRule(rule)) {
      return { recurrence_rule: rule, source: explicit[0] };
    }
  }

  const every = text.match(/\b(every\s+(?:day|weekday|week|month|\d+\s+(?:day|week|month)s?|[a-z,]+))\b/i);
  if (every) {
    const rule = every[1]!.trim().toLowerCase();
    if (isValidRecurrenceRule(rule)) {
      return { recurrence_rule: rule, source: every[0] };
    }
  }

  return {};
}

function extractTags(text: string): { tags: string[]; stripped: string } {
  const tags = new Set<string>();
  let stripped = text;

  const tagList = stripped.match(/\btags?\s*:\s*([^\n.;]+)/i);
  if (tagList) {
    for (const part of tagList[1]!.split(/[,#]+/)) {
      const tag = part.trim().toLowerCase().replace(/\s+/g, "-");
      if (tag) tags.add(tag);
    }
    stripped = stripped.replace(tagList[0], " ");
  }

  for (const match of stripped.matchAll(/#([a-z][a-z0-9_-]*)/gi)) {
    tags.add(match[1]!.toLowerCase());
    stripped = stripped.replace(match[0], " ");
  }

  return { tags: [...tags], stripped };
}

function extractAssignee(text: string): { assigned_to?: string; source?: string; stripped: string } {
  const assign = text.match(/\b(?:assign(?:ed)?\s+to|for\s+agent|owner)\s+(@?[a-z][a-z0-9_-]*)\b/i);
  if (assign) {
    const assigned = assign[1]!.replace(/^@/, "");
    return {
      assigned_to: assigned,
      source: assign[0],
      stripped: text.replace(assign[0], " "),
    };
  }
  return { stripped: text };
}

function extractStatus(text: string): { status?: TaskStatus; source?: string; stripped: string } {
  if (/\b(?:start(?:\s+now|\s+immediately)?|in[-\s]?progress)\b/i.test(text)) {
    const match = text.match(/\b(?:start(?:\s+now|\s+immediately)?|in[-\s]?progress)\b/i);
    return {
      status: "in_progress",
      source: match?.[0],
      stripped: text.replace(match?.[0] ?? "", " "),
    };
  }
  return { stripped: text };
}

function stripPriority(text: string): { priority?: TaskPriority; source?: string; stripped: string } {
  for (const pattern of PRIORITY_PATTERNS) {
    const match = text.match(pattern.re);
    if (match) {
      return {
        priority: pattern.priority,
        source: match[0],
        stripped: text.replace(match[0], " "),
      };
    }
  }
  return { stripped: text };
}

function stripDuePhrases(text: string): string {
  return text
    .replace(/\b(?:due|by)\s+\d{4}-\d{2}-\d{2}\b/gi, " ")
    .replace(/\b(?:due\s+)?(?:today|tonight|tomorrow|eod|end of day)\b/gi, " ")
    .replace(/\b(?:due\s+)?in\s+\d+\s+(?:day|days|week|weeks)\b/gi, " ")
    .replace(/\b(?:due\s+)?next\s+(?:week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/gi, " ")
    .replace(/\b(?:due\s+)?(?:this|on)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/gi, " ");
}

function stripRecurrence(text: string): string {
  return text
    .replace(/\b(?:recurring|repeat)\s+every\s+[a-z0-9,\s-]+/gi, " ")
    .replace(/\bevery\s+(?:day|weekday|week|month|\d+\s+(?:day|week|month)s?|[a-z,]+)\b/gi, " ");
}

function normalizeTitle(text: string): string {
  let title = text.trim();
  for (const prefix of PREFIX_PATTERNS) {
    title = title.replace(prefix, "");
  }
  title = title.replace(/\s{2,}/g, " ").replace(/^[-–—:,.\s]+|[-–—:,.\s]+$/g, "").trim();
  if (!title) return "Untitled task";
  return title.charAt(0).toUpperCase() + title.slice(1);
}

export function parseNaturalLanguageTask(
  text: string,
  options: ParseNaturalLanguageOptions = {},
): { parsed: ParsedNlFields; explain: NlIntakeExplain[] } {
  const raw = text.trim();
  if (!raw) throw new Error("Natural language intake text cannot be empty");

  const base = options.now ?? new Date();
  const explain: NlIntakeExplain[] = [];

  const tagHit = extractTags(raw);
  if (tagHit.tags.length) {
    explain.push({ field: "tags", value: tagHit.tags.join(", "), source: "tags/#hashtags" });
  }

  const priorityHit = stripPriority(tagHit.stripped);
  if (priorityHit.priority) {
    explain.push({ field: "priority", value: priorityHit.priority, source: priorityHit.source ?? priorityHit.priority });
  }

  const dueHit = extractDueDate(priorityHit.stripped, base);
  if (dueHit.due_at) {
    explain.push({ field: "due_at", value: dueHit.due_at, source: dueHit.source ?? "due phrase" });
  }

  const recurrenceHit = extractRecurrence(priorityHit.stripped);
  if (recurrenceHit.recurrence_rule) {
    explain.push({
      field: "recurrence_rule",
      value: recurrenceHit.recurrence_rule,
      source: recurrenceHit.source ?? recurrenceHit.recurrence_rule,
    });
  }

  const assignHit = extractAssignee(priorityHit.stripped);
  if (assignHit.assigned_to) {
    explain.push({ field: "assigned_to", value: assignHit.assigned_to, source: assignHit.source ?? assignHit.assigned_to });
  }

  const statusHit = extractStatus(assignHit.stripped);
  if (statusHit.status) {
    explain.push({ field: "status", value: statusHit.status, source: statusHit.source ?? statusHit.status });
  }

  let remainder = statusHit.stripped;
  remainder = stripDuePhrases(remainder);
  remainder = stripRecurrence(remainder);
  remainder = remainder.replace(/\b(?:assign(?:ed)?\s+to|for\s+agent|owner)\s+@?[a-z][a-z0-9_-]*\b/gi, " ");
  remainder = remainder.replace(/\s{2,}/g, " ").trim();

  const lines = remainder.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const title = normalizeTitle(lines[0] ?? remainder);
  const description = lines.length > 1 ? lines.slice(1).join("\n").slice(0, 8000) : undefined;

  return {
    parsed: {
      title,
      description,
      priority: priorityHit.priority,
      due_at: dueHit.due_at,
      tags: tagHit.tags,
      recurrence_rule: recurrenceHit.recurrence_rule,
      assigned_to: assignHit.assigned_to,
      status: statusHit.status,
    },
    explain,
  };
}

function toIntakeInput(input: NlIntakeInput, parsed: ParsedNlFields): IntakeInput {
  const body = parsed.description ? `${parsed.title}\n\n${parsed.description}` : parsed.title;
  return {
    text: body,
    source_type: "text",
    title: parsed.title,
    project_id: input.project_id,
    task_list_id: input.task_list_id,
    agent_id: input.agent_id,
    tags: [...new Set([...(input.tags ?? []), ...parsed.tags, "nl-intake"])],
    priority: input.priority ?? parsed.priority,
  };
}

function enrichIntakePreview(intake: IntakePreview, parsed: ParsedNlFields, rawText: string): IntakePreview {
  const create_task_input: CreateTaskInput = {
    ...intake.create_task_input,
    due_at: parsed.due_at,
    recurrence_rule: parsed.recurrence_rule,
    assigned_to: parsed.assigned_to,
    status: parsed.status ?? intake.create_task_input.status,
    metadata: {
      ...intake.create_task_input.metadata,
      nl_intake: true,
      nl_raw: rawText,
      intake_source: "nl_text",
    },
  };

  return {
    ...intake,
    source_type: "text",
    create_task_input,
  };
}

export function previewNlIntake(input: NlIntakeInput, db?: Database): NlIntakePreview {
  const d = db || getDatabase();
  const { parsed, explain } = parseNaturalLanguageTask(input.text);
  const intake = enrichIntakePreview(
    previewInboxIntake(toIntakeInput(input, parsed), d),
    parsed,
    input.text,
  );

  return {
    schema_version: NL_INTAKE_SCHEMA,
    dry_run: true,
    parsed,
    explain,
    intake,
  };
}

export function createNlIntake(
  input: NlIntakeInput,
  options: IntakeOptions = {},
  db?: Database,
): NlIntakeResult {
  const d = db || getDatabase();
  const preview = previewNlIntake(input, d);

  if (options.dry_run) {
    return {
      schema_version: NL_INTAKE_SCHEMA,
      dry_run: true,
      parsed: preview.parsed,
      explain: preview.explain,
      intake: preview.intake,
      task: null,
      skipped_duplicate: false,
    };
  }

  const intakePreview = preview.intake;

  if (intakePreview.duplicate_of && !options.skip_dedupe && !options.force) {
    const existing = getTask(intakePreview.duplicate_of.task_id, d)!;
    return {
      schema_version: NL_INTAKE_SCHEMA,
      dry_run: false,
      parsed: preview.parsed,
      explain: preview.explain,
      intake: { ...intakePreview, triage_status: "duplicate" },
      task: existing,
      skipped_duplicate: true,
    };
  }

  const createInput: CreateTaskInput = {
    ...intakePreview.create_task_input,
    metadata: {
      ...intakePreview.create_task_input.metadata,
      triage_status: "created",
      intake_created_at: now(),
    },
  };

  const task = createTask(createInput, d);
  return {
    schema_version: NL_INTAKE_SCHEMA,
    dry_run: false,
    parsed: preview.parsed,
    explain: preview.explain,
    intake: { ...intakePreview, triage_status: "created" },
    task,
    skipped_duplicate: false,
  };
}

export function formatNlIntakePreviewText(preview: NlIntakePreview): string {
  const lines = [
    `Schema: ${preview.schema_version}`,
    `Dry run: yes`,
    `Title: ${preview.parsed.title}`,
  ];

  if (preview.parsed.priority) lines.push(`Priority: ${preview.parsed.priority}`);
  if (preview.parsed.due_at) lines.push(`Due: ${preview.parsed.due_at}`);
  if (preview.parsed.recurrence_rule) lines.push(`Recurrence: ${preview.parsed.recurrence_rule}`);
  if (preview.parsed.assigned_to) lines.push(`Assigned to: ${preview.parsed.assigned_to}`);
  if (preview.parsed.tags.length) lines.push(`Tags: ${preview.parsed.tags.join(", ")}`);

  if (preview.explain.length) {
    lines.push("", "Parsed from text:");
    for (const item of preview.explain) {
      lines.push(`  - ${item.field}: ${item.value} (${item.source})`);
    }
  }

  lines.push("", "--- Inbox intake preview ---", formatIntakePreviewText(preview.intake));
  return lines.join("\n");
}

export { INBOX_INTAKE_SCHEMA };
