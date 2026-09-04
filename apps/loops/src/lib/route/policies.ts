import { homedir } from "node:os";
import { join } from "node:path";
import { dataDir as resolverDataDir } from "@hasna/contracts/paths";
import { getLoopsDataDir } from "../app-home.js";
import { TODOS_TASK_WORKER_VERIFIER_TEMPLATE_ID } from "../templates.js";
import { ValidationError } from "../errors.js";
import { routeDrainArgs } from "./options.js";
import { defaultLoopsProject, defaultTodosProject } from "./todos-cli.js";
import type { TodosDrainOptions } from "./types.js";

/** Named route-drain policies keep recurring task routes auditable and replayable. */

export type RoutePolicyId = "repoops-pr-queue" | "oss" | "pilot" | "machine-sync";

export type RoutePolicySafety = "unattended" | "manual-break-glass";

export interface RoutePolicySchedule {
  every?: string;
  cron?: string;
  at?: string;
  dynamic?: boolean;
  catchUp?: string;
  catchUpLimit?: string;
  overlap?: string;
  attempts?: string;
  retryDelay?: string;
  lease?: string;
}

export interface RoutePolicyGuard {
  kind: string;
  description: string;
  [key: string]: unknown;
}

export interface RoutePolicyDefinition {
  id: RoutePolicyId;
  title: string;
  description: string;
  routeKind: "todos-task";
  safety: RoutePolicySafety;
  source: string;
  aliases?: string[];
  drain: Partial<TodosDrainOptions>;
  schedule: RoutePolicySchedule;
  guards?: RoutePolicyGuard[];
  notes?: string[];
  requiresExplicitOptions?: Array<keyof TodosDrainOptions>;
}

export interface RoutePolicyRender {
  policy: RoutePolicyDefinition;
  drain: Partial<TodosDrainOptions>;
  schedule: RoutePolicySchedule;
  args: string[];
  command: string;
}

const CODEWITH_IMPL_POOL = "account008,account010,account012,account013,account014";
const REVIEWER_POOL = "andrei-hasna,kriptoburak";

function home(): string {
  return process.env.HOME || homedir();
}

function homePath(...parts: string[]): string {
  return join(home(), ...parts);
}

function routeReportsPath(...parts: string[]): string {
  return join(getLoopsDataDir(), "reports", "todos-task-drain", ...parts);
}

function commonAddDirs(): string[] {
  return [
    join(resolverDataDir({ app: "todos", home: home() })),
    join(getLoopsDataDir()),
  ];
}

function commonCodewithDrain(): Pick<TodosDrainOptions, "provider" | "addDir" | "permissionMode" | "sandbox"> {
  return {
    provider: "codewith",
    addDir: commonAddDirs(),
    permissionMode: "bypass",
    sandbox: "workspace-write",
  };
}

