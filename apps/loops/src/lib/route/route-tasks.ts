import type { Store } from "../store.js";
import { ValidationError } from "../errors.js";
import {
  buildDuplicateOverlapReport,
  buildNameHygieneReport,
  buildScriptInventoryReport,
} from "../hygiene.js";
import { selectRouteItems, writeRouteCursor, writeRouteEvidence } from "./cursors.js";
import { stableHash } from "./fields.js";
import { ensureTodosTaskList, runLocalCommand } from "./todos-cli.js";

/** Deduped todos task upserts shared by `health route-tasks` and `hygiene route-tasks`. */

export interface TaskRouteOptions {
  autoRoute?: boolean;
  routeProjectPath?: string;
  source: string;
}

export function taskAutoRoute(
  tags: string[],
  base: Record<string, unknown>,
  opts: TaskRouteOptions,
): { tags: string[]; metadata: Record<string, unknown>; autoRoute: { requested: boolean; enabled: boolean; skippedReason?: string } } {
  if (!opts.autoRoute) {
    return {
      tags,
      metadata: {
        ...base,
        route_enabled: false,
        project_path: null,
        working_dir: null,
        auto_route_requested: false,
        auto_route_enabled: false,
        automation: {
          allowed: false,
          source: opts.source,
          kind: "task-created-worker-verifier",
        },
      },
      autoRoute: { requested: false, enabled: false },
    };
  }
  const projectPath =
    (typeof base.cwd === "string" && base.cwd.trim()) ||
    (typeof opts.routeProjectPath === "string" && opts.routeProjectPath.trim()) ||
    undefined;
  if (!projectPath) {
    return {
      tags,
      metadata: {
        ...base,
        route_enabled: false,
        project_path: null,
        working_dir: null,
        auto_route_requested: true,
        auto_route_enabled: false,
        auto_route_skipped_reason: "missing cwd or --route-project-path",
        automation: {
          allowed: false,
          source: opts.source,
          kind: "task-created-worker-verifier",
        },
      },
      autoRoute: {
        requested: true,
        enabled: false,
        skippedReason: "missing cwd or --route-project-path",
      },
    };
  }
  return {
    tags: [...new Set([...tags, "auto:route"])],
    metadata: {
      ...base,
      route_enabled: true,
      project_path: projectPath,
      working_dir: projectPath,
      auto_route_requested: true,
      auto_route_enabled: true,
      automation: {
        allowed: true,
        source: opts.source,
        kind: "task-created-worker-verifier",
      },
    },
    autoRoute: { requested: true, enabled: true },
  };
}

function routeTaskWorkingDirArgs(routeTask: ReturnType<typeof taskAutoRoute>): string[] {
  const workingDir = routeTask.autoRoute.enabled && typeof routeTask.metadata.working_dir === "string"
    ? routeTask.metadata.working_dir
    : undefined;
  return workingDir ? ["--working-dir", workingDir] : [];
}

export interface RouteTaskSpec {
  title: string;
  description: string;
  priority: string;
  tags: string[];
  fingerprint: string;
  /** Base metadata handed to taskAutoRoute (before route flags are merged in). */
  metadata: Record<string, unknown>;
  /** Extra fields copied onto every action record for this task (e.g. hygiene `check`). */
  extra?: Record<string, unknown>;
}

export interface UpsertRouteTasksOptions {
  project: string;
  taskList: { slug: string; name: string; description: string; legacySlugs?: string[] };
  cursorKey: string;
  maxActions: number;
  dryRun?: boolean;
  autoRoute?: boolean;
  routeProjectPath?: string;
  source: string;
  evidence: { kind: string; dir?: string };
  /** Command-specific summary fields merged into the output before routing/actions. */
  summary: Record<string, unknown>;
  tasks: RouteTaskSpec[];
}

export interface UpsertRouteTasksResult {
  ok: boolean;
  output: Record<string, unknown>;
  evidencePath?: string;
}

