import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dataDir as resolverDataDir } from "@hasna/contracts/paths";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type {
  AccountRef,
  AgentPermissionMode,
  AgentProvider,
  AgentSandbox,
  AgentWorktreeMode,
  AgentWorktreeSpec,
  CreateWorkflowInput,
  LoopTemplateSource,
  LoopTemplateSummary,
  TimeoutMs,
  WorkflowStep,
} from "../types.js";
import {
  adversarialReviewFragment,
  boundedStepHeaderFragment,
  BOUNDED_AGENT_WORKER_VERIFIER_TEMPLATE_ID,
  BOUNDED_VERIFIER_DECISION_FRAGMENT,
  BOUNDED_VERIFIER_REVIEW_FRAGMENT,
  BUILTIN_TEMPLATE_SUMMARIES,
  DETERMINISTIC_CHECK_CREATE_TASK_TEMPLATE_ID,
  EVENT_REVIEW_FOCUS,
  EVENT_VERIFIER_DECISION_FRAGMENT,
  EVENT_WORKER_VERIFIER_TEMPLATE_ID,
  goalHeaderFragment,
  INCIDENT_RESPONSE_TEMPLATE_ID,
  KNOWLEDGE_REFRESH_TEMPLATE_ID,
  LIFECYCLE_VERIFIER_DECISION_FRAGMENT,
  lifecycleGateCommand,
  NO_TMUX_DISPATCH_FRAGMENT,
  PR_REVIEW_TEMPLATE_ID,
  prHandoffCommand,
  REPORT_ONLY_TEMPLATE_ID,
  ROUTING_HEALTH_ALERTS_ARE_NOT_TASKS_FRAGMENT,
  ROUTING_REMEDIATION_ALERT_CHANNEL,
  ROUTING_REMEDIATION_TEMPLATE_ID,
  routingRemediationDoctorCommand,
  routingRemediationPreflightCommand,
  SCHEDULED_AUDIT_TEMPLATE_ID,
  sourceTaskGateCommand,
  taskEvidenceGateCommand,
  taskEvidenceMarker,
  TASK_LIFECYCLE_TEMPLATE_ID,
  TASK_REVIEW_FOCUS,
  TASK_VERIFIER_DECISION_FRAGMENT,
  TODOS_TASK_WORKER_VERIFIER_TEMPLATE_ID,
  todosDoneLine,
  todosExactCommandsFragment,
  todosStartLine,
  todosTaskEvidenceLine,
  VERIFIER_TINY_FIXES_FRAGMENT,
  verifierIdleTimeoutMs,
  verifierRuntimeGuidance,
  WORKER_LEAVES_COMPLETION_FRAGMENT,
  worktreeContextFragment,
  worktreePrompt,
} from "./template-kit.js";
import type { AgentWorkflowRole, LifecycleGateStage } from "./template-kit.js";
import { poolRoleOffset, stableIndex } from "./route/profile-pool.js";

export {
  BOUNDED_AGENT_WORKER_VERIFIER_TEMPLATE_ID,
  DETERMINISTIC_CHECK_CREATE_TASK_TEMPLATE_ID,
  EVENT_WORKER_VERIFIER_TEMPLATE_ID,
  INCIDENT_RESPONSE_TEMPLATE_ID,
  KNOWLEDGE_REFRESH_TEMPLATE_ID,
  PR_REVIEW_TEMPLATE_ID,
  REPORT_ONLY_TEMPLATE_ID,
  ROUTING_REMEDIATION_TEMPLATE_ID,
  SCHEDULED_AUDIT_TEMPLATE_ID,
  TASK_LIFECYCLE_TEMPLATE_ID,
  TODOS_TASK_WORKER_VERIFIER_TEMPLATE_ID,
} from "./template-kit.js";
import {
  customLoopTemplatesDir,
  getCustomLoopTemplate,
  importCustomLoopTemplate as importCustomLoopTemplateWithReserved,
  loadCustomLoopTemplates,
  renderCustomLoopTemplate,
  validateCustomLoopTemplateFile as validateCustomLoopTemplateFileWithReserved,
} from "./templates-custom.js";
import type { CustomLoopTemplateImportOptions, CustomLoopTemplateImportResult } from "./templates-custom.js";

export type { CustomLoopTemplateImportOptions, CustomLoopTemplateImportResult } from "./templates-custom.js";

/** Agent/account/worktree fields shared by every agent-backed builtin template input. */
export interface AgentWorkflowTemplateBaseInput {
  projectPath: string;
  routeProjectPath?: string;
  projectGroup?: string;
  routeScope?: string;
  routeThrottleLimits?: {
    maxActive?: number;
    maxActiveScope?: string;
    maxActivePerProject?: number;
    maxActivePerProjectGroup?: number;
    maxPerProfile?: number;
  };
  provider?: AgentProvider;
  authProfile?: string;
  authProfilePool?: string[];
  triageAuthProfile?: string;
  plannerAuthProfile?: string;
  workerAuthProfile?: string;
  verifierAuthProfile?: string;
  account?: AccountRef;
  accountPool?: AccountRef[];
  triageAccount?: AccountRef;
  plannerAccount?: AccountRef;
  workerAccount?: AccountRef;
  verifierAccount?: AccountRef;
  model?: string;
  variant?: string;
  agent?: string;
  addDirs?: string[];
  permissionMode?: AgentPermissionMode;
  sandbox?: AgentSandbox;
  allowTools?: string[];
  allowCommands?: string[];
  safetyReason?: string;
  manualBreakGlass?: boolean;
  worktreeMode?: AgentWorktreeMode;
  worktreeRoot?: string;
  worktreeBranchPrefix?: string;
  timeoutMs?: TimeoutMs;
  verifierIdleTimeoutMs?: number;
}

export interface TodosTaskWorkflowTemplateInput extends AgentWorkflowTemplateBaseInput {
  taskId: string;
  taskTitle?: string;
  taskDescription?: string;
  todosProjectPath?: string;
  prHandoff?: boolean;
  prReviewRouting?: PrReviewRoutingTemplateContext;
  eventId?: string;
  eventType?: string;
}

export interface PrReviewRoutingTemplateContext {
  required?: boolean;
  allowed?: boolean;
  reason?: string;
  author?: string;
  reviewers?: string[];
  selectedReviewer?: string;
  signals?: string[];
}

export interface EventWorkflowTemplateInput extends AgentWorkflowTemplateBaseInput {
  eventId: string;
  eventType: string;
  eventSource: string;
  eventSubject?: string;
  eventMessage?: string;
  eventJson: string;
}

export interface BoundedAgentWorkflowTemplateInput extends AgentWorkflowTemplateBaseInput {
  name?: string;
  objective: string;
  prompt?: string;
}

export interface RoutingRemediationWorkflowTemplateInput extends AgentWorkflowTemplateBaseInput {
  todosProjectPath?: string;
  doctorJsonPath?: string;
  doctorProject?: string;
  tag?: string;
  status?: string;
  shard?: string;
  limit?: string;
  maxRepairs?: number;
  dryRun?: boolean;
  idempotencyKey?: string;
  evidenceDir?: string;
  undoDir?: string;
  /**
   * Conversations channel that routing-health blocker findings are summarised to.
   * Defaults to {@link ROUTING_REMEDIATION_ALERT_CHANNEL}. They are never filed as tasks.
   */
  alertChannel?: string;
}

export type LoopTemplateSourceFilter = LoopTemplateSource | "all";

export interface ListLoopTemplatesOptions {
  source?: LoopTemplateSourceFilter;
}

// ---------------------------------------------------------------------------
// Shared render helpers
// ---------------------------------------------------------------------------

function compactJson(value: unknown): string {
  return JSON.stringify(value);
}

function prReviewRoutingContext(input: TodosTaskWorkflowTemplateInput): PrReviewRoutingTemplateContext | undefined {
  return input.prReviewRouting?.required ? input.prReviewRouting : undefined;
}

function prReviewFollowUpFragment(input: TodosTaskWorkflowTemplateInput): string {
  const routing = prReviewRoutingContext(input);
  const author = routing?.author?.trim();
  const reviewers = routing?.reviewers?.map((reviewer) => reviewer.trim()).filter(Boolean) ?? [];
  const evidenceLines = [
    author ? `- Source PR author evidence: GitHub author is ${author}` : undefined,
    reviewers.length ? `- Source PR reviewer evidence: GitHub reviewer pool: ${reviewers.join(", ")}` : undefined,
    routing?.selectedReviewer ? `- Selected non-author reviewer: ${routing.selectedReviewer}` : undefined,
  ].filter(Boolean);
  return [
    "PR-derived follow-up todos: If any lifecycle step creates a follow-up todo that references a GitHub PR, PR approval, PR review, or PR merge work, the todo description must include parser-compatible routing evidence so downstream drains can select a non-author reviewer.",
    ...evidenceLines,
    "Copy these exact evidence lines from the source task when present, or derive them from the referenced PR before creating the follow-up todo:",
    "GitHub author is <login>",
    "GitHub reviewer pool: <login>, <login>",
    "When the source PR author or reviewer pool cannot be determined, do not create an auto-routable PR-derived follow-up todo; comment the source task with the blocker instead.",
  ].join("\n");
}