function policyDefinitions(): RoutePolicyDefinition[] {
  const loopsProject = defaultLoopsProject();
  const todosProject = defaultTodosProject();
  const worktreeRoot = join(resolverDataDir({ app: "repos", home: home() }), "worktrees");
  return [
    {
      id: "repoops-pr-queue",
      title: "RepoOps PR Queue",
      description: "Route repo PR merge/review queue tasks through the bounded RepoOps merge lane.",
      routeKind: "todos-task",
      safety: "unattended",
      source: "spark01 live loop machine-repo-pr-queue-router inspected 2026-07-06",
      aliases: ["repoops"],
      drain: {
        routePolicyEvidence: "repoops-pr-queue",
        ...(todosProject ? { todosProject } : {}),
        taskList: "repo-pr-merge-queue",
        tags: "auto:route",
        limit: "50",
        scanLimit: "1000",
        maxDispatch: "6",
        evidenceDir: routeReportsPath("repoops"),
        compact: true,
        template: TODOS_TASK_WORKER_VERIFIER_TEMPLATE_ID,
        ...commonCodewithDrain(),
        authProfilePool: CODEWITH_IMPL_POOL,
        maxPerProfile: "3",
        projectPath: home(),
        projectGroup: "repoops",
        maxActive: "6",
        maxActiveScope: "merge",
        maxActivePerProject: "4",
        maxActivePerProjectGroup: "6",
        worktreeMode: "required",
        worktreeBranchPrefix: "openloops",
        namePrefix: "event:repoops-pr-queue",
        githubReviewerPool: REVIEWER_POOL,
        variant: "medium",
      },
      schedule: {
        every: "5m",
        catchUp: "latest",
        overlap: "skip",
        attempts: "1",
        retryDelay: "1m",
        lease: "30m",
      },
    },
    {
      id: "oss",
      title: "OSS Task Lifecycle",
      description: "Route Hasna OSS repo tasks through the triage, planner, worker, verifier, and PR handoff lifecycle.",
      routeKind: "todos-task",
      safety: "unattended",
      source: "spark01 live loop machine-oss-task-lifecycle-router inspected 2026-07-06",
      drain: {
        routePolicyEvidence: "oss",
        ...(todosProject ? { todosProject } : {}),
        projectPathPrefix: homePath("workspace", "hasna", "opensource"),
        tags: "auto:route",
        limit: "50",
        scanLimit: "5000",
        maxDispatch: "6",
        evidenceDir: routeReportsPath("oss"),
        compact: true,
        template: "task-lifecycle",
        ...commonCodewithDrain(),
        authProfilePool: CODEWITH_IMPL_POOL,
        projectGroup: "oss",
        maxActive: "6",
        maxActiveScope: "codewith-impl",
        maxActivePerProject: "2",
        maxActivePerProjectGroup: "7",
        maxPerProfile: "3",
        worktreeMode: "required",
        worktreeRoot,
        worktreeBranchPrefix: "openloops",
        namePrefix: "event:todos-task-opensource",
        preflight: true,
        prHandoff: true,
        githubReviewerPool: REVIEWER_POOL,
      },
      schedule: {
        every: "2m",
        catchUp: "latest",
        overlap: "skip",
        attempts: "2",
        retryDelay: "1m",
        lease: "20m",
      },
    },
    {
      id: "pilot",
      title: "Pilot Break-Glass Drain",
      description: "Route one pilot task at a time through the legacy break-glass lane. This policy is paused by default and requires explicit manual break-glass acknowledgement.",
      routeKind: "todos-task",
      safety: "manual-break-glass",
      source: "spark01 paused live loop machine-todos-drain-pilot-breakglass inspected 2026-07-06",
      requiresExplicitOptions: ["manualBreakGlass", "safetyReason"],
      drain: {
        routePolicyEvidence: "pilot",
        ...(todosProject ? { todosProject } : {}),
        taskList: "event-trigger-production-pilot",
        tags: "auto:route",
        scanLimit: "500",
        maxDispatch: "1",
        evidenceDir: routeReportsPath("pilot"),
        compact: true,
        template: TODOS_TASK_WORKER_VERIFIER_TEMPLATE_ID,
        provider: "codewith",
        authProfilePool: "account004,account005,account006",
        sandbox: "danger-full-access",
        safetyReason: "operator-approved pilot break-glass route",
        manualBreakGlass: true,
        permissionMode: "bypass",
        projectPath: loopsProject,
        projectGroup: "loops-pilot",
        namePrefix: "event:todos-task-pilot",
        maxActive: "12",
        maxActivePerProject: "1",
        maxActivePerProjectGroup: "4",
        worktreeMode: "auto",
      },
      schedule: {
        every: "5m",
        catchUp: "latest",
        overlap: "skip",
        attempts: "1",
        retryDelay: "1m",
        lease: "3m",
      },
      notes: [
        "The live pilot loop was paused when inspected.",
        "The operator must pass --manual-break-glass explicitly when applying this policy.",
      ],
    },
    {
      id: "machine-sync",
      title: "Machine Sync Task Router",
      description: "Route machine-default-sync tasks with strict per-project and project-group throttles.",
      routeKind: "todos-task",
      safety: "unattended",
      source: "spark01 live loop machine-default-sync-task-router inspected 2026-07-06",
      drain: {
        routePolicyEvidence: "machine-sync",
        ...(todosProject ? { todosProject } : {}),
        taskList: "machine-default-sync",
        tags: "auto:route",
        limit: "50",
        scanLimit: "500",
        maxDispatch: "1",
        evidenceDir: routeReportsPath("machine-sync"),
        compact: true,
        template: TODOS_TASK_WORKER_VERIFIER_TEMPLATE_ID,
        ...commonCodewithDrain(),
        authProfilePool: CODEWITH_IMPL_POOL,
        projectPath: loopsProject,
        projectGroup: "machine-sync",
        maxActive: "5",
        maxActivePerProject: "1",
        maxActivePerProjectGroup: "2",
        worktreeMode: "required",
        worktreeBranchPrefix: "openloops",
        namePrefix: "event:machine-default-sync",
        preflight: true,
      },
      schedule: {
        every: "5m",
        catchUp: "latest",
        overlap: "skip",
        attempts: "2",
        retryDelay: "1m",
        lease: "5m",
      },
      guards: [
        {
          kind: "codewith-active-cap",
          description: "The inspected live loop had an external shell guard that skipped routing when Codewith activeRunCount >= 6.",
          activeCap: 6,
          evidenceDir: routeReportsPath("machine-sync"),
        },
      ],
    },
  ];
}

