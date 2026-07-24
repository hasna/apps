/**
 * Agent handoff packets — offline summaries of goal/project state, tasks,
 * blockers, comments, verification, and next actions. Portable local export.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Database } from "bun:sqlite";
import { getDatabase } from "../db/database.js";
import { getProject } from "../db/projects.js";
import { getPlan } from "../db/plans.js";
import { listTasks, getNextTask } from "../db/tasks.js";
import { listComments } from "../db/comments.js";
import { createHandoff, getLatestHandoff, type Handoff } from "../db/handoffs.js";
import { getTaskCommits } from "../db/task-commits.js";
import { getBlockedTaskReports, getReadyTasks } from "./dependency-graph.js";
import { listVerificationEvidence } from "./verification-evidence.js";
import { getPlanExecutionState } from "./plan-execution.js";

export const HANDOFF_PACKET_SCHEMA = "todos.handoff_packet.v1";

export interface HandoffPacketContext {
  project: { id: string; name: string; path: string } | null;
  plan: { id: string; name: string; status: string; percent_complete?: number } | null;
  goal_summary: string | null;
}

export interface HandoffTaskSummary {
  id: string;
  short_id: string | null;
  title: string;
  status: string;
  priority: string;
  assigned_to: string | null;
}

export interface HandoffCommentSummary {
  task_id: string;
  content: string;
  created_at: string;
  agent_id: string | null;
}

export interface HandoffVerificationSummary {
  task_id: string | null;
  status: string;
  summary: string;
  confidence: number | null;
}

export interface HandoffPacket {
  schema_version: typeof HANDOFF_PACKET_SCHEMA;
  id: string | null;
  agent_id: string | null;
  created_at: string;
  context: HandoffPacketContext;
  active_tasks: HandoffTaskSummary[];
  blocked_tasks: HandoffTaskSummary[];
  dependencies_note: string | null;
  recent_comments: HandoffCommentSummary[];
  changed_files: string[];
  verification: HandoffVerificationSummary[];
  next_suggested_action: string | null;
  completed: string[];
  in_progress: string[];
  blockers: string[];
  next_steps: string[];
  summary: string;
}

export interface BuildHandoffPacketInput {
  agent_id?: string;
  project_id?: string;
  plan_id?: string;
  task_id?: string;
  include_files?: boolean;
}

function summarizeTask(t: { id: string; short_id: string | null; title: string; status: string; priority: string; assigned_to?: string | null }): HandoffTaskSummary {
  return {
    id: t.id,
    short_id: t.short_id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    assigned_to: t.assigned_to ?? null,
  };
}

export function buildHandoffPacket(input: BuildHandoffPacketInput = {}, db?: Database): HandoffPacket {
  const d = getDatabase(db);
  const project = input.project_id ? getProject(input.project_id, d) : null;
  const plan = input.plan_id ? getPlan(input.plan_id, d) : null;

  const activeFilter = {
    project_id: input.project_id,
    plan_id: input.plan_id,
  };

  const active = listTasks(
    {
      project_id: input.project_id,
      plan_id: input.plan_id,
      status: "in_progress",
      assigned_to: input.agent_id,
    },
    d,
  );
  const activeTasks = active.map((a) => summarizeTask(a));

  const blockedReports = getBlockedTaskReports(
    { project_id: input.project_id, plan_id: input.plan_id, limit: 10 },
    d,
  );
  const blockedTasks = blockedReports.map((b) => summarizeTask(b.task));

  const ready = getReadyTasks({ ...activeFilter, limit: 1 }, d);
  const nextTask = getNextTask(input.agent_id, activeFilter, d);
  const nextAction = ready[0]
    ? `Claim ready task: ${ready[0]!.task.title}`
    : nextTask
      ? `Next claimable: ${nextTask.title}`
      : blockedTasks.length > 0
        ? `Unblock: ${blockedReports[0]!.blockers.map((b) => b.title).join(", ")}`
        : null;

  const recentComments: HandoffCommentSummary[] = [];
  const taskIds = [
    ...(input.task_id ? [input.task_id] : []),
    ...activeTasks.map((t) => t.id),
    ...blockedTasks.slice(0, 3).map((t) => t.id),
  ];
  for (const tid of [...new Set(taskIds)].slice(0, 5)) {
    for (const c of listComments(tid, d).slice(-3)) {
      recentComments.push({
        task_id: tid,
        content: c.content.slice(0, 500),
        created_at: c.created_at,
        agent_id: c.agent_id,
      });
    }
  }
  recentComments.sort((a, b) => b.created_at.localeCompare(a.created_at));

  const changedFiles = new Set<string>();
  if (input.include_files !== false) {
    for (const tid of taskIds.slice(0, 5)) {
      for (const commit of getTaskCommits(tid, d)) {
        if (commit.files_changed) {
          for (const f of commit.files_changed) changedFiles.add(f);
        }
      }
    }
  }

  const verification = listVerificationEvidence(
    { task_id: input.task_id, limit: 5 },
    d,
  ).map((v) => ({
    task_id: v.task_id,
    status: v.status,
    summary: v.summary,
    confidence: v.confidence,
  }));

  const planState = input.plan_id ? getPlanExecutionState(input.plan_id, d) : null;

  const completed = listTasks({ project_id: input.project_id, status: "completed" }, d)
    .slice(0, 10)
    .map((t) => t.title);
  const inProgress = activeTasks.map((t) => t.title);
  const blockers = blockedTasks.map((t) => t.title);
  const nextSteps = ready.slice(0, 3).map((r) => r.task.title);

  const summaryParts = [
    project ? `Project: ${project.name}` : null,
    plan ? `Plan: ${plan.name}` : null,
    `${inProgress.length} active, ${blockers.length} blocked`,
  ].filter(Boolean);

  return {
    schema_version: HANDOFF_PACKET_SCHEMA,
    id: null,
    agent_id: input.agent_id ?? null,
    created_at: new Date().toISOString(),
    context: {
      project: project ? { id: project.id, name: project.name, path: project.path } : null,
      plan: plan
        ? {
            id: plan.id,
            name: plan.name,
            status: plan.status,
            percent_complete: planState?.percent_complete,
          }
        : null,
      goal_summary: plan?.description ?? project?.description ?? null,
    },
    active_tasks: activeTasks,
    blocked_tasks: blockedTasks,
    dependencies_note: blockedReports.length
      ? `${blockedReports.length} task(s) blocked by incomplete dependencies`
      : null,
    recent_comments: recentComments.slice(0, 15),
    changed_files: [...changedFiles].slice(0, 50),
    verification,
    next_suggested_action: nextAction,
    completed,
    in_progress: inProgress,
    blockers,
    next_steps: nextSteps,
    summary: summaryParts.join(" · "),
  };
}

export function createHandoffPacket(input: BuildHandoffPacketInput = {}, db?: Database): HandoffPacket {
  const packet = buildHandoffPacket(input, db);
  const handoff = createHandoff({
    agent_id: input.agent_id,
    project_id: input.project_id,
    summary: packet.summary,
    completed: packet.completed,
    in_progress: packet.in_progress,
    blockers: packet.blockers,
    next_steps: packet.next_steps,
  }, db);
  return { ...packet, id: handoff.id, created_at: handoff.created_at };
}

export function formatHandoffPacket(packet: HandoffPacket, format: "json" | "markdown" = "json"): string {
  if (format === "json") return JSON.stringify(packet, null, 2);

  const lines = [
    "# Agent Handoff Packet",
    "",
    `**Summary:** ${packet.summary}`,
    `**Agent:** ${packet.agent_id ?? "unknown"}`,
    `**Created:** ${packet.created_at}`,
    "",
  ];

  if (packet.context.project) {
    lines.push(`## Project: ${packet.context.project.name}`, "");
  }
  if (packet.context.plan) {
    lines.push(
      `## Plan: ${packet.context.plan.name} (${packet.context.plan.status}${packet.context.plan.percent_complete !== undefined ? `, ${packet.context.plan.percent_complete}%` : ""})`,
      "",
    );
  }

  if (packet.next_suggested_action) {
    lines.push(`## Next Action`, packet.next_suggested_action, "");
  }

  if (packet.active_tasks.length) {
    lines.push("## Active Tasks");
    for (const t of packet.active_tasks) lines.push(`- [${t.status}] ${t.short_id || t.id.slice(0, 8)} ${t.title}`);
    lines.push("");
  }

  if (packet.blocked_tasks.length) {
    lines.push("## Blocked");
    for (const t of packet.blocked_tasks) lines.push(`- ${t.title}`);
    lines.push("");
  }

  if (packet.verification.length) {
    lines.push("## Verification");
    for (const v of packet.verification) lines.push(`- ${v.status}: ${v.summary}`);
    lines.push("");
  }

  if (packet.changed_files.length) {
    lines.push("## Changed Files");
    for (const f of packet.changed_files.slice(0, 20)) lines.push(`- ${f}`);
    lines.push("");
  }

  if (packet.recent_comments.length) {
    lines.push("## Recent Comments");
    for (const c of packet.recent_comments.slice(0, 10)) {
      lines.push(`- (${c.created_at.slice(0, 16)}) ${c.content.slice(0, 120)}`);
    }
  }

  return lines.join("\n");
}

export function exportHandoffPacket(input: BuildHandoffPacketInput = {}, path?: string, db?: Database): HandoffPacket {
  const packet = createHandoffPacket(input, db);
  if (path) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, formatHandoffPacket(packet, "json"), "utf8");
  }
  return packet;
}

export function getStoredHandoffAsPacket(handoff: Handoff, db?: Database): HandoffPacket {
  return buildHandoffPacket({
    agent_id: handoff.agent_id ?? undefined,
    project_id: handoff.project_id ?? undefined,
  }, db);
}

export function getLatestHandoffPacket(agentId?: string, projectId?: string, db?: Database): HandoffPacket | null {
  const handoff = getLatestHandoff(agentId, projectId, db);
  if (!handoff) return null;
  const packet = buildHandoffPacket({
    agent_id: handoff.agent_id ?? undefined,
    project_id: handoff.project_id ?? undefined,
  }, db);
  return { ...packet, id: handoff.id, summary: handoff.summary, created_at: handoff.created_at };
}
