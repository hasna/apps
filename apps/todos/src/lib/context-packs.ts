/**
 * Local agent context packs — deterministic Markdown/JSON bundles for agent runs.
 */

import { getTask, getTaskWithRelations, listTasks } from "../db/tasks.js";
import { getProject } from "../db/projects.js";
import { getPlan } from "../db/plans.js";
import { listComments } from "../db/comments.js";
import { listTaskFiles } from "../db/task-files.js";
import { listVerificationRecords } from "./verification-providers.js";
import { listArtifacts } from "../db/artifacts.js";
import { redactObject } from "./local-encryption.js";
import type { Task } from "../types/index.js";

export const CONTEXT_PACK_VERSION = "todos.context-pack.v1";

export interface ContextPackInput {
  task_id?: string;
  project_id?: string;
  plan_id?: string;
  agent_id?: string;
  include_files?: boolean;
  include_verification?: boolean;
  include_artifacts?: boolean;
  redact?: boolean;
}

export interface ContextPack {
  schema_version: typeof CONTEXT_PACK_VERSION;
  generated_at: string;
  task: Record<string, unknown> | null;
  project: Record<string, unknown> | null;
  plan: Record<string, unknown> | null;
  dependencies: Array<{ id: string; title: string; status: string }>;
  blocked_by: Array<{ id: string; title: string; status: string }>;
  subtasks: Array<{ id: string; title: string; status: string }>;
  comments: Array<{ content: string; agent_id: string | null; created_at: string }>;
  files: string[];
  verification_history: Array<{ provider: string; status: string; summary: string; created_at: string }>;
  artifacts: Array<{ id: string; name: string; storage_mode: string; redaction_status: string }>;
  acceptance_criteria: string[];
  prompt_bundle: string;
}

function taskSummary(task: Task): Record<string, unknown> {
  return {
    id: task.id,
    short_id: task.short_id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    plan_id: task.plan_id,
    project_id: task.project_id,
    assigned_to: task.assigned_to,
    tags: task.tags,
    due_at: task.due_at,
    metadata: task.metadata,
  };
}

export function buildContextPack(input: ContextPackInput): ContextPack {
  const generatedAt = new Date().toISOString();
  let task: Task | null = null;
  let project = null;
  let plan = null;
  let dependencies: ContextPack["dependencies"] = [];
  let blocked_by: ContextPack["blocked_by"] = [];
  let subtasks: ContextPack["subtasks"] = [];
  let comments: ContextPack["comments"] = [];
  let files: string[] = [];
  let verification_history: ContextPack["verification_history"] = [];
  let artifacts: ContextPack["artifacts"] = [];
  let acceptance_criteria: string[] = [];

  if (input.task_id) {
    const rel = getTaskWithRelations(input.task_id);
    if (rel) {
      task = rel;
      dependencies = rel.dependencies.map((d) => ({ id: d.id, title: d.title, status: d.status }));
      blocked_by = rel.blocked_by.map((d) => ({ id: d.id, title: d.title, status: d.status }));
      subtasks = rel.subtasks.map((s) => ({ id: s.id, title: s.title, status: s.status }));
      comments = listComments(task.id).slice(-20).map((c) => ({
        content: c.content,
        agent_id: c.agent_id,
        created_at: c.created_at,
      }));
      if (input.include_files !== false) {
        files = listTaskFiles(task.id).map((f) => f.path);
      }
      if (input.include_verification !== false) {
        verification_history = listVerificationRecords({ task_id: task.id, limit: 10 }).map((v) => ({
          provider: v.provider_name,
          status: v.status,
          summary: v.summary,
          created_at: v.created_at,
        }));
      }
      if (input.include_artifacts !== false) {
        artifacts = listArtifacts({ entity_type: "task", entity_id: task.id }).map((a) => ({
          id: a.id,
          name: a.name,
          storage_mode: a.storage_mode,
          redaction_status: a.redaction_status,
        }));
      }
      const meta = task.metadata as Record<string, unknown>;
      if (Array.isArray(meta.acceptance_criteria)) {
        acceptance_criteria = meta.acceptance_criteria as string[];
      } else if (typeof meta.acceptance === "string") {
        acceptance_criteria = [meta.acceptance];
      }
    }
  }

  const projectId = input.project_id || task?.project_id;
  if (projectId) {
    const p = getProject(projectId);
    if (p) project = { id: p.id, name: p.name, path: p.path, description: p.description };
  }

  const planId = input.plan_id || task?.plan_id;
  if (planId) {
    const pl = getPlan(planId);
    if (pl) {
      plan = { id: pl.id, name: pl.name, description: pl.description, status: pl.status };
      if (!task) {
        const planTasks = listTasks({ plan_id: planId, limit: 50 });
        subtasks = planTasks.map((t) => ({ id: t.id, title: t.title, status: t.status }));
      }
    }
  }

  let pack: ContextPack = {
    schema_version: CONTEXT_PACK_VERSION,
    generated_at: generatedAt,
    task: task ? taskSummary(task) : null,
    project,
    plan,
    dependencies,
    blocked_by,
    subtasks,
    comments,
    files,
    verification_history,
    artifacts,
    acceptance_criteria,
    prompt_bundle: "",
  };

  if (input.redact !== false) {
    pack = {
      ...pack,
      task: pack.task ? redactObject(pack.task) : null,
      project: pack.project ? redactObject(pack.project) : null,
      plan: pack.plan ? redactObject(pack.plan) : null,
    };
  }

  pack.prompt_bundle = formatContextPackMarkdown(pack);
  return pack;
}

