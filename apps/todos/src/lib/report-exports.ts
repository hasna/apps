/**
 * Local read-only HTML and Markdown report exports for projects, plans, runs,
 * evidence, roadmaps, and retrospectives. Offline static output with redaction.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Database } from "bun:sqlite";
import { getDatabase, now } from "../db/database.js";
import { getProject, listProjects } from "../db/projects.js";
import { getPlan, listPlans } from "../db/plans.js";
import { listTasks, getTask } from "../db/tasks.js";
import { getStatus } from "../db/task-status.js";
import { redactText } from "./secret-redaction.js";
import { getRunRecord, listRunRecords } from "./run-records.js";
import { listVerificationEvidence } from "./verification-evidence.js";
import { getPlanExecutionState } from "./plan-execution.js";

export const REPORT_EXPORT_SCHEMA = "todos.report_export.v1";

export const REPORT_KINDS = ["project", "plan", "run", "evidence", "roadmap", "retrospective"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_FORMATS = ["markdown", "html"] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

export interface ReportSection {
  id: string;
  title: string;
  lines: string[];
}

export interface ReportExportData {
  schema_version: typeof REPORT_EXPORT_SCHEMA;
  kind: ReportKind;
  title: string;
  exported_at: string;
  read_only: true;
  redacted: boolean;
  project_id: string | null;
  plan_id: string | null;
  run_record_id: string | null;
  task_id: string | null;
  sections: ReportSection[];
}

export interface BuildReportExportInput {
  kind: ReportKind;
  project_id?: string;
  plan_id?: string;
  run_record_id?: string;
  task_id?: string;
  days?: number;
  redact?: boolean;
  exported_at?: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function section(id: string, title: string, lines: string[]): ReportSection {
  return { id, title, lines };
}

function taskLine(t: { short_id: string | null; title: string; status: string; priority: string }): string {
  const sid = t.short_id ? `[${t.short_id}] ` : "";
  return `- ${sid}${t.title} (${t.status}, ${t.priority})`;
}

export function buildReportExportData(input: BuildReportExportInput, db?: Database): ReportExportData {
  const d = getDatabase(db);
  const redact = input.redact !== false;
  const exportedAt = input.exported_at ?? now();
  const sections: ReportSection[] = [];

  let title = `Todos ${input.kind} report`;
  let projectId = input.project_id ?? null;
  let planId = input.plan_id ?? null;
  let runRecordId = input.run_record_id ?? null;
  let taskId = input.task_id ?? null;

  switch (input.kind) {
    case "project": {
      const project = projectId ? getProject(projectId, d) : listProjects(d)[0];
      if (!project) throw new Error("Project not found");
      projectId = project.id;
      title = `Project: ${project.name}`;
      const status = getStatus({ project_id: project.id }, undefined, undefined, d);
      sections.push(
        section("overview", "Overview", [
          `Name: ${project.name}`,
          `Path: ${project.path}`,
          `Prefix: ${project.task_prefix ?? "—"}`,
        ]),
        section("status", "Status", [
          `Pending: ${status.pending}`,
          `In progress: ${status.in_progress}`,
          `Completed: ${status.completed}`,
          `Total: ${status.total}`,
          `Stale: ${status.stale_count}`,
        ]),
      );
      const tasks = listTasks({ project_id: project.id, limit: 50 }, d);
      sections.push(section("tasks", "Recent tasks", tasks.length ? tasks.map(taskLine) : ["No tasks"]));
      break;
    }
    case "plan": {
      const plan = planId ? getPlan(planId, d) : listPlans(undefined, d)[0];
      if (!plan) throw new Error("Plan not found");
      planId = plan.id;
      projectId = plan.project_id ?? projectId;
      title = `Plan: ${plan.name}`;
      const exec = getPlanExecutionState(plan.id, d);
      sections.push(
        section("overview", "Overview", [
          `Name: ${plan.name}`,
          `Status: ${plan.status}`,
          `Progress: ${exec?.percent_complete ?? 0}%`,
        ]),
      );
      if (exec) {
        sections.push(
          section("steps", "Steps", [
            `Total: ${exec.total_steps}`,
            `Completed: ${exec.completed}`,
            `In progress: ${exec.in_progress}`,
            `Ready: ${exec.ready_steps.length}`,
          ]),
        );
        if (exec.steps.length) {
          sections.push(
            section(
              "step_list",
              "Step tasks",
              exec.steps.slice(0, 30).map((s) => {
                const sid = s.short_id ? `[${s.short_id}] ` : "";
                return `- ${sid}${s.title} (${s.status})`;
              }),
            ),
          );
        }
      }
      break;
    }
    case "run": {
      const run = runRecordId ? getRunRecord(runRecordId, d) : listRunRecords({ limit: 1 }, d)[0];
      if (!run) throw new Error("Run record not found");
      runRecordId = run.id;
      planId = run.plan_id ?? planId;
      title = `Run: ${run.objective ?? run.id.slice(0, 8)}`;
      sections.push(
        section("overview", "Overview", [
          `Status: ${run.status}`,
          `Agent: ${run.agent_id ?? "—"}`,
          `Started: ${run.started_at}`,
          `Completed: ${run.completed_at ?? "—"}`,
        ]),
        section("objective", "Objective", [run.objective ?? "—"]),
      );
      if (run.commands.length) {
        sections.push(
          section("commands", "Commands", run.commands.map((c) => `${c.command} (exit ${c.exit_code ?? "?"})`)),
        );
      }
      if (run.files_touched.length) {
        sections.push(section("files", "Files touched", run.files_touched.slice(0, 50)));
      }
      break;
    }
    case "evidence": {
      const filter = { task_id: taskId ?? undefined, run_record_id: runRecordId ?? undefined, limit: 50 };
      const records = listVerificationEvidence(filter, d);
      if (taskId) {
        const task = getTask(taskId, d);
        title = task ? `Evidence: ${task.title}` : "Evidence report";
      } else {
        title = "Verification evidence";
      }
      if (!records.length) {
        sections.push(section("evidence", "Records", ["No verification evidence found"]));
      } else {
        sections.push(
          section(
            "evidence",
            "Records",
            records.map(
              (r) =>
                `${r.status.toUpperCase()}: ${r.summary} (confidence ${r.confidence ?? "—"}, task ${r.task_id ?? "—"})`,
            ),
          ),
        );
      }
      break;
    }
    case "roadmap": {
      const project = projectId ? getProject(projectId, d) : listProjects(d)[0];
      if (!project) throw new Error("Project not found");
      projectId = project.id;
      title = `Roadmap: ${project.name}`;
      const plans = listPlans(project.id, d);
      if (!plans.length) {
        sections.push(section("plans", "Plans", ["No plans defined"]));
      } else {
        for (const plan of plans) {
          const exec = getPlanExecutionState(plan.id, d);
          sections.push(
            section(`plan-${plan.id.slice(0, 8)}`, plan.name, [
              `Status: ${plan.status}`,
              `Progress: ${exec?.percent_complete ?? 0}%`,
              `Steps: ${exec?.total_steps ?? 0} total, ${exec?.completed ?? 0} done`,
            ]),
          );
        }
      }
      break;
    }
    case "retrospective": {
      const days = input.days ?? 7;
      const project = projectId ? getProject(projectId, d) : undefined;
      if (project) projectId = project.id;
      title = project ? `Retrospective: ${project.name}` : "Retrospective";
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const completed = listTasks(
        { project_id: projectId ?? undefined, status: "completed", limit: 200 },
        d,
      ).filter((t) => (t.completed_at ?? t.updated_at) >= since);
      const failed = listTasks(
        { project_id: projectId ?? undefined, status: "failed", limit: 50 },
        d,
      ).filter((t) => t.updated_at >= since);

      sections.push(
        section("summary", "Summary", [
          `Period: last ${days} days`,
          `Completed: ${completed.length}`,
          `Failed: ${failed.length}`,
        ]),
      );
      if (completed.length) {
        sections.push(section("wins", "Completed", completed.slice(0, 30).map(taskLine)));
      }
      if (failed.length) {
        sections.push(section("lessons", "Failures", failed.map(taskLine)));
      }
      break;
    }
    default:
      throw new Error(`Unknown report kind: ${input.kind satisfies never}`);
  }

  const payload: ReportExportData = {
    schema_version: REPORT_EXPORT_SCHEMA,
    kind: input.kind,
    title,
    exported_at: exportedAt,
    read_only: true,
    redacted: redact,
    project_id: projectId,
    plan_id: planId,
    run_record_id: runRecordId,
    task_id: taskId,
    sections,
  };

  if (redact) {
    payload.sections = payload.sections.map((s) => ({
      ...s,
      lines: s.lines.map((line) => redactText(line)),
    }));
  }

  return payload;
}

export function formatReportMarkdown(data: ReportExportData): string {
  const lines = [
    `# ${data.title}`,
    "",
    `> Read-only local export · ${data.exported_at} · schema ${data.schema_version}`,
    "",
  ];
  for (const s of data.sections) {
    lines.push(`## ${s.title}`, "");
    lines.push(...s.lines, "");
  }
  return lines.join("\n").trimEnd() + "\n";
}

export function formatReportHtml(data: ReportExportData): string {
  const body = data.sections
    .map(
      (s) =>
        `<section id="${escapeHtml(s.id)}"><h2>${escapeHtml(s.title)}</h2><ul>${s.lines
          .map((line) => `<li>${escapeHtml(line)}</li>`)
          .join("")}</ul></section>`,
    )
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(data.title)}</title>
<style>
body{font-family:system-ui,sans-serif;max-width:52rem;margin:2rem auto;padding:0 1rem;line-height:1.5;color:#111}
header{border-bottom:1px solid #ddd;margin-bottom:1.5rem;padding-bottom:1rem}
.badge{display:inline-block;background:#eef;padding:.2rem .5rem;border-radius:.25rem;font-size:.85rem}
section{margin-bottom:1.5rem}
h1{margin:0 0 .5rem}
h2{font-size:1.1rem;margin:0 0 .5rem}
ul{margin:0;padding-left:1.25rem}
footer{margin-top:2rem;font-size:.85rem;color:#666}
</style>
</head>
<body>
<header>
<p class="badge">Read-only · local export</p>
<h1>${escapeHtml(data.title)}</h1>
<p>Exported ${escapeHtml(data.exported_at)} · ${escapeHtml(data.kind)} report</p>
</header>
${body}
<footer>Generated by @hasna/todos · no sign-in required · static snapshot</footer>
</body>
</html>
`;
}

export function formatReportExport(data: ReportExportData, format: ReportFormat): string {
  return format === "html" ? formatReportHtml(data) : formatReportMarkdown(data);
}

export function writeReportExport(data: ReportExportData, format: ReportFormat, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatReportExport(data, format), "utf8");
}

export function exportReport(
  input: BuildReportExportInput & { format: ReportFormat; path: string },
  db?: Database,
): ReportExportData {
  const data = buildReportExportData(input, db);
  writeReportExport(data, input.format, input.path);
  return data;
}

export function getReportExportDocs(): string {
  return `# Report exports

Local read-only HTML and Markdown reports for sharing from workspaces.

## Kinds
- project — status and task summary
- plan — execution progress and steps
- run — run record commands and files
- evidence — verification evidence records
- roadmap — plans grouped by project
- retrospective — completed/failed tasks over a period

## CLI
\`\`\`bash
todos report export --kind project --format markdown --out report.md
todos report export --kind plan --plan-id <id> --format html --out plan.html
todos report export --kind retrospective --days 14 --format markdown --out retro.md
\`\`\`

## MCP
- \`build_report_export\` — build report data JSON
- \`export_report_file\` — write HTML or Markdown to path
`;
}