export function listRoutePolicies(): RoutePolicyDefinition[] {
  return policyDefinitions();
}

export function getRoutePolicy(idOrAlias: string | undefined): RoutePolicyDefinition | undefined {
  const wanted = idOrAlias?.trim();
  if (!wanted) return undefined;
  return policyDefinitions().find((policy) => policy.id === wanted || policy.aliases?.includes(wanted));
}

function selectedPolicyId(opts: Pick<TodosDrainOptions, "policy" | "preset">): string | undefined {
  const policy = opts.policy?.trim();
  const preset = opts.preset?.trim();
  if (policy && preset && policy !== preset) throw new ValidationError(`--policy (${policy}) and --preset (${preset}) disagree`);
  return policy || preset;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value === undefined || value === false || value === "") return [];
  return [String(value)];
}

function valuesEqual(a: unknown, b: unknown): boolean {
  const left = stringList(a);
  const right = stringList(b);
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

const DRAIN_DEFAULTS: Partial<Record<keyof TodosDrainOptions, unknown>> = {
  todosProject: defaultTodosProject(),
  template: TODOS_TASK_WORKER_VERIFIER_TEMPLATE_ID,
  limit: "50",
  maxDispatch: "1",
  addDir: [],
  verifierIdleTimeout: "15m",
  worktreeMode: "auto",
  worktreeBranchPrefix: "openloops",
  namePrefix: "event:todos-task",
};

const SCHEDULE_DEFAULTS: Record<string, unknown> = {
  catchUp: "latest",
  overlap: "skip",
  retryDelay: "1m",
  lease: "30m",
};

function optionWasSet(opts: Record<string, unknown>, key: string, defaults: Record<string, unknown> | Partial<Record<keyof TodosDrainOptions, unknown>>): boolean {
  const value = opts[key];
  if (value === undefined || value === false || value === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return !(key in defaults && valuesEqual(value, defaults[key as keyof typeof defaults]));
}

function mergePolicyValues<T extends Record<string, unknown>>(
  base: T,
  policyId: string,
  values: Record<string, unknown>,
  defaults: Record<string, unknown> | Partial<Record<keyof TodosDrainOptions, unknown>>,
): T {
  const merged: Record<string, unknown> = { ...base };
  const conflicts: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (optionWasSet(base, key, defaults) && !valuesEqual(base[key], value)) {
      conflicts.push(`${key}=${JSON.stringify(base[key])} conflicts with policy ${policyId} value ${JSON.stringify(value)}`);
      continue;
    }
    merged[key] = Array.isArray(value) ? [...value] : value;
  }
  if (conflicts.length) throw new ValidationError(`route policy ${policyId} has conflicting explicit option(s): ${conflicts.join("; ")}`);
  return merged as T;
}

export function applyRoutePolicyToDrainOptions<T extends TodosDrainOptions>(
  opts: T,
  applyOpts: { requireExplicitSafety?: boolean } = {},
): T {
  const id = selectedPolicyId(opts);
  if (!id) return opts;
  const policy = getRoutePolicy(id);
  if (!policy) throw new ValidationError(`unknown route policy: ${id}`);
  if (opts.routePolicyEvidence && opts.routePolicyEvidence !== policy.id) {
    throw new ValidationError(`--route-policy-evidence (${opts.routePolicyEvidence}) does not match policy ${policy.id}`);
  }
  if (applyOpts.requireExplicitSafety !== false) {
    for (const key of policy.requiresExplicitOptions ?? []) {
      if (key === "manualBreakGlass") {
        if (opts[key] !== true) throw new ValidationError(`route policy ${policy.id} requires explicit --manual-break-glass`);
        continue;
      }
      if (key === "safetyReason") {
        if (typeof opts[key] !== "string" || opts[key].trim() === "") {
          throw new ValidationError(`route policy ${policy.id} requires an explicit non-empty --safety-reason`);
        }
        continue;
      }
      if (opts[key] === undefined || opts[key] === false || opts[key] === "") {
        throw new ValidationError(`route policy ${policy.id} requires explicit --${String(key)}`);
      }
    }
  }
  const policyValues = { ...policy.drain } as Record<string, unknown>;
  if (applyOpts.requireExplicitSafety !== false) {
    for (const key of policy.requiresExplicitOptions ?? []) delete policyValues[key];
  }
  const merged = mergePolicyValues(opts as Record<string, unknown>, policy.id, policyValues, DRAIN_DEFAULTS);
  merged.policy = opts.policy;
  merged.preset = opts.preset;
  merged.routePolicyEvidence = policy.id;
  return merged as T;
}

export function applyRoutePolicyToScheduleOptions<T extends TodosDrainOptions & Record<string, unknown>>(opts: T): T {
  const drain = applyRoutePolicyToDrainOptions(opts, { requireExplicitSafety: true }) as T;
  const policy = getRoutePolicy(drain.routePolicyEvidence);
  if (!policy) return drain;
  return mergePolicyValues(drain, policy.id, policy.schedule as Record<string, unknown>, SCHEDULE_DEFAULTS);
}

function expandedDrainOptions(opts: TodosDrainOptions): Partial<TodosDrainOptions> {
  const keys: Array<keyof TodosDrainOptions> = [
    "routePolicyEvidence",
    "todosProject",
    "todosProjectId",
    "taskList",
    "tags",
    "projectPathPrefix",
    "limit",
    "scanLimit",
    "maxDispatch",
    "evidenceDir",
    "compact",
    "template",
    "provider",
    "providerRule",
    "authProfile",
    "authProfilePool",
    "account",
    "accountPool",
    "accountTool",
    "model",
    "variant",
    "agent",
    "addDir",
    "timeout",
    "verifierIdleTimeout",
    "permissionMode",
    "sandbox",
    "safetyReason",
    "manualBreakGlass",
    "projectPath",
    "projectGroup",
    "maxActive",
    "maxActiveScope",
    "maxActivePerProject",
    "maxActivePerProjectGroup",
    "maxPerProfile",
    "worktreeMode",
    "worktreeRoot",
    "worktreeBranchPrefix",
    "prHandoff",
    "githubReviewer",
    "githubReviewerPool",
    "namePrefix",
    "preflight",
  ];
  const result: Partial<TodosDrainOptions> = {};
  for (const key of keys) {
    const value = opts[key];
    if (value === undefined || value === false || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    (result as Record<string, unknown>)[key] = value;
  }
  return result;
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_/:.,=@+-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function routePolicyEvidenceFromOptions(opts: TodosDrainOptions): Record<string, unknown> | undefined {
  const selected = selectedPolicyId(opts);
  const id = opts.routePolicyEvidence ?? selected;
  if (!id) return undefined;
  const policy = getRoutePolicy(id);
  if (policy?.safety === "manual-break-glass") {
    if (opts.manualBreakGlass !== true) {
      throw new ValidationError(`route policy ${policy.id} requires explicit --manual-break-glass`);
    }
    if (typeof opts.safetyReason !== "string" || opts.safetyReason.trim() === "") {
      throw new ValidationError(`route policy ${policy.id} requires an explicit non-empty --safety-reason`);
    }
  }
  const applied = selected && policy
    ? applyRoutePolicyToDrainOptions({ ...opts, policy: policy.id }, { requireExplicitSafety: false })
    : opts;
  return {
    id: policy?.id ?? id,
    title: policy?.title,
    safety: policy?.safety,
    source: policy?.source,
    notes: policy?.notes,
    guards: policy?.guards,
    expandedOptions: expandedDrainOptions(applied),
    explicitArgs: routeDrainArgs(applied),
  };
}

export function renderRoutePolicy(idOrAlias: string): RoutePolicyRender {
  const policy = getRoutePolicy(idOrAlias);
  if (!policy) throw new ValidationError(`unknown route policy: ${idOrAlias}`);
  const expanded = applyRoutePolicyToDrainOptions({ policy: policy.id }, { requireExplicitSafety: false });
  const args = ["--json", ...routeDrainArgs(expanded)];
  return {
    policy,
    drain: expandedDrainOptions(expanded),
    schedule: policy.schedule,
    args,
    command: ["loops", ...args].map(shellQuote).join(" "),
  };
}

export function validateRoutePolicy(idOrAlias: string): RoutePolicyRender {
  const rendered = renderRoutePolicy(idOrAlias);
  const { policy, drain, args } = rendered;
  if (args.includes("--policy") || args.includes("--preset")) {
    throw new ValidationError(`route policy ${policy.id} rendered a non-replayable policy flag`);
  }
  if (policy.safety === "manual-break-glass" &&
      (drain.sandbox !== "danger-full-access" || drain.manualBreakGlass !== true || !drain.safetyReason?.trim())) {
    throw new ValidationError(`route policy ${policy.id} must expose danger-full-access, safety-reason, and manual-break-glass evidence`);
  }
  if (policy.safety === "unattended" && drain.sandbox === "danger-full-access") {
    throw new ValidationError(`route policy ${policy.id} cannot use danger-full-access as unattended automation`);
  }
  return rendered;
}
