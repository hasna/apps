import { realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { Store } from "../store.js";
import { ValidationError } from "../errors.js";
import { taskEventField } from "./fields.js";
import { positiveInteger } from "./parse.js";

/** Active-workflow admission throttles and canonical project-path handling. */

export interface RouteThrottleLimits {
  maxActive?: number;
  maxActivePerProject?: number;
  maxActivePerProjectGroup?: number;
}

export interface RouteThrottleDecision {
  allowed: boolean;
  reason?: string;
  projectPath: string;
  projectGroup?: string;
  limits: RouteThrottleLimits;
  counts: {
    global: number;
    project: number;
    projectGroup?: number;
  };
}

export function routeThrottleLimitsFromOpts(opts: {
  maxActive?: string;
  maxActivePerProject?: string;
  maxActivePerProjectGroup?: string;
}): RouteThrottleLimits {
  return {
    maxActive: positiveInteger(opts.maxActive, "--max-active"),
    maxActivePerProject: positiveInteger(opts.maxActivePerProject, "--max-active-per-project"),
    maxActivePerProjectGroup: positiveInteger(opts.maxActivePerProjectGroup, "--max-active-per-project-group"),
  };
}

function routeThrottleField(data: Record<string, unknown>, metadata: Record<string, unknown>, keys: string[]): string | undefined {
  return taskEventField(data, keys) ?? taskEventField(metadata, keys);
}

export function routeThrottleLimitsFromInputs(
  opts: {
    maxActive?: string;
    maxActivePerProject?: string;
    maxActivePerProjectGroup?: string;
  },
  data: Record<string, unknown>,
  metadata: Record<string, unknown>,
): RouteThrottleLimits {
  return {
    maxActive: positiveInteger(
      opts.maxActive ?? routeThrottleField(data, metadata, ["max_active", "maxActive", "route_max_active", "routeMaxActive"]),
      "--max-active",
    ),
    maxActivePerProject: positiveInteger(
      opts.maxActivePerProject ?? routeThrottleField(data, metadata, [
        "max_active_per_project",
        "maxActivePerProject",
        "route_max_active_per_project",
        "routeMaxActivePerProject",
      ]),
      "--max-active-per-project",
    ),
    maxActivePerProjectGroup: positiveInteger(
      opts.maxActivePerProjectGroup ?? routeThrottleField(data, metadata, [
        "max_active_per_project_group",
        "maxActivePerProjectGroup",
        "max_active_per_group",
        "maxActivePerGroup",
        "project_group_max_active",
        "projectGroupMaxActive",
        "route_max_active_per_project_group",
        "routeMaxActivePerProjectGroup",
      ]),
      "--max-active-per-project-group",
    ),
  };
}

export function hasThrottleLimits(limits: RouteThrottleLimits): boolean {
  return limits.maxActive !== undefined || limits.maxActivePerProject !== undefined || limits.maxActivePerProjectGroup !== undefined;
}

export function normalizeRoutePath(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const resolved = resolve(value.trim());
  let canonical = resolved;
  try {
    canonical = realpathSync(resolved);
  } catch {
    return canonical;
  }
  const gitRoot = spawnSync("git", ["-C", canonical, "rev-parse", "--show-toplevel"], { encoding: "utf8" });
  if (gitRoot.status === 0 && gitRoot.stdout.trim()) {
    try {
      return realpathSync(gitRoot.stdout.trim());
    } catch {
      return resolve(gitRoot.stdout.trim());
    }
  }
  return canonical;
}

export function routeProjectGroup(optsGroup: string | undefined, data: Record<string, unknown>, metadata: Record<string, unknown>): string | undefined {
  return optsGroup?.trim() ||
    taskEventField(data, ["project_group", "projectGroup", "repo_group", "repoGroup", "workspace_group", "workspaceGroup"]) ||
    taskEventField(metadata, ["project_group", "projectGroup", "repo_group", "repoGroup", "workspace_group", "workspaceGroup"]);
}

export function routeThrottleDecision(
  store: Store,
  args: { projectPath: string; projectGroup?: string; routeScope?: string; limits: RouteThrottleLimits },
): RouteThrottleDecision {
  const projectPath = normalizeRoutePath(args.projectPath) ?? resolve(args.projectPath);
  const projectGroup = args.projectGroup?.trim() || undefined;
  const routeScope = args.routeScope?.trim() || undefined;
  const counts = store.countActiveWorkflowWorkItems({ projectKey: projectPath, projectGroup, routeScope });
  const base = {
    projectPath,
    ...(projectGroup ? { projectGroup } : {}),
    limits: args.limits,
    counts,
  };
  if (args.limits.maxActive !== undefined && counts.global >= args.limits.maxActive) {
    return { ...base, allowed: false, reason: `global active workflow limit reached (${counts.global}/${args.limits.maxActive})` };
  }
  if (args.limits.maxActivePerProject !== undefined && counts.project >= args.limits.maxActivePerProject) {
    return { ...base, allowed: false, reason: `project active workflow limit reached (${counts.project}/${args.limits.maxActivePerProject})` };
  }
  if (
    projectGroup &&
    args.limits.maxActivePerProjectGroup !== undefined &&
    counts.projectGroup !== undefined &&
    counts.projectGroup >= args.limits.maxActivePerProjectGroup
  ) {
    return {
      ...base,
      allowed: false,
      reason: `project-group active workflow limit reached (${counts.projectGroup}/${args.limits.maxActivePerProjectGroup})`,
    };
  }
  return { ...base, allowed: true };
}

export function routeThrottleDryRunPreview(args: { projectPath: string; projectGroup?: string; limits: RouteThrottleLimits }) {
  const projectPath = normalizeRoutePath(args.projectPath) ?? resolve(args.projectPath);
  const projectGroup = args.projectGroup?.trim() || undefined;
  return {
    evaluated: false,
    reason: "not evaluated in dry-run because opening the live loop store may create or migrate the database",
    projectPath,
    ...(projectGroup ? { projectGroup } : {}),
    limits: args.limits,
  };
}

export function isExistingGitProjectPath(path: string): boolean {
  const result = spawnSync("git", ["-C", path, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  return result.status === 0;
}

export function validateRequiredRouteWorktreeProjectPath(opts: { worktreeMode?: string }, projectPath: string): void {
  if ((opts.worktreeMode ?? "auto") !== "required") return;
  if (!isExistingGitProjectPath(projectPath)) {
    throw new ValidationError(`worktreeMode=required but projectPath is not an existing git repository: ${projectPath}`);
  }
}