export function formatContextPackMarkdown(pack: ContextPack): string {
  const lines: string[] = [
    "# Agent Context Pack",
    "",
    `Generated: ${pack.generated_at}`,
    "",
  ];

  if (pack.task) {
    lines.push("## Task", "");
    lines.push(`- **ID:** ${pack.task.short_id || (pack.task.id as string)?.slice(0, 8)}`);
    lines.push(`- **Title:** ${pack.task.title}`);
    lines.push(`- **Status:** ${pack.task.status} | **Priority:** ${pack.task.priority}`);
    if (pack.task.description) lines.push("", String(pack.task.description));
    lines.push("");
  }

  if (pack.plan) {
    lines.push("## Plan", "", `- **Name:** ${pack.plan.name}`, `- **Status:** ${pack.plan.status}`, "");
  }

  if (pack.acceptance_criteria.length) {
    lines.push("## Acceptance Criteria", "");
    for (const c of pack.acceptance_criteria) lines.push(`- ${c}`);
    lines.push("");
  }

  if (pack.blocked_by.length) {
    lines.push("## Blocked By", "");
    for (const b of pack.blocked_by) lines.push(`- ${b.title} (${b.status})`);
    lines.push("");
  }

  if (pack.dependencies.length) {
    lines.push("## Dependencies", "");
    for (const d of pack.dependencies) lines.push(`- ${d.title} (${d.status})`);
    lines.push("");
  }

  if (pack.subtasks.length) {
    lines.push("## Steps / Subtasks", "");
    for (const s of pack.subtasks) lines.push(`- [${s.status === "completed" ? "x" : " "}] ${s.title}`);
    lines.push("");
  }

  if (pack.files.length) {
    lines.push("## Relevant Files", "");
    for (const f of pack.files) lines.push(`- \`${f}\``);
    lines.push("");
  }

  if (pack.comments.length) {
    lines.push("## Recent Comments", "");
    for (const c of pack.comments.slice(-5)) {
      lines.push(`- ${c.created_at.slice(0, 16)} ${c.agent_id || "?"}: ${c.content}`);
    }
    lines.push("");
  }

  if (pack.verification_history.length) {
    lines.push("## Verification History", "");
    for (const v of pack.verification_history) {
      lines.push(`- ${v.provider} ${v.status}: ${v.summary}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function formatContextPackJson(pack: ContextPack): string {
  return JSON.stringify(pack, null, 2);
}