export function upsertRouteTasks(opts: UpsertRouteTasksOptions): UpsertRouteTasksResult {
  const selection = selectRouteItems(opts.tasks, opts.maxActions, opts.cursorKey, (task) => task.fingerprint);
  const listId = opts.dryRun
    ? undefined
    : ensureTodosTaskList(
      opts.project,
      opts.taskList.slug,
      opts.taskList.name,
      opts.taskList.description,
      opts.taskList.legacySlugs,
    );
  const actions = selection.selected.map((task) => {
    const routeTask = taskAutoRoute(task.tags, task.metadata, {
      autoRoute: Boolean(opts.autoRoute),
      routeProjectPath: opts.routeProjectPath,
      source: opts.source,
    });
    if (opts.dryRun) {
      return {
        action: "would-upsert",
        ...task.extra,
        title: task.title,
        fingerprint: task.fingerprint,
        priority: task.priority,
        tags: routeTask.tags,
        metadata: routeTask.metadata,
        autoRoute: routeTask.autoRoute,
      };
    }
    const result = runLocalCommand("todos", [
      "--project",
      opts.project,
      "--json",
      "task",
      "upsert",
      "--fingerprint",
      task.fingerprint,
      "--title",
      task.title,
      "-d",
      task.description,
      "--priority",
      task.priority,
      "--status",
      "pending",
      "--list",
      listId!,
      "--tags",
      routeTask.tags.join(","),
      ...routeTaskWorkingDirArgs(routeTask),
      "--metadata-json",
      JSON.stringify(routeTask.metadata),
    ]);
    if (!result.ok) {
      return { action: "upsert-failed", ...task.extra, fingerprint: task.fingerprint, error: result.stderr || result.error || result.stdout };
    }
    return { action: "upserted", ...task.extra, fingerprint: task.fingerprint, task: JSON.parse(result.stdout || "{}") };
  });
  const routed = {
    ok: actions.every((action) => action.action !== "upsert-failed"),
    ...opts.summary,
    routing: selection.cursor,
    actions,
  };
  const evidencePath = writeRouteEvidence(opts.evidence.kind, routed, opts.evidence.dir);
  if (!opts.dryRun && routed.ok) writeRouteCursor(selection.cursor.key, selection.cursor.lastFingerprint);
  return {
    ok: routed.ok,
    output: evidencePath ? { ...routed, evidencePath } : routed,
    evidencePath,
  };
}

export type HygieneCheckKind = "names" | "duplicates" | "scripts";

export interface HygieneRouteTask {
  check: HygieneCheckKind;
  title: string;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  tags: string[];
  fingerprint: string;
  metadata: Record<string, unknown>;
}

const HYGIENE_CHECKS: HygieneCheckKind[] = ["names", "duplicates", "scripts"];

export function parseHygieneChecks(value: string | undefined): HygieneCheckKind[] {
  if (!value || value === "all") return HYGIENE_CHECKS;
  const checks = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const invalid = checks.filter((entry) => !HYGIENE_CHECKS.includes(entry as HygieneCheckKind));
  if (invalid.length > 0) throw new ValidationError(`invalid hygiene check(s): ${invalid.join(", ")}`);
  return [...new Set(checks)] as HygieneCheckKind[];
}