function taskLabel(input: TodosTaskWorkflowTemplateInput): string {
  const head = input.taskTitle?.trim() || input.taskId;
  return head.length > 160 ? `${head.slice(0, 157)}...` : head;
}

function routeAdmissionContext(input: AgentWorkflowTemplateBaseInput): Record<string, unknown> | undefined {
  const limits = input.routeThrottleLimits
    ? {
        maxActive: input.routeThrottleLimits.maxActive,
        maxActiveScope: input.routeThrottleLimits.maxActiveScope,
        maxActivePerProject: input.routeThrottleLimits.maxActivePerProject,
        maxActivePerProjectGroup: input.routeThrottleLimits.maxActivePerProjectGroup,
        maxPerProfile: input.routeThrottleLimits.maxPerProfile,
      }
    : undefined;
  const hasLimits = Boolean(limits && Object.values(limits).some((value) => value !== undefined));
  if (!input.projectGroup && !input.routeScope && !hasLimits) return undefined;
  return {
    projectGroup: input.projectGroup,
    routeScope: input.routeScope,
    ...(hasLimits ? { limits } : {}),
  };
}

const UNLIMITED_AGENT_TIMEOUT_MS: TimeoutMs = null;

function agentTimeoutMs(input: { timeoutMs?: TimeoutMs }): TimeoutMs {
  return input.timeoutMs === undefined ? UNLIMITED_AGENT_TIMEOUT_MS : input.timeoutMs;
}

function parseTemplateTimeoutMs(raw: string | undefined): TimeoutMs | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const normalized = raw.trim().toLowerCase();
  if (["unlimited", "none", "null", "never", "off", "false"].includes(normalized)) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("timeoutMs must be a positive integer number of milliseconds, or unlimited/none/null");
  }
  return value;
}

function parseTemplateIdleTimeoutMs(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const normalized = raw.trim().toLowerCase();
  if (["unlimited", "none", "null", "never", "off", "false"].includes(normalized)) return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("verifierIdleTimeoutMs must be a positive integer number of milliseconds, or none/off");
  }
  return value;
}

