import { resolve } from "node:path";
import type { Store } from "../store.js";
import { ValidationError } from "../errors.js";
import { gitProjectRootForPath, isExistingGitProjectPath, realpathOrResolve } from "../git-project.js";
import { taskEventField } from "./fields.js";
import { nonNegativeInteger, positiveInteger } from "./parse.js";

export { isExistingGitProjectPath };

/** Active-workflow admission throttles and canonical project-path handling. */

export interface RouteThrottleLimits {
  maxActive?: number;
  maxActiveScope?: string;
  maxActivePerProject?: number;
  maxActivePerProjectGroup?: number;
  maxPerProfile?: number;
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
  maxActiveScope?: string;
  maxActivePerProject?: string;
  maxActivePerProjectGroup?: string;
  maxPerProfile?: string;
}): RouteThrottleLimits {
  return {
    maxActive: positiveInteger(opts.maxActive, "--max-active"),
    maxActiveScope: opts.maxActiveScope?.trim() || undefined,
    maxActivePerProject: positiveInteger(opts.maxActivePerProject, "--max-active-per-project"),
    maxActivePerProjectGroup: positiveInteger(opts.maxActivePerProjectGroup, "--max-active-per-project-group"),
    maxPerProfile: nonNegativeInteger(opts.maxPerProfile, "--max-per-profile"),
  };
}

export function hasThrottleLimits(limits: RouteThrottleLimits): boolean {
  return limits.maxActive !== undefined ||
    limits.maxActivePerProject !== undefined ||
    limits.maxActivePerProjectGroup !== undefined;
}

export function normalizeRoutePath(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const resolved = resolve(value.trim());
  return gitProjectRootForPath(resolved) ?? realpathOrResolve(resolved);
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
    const scopeLabel = routeScope ? `scope ${routeScope}` : "global";
    return { ...base, allowed: false, reason: `${scopeLabel} active workflow limit reached (${counts.global}/${args.limits.maxActive})` };
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

export function validateRequiredRouteWorktreeProjectPath(opts: { worktreeMode?: string }, projectPath: string): void {
  if ((opts.worktreeMode ?? "auto") !== "required") return;
  if (!isExistingGitProjectPath(projectPath)) {
    throw new ValidationError(`worktreeMode=required but projectPath is not an existing git repository: ${projectPath}`);
  }
}