export function buildHygieneRouteTasks(
  store: Store,
  opts: { checks: HygieneCheckKind[]; includeInactive?: boolean; limit?: number; scriptsDir?: string },
): { checked: Record<HygieneCheckKind, number>; findings: number; tasks: HygieneRouteTask[] } {
  const checked: Record<HygieneCheckKind, number> = { names: 0, duplicates: 0, scripts: 0 };
  const tasks: HygieneRouteTask[] = [];
  const limit = opts.limit ?? 1_000;

  if (opts.checks.includes("names")) {
    const report = buildNameHygieneReport(store, { includeInactive: opts.includeInactive, limit });
    checked.names = report.checked;
    for (const change of report.changes.filter((entry) => entry.changed)) {
      // Stable machine identity: changing this prefix would duplicate the
      // pre-rename Todos task instead of updating it.
      const fingerprint = `openloops:hygiene:names:${change.id}:${stableHash([change.oldName, change.newName])}`;
      tasks.push({
        check: "names",
        title: `Loops hygiene: rename loop ${change.oldName}`,
        description: [
          `Loops name hygiene found a non-canonical loop name.`,
          `Loop: ${change.oldName} (${change.id})`,
          `Expected name: ${change.newName}`,
          `Scope: ${change.scope} / ${change.scopeSlug}`,
          `Fingerprint: ${fingerprint}`,
          "",
          "Acceptance:",
          "- Confirm the canonical name is correct for the loop scope.",
          "- Rename through Loops CLI/API so ids, schedules, run history, and metadata are preserved.",
          "- Do not dispatch work by tmux.",
        ].join("\n"),
        priority: "low",
        tags: ["loops", "hygiene", "name-hygiene"],
        fingerprint,
        metadata: {
          source: "loops.hygiene.route-tasks",
          check: "names",
          loop_id: change.id,
          old_name: change.oldName,
          new_name: change.newName,
          scope: change.scope,
          scope_slug: change.scopeSlug,
          no_tmux_dispatch: true,
        },
      });
    }
  }

  if (opts.checks.includes("duplicates")) {
    const report = buildDuplicateOverlapReport(store, { includeInactive: opts.includeInactive, limit });
    checked.duplicates = report.checked;
    for (const group of report.groups) {
      const loopIds = group.loops.map((loop) => loop.id).sort();
      const fingerprint = `openloops:hygiene:duplicates:${stableHash([group.key, loopIds])}`;
      tasks.push({
        check: "duplicates",
        title: `Loops hygiene: duplicate/overlapping loops - ${group.baseName}`,
        description: [
          `Loops duplicate/overlap hygiene found multiple loops with the same normalized name, cwd, and schedule.`,
          `Base name: ${group.baseName}`,
          group.cwd ? `Cwd: ${group.cwd}` : undefined,
          `Schedule: ${group.schedule}`,
          `Fingerprint: ${fingerprint}`,
          "",
          "Loops:",
          ...group.loops.map((loop) => `- ${loop.id} ${loop.status} ${loop.name}`),
          "",
          "Acceptance:",
          "- Decide the authoritative active loop.",
          "- Archive or retarget superseded loops through Loops CLI/API while preserving history.",
          "- Do not dispatch work by tmux.",
        ].filter(Boolean).join("\n"),
        priority: group.loops.some((loop) => loop.status === "active") ? "medium" : "low",
        tags: ["loops", "hygiene", "duplicate-overlap"],
        fingerprint,
        metadata: {
          source: "loops.hygiene.route-tasks",
          check: "duplicates",
          base_name: group.baseName,
          cwd: group.cwd,
          schedule: group.schedule,
          loop_ids: loopIds,
          no_tmux_dispatch: true,
        },
      });
    }
  }

  if (opts.checks.includes("scripts")) {
    const report = buildScriptInventoryReport(store, { includeInactive: opts.includeInactive, limit, scriptsDir: opts.scriptsDir });
    checked.scripts = report.checked;
    for (const loop of report.loops) {
      const fingerprint = `openloops:hygiene:scripts:${loop.id}:${stableHash([loop.command])}`;
      tasks.push({
        check: "scripts",
        title: `Loops hygiene: replace script-backed loop ${loop.name}`,
        description: [
          `Loops script inventory found a loop still backed by a local script command.`,
          `Loop: ${loop.name} (${loop.id})`,
          `Status: ${loop.status}`,
          loop.cwd ? `Cwd: ${loop.cwd}` : undefined,
          `Command: ${loop.command}`,
          `Fingerprint: ${fingerprint}`,
          "",
          "Acceptance:",
          "- Replace this loop with a package-level CLI/API/template abstraction when one exists.",
          "- If no abstraction exists, create/update the owning repo task instead of adding another local script.",
          "- Archive superseded loops through Loops CLI/API and preserve history.",
          "- Do not dispatch work by tmux.",
        ].filter(Boolean).join("\n"),
        priority: loop.status === "active" ? "medium" : "low",
        tags: ["loops", "hygiene", "script-backed-loop"],
        fingerprint,
        metadata: {
          source: "loops.hygiene.route-tasks",
          check: "scripts",
          loop_id: loop.id,
          loop_name: loop.name,
          loop_status: loop.status,
          cwd: loop.cwd,
          script_matches: loop.scriptMatches,
          no_tmux_dispatch: true,
        },
      });
    }
  }

  return { checked, findings: tasks.length, tasks };
}