function parseDeterministicTimeoutMs(raw: string | undefined, fallbackMs: number, label = "timeoutMs"): number {
  if (raw === undefined || raw.trim() === "") return fallbackMs;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer number of milliseconds`);
  return value;
}

function parseNonNegativeIntegerVar(raw: string | undefined, fallback: number, label: string): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function rolePoolValue<T>(pool: T[] | undefined, seed: string, role: AgentWorkflowRole): T | undefined {
  if (!pool?.length) return undefined;
  const workerIndex = stableIndex(seed, pool.length);
  if (pool.length === 1) return pool[workerIndex];
  // Deterministic per-role offset. This is the render-time default; live drain
  // dispatch may override codewith auth profiles with least-loaded pool
  // selection (see route/profile-pool.ts + route-event.ts). The tie-break there
  // reuses this exact offset so equal-load selection is identical.
  return pool[(workerIndex + poolRoleOffset(role)) % pool.length];
}

function authProfileForRole(input: AgentWorkflowTemplateBaseInput, role: AgentWorkflowRole, seed: string): string | undefined {
  if (role === "triage" && input.triageAuthProfile) return input.triageAuthProfile;
  if (role === "planner" && input.plannerAuthProfile) return input.plannerAuthProfile;
  if (role === "worker" && input.workerAuthProfile) return input.workerAuthProfile;
  if (role === "verifier" && input.verifierAuthProfile) return input.verifierAuthProfile;
  return rolePoolValue(input.authProfilePool, seed, role) ?? input.authProfile;
}

function accountForRole(input: AgentWorkflowTemplateBaseInput, role: AgentWorkflowRole, seed: string): AccountRef | undefined {
  if (role === "triage" && input.triageAccount) return input.triageAccount;
  if (role === "planner" && input.plannerAccount) return input.plannerAccount;
  if (role === "worker" && input.workerAccount) return input.workerAccount;
  if (role === "verifier" && input.verifierAccount) return input.verifierAccount;
  return rolePoolValue(input.accountPool, seed, role) ?? input.account;
}

function slugSegment(value: string | undefined, fallback = "item"): string {
  const slug = (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || fallback;
}

function stableHex(seed: string): string {
  return stableIndex(seed, 0xffffffff).toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Worktree planning. Templates compute the deterministic worktree location and
// branch; the executor natively prepares/enters the worktree from the agent
// step's target.worktree spec (no template-emitted prepare step).
// ---------------------------------------------------------------------------

interface WorktreePlan extends AgentWorktreeSpec {
  gitMetadataDir?: string;
}

function normalizeWorktreeMode(mode: AgentWorktreeMode | undefined): AgentWorktreeMode {
  const value = mode ?? "auto";
  if (!["auto", "required", "off", "main"].includes(value)) {
    throw new Error(`worktreeMode must be one of auto, required, off, or main`);
  }
  return value;
}

function defaultWorktreeRoot(root: string | undefined): string {
  if (root?.trim()) {
    const expanded = root.trim().replace(/^~(?=$|\/)/, homedir());
    return isAbsolute(expanded) ? expanded : resolve(expanded);
  }
  // Canonical worktree root per global-worktree-placement; never an app data
  // dir. Resolved through the single paths resolver (ruling #1668).
  return join(resolverDataDir({ app: "repos", home: homedir() }), "worktrees");
}

function gitRootFor(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return execFileSync("git", ["-C", path, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

function gitCommonDirFor(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const raw = execFileSync("git", ["-C", path, "rev-parse", "--git-common-dir"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!raw) return undefined;
    return isAbsolute(raw) ? raw : resolve(path, raw);
  } catch {
    return undefined;
  }
}

function worktreePlan(input: AgentWorkflowTemplateBaseInput, seed: string): WorktreePlan {
  const mode = normalizeWorktreeMode(input.worktreeMode);
  const originalCwd = input.projectPath;
  if (mode === "off" || mode === "main") {
    return {
      mode,
      enabled: false,
      originalCwd,
      cwd: originalCwd,
      reason: mode === "main" ? "explicit main/default checkout mode" : "worktree mode disabled",
    };
  }

  const repoRoot = gitRootFor(originalCwd);
  if (!repoRoot) {
    if (mode === "required") {
      throw new Error(`worktreeMode=required but projectPath is not an existing git repository: ${originalCwd}`);
    }
    return {
      mode,
      enabled: false,
      originalCwd,
      cwd: originalCwd,
      reason: "projectPath is not an existing git repository",
    };
  }

  const root = defaultWorktreeRoot(input.worktreeRoot);
  const repoSlug = slugSegment(basename(repoRoot), "repo");
  const seedSlug = `${slugSegment(seed, "run").slice(0, 48)}-${stableHex(`${repoRoot}:${seed}`)}`;
  const worktreePath = join(root, repoSlug, seedSlug);
  const relativeCwd = relative(repoRoot, originalCwd);
  const cwd = relativeCwd && !relativeCwd.startsWith("..") && !isAbsolute(relativeCwd)
    ? join(worktreePath, relativeCwd)
    : worktreePath;
  const branchPrefix = (input.worktreeBranchPrefix?.trim() || "openloops").replace(/^\/+|\/+$/g, "") || "openloops";
  const branch = `${branchPrefix}/${repoSlug}/${seedSlug}`;
  return {
    mode,
    enabled: true,
    originalCwd,
    cwd,
    repoRoot,
    root,
    path: worktreePath,
    branch,
    gitMetadataDir: gitCommonDirFor(repoRoot),
  };
}

function assertNativeAuthProfileSupport(input: AgentWorkflowTemplateBaseInput, provider: AgentProvider): void {
  if (provider === "codewith") return;
  const hasNativeAuthProfiles = Boolean(
    input.authProfile ||
      input.authProfilePool?.length ||
      input.triageAuthProfile ||
      input.plannerAuthProfile ||
      input.workerAuthProfile ||
      input.verifierAuthProfile,
  );
  if (!hasNativeAuthProfiles) return;
  throw new Error(
    `authProfile, authProfilePool, triageAuthProfile, plannerAuthProfile, workerAuthProfile, and verifierAuthProfile are supported only for provider codewith; use account/accountPool for ${provider} profile isolation`,
  );
}

function failClosedSandbox(input: AgentWorkflowTemplateBaseInput, provider: AgentProvider, sandbox: AgentSandbox | undefined): void {
  const relaxed = (["codewith", "codex"].includes(provider) && sandbox === "danger-full-access") ||
    (provider === "cursor" && sandbox === "disabled");
  if (!relaxed) return;
  if (input.manualBreakGlass && input.safetyReason?.trim()) return;
  throw new Error(
    `${sandbox} is manual break-glass only for generated worker/verifier workflows; use a restricted sandbox or set manualBreakGlass=true with a non-empty safetyReason and explicit operator approval`,
  );
}

function agentAllowlist(input: AgentWorkflowTemplateBaseInput) {
  const tools = input.allowTools?.length ? [...new Set(input.allowTools)] : undefined;
  const commands = [...(input.allowCommands ?? [])];
  if (input.manualBreakGlass) commands.push("manual-break-glass");
  const uniqueCommands = commands.length ? [...new Set(commands)] : undefined;
  const safetyReason = input.safetyReason?.trim() || undefined;
  if ((tools?.length || uniqueCommands?.length) && !safetyReason) {
    throw new Error("allowlist.safetyReason is required when tool or command restrictions are declared");
  }
  if (!tools?.length && !uniqueCommands?.length && !safetyReason) return undefined;
  return {
    tools,
    commands: uniqueCommands,
    enforcement: "metadata_only" as const,
    safetyReason,
  };
}

function agentTarget(
  input: AgentWorkflowTemplateBaseInput,
  prompt: string,
  role: AgentWorkflowRole,
  seed: string,
  plan: WorktreePlan,
): WorkflowStep["target"] {
  const provider = input.provider ?? "codewith";
  assertNativeAuthProfileSupport(input, provider);
  const sandbox =
    input.sandbox ??
    (provider === "codewith" || provider === "codex"
      ? "workspace-write"
      : provider === "cursor"
        ? "enabled"
        : undefined);
  failClosedSandbox(input, provider, sandbox);
  const addDirs = [...(input.addDirs ?? [])];
  if (
    plan.enabled &&
    plan.gitMetadataDir &&
    (provider === "codewith" || provider === "codex") &&
    sandbox === "workspace-write"
  ) {
    addDirs.push(plan.gitMetadataDir);
  }
  return {
    type: "agent",
    provider,
    prompt,
    cwd: plan.cwd,
    model: input.model,
    variant: input.variant,
    agent: input.agent,
    addDirs: addDirs.length ? [...new Set(addDirs)] : undefined,
    authProfile: provider === "codewith" ? authProfileForRole(input, role, seed) : undefined,
    configIsolation: "safe",
    permissionMode:
      input.permissionMode ??
      (provider === "codewith" || provider === "codex" ? "bypass" : "default"),
    sandbox,
    manualBreakGlass: input.manualBreakGlass || undefined,
    worktree: {
      mode: plan.mode,
      enabled: plan.enabled,
      originalCwd: plan.originalCwd,
      cwd: plan.cwd,
      repoRoot: plan.repoRoot,
      root: plan.root,
      path: plan.path,
      branch: plan.branch,
      reason: plan.reason,
    },
    allowlist: agentAllowlist(input),
    routing: {
      projectPath: input.routeProjectPath ?? input.projectPath,
      ...(input.projectGroup ? { projectGroup: input.projectGroup } : {}),
      role,
    },
    account: accountForRole(input, role, seed),
    timeoutMs: agentTimeoutMs(input),
    idleTimeoutMs: role === "verifier" ? verifierIdleTimeoutMs(input) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Deterministic step builders
// ---------------------------------------------------------------------------

/**
 * Exit codes that mark a gate step as blocked control flow instead of failed.
 * blockedExitCodes is read by the workflow runner from step JSON; the
 * WorkflowStep type field addition belongs to the types.ts owners.
 */
const GATE_BLOCKED_EXIT_CODES = [12];

type GateWorkflowStep = WorkflowStep & { blockedExitCodes?: number[] };

interface CommandStepOptions {
  id: string;
  name: string;
  description: string;
  command: string;
  cwd: string;
  timeoutMs: number;
  idleTimeoutMs?: number;
  dependsOn?: string[];
  blockedExitCodes?: number[];
}

/**
 * Deterministic helper steps run in the original checkout. Their commands pin
 * a Todos project only when one is configured, and the executor prepares the
 * agent worktree lazily so the worktree cwd may not exist yet.
 */
function commandStep(opts: CommandStepOptions): GateWorkflowStep {
  return {
    id: opts.id,
    name: opts.name,
    description: opts.description,
    ...(opts.dependsOn ? { dependsOn: opts.dependsOn } : {}),
    target: {
      type: "command",
      command: "bash",
      args: ["-lc", opts.command],
      cwd: opts.cwd,
      timeoutMs: opts.timeoutMs,
      ...(opts.idleTimeoutMs !== undefined ? { idleTimeoutMs: opts.idleTimeoutMs } : {}),
    },
    timeoutMs: opts.timeoutMs,
    ...(opts.blockedExitCodes ? { blockedExitCodes: opts.blockedExitCodes } : {}),
  };
}

function sourceTaskGateStep(todosProjectPath: string | undefined, taskId: string, plan: WorktreePlan, description: string): GateWorkflowStep {
  return commandStep({
    id: "source-task-gate",
    name: "Source Task Gate",
    description,
    command: sourceTaskGateCommand(todosProjectPath, taskId),
    cwd: plan.originalCwd,
    timeoutMs: 60_000,
    blockedExitCodes: GATE_BLOCKED_EXIT_CODES,
  });
}

interface LifecycleGateStepOptions {
  stage: LifecycleGateStage;
  description: string;
  dependsOn: string[];
  todosProjectPath?: string;
  taskId: string;
  goMarker: string;
  blockedMarker: string;
  plan: WorktreePlan;
}

function lifecycleGateStep(opts: LifecycleGateStepOptions): GateWorkflowStep {
  return commandStep({
    id: `${opts.stage}-gate`,
    name: opts.stage === "triage" ? "Triage Gate" : "Planner Gate",
    description: opts.description,
    dependsOn: opts.dependsOn,
    command: lifecycleGateCommand(opts.todosProjectPath, opts.taskId, opts.stage, opts.goMarker, opts.blockedMarker),
    cwd: opts.plan.originalCwd,
    timeoutMs: 2 * 60_000,
    blockedExitCodes: GATE_BLOCKED_EXIT_CODES,
  });
}

function taskEvidenceCheckStep(
  todosProjectPath: string | undefined,
  taskId: string,
  plan: WorktreePlan,
  workerMarker: string,
  verifierMarker: string,
): WorkflowStep {
  return commandStep({
    id: "task-evidence-check",
    name: "Task Evidence Check",
    description: "Fail route success unless the verifier completed the task with visible worker and verifier evidence.",
    dependsOn: ["verifier"],
    command: taskEvidenceGateCommand(todosProjectPath, taskId, workerMarker, verifierMarker),
    cwd: plan.originalCwd,
    timeoutMs: 60_000,
    blockedExitCodes: [],
  });
}

function prHandoffArtifactPath(plan: WorktreePlan, taskId: string): string {
  return join(plan.cwd, ".openloops", "pr-handoff", `${slugSegment(taskId, "task")}.json`);
}

function prHandoffStep(input: TodosTaskWorkflowTemplateInput, plan: WorktreePlan, todosProjectPath: string | undefined): WorkflowStep {
  return commandStep({
    id: "pr-handoff",
    name: "PR Handoff",
    description: "Push/open a PR from a worker handoff artifact or queue a bounded network handoff task.",
    dependsOn: ["worker"],
    command: prHandoffCommand({
      artifactPath: prHandoffArtifactPath(plan, input.taskId),
      taskId: input.taskId,
      todosProjectPath,
      worktreeCwd: plan.cwd,
      worktreeRoot: plan.path ?? plan.cwd,
      expectedBranch: plan.branch ?? "",
    }),
    cwd: plan.originalCwd,
    timeoutMs: 2 * 60_000,
  });
}

interface WorkerVerifierStepOptions {
  input: AgentWorkflowTemplateBaseInput;
  seed: string;
  plan: WorktreePlan;
  workerPrompt: string;
  verifierPrompt: string;
  workerDescription: string;
  verifierDescription: string;
  workerDependsOn?: string[];
}

function workerVerifierSteps(opts: WorkerVerifierStepOptions): WorkflowStep[] {
  const timeoutMs = agentTimeoutMs(opts.input);
  return [
    {
      id: "worker",
      name: "Worker",
      description: opts.workerDescription,
      ...(opts.workerDependsOn ? { dependsOn: opts.workerDependsOn } : {}),
      target: agentTarget(opts.input, opts.workerPrompt, "worker", opts.seed, opts.plan),
      timeoutMs,
    },
    {
      id: "verifier",
      name: "Verifier",
      description: opts.verifierDescription,
      dependsOn: ["worker"],
      target: agentTarget(opts.input, opts.verifierPrompt, "verifier", opts.seed, opts.plan),
      timeoutMs,
    },
  ];
}

// ---------------------------------------------------------------------------
// Template listing (builtin summaries + custom registry facade)
// ---------------------------------------------------------------------------

export function loopTemplatesDir(): string {
  return customLoopTemplatesDir();
}

function builtinLoopTemplates(): LoopTemplateSummary[] {
  return BUILTIN_TEMPLATE_SUMMARIES.map((template) => ({ ...structuredClone(template), source: "builtin" }));
}

function getBuiltinLoopTemplate(id: string): LoopTemplateSummary | undefined {
  return builtinLoopTemplates().find((template) => template.id === id || template.name === id);
}

function builtinTemplateKeys(): Set<string> {
  const keys = new Set<string>();
  for (const template of BUILTIN_TEMPLATE_SUMMARIES) {
    keys.add(template.id);
    keys.add(template.name);
  }
  return keys;
}

export function validateCustomLoopTemplateFile(file: string): LoopTemplateSummary {
  return validateCustomLoopTemplateFileWithReserved(file, builtinTemplateKeys());
}

export function importCustomLoopTemplate(file: string, opts: CustomLoopTemplateImportOptions = {}): CustomLoopTemplateImportResult {
  return importCustomLoopTemplateWithReserved(file, builtinTemplateKeys(), opts);
}

export function validateLoopTemplateRegistry(opts: ListLoopTemplatesOptions = {}): { ok: true; templates: LoopTemplateSummary[]; customDir: string } {
  return {
    ok: true,
    templates: listLoopTemplates(opts),
    customDir: customLoopTemplatesDir(),
  };
}

export function listLoopTemplates(opts: ListLoopTemplatesOptions = {}): LoopTemplateSummary[] {
  const source = opts.source ?? "all";
  const templates: LoopTemplateSummary[] = [];
  if (source !== "custom") templates.push(...builtinLoopTemplates());
  if (source !== "builtin") {
    templates.push(...loadCustomLoopTemplates(builtinTemplateKeys()).map((entry) => structuredClone(entry.summary)));
  }
  return templates;
}

export function getLoopTemplate(id: string, opts: ListLoopTemplatesOptions = {}): LoopTemplateSummary | undefined {
  const source = opts.source ?? "all";
  if (source !== "custom") {
    const builtin = getBuiltinLoopTemplate(id);
    if (builtin) return builtin;
    if (source === "builtin") return undefined;
  }
  return getCustomLoopTemplate(id, builtinTemplateKeys())?.summary;
}

// ---------------------------------------------------------------------------
// Builtin template renderers
// ---------------------------------------------------------------------------

export function renderTodosTaskWorkerVerifierWorkflow(input: TodosTaskWorkflowTemplateInput): CreateWorkflowInput {
  if (!input.taskId?.trim()) throw new Error("taskId is required");
  if (!input.projectPath?.trim()) throw new Error("projectPath is required");
  const todosProjectPath = input.todosProjectPath?.trim() || undefined;
  const plan = worktreePlan(input, input.taskId);
  const workerMarker = taskEvidenceMarker("worker", input.taskId, input.eventId);
  const verifierMarker = taskEvidenceMarker("verifier", input.taskId, input.eventId);
  const taskContext = {
    taskId: input.taskId,
    taskTitle: input.taskTitle,
    taskDescription: input.taskDescription,
    eventId: input.eventId,
    eventType: input.eventType,
    projectPath: input.projectPath,
    routeProjectPath: input.routeProjectPath,
    projectGroup: input.projectGroup,
    routeAdmission: routeAdmissionContext(input),
    worktree: worktreeContextFragment(plan),
  };
  const workerPrompt = [
    ...goalHeaderFragment(`Complete todos task ${input.taskId} in ${input.projectPath}.`, "worker", "task"),
    worktreePrompt(plan),
    ...todosExactCommandsFragment(todosProjectPath, input.taskId, [
      todosStartLine(todosProjectPath, input.taskId),
      todosTaskEvidenceLine(todosProjectPath, input.taskId, "worker", workerMarker, "concise worker evidence and blockers"),
    ]),
    "Investigate first before changing files. Use the todos CLI as the source of truth for the task.",
    "Inspect the repository/project state, implement only the task scope, run focused validation, preserve unrelated user changes, and update the task with comments, evidence, changed files, commits, and blockers.",
    NO_TMUX_DISPATCH_FRAGMENT,
    WORKER_LEAVES_COMPLETION_FRAGMENT,
    "",
    `Task context JSON: ${compactJson(taskContext)}`,
  ].join("\n");
  const verifierPrompt = [
    ...goalHeaderFragment(`Verify todos task ${input.taskId} after the worker step.`, "verifier", "task"),
    worktreePrompt(plan),
    ...todosExactCommandsFragment(todosProjectPath, input.taskId, [
      todosTaskEvidenceLine(todosProjectPath, input.taskId, "verifier", verifierMarker, "concise verification evidence or blocker"),
      todosDoneLine(todosProjectPath, input.taskId),
    ]),
    adversarialReviewFragment("the task, repository state, commits, tests, and worker evidence", TASK_REVIEW_FOCUS),
    verifierRuntimeGuidance(input),
    TASK_VERIFIER_DECISION_FRAGMENT,
    NO_TMUX_DISPATCH_FRAGMENT,
    VERIFIER_TINY_FIXES_FRAGMENT,
    "",
    `Task context JSON: ${compactJson(taskContext)}`,
  ].join("\n");

  return {
    name: `todos-task-${input.taskId.slice(0, 8)}-worker-verifier`,
    description: `Task-triggered worker/verifier workflow for ${taskLabel(input)}`,
    version: 1,
    steps: [
      sourceTaskGateStep(
        todosProjectPath,
        input.taskId,
        plan,
        "Fail before worker execution when the source todos task is not resolvable.",
      ),
      ...workerVerifierSteps({
        input,
        seed: input.taskId,
        plan,
        workerPrompt,
        verifierPrompt,
        workerDescription: "Implement the todos task and record evidence.",
        verifierDescription: "Adversarially verify worker output and update todos.",
        workerDependsOn: ["source-task-gate"],
      }),
      taskEvidenceCheckStep(todosProjectPath, input.taskId, plan, workerMarker, verifierMarker),
    ],
  };
}

export function renderTaskLifecycleWorkflow(input: TodosTaskWorkflowTemplateInput): CreateWorkflowInput {
  if (!input.taskId?.trim()) throw new Error("taskId is required");
  if (!input.projectPath?.trim()) throw new Error("projectPath is required");
  const todosProjectPath = input.todosProjectPath?.trim() || undefined;
  const plan = worktreePlan(input, input.taskId);
  const workerMarker = taskEvidenceMarker("worker", input.taskId, input.eventId);
  const verifierMarker = taskEvidenceMarker("verifier", input.taskId, input.eventId);
  const taskContext = {
    taskId: input.taskId,
    taskTitle: input.taskTitle,
    taskDescription: input.taskDescription,
    eventId: input.eventId,
    eventType: input.eventType,
    projectPath: input.projectPath,
    routeProjectPath: input.routeProjectPath,
    projectGroup: input.projectGroup,
    todosProjectPath,
    prReviewRouting: prReviewRoutingContext(input),
    routeAdmission: routeAdmissionContext(input),
    worktree: worktreeContextFragment(plan),
  };
  const handoffArtifactPath = prHandoffArtifactPath(plan, input.taskId);
  const prHandoffGuidance = input.prHandoff
    ? [
        "PR handoff mode is enabled for this lifecycle.",
        `If implementation and validation pass but git push or gh PR creation fails because DNS, network, or sandbox policy blocks GitHub access, write a JSON artifact to: ${handoffArtifactPath}`,
        "The artifact must include taskId, worktreePath or repoPath, branch, base, commit, remote, validation, and error. Include githubRepo, title, and body when known.",
        "After writing the artifact, comment the source task with the artifact path and exit without marking the task done. The bounded PR handoff step will push/open the PR or queue a network-enabled handoff task without rerunning implementation.",
      ].join("\n")
    : "";
  const shared = [
    worktreePrompt(plan),
    ...todosExactCommandsFragment(todosProjectPath, input.taskId, []),
    "Use concrete task-specific text in lifecycle comments. Do not copy placeholder text into lifecycle comments; triage and planner comments must start with the exact stage marker when advancing or blocking the workflow.",
    NO_TMUX_DISPATCH_FRAGMENT,
    "Preserve unrelated user changes and keep scope tied to the task acceptance criteria.",
    prReviewFollowUpFragment(input),
    "",
    `Task context JSON: ${compactJson(taskContext)}`,
    prHandoffGuidance,
  ].join("\n");
  const gateMarker = (stage: LifecycleGateStage, state: "go" | "blocked"): string =>
    `openloops:${stage}=${state} task=${input.taskId}${input.eventId ? ` event=${input.eventId}` : ""}`;
  const todosCommand = todosProjectPath ? `todos --project ${todosProjectPath}` : "todos";
  const blockTaskCommand = `${todosCommand} update ${input.taskId} --status blocked`;
  const markerCommentCommand = (stage: LifecycleGateStage, state: "go" | "blocked", evidencePlaceholder: string): string =>
    `${todosCommand} comment ${input.taskId} "${gateMarker(stage, state)}\n<${evidencePlaceholder}>"`;
  const gateStopFragment = (stage: LifecycleGateStage, stops: string): string =>
    `The deterministic ${stage} gate will stop ${stops} unless the latest ${stage} marker is the exact go marker and the task has no blocked/completed/done/cancelled/failed/archived/no-auto/manual/approval-required state.`;
  const triagePrompt = [
    ...boundedStepHeaderFragment(`Triage todos task ${input.taskId} for safe automated execution.`, "triage", "lifecycle"),
    shared,
    "Decide whether the task is eligible for loop execution. Check status, dependencies, duplicate tasks, no-auto/manual/approval metadata, project path, acceptance criteria, and whether the requested work should be split before implementation.",
    "Do not implement repo changes in this step.",
    `If the task is eligible for automated planning, add a task comment whose first line is exactly: ${gateMarker("triage", "go")}`,
    `Use this copy-safe marker comment command for triage go: ${markerCommentCommand("triage", "go", "task-specific triage evidence")}`,
    "Do not run a separate generic evidence comment before the marker; include the triage decision, duplicates/dependencies found, and any follow-up tasks created in that same marker comment.",
    `If the task should not proceed automatically, run: ${blockTaskCommand}`,
    `Then add a task comment whose first line is exactly: ${gateMarker("triage", "blocked")}`,
    `Use this copy-safe marker comment command for triage blocked: ${markerCommentCommand("triage", "blocked", "task-specific triage evidence")}`,
    "Do not run a separate generic blocker comment before the marker; include the blocker evidence in that same marker comment.",
    gateStopFragment("triage", "later steps"),
  ].join("\n");
  const plannerPrompt = [
    ...boundedStepHeaderFragment(`Plan todos task ${input.taskId} before implementation.`, "planner", "lifecycle"),
    shared,
    "Read the triage comment and current task details.",
    `If the task is ready for implementation, add a task comment whose first line is exactly: ${gateMarker("planner", "go")}`,
    `Use this copy-safe marker comment command for planner go: ${markerCommentCommand("planner", "go", "task-specific plan/evidence")}`,
    "Do not run a separate generic evidence comment before the marker; in that same marker comment, include a concise implementation plan: files/areas to inspect, validation commands, risk checks, expected commit/PR behavior, and any cross-repo tasks that should be created separately.",
    `Do not implement repo changes in this step. If the task is too broad or unsafe for automation, run: ${blockTaskCommand}`,
    `Then add a task comment whose first line is exactly: ${gateMarker("planner", "blocked")}`,
    `Use this copy-safe marker comment command for planner blocked: ${markerCommentCommand("planner", "blocked", "task-specific plan/evidence")}`,
    `Do not run a separate generic blocker comment before the marker; create smaller deduped tasks and record blocker evidence in that same marker comment. ${gateStopFragment("planner", "the worker")}`,
  ].join("\n");
  const workerPrompt = [
    ...boundedStepHeaderFragment(`Complete todos task ${input.taskId} according to the planner evidence.`, "worker", "lifecycle"),
    shared,
    todosStartLine(todosProjectPath, input.taskId),
    todosTaskEvidenceLine(todosProjectPath, input.taskId, "worker", workerMarker, "concrete worker evidence: changed files, commits, validation, blockers, residual risks"),
    "Read the triage and planner comments first. Implement only the scoped task, run focused validation, and record concrete worker evidence in todos: changed files, commits, validation results, blockers, and residual risks.",
    input.prHandoff ? `When only GitHub network access is blocked after a successful commit/validation, record the handoff artifact at ${handoffArtifactPath} instead of repeatedly retrying push/PR creation.` : undefined,
    WORKER_LEAVES_COMPLETION_FRAGMENT,
  ].filter(Boolean).join("\n");
  const verifierPrompt = [
    ...boundedStepHeaderFragment(`Verify todos task ${input.taskId} after the full lifecycle worker step.`, "verifier", "lifecycle"),
    shared,
    "Before completion, record concrete verification evidence in todos with changed files, validation results, findings, and the task decision.",
    todosTaskEvidenceLine(todosProjectPath, input.taskId, "verifier", verifierMarker, "concrete verifier evidence: findings, validation, task decision"),
    todosDoneLine(todosProjectPath, input.taskId),
    adversarialReviewFragment("triage, plan, worker evidence, repo state, commits, tests, and acceptance criteria", TASK_REVIEW_FOCUS),
    verifierRuntimeGuidance(input),
    input.prHandoff ? `If ${handoffArtifactPath} exists and there is no PR URL evidence, verify that the PR handoff step queued or completed a bounded handoff; leave the original task open or blocked until PR evidence is recorded.` : undefined,
    LIFECYCLE_VERIFIER_DECISION_FRAGMENT,
    VERIFIER_TINY_FIXES_FRAGMENT,
  ].filter(Boolean).join("\n");
  const steps: WorkflowStep[] = [
    sourceTaskGateStep(
      todosProjectPath,
      input.taskId,
      plan,
      "Fail before lifecycle agents execute when the source todos task is not resolvable.",
    ),
    {
      id: "triage",
      name: "Triage",
      description: "Check task eligibility, duplicates, dependencies, and automation gates.",
      dependsOn: ["source-task-gate"],
      target: agentTarget(input, triagePrompt, "triage", input.taskId, plan),
      timeoutMs: agentTimeoutMs(input),
    },
    lifecycleGateStep({
      stage: "triage",
      description: "Stop the lifecycle before planning when triage blocked or disallowed automation.",
      dependsOn: ["triage"],
      todosProjectPath,
      taskId: input.taskId,
      goMarker: gateMarker("triage", "go"),
      blockedMarker: gateMarker("triage", "blocked"),
      plan,
    }),
    {
      id: "planner",
      name: "Planner",
      description: "Create a concise implementation plan and split unsafe scope before work starts.",
      dependsOn: ["triage-gate"],
      target: agentTarget(input, plannerPrompt, "planner", input.taskId, plan),
      timeoutMs: agentTimeoutMs(input),
    },
    lifecycleGateStep({
      stage: "planner",
      description: "Stop the lifecycle before implementation when planning blocked or disallowed automation.",
      dependsOn: ["planner"],
      todosProjectPath,
      taskId: input.taskId,
      goMarker: gateMarker("planner", "go"),
      blockedMarker: gateMarker("planner", "blocked"),
      plan,
    }),
    {
      id: "worker",
      name: "Worker",
      description: "Implement the todos task according to triage and planner evidence.",
      dependsOn: ["planner-gate"],
      target: agentTarget(input, workerPrompt, "worker", input.taskId, plan),
      timeoutMs: agentTimeoutMs(input),
    },
  ];
  if (input.prHandoff) {
    steps.push(prHandoffStep(input, plan, todosProjectPath));
  }
  steps.push({
    id: "verifier",
    name: "Verifier",
    description: "Adversarially verify worker output and update todos.",
    dependsOn: [input.prHandoff ? "pr-handoff" : "worker"],
    target: agentTarget(input, verifierPrompt, "verifier", input.taskId, plan),
    timeoutMs: agentTimeoutMs(input),
  });
  steps.push(taskEvidenceCheckStep(todosProjectPath, input.taskId, plan, workerMarker, verifierMarker));

  return {
    name: `task-lifecycle-${input.taskId.slice(0, 8)}-triage-plan-worker-verifier`,
    description: `Full task lifecycle workflow for ${taskLabel(input)}`,
    version: 1,
    steps,
  };
}

export function renderRoutingRemediationWorkflow(input: RoutingRemediationWorkflowTemplateInput): CreateWorkflowInput {
  if (!input.projectPath?.trim()) throw new Error("projectPath is required");
  const todosProjectPath = input.todosProjectPath ?? input.routeProjectPath ?? input.projectPath;
  const status = input.status ?? "pending,in_progress";
  const scope = {
    doctorProject: input.doctorProject,
    tag: input.tag,
    status,
    shard: input.shard,
    limit: input.limit,
  };
  const idempotencyKey =
    input.idempotencyKey?.trim() ||
    [
      "routing-remediation",
      todosProjectPath,
      input.doctorJsonPath ?? "doctor-live",
      input.doctorProject ?? "all-projects",
      input.tag ?? "all-tags",
      status,
      input.shard ?? "all-shards",
      input.limit ?? "unlimited",
    ].join(":");
  const runId = `${slugSegment(idempotencyKey, "routing-remediation").slice(0, 48)}-${stableHex(idempotencyKey)}`;
  const maxRepairs = input.maxRepairs ?? 25;
  if (!Number.isInteger(maxRepairs) || maxRepairs < 0) throw new Error("maxRepairs must be a non-negative integer");
  const dryRun = input.dryRun ?? true;
  const plan = worktreePlan(input, idempotencyKey);
  const evidenceDir = input.evidenceDir ?? join(input.projectPath, ".openloops", "routing-remediation");
  const undoDir = input.undoDir ?? evidenceDir;
  const doctorOutputPath = join(evidenceDir, `routing-doctor-${runId}.json`);
  const preflightOutputPath = join(evidenceDir, `routing-remediation-preflight-${runId}.json`);
  const applyOutputPath = join(evidenceDir, `routing-remediation-apply-${runId}.json`);
  const recheckOutputPath = join(evidenceDir, `routing-remediation-recheck-${runId}.json`);
  const blockerReportPath = join(evidenceDir, `routing-remediation-blockers-${runId}.json`);
  const alertChannel = input.alertChannel?.trim() || ROUTING_REMEDIATION_ALERT_CHANNEL;
  const undoRecordPath = join(undoDir, `routing-remediation-${runId}.undo.json`);
  const applyCommand = routingRemediationDoctorCommand({
    todosProjectPath,
    apply: true,
    undoRecordPath,
    ...scope,
  });
  const recheckCommand = routingRemediationDoctorCommand({
    todosProjectPath,
    ...scope,
  });
  const preflightCommand = routingRemediationPreflightCommand({
    todosProjectPath,
    doctorJsonPath: input.doctorJsonPath,
    doctorOutputPath,
    preflightOutputPath,
    maxRepairs,
    dryRun,
    idempotencyKey,
    applyCommand,
    blockerReportPath,
    alertChannel,
    ...scope,
  });
  const context = {
    idempotencyKey,
    projectPath: input.projectPath,
    routeProjectPath: input.routeProjectPath,
    projectGroup: input.projectGroup,
    todosProjectPath,
    doctorJsonPath: input.doctorJsonPath,
    doctorProject: input.doctorProject,
    tag: input.tag,
    status,
    shard: input.shard,
    limit: input.limit,
    maxRepairs,
    dryRun,
    evidence: {
      doctorOutputPath,
      preflightOutputPath,
      applyOutputPath,
      recheckOutputPath,
      blockerReportPath,
      undoRecordPath,
    },
    alertChannel,
    worktree: worktreeContextFragment(plan),
  };
  const shared = [
    worktreePrompt(plan),
    "Routing remediation contract:",
    `- Todos project path: ${todosProjectPath}`,
    `- Idempotency key: ${idempotencyKey}`,
    `- Dry-run/preflight mode: ${dryRun ? "true" : "false"}`,
    `- Max safe_auto repairs for this run: ${maxRepairs}`,
    `- Source doctor JSON: ${input.doctorJsonPath ?? "generated by routing-doctor-preflight"}`,
    `- Normalized doctor JSON: ${doctorOutputPath}`,
    `- Preflight JSON: ${preflightOutputPath}`,
    `- Apply JSON target: ${applyOutputPath}`,
    `- Recheck JSON target: ${recheckOutputPath}`,
    `- Blocker findings report (evidence, NOT tasks): ${blockerReportPath}`,
    `- Blocker alert conversations channel: ${alertChannel}`,
    `- Undo record target: ${undoRecordPath}`,
    "Never edit the Todos SQLite database, raw DB files, or task JSON storage directly. Do not use sqlite3, ad hoc SQL, or filesystem mutations as a repair mechanism.",
    "Only supported Todos CLI/API commands may mutate tasks. Safe repairs are limited to doctor findings classified safe_auto whose suggested_repair.field is working_dir or task_list_id.",
    "Refuse blocker_human, blocker_cross_repo, blocker_invalid_path, unsupported, legal, and other human-judgement findings as mutations. Report them as evidence; never mutate them.",
    ROUTING_HEALTH_ALERTS_ARE_NOT_TASKS_FRAGMENT(alertChannel, blockerReportPath),
    NO_TMUX_DISPATCH_FRAGMENT,
    "",
    `Routing remediation context JSON: ${compactJson(context)}`,
  ].join("\n");
  const workerPrompt = [
    ...boundedStepHeaderFragment("Apply bounded routing-doctor remediation from preflight evidence.", "worker", "bounded"),
    shared,
    "Read the preflight JSON before making any mutation. If preflight apply_allowed is false, do not run the apply command.",
    dryRun
      ? "This workflow was rendered with dryRun=true. Do not run the apply command; produce only a dry-run summary and blocker-task preview/update evidence."
      : `If preflight permits apply, run the supported repair command and capture stdout JSON to ${applyOutputPath}: ${applyCommand}`,
    `After any apply run, recheck route state and capture stdout JSON to ${recheckOutputPath}: ${recheckCommand}`,
    "For every modified task, ensure a task comment records old value, new value, repair command, source doctor run, undo record, and route-state recheck result. If the Todos CLI already wrote a complete per-task repair comment, verify it; otherwise add the missing evidence with todos comment.",
    `Every blocker_human, blocker_cross_repo, blocker_invalid_path, unsupported, or legal finding is already recorded in the blocker report at ${blockerReportPath} by the preflight step. Verify it is complete; do not re-file any of it anywhere else.`,
    [
      "Aggregate alert command shape — exactly ONE post per run, never one per finding:",
      `conversations send ${alertChannel} "routing-health ${idempotencyKey}: <N> blocker findings (<category>=<count>, ...). Evidence: ${blockerReportPath}"`,
      "Skip the post entirely when the run produced zero blocker findings — silence is the correct output for a clean run.",
    ].join("\n"),
    "Do not change cross-repo task intent. A cross-repo finding can only be changed when the doctor itself classifies the exact field repair as safe_auto and the supported Todos repair command applies it.",
    "Record compact workflow evidence: changed tasks, blocker report path, apply/recheck artifact paths, undo record path, validation results, and residual risks.",
  ].join("\n");
  const verifierPrompt = [
    ...boundedStepHeaderFragment("Verify bounded routing-doctor remediation evidence.", "verifier", "bounded"),
    shared,
    adversarialReviewFragment("the preflight artifact, apply output, undo record, blocker report, per-task comments, and route-state recheck", TASK_REVIEW_FOCUS),
    verifierRuntimeGuidance(input),
    `Re-run or inspect the route-state recheck command as needed: ${recheckCommand}`,
    `Confirm safe_auto repairs were limited to working_dir and task_list_id, raw DB edits were not used, cross-repo/human/legal/unsupported findings landed in ${blockerReportPath} and at most one aggregate post on ${alertChannel}, and every changed task has old/new/command/source/recheck evidence.`,
    "Fail verification if this run created ANY todos task for a routing finding. Routine operational alerts are not tasks (owner directive 2026-07-30); one task per finding is the exact defect this workflow was changed to remove.",
    "If dry-run mode was rendered, verify that no apply/repair mutation occurred and that the output is clearly preflight-only.",
    "If invalid, record precise blocker evidence and create follow-up tasks rather than broad fixes.",
    VERIFIER_TINY_FIXES_FRAGMENT,
  ].join("\n");

  return {
    name: `routing-remediation-${runId}`,
    description: `Routing doctor remediation workflow; dryRun=${dryRun}; maxRepairs=${maxRepairs}; idempotency=${idempotencyKey}`,
    version: 1,
    steps: [
      commandStep({
        id: "routing-doctor-preflight",
        name: "Routing Doctor Preflight",
        description: "Run or consume routing doctor JSON, enforce safe-field and repair-capacity gates, and write bounded evidence.",
        command: preflightCommand,
        cwd: input.projectPath,
        timeoutMs: 5 * 60_000,
        idleTimeoutMs: 60_000,
        blockedExitCodes: GATE_BLOCKED_EXIT_CODES,
      }),
      ...workerVerifierSteps({
        input,
        seed: idempotencyKey,
        plan,
        workerPrompt,
        verifierPrompt,
        workerDescription: "Apply only supported Todos CLI safe_auto repairs and report blocker findings as evidence; never as tasks.",
        verifierDescription: "Adversarially verify routing remediation evidence and safety boundaries.",
        workerDependsOn: ["routing-doctor-preflight"],
      }),
    ],
  };
}

export function renderEventWorkerVerifierWorkflow(input: EventWorkflowTemplateInput): CreateWorkflowInput {
  if (!input.eventId?.trim()) throw new Error("eventId is required");
  if (!input.eventType?.trim()) throw new Error("eventType is required");
  if (!input.eventSource?.trim()) throw new Error("eventSource is required");
  if (!input.eventJson?.trim()) throw new Error("eventJson is required");
  if (!input.projectPath?.trim()) throw new Error("projectPath is required");
  const seed = `${input.eventSource}:${input.eventType}:${input.eventId}`;
  const plan = worktreePlan(input, seed);
  const eventContext = {
    eventId: input.eventId,
    eventType: input.eventType,
    eventSource: input.eventSource,
    eventSubject: input.eventSubject,
    eventMessage: input.eventMessage,
    projectPath: input.projectPath,
    routeProjectPath: input.routeProjectPath,
    projectGroup: input.projectGroup,
    routeAdmission: routeAdmissionContext(input),
    worktree: worktreeContextFragment(plan),
  };
  const eventContextLines = [
    `Event context JSON: ${compactJson(eventContext)}`,
    `Full event envelope JSON: ${input.eventJson}`,
  ];
  const workerPrompt = [
    ...goalHeaderFragment(
      `Handle Hasna event ${input.eventSource}/${input.eventType} (${input.eventId}) in ${input.projectPath}.`,
      "worker",
      "event",
    ),
    worktreePrompt(plan),
    "Investigate first before changing files. Read the full event envelope and decide the narrow action required by that event. Preserve unrelated user changes and update the relevant local CLI/task/knowledge system with evidence, changed files, commits, and blockers.",
    "If the event is informational or does not require action, record that finding and stop without making changes.",
    "",
    ...eventContextLines,
  ].join("\n");
  const verifierPrompt = [
    ...goalHeaderFragment(
      `Verify handling of Hasna event ${input.eventSource}/${input.eventType} (${input.eventId}).`,
      "verifier",
      "event",
    ),
    worktreePrompt(plan),
    adversarialReviewFragment(
      "the event, repository/project state, worker evidence, tests, and any created tasks or notes",
      EVENT_REVIEW_FOCUS,
    ),
    verifierRuntimeGuidance(input),
    EVENT_VERIFIER_DECISION_FRAGMENT,
    "",
    ...eventContextLines,
  ].join("\n");

  return {
    name: `event-${input.eventSource}-${input.eventType}-${input.eventId.slice(0, 8)}-worker-verifier`.replace(/[^a-zA-Z0-9._:-]+/g, "-"),
    description: `Event-triggered worker/verifier workflow for ${input.eventSource}/${input.eventType}`,
    version: 1,
    steps: workerVerifierSteps({
      input,
      seed,
      plan,
      workerPrompt,
      verifierPrompt,
      workerDescription: "Handle the Hasna event and record evidence.",
      verifierDescription: "Adversarially verify event handling.",
    }),
  };
}

export function renderBoundedAgentWorkerVerifierWorkflow(input: BoundedAgentWorkflowTemplateInput): CreateWorkflowInput {
  if (!input.objective?.trim()) throw new Error("objective is required");
  if (!input.projectPath?.trim()) throw new Error("projectPath is required");
  const seed = `${input.projectPath}:${input.objective}`;
  const plan = worktreePlan(input, seed);
  const workerPrompt = [
    ...goalHeaderFragment(input.objective, "worker", "bounded"),
    worktreePrompt(plan),
    "Investigate first. Keep scope narrow, use local project/task systems as the source of truth when relevant, preserve unrelated changes, run focused validation, and record concise evidence.",
    NO_TMUX_DISPATCH_FRAGMENT,
    input.prompt,
  ].filter(Boolean).join("\n");
  const verifierPrompt = [
    ...goalHeaderFragment(`Adversarially verify: ${input.objective}`, "verifier", "bounded"),
    worktreePrompt(plan),
    BOUNDED_VERIFIER_REVIEW_FRAGMENT,
    verifierRuntimeGuidance(input),
    BOUNDED_VERIFIER_DECISION_FRAGMENT,
  ].join("\n");

  return {
    name: input.name ?? `bounded-agent-${stableHex(seed)}-worker-verifier`,
    description: `Bounded worker/verifier workflow for ${input.objective.slice(0, 180)}`,
    version: 1,
    steps: workerVerifierSteps({
      input,
      seed,
      plan,
      workerPrompt,
      verifierPrompt,
      workerDescription: "Execute the bounded objective and record evidence.",
      verifierDescription: "Adversarially verify the bounded objective result.",
    }),
  };
}

// ---------------------------------------------------------------------------
// Builtin template variable mapping and dispatch
// ---------------------------------------------------------------------------

function listVar(value: string | undefined): string[] | undefined {
  const values = value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return values?.length ? values : undefined;
}

function booleanVar(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off", ""].includes(normalized)) return false;
  throw new Error(`expected boolean value, got ${value}`);
}

function accountVar(profile: string | undefined, tool: string | undefined): AccountRef | undefined {
  return profile ? { profile, tool } : undefined;
}

function accountPoolVar(value: string | undefined, tool?: string): AccountRef[] | undefined {
  return listVar(value)?.map((profile) => ({ profile, tool }));
}

function positiveTemplateInteger(raw: string | undefined, label: string): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function nonNegativeTemplateInteger(raw: string | undefined, label: string): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

/** Variable mapping shared by every agent-backed builtin template. */
function agentTemplateInput(values: Record<string, string | undefined>): AgentWorkflowTemplateBaseInput {
  return {
    projectPath: values.projectPath ?? values.cwd ?? process.cwd(),
    routeProjectPath: values.routeProjectPath,
    projectGroup: values.projectGroup,
    routeScope: values.routeScope,
    routeThrottleLimits: {
      maxActive: positiveTemplateInteger(values.maxActive, "maxActive"),
      maxActiveScope: values.maxActiveScope?.trim() || undefined,
      maxActivePerProject: positiveTemplateInteger(values.maxActivePerProject, "maxActivePerProject"),
      maxActivePerProjectGroup: positiveTemplateInteger(values.maxActivePerProjectGroup, "maxActivePerProjectGroup"),
      maxPerProfile: nonNegativeTemplateInteger(values.maxPerProfile, "maxPerProfile"),
    },
    provider: values.provider as AgentProvider | undefined,
    authProfile: values.authProfile,
    authProfilePool: listVar(values.authProfilePool),
    workerAuthProfile: values.workerAuthProfile,
    verifierAuthProfile: values.verifierAuthProfile,
    account: accountVar(values.account, values.accountTool),
    accountPool: accountPoolVar(values.accountPool, values.accountTool),
    model: values.model,
    variant: values.variant,
    agent: values.agent,
    addDirs: listVar(values.addDirs ?? values.addDir),
    allowTools: listVar(values.allowTools ?? values.allowTool),
    allowCommands: listVar(values.allowCommands ?? values.allowCommand),
    permissionMode: values.permissionMode as AgentPermissionMode | undefined,
    sandbox: values.sandbox as AgentSandbox | undefined,
    safetyReason: values.safetyReason,
    manualBreakGlass: booleanVar(values.manualBreakGlass),
    worktreeMode: values.worktreeMode as AgentWorktreeMode | undefined,
    worktreeRoot: values.worktreeRoot,
    worktreeBranchPrefix: values.worktreeBranchPrefix,
    timeoutMs: parseTemplateTimeoutMs(values.timeoutMs),
    verifierIdleTimeoutMs: parseTemplateIdleTimeoutMs(values.verifierIdleTimeoutMs ?? values.verifierIdleTimeout),
  };
}

interface BoundedLifecycleDefinition {
  name: string;
  objective: string;
  defaultPrompt: string;
}

/** Data-driven deltas for the bounded lifecycle templates on top of the worker/verifier renderer. */
const BOUNDED_LIFECYCLE_TEMPLATES: Record<
  string,
  (values: Record<string, string | undefined>, projectPath: string) => BoundedLifecycleDefinition
> = {
  [PR_REVIEW_TEMPLATE_ID]: (values) => {
    const pr = values.prUrl ?? values.prNumber ?? "";
    if (!pr.trim()) throw new Error("prUrl or prNumber is required");
    return {
      name: `pr-review-${slugSegment(pr)}-worker-verifier`,
      objective: values.objective ?? `Review and drive PR ${pr} toward merge-ready state.`,
      defaultPrompt:
        "Inspect PR state, checks, conflicts, branch freshness, review requirements, and repo policy. Apply only owned logical fixes in the isolated worktree, validate, update the PR/task with evidence, and do not merge unless policy/checks make it clearly safe.",
    };
  },
  [SCHEDULED_AUDIT_TEMPLATE_ID]: (values, projectPath) => {
    const objective = values.objective ?? "";
    if (!objective.trim()) throw new Error("objective is required");
    return {
      name: `scheduled-audit-${stableHex(`${projectPath}:${objective}`)}-worker-verifier`,
      objective,
      defaultPrompt:
        "Run the bounded audit, write compact evidence, create deduped todos tasks for actionable issues, and avoid implementation unless the task explicitly allows it.",
    };
  },
  [KNOWLEDGE_REFRESH_TEMPLATE_ID]: (values) => {
    const scope = values.scope ?? values.label ?? "recent knowledge";
    return {
      name: `knowledge-refresh-${slugSegment(scope)}-worker-verifier`,
      objective: values.objective ?? `Refresh and verify ${scope}.`,
      defaultPrompt:
        "Inspect recent knowledge records, improve structure/schema where appropriate, avoid duplicates, create tasks for code changes instead of doing unrelated implementation, and record verification evidence.",
    };
  },
  [REPORT_ONLY_TEMPLATE_ID]: (values, projectPath) => {
    const objective = values.objective ?? "";
    if (!objective.trim()) throw new Error("objective is required");
    return {
      name: `report-only-${stableHex(`${projectPath}:${objective}`)}-worker-verifier`,
      objective,
      defaultPrompt:
        "Produce a report only. Do not mutate repositories, tasks, secrets, databases, or external systems except for writing the requested report/evidence artifact.",
    };
  },
  [INCIDENT_RESPONSE_TEMPLATE_ID]: (values) => {
    const objective = values.objective ?? "";
    if (!objective.trim()) throw new Error("objective is required");
    return {
      name: `incident-response-${slugSegment(values.incidentId ?? values.taskId ?? "incident")}-worker-verifier`,
      objective,
      defaultPrompt:
        "Triage first, gather bounded evidence, mitigate only narrow allowed issues, preserve data/history/secrets, create follow-up tasks for larger fixes, and require verifier confirmation before closure.",
    };
  },
};

function renderLifecycleBoundedTemplate(id: string, values: Record<string, string | undefined>): CreateWorkflowInput | undefined {
  const base = agentTemplateInput(values);
  if (id === TASK_LIFECYCLE_TEMPLATE_ID) {
    const taskId = values.taskId ?? "";
    if (!taskId.trim()) throw new Error("taskId is required");
    return renderTaskLifecycleWorkflow({
      ...base,
      taskId,
      taskTitle: values.taskTitle,
      taskDescription: values.taskDescription,
      todosProjectPath: values.todosProjectPath ?? values.todosProject,
      triageAuthProfile: values.triageAuthProfile,
      plannerAuthProfile: values.plannerAuthProfile,
      triageAccount: accountVar(values.triageAccount, values.accountTool),
      plannerAccount: accountVar(values.plannerAccount, values.accountTool),
      workerAccount: accountVar(values.workerAccount, values.accountTool),
      verifierAccount: accountVar(values.verifierAccount, values.accountTool),
      prHandoff: booleanVar(values.prHandoff),
      worktreeMode: base.worktreeMode ?? "required",
      eventId: values.eventId,
      eventType: values.eventType,
    });
  }
  const bounded = BOUNDED_LIFECYCLE_TEMPLATES[id];
  if (!bounded) return undefined;
  const definition = bounded(values, base.projectPath);
  return renderBoundedAgentWorkerVerifierWorkflow({
    ...base,
    sandbox: base.sandbox ?? (id === REPORT_ONLY_TEMPLATE_ID ? "read-only" : undefined),
    worktreeMode: base.worktreeMode ?? (id === REPORT_ONLY_TEMPLATE_ID ? "main" : "required"),
    name: values.name ?? definition.name,
    objective: definition.objective,
    prompt: values.prompt ?? definition.defaultPrompt,
  });
}

function renderDeterministicCheckCreateTaskWorkflow(values: Record<string, string | undefined>): CreateWorkflowInput {
  const projectPath = values.projectPath ?? values.cwd ?? process.cwd();
  const checkCommand = values.checkCommand ?? "";
  if (!checkCommand.trim()) throw new Error("checkCommand is required");
  const seed = `${projectPath}:${checkCommand}`;
  const timeoutMs = parseDeterministicTimeoutMs(values.timeoutMs, 5 * 60_000);
  const idleTimeoutMs = parseDeterministicTimeoutMs(values.idleTimeoutMs, 60_000, "idleTimeoutMs");
  return {
    name: values.name ?? `deterministic-check-${stableHex(seed)}`,
    description:
      values.description ??
      "Deterministic check that writes compact evidence and upserts one deduped todos task when the expectation is not met.",
    version: 1,
    steps: [
      commandStep({
        id: "check",
        name: "Check",
        description: "Run the deterministic check/task-upsert command.",
        command: checkCommand,
        cwd: projectPath,
        timeoutMs,
        idleTimeoutMs,
      }),
    ],
  };
}

function renderRoutingRemediationTemplate(values: Record<string, string | undefined>): CreateWorkflowInput {
  const base = agentTemplateInput(values);
  return renderRoutingRemediationWorkflow({
    ...base,
    todosProjectPath: values.todosProjectPath ?? values.todosProject,
    doctorJsonPath: values.doctorJsonPath,
    doctorProject: values.doctorProject,
    tag: values.tag,
    status: values.status,
    shard: values.shard,
    limit: values.limit,
    maxRepairs: parseNonNegativeIntegerVar(values.maxRepairs, 25, "maxRepairs"),
    dryRun: booleanVar(values.dryRun) ?? true,
    idempotencyKey: values.idempotencyKey,
    evidenceDir: values.evidenceDir,
    undoDir: values.undoDir,
    alertChannel: values.alertChannel,
    worktreeMode: base.worktreeMode ?? "required",
  });
}

function renderBuiltinLoopTemplate(id: string, values: Record<string, string | undefined>): CreateWorkflowInput {
  if (id === DETERMINISTIC_CHECK_CREATE_TASK_TEMPLATE_ID) {
    return renderDeterministicCheckCreateTaskWorkflow(values);
  }
  if (id === ROUTING_REMEDIATION_TEMPLATE_ID) {
    return renderRoutingRemediationTemplate(values);
  }
  const lifecycle = renderLifecycleBoundedTemplate(id, values);
  if (lifecycle) return lifecycle;
  if (id === TODOS_TASK_WORKER_VERIFIER_TEMPLATE_ID) {
    return renderTodosTaskWorkerVerifierWorkflow({
      ...agentTemplateInput(values),
      taskId: values.taskId ?? "",
      taskTitle: values.taskTitle,
      taskDescription: values.taskDescription,
      todosProjectPath: values.todosProjectPath ?? values.todosProject,
      eventId: values.eventId,
      eventType: values.eventType,
    });
  }
  if (id === EVENT_WORKER_VERIFIER_TEMPLATE_ID) {
    return renderEventWorkerVerifierWorkflow({
      ...agentTemplateInput(values),
      eventId: values.eventId ?? "",
      eventType: values.eventType ?? "",
      eventSource: values.eventSource ?? "",
      eventSubject: values.eventSubject,
      eventMessage: values.eventMessage,
      eventJson: values.eventJson ?? "",
    });
  }
  if (id === BOUNDED_AGENT_WORKER_VERIFIER_TEMPLATE_ID) {
    return renderBoundedAgentWorkerVerifierWorkflow({
      ...agentTemplateInput(values),
      name: values.name,
      objective: values.objective ?? "",
      prompt: values.prompt,
    });
  }
  throw new Error(`unknown template: ${id}`);
}

export function renderLoopTemplate(
  id: string,
  values: Record<string, string | undefined>,
  opts: ListLoopTemplatesOptions = {},
): CreateWorkflowInput {
  const source = opts.source ?? "all";
  if (source !== "custom") {
    const builtin = getBuiltinLoopTemplate(id);
    if (builtin) return renderBuiltinLoopTemplate(builtin.id, values);
    if (source === "builtin") throw new Error(`unknown built-in template: ${id}`);
  }
  const custom = getCustomLoopTemplate(id, builtinTemplateKeys());
  if (custom) return renderCustomLoopTemplate(custom, values);
  throw new Error(`unknown template: ${id}`);
}
