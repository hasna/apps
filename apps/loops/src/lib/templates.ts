import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
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
  LoopTemplateVariable,
  LoopTemplateVariableType,
  WorkflowStep,
} from "../types.js";
import { dataDir } from "./paths.js";
import { workflowBodyFromJson } from "./workflow-spec.js";

export const TODOS_TASK_WORKER_VERIFIER_TEMPLATE_ID = "todos-task-worker-verifier";
export const EVENT_WORKER_VERIFIER_TEMPLATE_ID = "event-worker-verifier";
export const BOUNDED_AGENT_WORKER_VERIFIER_TEMPLATE_ID = "bounded-agent-worker-verifier";
export const TASK_LIFECYCLE_TEMPLATE_ID = "task-lifecycle";
export const PR_REVIEW_TEMPLATE_ID = "pr-review";
export const SCHEDULED_AUDIT_TEMPLATE_ID = "scheduled-audit";
export const KNOWLEDGE_REFRESH_TEMPLATE_ID = "knowledge-refresh";
export const REPORT_ONLY_TEMPLATE_ID = "report-only";
export const INCIDENT_RESPONSE_TEMPLATE_ID = "incident-response";
export const DETERMINISTIC_CHECK_CREATE_TASK_TEMPLATE_ID = "deterministic-check-create-task";

export interface TodosTaskWorkflowTemplateInput {
  taskId: string;
  taskTitle?: string;
  taskDescription?: string;
  projectPath: string;
  todosProjectPath?: string;
  routeProjectPath?: string;
  projectGroup?: string;
  provider?: AgentProvider;
  authProfile?: string;
  authProfilePool?: string[];
  workerAuthProfile?: string;
  verifierAuthProfile?: string;
  account?: AccountRef;
  accountPool?: AccountRef[];
  workerAccount?: AccountRef;
  verifierAccount?: AccountRef;
  model?: string;
  variant?: string;
  agent?: string;
  addDirs?: string[];
  permissionMode?: AgentPermissionMode;
  sandbox?: AgentSandbox;
  manualBreakGlass?: boolean;
  worktreeMode?: AgentWorktreeMode;
  worktreeRoot?: string;
  worktreeBranchPrefix?: string;
  eventId?: string;
  eventType?: string;
}

export interface EventWorkflowTemplateInput {
  eventId: string;
  eventType: string;
  eventSource: string;
  eventSubject?: string;
  eventMessage?: string;
  eventJson: string;
  projectPath: string;
  routeProjectPath?: string;
  projectGroup?: string;
  provider?: AgentProvider;
  authProfile?: string;
  authProfilePool?: string[];
  workerAuthProfile?: string;
  verifierAuthProfile?: string;
  account?: AccountRef;
  accountPool?: AccountRef[];
  workerAccount?: AccountRef;
  verifierAccount?: AccountRef;
  model?: string;
  variant?: string;
  agent?: string;
  addDirs?: string[];
  permissionMode?: AgentPermissionMode;
  sandbox?: AgentSandbox;
  manualBreakGlass?: boolean;
  worktreeMode?: AgentWorktreeMode;
  worktreeRoot?: string;
  worktreeBranchPrefix?: string;
}

export interface BoundedAgentWorkflowTemplateInput {
  name?: string;
  objective: string;
  prompt?: string;
  projectPath: string;
  routeProjectPath?: string;
  projectGroup?: string;
  provider?: AgentProvider;
  authProfile?: string;
  authProfilePool?: string[];
  workerAuthProfile?: string;
  verifierAuthProfile?: string;
  account?: AccountRef;
  accountPool?: AccountRef[];
  workerAccount?: AccountRef;
  verifierAccount?: AccountRef;
  model?: string;
  variant?: string;
  agent?: string;
  addDirs?: string[];
  permissionMode?: AgentPermissionMode;
  sandbox?: AgentSandbox;
  manualBreakGlass?: boolean;
  worktreeMode?: AgentWorktreeMode;
  worktreeRoot?: string;
  worktreeBranchPrefix?: string;
  timeoutMs?: number;
}

const TEMPLATE_SUMMARIES: LoopTemplateSummary[] = [
  {
    id: TODOS_TASK_WORKER_VERIFIER_TEMPLATE_ID,
    name: "Todos Task Worker + Verifier",
    description:
      "Create a one-shot workflow for a todos task: one agent performs the task, then a fresh verifier agent audits the result and records follow-up tasks or completion evidence.",
    kind: "workflow",
    variables: [
      { name: "taskId", required: true, description: "Todos task id to execute." },
      { name: "taskTitle", description: "Human-readable task title." },
      { name: "projectPath", required: true, description: "Repository or project working directory." },
      { name: "todosProjectPath", description: "Todos storage project path used in worker/verifier commands." },
      { name: "routeProjectPath", description: "Canonical project path used for scheduler concurrency limits." },
      { name: "projectGroup", description: "Optional project group used for scheduler concurrency limits." },
      { name: "provider", default: "codewith", description: "Agent provider: codewith, claude, cursor, opencode, aicopilot, or codex." },
      { name: "authProfile", description: "Provider-native auth profile, currently Codewith." },
      { name: "authProfilePool", description: "Comma-separated provider-native auth profiles; worker/verifier are selected deterministically." },
      { name: "workerAuthProfile", description: "Provider-native auth profile for the worker step." },
      { name: "verifierAuthProfile", description: "Provider-native auth profile for the verifier step." },
      { name: "accountPool", description: "Comma-separated OpenAccounts profiles; worker/verifier are selected deterministically." },
      { name: "model", description: "Provider model." },
      { name: "variant", description: "Provider reasoning/model effort variant." },
      { name: "addDirs", description: "Comma-separated additional writable directories for provider sandboxes." },
      { name: "permissionMode", default: "bypass", description: "Provider permission mode: default, plan, auto, or bypass." },
      { name: "sandbox", default: "workspace-write", description: "Provider sandbox mode." },
      { name: "manualBreakGlass", default: "false", description: "Allow explicit danger-full-access in a generated workflow. Intended for manual emergency use only." },
      { name: "worktreeMode", default: "auto", description: "Worktree isolation mode: auto, required, off, or main." },
      { name: "worktreeRoot", default: "~/.hasna/loops/worktrees", description: "Base directory for OpenLoops-managed git worktrees." },
      { name: "worktreeBranchPrefix", default: "openloops", description: "Branch prefix for generated task/event worktree branches." },
    ],
  },
  {
    id: EVENT_WORKER_VERIFIER_TEMPLATE_ID,
    name: "Hasna Event Worker + Verifier",
    description:
      "Create a one-shot workflow for a generic Hasna event: one agent handles the event, then a fresh verifier agent audits the result and records evidence or follow-up tasks.",
    kind: "workflow",
    variables: [
      { name: "eventId", required: true, description: "Hasna event id." },
      { name: "eventType", required: true, description: "Hasna event type." },
      { name: "eventSource", required: true, description: "Hasna event source." },
      { name: "eventJson", required: true, description: "Full event envelope JSON." },
      { name: "projectPath", required: true, description: "Repository or project working directory." },
      { name: "routeProjectPath", description: "Canonical project path used for scheduler concurrency limits." },
      { name: "projectGroup", description: "Optional project group used for scheduler concurrency limits." },
      { name: "provider", default: "codewith", description: "Agent provider: codewith, claude, cursor, opencode, aicopilot, or codex." },
      { name: "authProfile", description: "Provider-native auth profile, currently Codewith." },
      { name: "authProfilePool", description: "Comma-separated provider-native auth profiles; worker/verifier are selected deterministically." },
      { name: "workerAuthProfile", description: "Provider-native auth profile for the worker step." },
      { name: "verifierAuthProfile", description: "Provider-native auth profile for the verifier step." },
      { name: "accountPool", description: "Comma-separated OpenAccounts profiles; worker/verifier are selected deterministically." },
      { name: "model", description: "Provider model." },
      { name: "variant", description: "Provider reasoning/model effort variant." },
      { name: "addDirs", description: "Comma-separated additional writable directories for provider sandboxes." },
      { name: "permissionMode", default: "bypass", description: "Provider permission mode: default, plan, auto, or bypass." },
      { name: "sandbox", default: "workspace-write", description: "Provider sandbox mode." },
      { name: "manualBreakGlass", default: "false", description: "Allow explicit danger-full-access in a generated workflow. Intended for manual emergency use only." },
      { name: "worktreeMode", default: "auto", description: "Worktree isolation mode: auto, required, off, or main." },
      { name: "worktreeRoot", default: "~/.hasna/loops/worktrees", description: "Base directory for OpenLoops-managed git worktrees." },
      { name: "worktreeBranchPrefix", default: "openloops", description: "Branch prefix for generated event worktree branches." },
    ],
  },
  {
    id: BOUNDED_AGENT_WORKER_VERIFIER_TEMPLATE_ID,
    name: "Bounded Agent Worker + Verifier",
    description:
      "Create a bounded recurring-agent workflow: one agent performs a narrow objective, then a fresh verifier audits the result with separate account/profile selection.",
    kind: "workflow",
    variables: [
      { name: "objective", required: true, description: "Narrow goal-mode objective for the worker." },
      { name: "prompt", description: "Optional extra worker prompt details." },
      { name: "projectPath", required: true, description: "Repository or project working directory." },
      { name: "routeProjectPath", description: "Canonical project path used for scheduler concurrency limits." },
      { name: "projectGroup", description: "Optional project group used for scheduler concurrency limits." },
      { name: "provider", default: "codewith", description: "Agent provider: codewith, claude, cursor, opencode, aicopilot, or codex." },
      { name: "authProfile", description: "Provider-native auth profile, currently Codewith." },
      { name: "authProfilePool", description: "Comma-separated provider-native auth profiles; worker/verifier are selected deterministically." },
      { name: "workerAuthProfile", description: "Provider-native auth profile for the worker step." },
      { name: "verifierAuthProfile", description: "Provider-native auth profile for the verifier step." },
      { name: "accountPool", description: "Comma-separated OpenAccounts profiles; worker/verifier are selected deterministically." },
      { name: "model", description: "Provider model." },
      { name: "variant", description: "Provider reasoning/model effort variant." },
      { name: "permissionMode", default: "bypass", description: "Provider permission mode: default, plan, auto, or bypass." },
      { name: "sandbox", default: "workspace-write", description: "Provider sandbox mode." },
      { name: "manualBreakGlass", default: "false", description: "Allow explicit danger-full-access in a generated workflow. Intended for manual emergency use only." },
      { name: "worktreeMode", default: "auto", description: "Worktree isolation mode: auto, required, off, or main." },
      { name: "worktreeRoot", default: "~/.hasna/loops/worktrees", description: "Base directory for OpenLoops-managed git worktrees." },
      { name: "worktreeBranchPrefix", default: "openloops", description: "Branch prefix for generated bounded-agent worktree branches." },
      { name: "timeoutMs", default: "2700000", description: "Step timeout in milliseconds." },
    ],
  },
  {
    id: TASK_LIFECYCLE_TEMPLATE_ID,
    name: "Task Lifecycle",
    description:
      "Run the standard task-created lifecycle: triage/dedupe, plan, worker execution, independent verification, and todos closure/follow-up evidence.",
    kind: "workflow",
    variables: [
      { name: "taskId", required: true, description: "Todos task id." },
      { name: "projectPath", required: true, description: "Repository or project working directory." },
      { name: "authProfilePool", description: "Comma-separated Codewith profiles for worker/verifier rotation." },
      { name: "accountPool", description: "Comma-separated OpenAccounts profiles for non-Codewith providers." },
      { name: "provider", default: "codewith", description: "Agent provider." },
      { name: "sandbox", default: "workspace-write", description: "Provider sandbox mode." },
      { name: "worktreeMode", default: "required", description: "Worktree isolation mode." },
    ],
  },
  {
    id: PR_REVIEW_TEMPLATE_ID,
    name: "PR Review",
    description:
      "Review and drive a pull request toward merge-ready state with a worker and fresh adversarial verifier.",
    kind: "workflow",
    variables: [
      { name: "prUrl", description: "Pull request URL." },
      { name: "prNumber", description: "Pull request number." },
      { name: "projectPath", required: true, description: "Repository working directory." },
      { name: "authProfilePool", description: "Comma-separated Codewith profiles for worker/verifier rotation." },
      { name: "provider", default: "codewith", description: "Agent provider." },
      { name: "sandbox", default: "workspace-write", description: "Provider sandbox mode." },
      { name: "worktreeMode", default: "required", description: "Worktree isolation mode." },
    ],
  },
  {
    id: SCHEDULED_AUDIT_TEMPLATE_ID,
    name: "Scheduled Audit",
    description:
      "Run a bounded scheduled audit, record evidence, create follow-up tasks for actionable findings, then verify the audit result.",
    kind: "workflow",
    variables: [
      { name: "objective", required: true, description: "Audit objective." },
      { name: "projectPath", required: true, description: "Repository or project working directory." },
      { name: "authProfilePool", description: "Comma-separated Codewith profiles for worker/verifier rotation." },
      { name: "provider", default: "codewith", description: "Agent provider." },
      { name: "sandbox", default: "workspace-write", description: "Provider sandbox mode." },
      { name: "worktreeMode", default: "required", description: "Worktree isolation mode." },
    ],
  },
  {
    id: KNOWLEDGE_REFRESH_TEMPLATE_ID,
    name: "Knowledge Refresh",
    description:
      "Review recent knowledge, improve structure/schema where needed, create deduped tasks for code changes, and verify the knowledge update.",
    kind: "workflow",
    variables: [
      { name: "scope", description: "Knowledge scope or label to refresh." },
      { name: "projectPath", required: true, description: "Repository or project working directory." },
      { name: "authProfilePool", description: "Comma-separated Codewith profiles for worker/verifier rotation." },
      { name: "provider", default: "codewith", description: "Agent provider." },
      { name: "sandbox", default: "workspace-write", description: "Provider sandbox mode." },
      { name: "worktreeMode", default: "required", description: "Worktree isolation mode." },
    ],
  },
  {
    id: REPORT_ONLY_TEMPLATE_ID,
    name: "Report Only",
    description:
      "Produce a bounded report without mutating repositories; verifier checks evidence, scope, and absence of unauthorized changes.",
    kind: "workflow",
    variables: [
      { name: "objective", required: true, description: "Report objective." },
      { name: "projectPath", required: true, description: "Repository or project working directory." },
      { name: "authProfilePool", description: "Comma-separated Codewith profiles for worker/verifier rotation." },
      { name: "provider", default: "codewith", description: "Agent provider." },
      { name: "sandbox", default: "read-only", description: "Provider sandbox mode." },
      { name: "worktreeMode", default: "main", description: "Report-only workflows normally inspect the main checkout read-only." },
    ],
  },
  {
    id: INCIDENT_RESPONSE_TEMPLATE_ID,
    name: "Incident Response",
    description:
      "Triage an incident, gather bounded evidence, apply only allowed narrow mitigation, create follow-up tasks, and verify the response.",
    kind: "workflow",
    variables: [
      { name: "incidentId", description: "Incident or task id." },
      { name: "objective", required: true, description: "Incident response objective." },
      { name: "projectPath", required: true, description: "Repository or project working directory." },
      { name: "authProfilePool", description: "Comma-separated Codewith profiles for worker/verifier rotation." },
      { name: "provider", default: "codewith", description: "Agent provider." },
      { name: "sandbox", default: "workspace-write", description: "Provider sandbox mode." },
      { name: "worktreeMode", default: "required", description: "Worktree isolation mode." },
    ],
  },
  {
    id: DETERMINISTIC_CHECK_CREATE_TASK_TEMPLATE_ID,
    name: "Deterministic Check Create Task",
    description:
      "Run a deterministic check command that writes compact evidence and upserts one deduped todos task when its expectation is not met.",
    kind: "workflow",
    variables: [
      { name: "checkCommand", required: true, description: "Shell command that performs the check and task upsert." },
      { name: "projectPath", required: true, description: "Repository or project working directory." },
      { name: "name", description: "Workflow name." },
      { name: "timeoutMs", default: "300000", description: "Check timeout in milliseconds." },
    ],
  },
];

export type LoopTemplateSourceFilter = LoopTemplateSource | "all";

export interface ListLoopTemplatesOptions {
  source?: LoopTemplateSourceFilter;
}

export interface CustomLoopTemplateImportOptions {
  replace?: boolean;
}

export interface CustomLoopTemplateImportResult {
  template: LoopTemplateSummary;
  path: string;
  replaced: boolean;
}

interface CustomLoopTemplateDefinition {
  id: string;
  name: string;
  description: string;
  kind: "workflow";
  variables: LoopTemplateVariable[];
  workflow: unknown;
}

interface CustomLoopTemplateEntry {
  definition: CustomLoopTemplateDefinition;
  summary: LoopTemplateSummary;
  path: string;
}

const CUSTOM_TEMPLATE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const CUSTOM_TEMPLATE_VARIABLE_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const CUSTOM_TEMPLATE_VARIABLE_TYPES = new Set<LoopTemplateVariableType>(["string", "number", "boolean", "json", "string[]"]);
const CUSTOM_TEMPLATE_PLACEHOLDER = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
const CUSTOM_TEMPLATE_EXACT_PLACEHOLDER = /^\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}$/;
const CUSTOM_TEMPLATE_DANGEROUS_ARG_PATTERNS = [
  "danger-full-access",
  "dangerously-bypass",
  "dangerously-skip",
];

function compactJson(value: unknown): string {
  return JSON.stringify(value);
}

function taskLabel(input: TodosTaskWorkflowTemplateInput): string {
  const head = input.taskTitle?.trim() || input.taskId;
  return head.length > 160 ? `${head.slice(0, 157)}...` : head;
}

type AgentWorkflowTemplateInput = Pick<
  TodosTaskWorkflowTemplateInput,
  | "projectPath"
  | "routeProjectPath"
  | "projectGroup"
  | "provider"
  | "authProfile"
  | "authProfilePool"
  | "workerAuthProfile"
  | "verifierAuthProfile"
  | "account"
  | "accountPool"
  | "workerAccount"
  | "verifierAccount"
  | "model"
  | "variant"
  | "agent"
  | "addDirs"
  | "permissionMode"
  | "sandbox"
  | "manualBreakGlass"
  | "worktreeMode"
  | "worktreeRoot"
  | "worktreeBranchPrefix"
>;

type AgentWorkflowRole = "worker" | "verifier";

interface WorktreePlan extends AgentWorktreeSpec {
  prepareStep?: WorkflowStep;
}

function stableIndex(seed: string, size: number): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % size;
}

function rolePoolValue<T>(pool: T[] | undefined, seed: string, role: AgentWorkflowRole): T | undefined {
  if (!pool?.length) return undefined;
  const workerIndex = stableIndex(seed, pool.length);
  if (role === "worker" || pool.length === 1) return pool[workerIndex];
  return pool[(workerIndex + 1) % pool.length];
}

function authProfileForRole(input: AgentWorkflowTemplateInput, role: AgentWorkflowRole, seed: string): string | undefined {
  if (role === "worker" && input.workerAuthProfile) return input.workerAuthProfile;
  if (role === "verifier" && input.verifierAuthProfile) return input.verifierAuthProfile;
  return rolePoolValue(input.authProfilePool, seed, role) ?? input.authProfile;
}

function accountForRole(input: AgentWorkflowTemplateInput, role: AgentWorkflowRole, seed: string): AccountRef | undefined {
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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
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
  return join(homedir(), ".hasna", "loops", "worktrees");
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

function prepareWorktreeCommand(plan: Required<Pick<WorktreePlan, "repoRoot" | "path" | "branch">>): string {
  const repo = shellQuote(plan.repoRoot);
  const path = shellQuote(plan.path);
  const branch = shellQuote(plan.branch);
  return [
    "set -euo pipefail",
    `repo=${repo}`,
    `path=${path}`,
    `branch=${branch}`,
    'resolve_path() { cd "$1" && pwd -P; }',
    'git_common_dir() {',
    '  local base="$1"',
    '  local common',
    '  common="$(git -C "$base" rev-parse --git-common-dir)"',
    '  case "$common" in',
    '    /*) printf "%s\\n" "$common" ;;',
    '    *) (cd "$base" && cd "$common" && pwd -P) ;;',
    '  esac',
    '}',
    'mkdir -p "$(dirname "$path")"',
    'if [ -e "$path" ]; then',
    '  if [ -L "$path" ]; then',
    '    printf "refusing symlinked worktree path %s\\n" "$path" >&2',
    '    exit 1',
    '  fi',
    '  if git -C "$path" rev-parse --is-inside-work-tree >/dev/null 2>&1; then',
    '    expected_common="$(git_common_dir "$repo")"',
    '    actual_common="$(git_common_dir "$path")"',
    '    if [ "$actual_common" != "$expected_common" ]; then',
    '      printf "existing worktree %s belongs to different git common dir\\n" "$path" >&2',
    '      printf "expected %s got %s\\n" "$expected_common" "$actual_common" >&2',
    '      exit 1',
    '    fi',
    '    actual_top="$(git -C "$path" rev-parse --show-toplevel)"',
    '    actual_top="$(resolve_path "$actual_top")"',
    '    expected_top="$(resolve_path "$path")"',
    '    if [ "$actual_top" != "$expected_top" ]; then',
    '      printf "existing worktree top-level mismatch for %s: %s\\n" "$path" "$actual_top" >&2',
    '      exit 1',
    '    fi',
    '    actual_branch="$(git -C "$path" branch --show-current)"',
    '    if [ "$actual_branch" != "$branch" ]; then',
    '      printf "existing worktree %s is on branch %s, expected %s\\n" "$path" "$actual_branch" "$branch" >&2',
    '      exit 1',
    '    fi',
    '    printf "existing worktree %s branch %s\\n" "$path" "$branch"',
    "    exit 0",
    "  fi",
    '  printf "refusing to overwrite non-git path: %s\\n" "$path" >&2',
    "  exit 1",
    "fi",
    'git -C "$repo" rev-parse --is-inside-work-tree >/dev/null',
    'if git -C "$repo" show-ref --verify --quiet "refs/heads/$branch"; then',
    '  git -C "$repo" worktree add "$path" "$branch"',
    "else",
    '  git -C "$repo" worktree add -b "$branch" "$path" HEAD',
    "fi",
    'printf "prepared worktree %s branch %s\\n" "$path" "$branch"',
  ].join("\n");
}

function worktreePlan(input: AgentWorkflowTemplateInput, seed: string): WorktreePlan {
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
  const prepareStep: WorkflowStep = {
    id: "prepare-worktree",
    name: "Prepare Worktree",
    description: "Create or reuse the isolated OpenLoops git worktree for this workflow run.",
    target: {
      type: "command",
      command: "bash",
      args: ["-lc", prepareWorktreeCommand({ repoRoot, path: worktreePath, branch })],
      cwd: repoRoot,
      timeoutMs: 5 * 60_000,
    },
    timeoutMs: 5 * 60_000,
  };
  return {
    mode,
    enabled: true,
    originalCwd,
    cwd,
    repoRoot,
    root,
    path: worktreePath,
    branch,
    prepareStep,
  };
}

function worktreePrompt(plan: WorktreePlan): string {
  if (plan.enabled) {
    return [
      "OpenLoops worktree policy:",
      "- Use the isolated git worktree as the only writeable repository checkout for this task/event.",
      `- Worktree cwd: ${plan.cwd}`,
      `- Worktree root: ${plan.path}`,
      `- Branch: ${plan.branch}`,
      `- Original checkout: ${plan.originalCwd}`,
      "- Do not mutate the original checkout/main branch except for read-only inspection.",
      "- Preserve unrelated changes in both the original checkout and this worktree.",
    ].join("\n");
  }
  return [
    "OpenLoops worktree policy:",
    `- Worktree mode ${plan.mode} did not select an isolated worktree: ${plan.reason ?? "not enabled"}.`,
    `- Cwd: ${plan.cwd}`,
    "- Do not create ad hoc worktrees unless the task itself explicitly requires one.",
  ].join("\n");
}

function assertNativeAuthProfileSupport(input: AgentWorkflowTemplateInput, provider: AgentProvider): void {
  if (provider === "codewith") return;
  const hasNativeAuthProfiles = Boolean(
    input.authProfile ||
      input.authProfilePool?.length ||
      input.workerAuthProfile ||
      input.verifierAuthProfile,
  );
  if (!hasNativeAuthProfiles) return;
  throw new Error(
    `authProfile, authProfilePool, workerAuthProfile, and verifierAuthProfile are supported only for provider codewith; use account/accountPool for ${provider} profile isolation`,
  );
}

function failClosedSandbox(input: AgentWorkflowTemplateInput, provider: AgentProvider, sandbox: AgentSandbox | undefined): void {
  if (!["codewith", "codex"].includes(provider)) return;
  if (sandbox !== "danger-full-access") return;
  if (input.manualBreakGlass) return;
  throw new Error(
    "danger-full-access is manual break-glass only for generated worker/verifier workflows; use sandbox=workspace-write or set manualBreakGlass=true with explicit operator approval",
  );
}

function agentTarget(
  input: AgentWorkflowTemplateInput,
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
  return {
    type: "agent",
    provider,
    prompt,
    cwd: plan.cwd,
    model: input.model,
    variant: input.variant,
    agent: input.agent,
    addDirs: input.addDirs,
    authProfile: provider === "codewith" ? authProfileForRole(input, role, seed) : undefined,
    configIsolation: "safe",
    permissionMode: input.permissionMode ?? "bypass",
    sandbox,
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
    allowlist: input.manualBreakGlass ? { enforcement: "metadata_only", commands: ["manual-break-glass"] } : undefined,
    routing: {
      projectPath: input.routeProjectPath ?? input.projectPath,
      ...(input.projectGroup ? { projectGroup: input.projectGroup } : {}),
    },
    account: accountForRole(input, role, seed),
    timeoutMs: 45 * 60_000,
  };
}

function workflowStepsWithWorktree(plan: WorktreePlan, steps: WorkflowStep[]): WorkflowStep[] {
  if (!plan.prepareStep) return steps;
  return [
    plan.prepareStep,
    ...steps.map((step) => step.id === "worker"
      ? { ...step, dependsOn: [...new Set([...(step.dependsOn ?? []), plan.prepareStep!.id])] }
      : step),
  ];
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
}

function assertTemplateString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`);
  return value.trim();
}

function assertTemplateKind(value: unknown, label: string): "workflow" {
  const kind = assertTemplateString(value, label);
  if (kind !== "workflow") throw new Error(`${label} must be workflow; custom loop templates are not supported yet`);
  return kind;
}

function customLoopTemplatesDir(): string {
  return join(dataDir(), "templates");
}

function ensureCustomLoopTemplatesDir(): string {
  const dir = customLoopTemplatesDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function loopTemplatesDir(): string {
  return customLoopTemplatesDir();
}

function builtinLoopTemplates(): LoopTemplateSummary[] {
  return TEMPLATE_SUMMARIES.map((template) => ({ ...structuredClone(template), source: "builtin" }));
}

function getBuiltinLoopTemplate(id: string): LoopTemplateSummary | undefined {
  return builtinLoopTemplates().find((template) => template.id === id || template.name === id);
}

function builtinTemplateKeys(): Set<string> {
  const keys = new Set<string>();
  for (const template of TEMPLATE_SUMMARIES) {
    keys.add(template.id);
    keys.add(template.name);
  }
  return keys;
}

function validateCustomTemplateId(id: string, label: string): void {
  if (!CUSTOM_TEMPLATE_ID_PATTERN.test(id)) {
    throw new Error(`${label} must match ${CUSTOM_TEMPLATE_ID_PATTERN.source}`);
  }
}

function optionalTemplateBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`);
  return value;
}

function validateCustomTemplateVariables(value: unknown, label: string): LoopTemplateVariable[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const seen = new Set<string>();
  return value.map((entry, index) => {
    const entryLabel = `${label}[${index}]`;
    assertRecord(entry, entryLabel);
    const name = assertTemplateString(entry.name, `${entryLabel}.name`);
    if (!CUSTOM_TEMPLATE_VARIABLE_PATTERN.test(name)) {
      throw new Error(`${entryLabel}.name must match ${CUSTOM_TEMPLATE_VARIABLE_PATTERN.source}`);
    }
    if (seen.has(name)) throw new Error(`duplicate custom template variable: ${name}`);
    seen.add(name);
    const description = entry.description === undefined ? undefined : assertTemplateString(entry.description, `${entryLabel}.description`);
    const defaultValue = entry.default === undefined ? undefined : assertTemplateString(entry.default, `${entryLabel}.default`);
    const type = entry.type === undefined ? undefined : assertTemplateString(entry.type, `${entryLabel}.type`) as LoopTemplateVariableType;
    if (type && !CUSTOM_TEMPLATE_VARIABLE_TYPES.has(type)) {
      throw new Error(`${entryLabel}.type must be one of ${[...CUSTOM_TEMPLATE_VARIABLE_TYPES].join(", ")}`);
    }
    if (defaultValue && CUSTOM_TEMPLATE_DANGEROUS_ARG_PATTERNS.some((pattern) => defaultValue.includes(pattern))) {
      throw new Error(`${entryLabel}.default cannot contain dangerous sandbox or bypass flags in a custom template`);
    }
    return {
      name,
      description,
      required: optionalTemplateBoolean(entry.required, `${entryLabel}.required`),
      default: defaultValue,
      type,
    };
  });
}

function hasDangerousArg(value: string): boolean {
  return CUSTOM_TEMPLATE_DANGEROUS_ARG_PATTERNS.some((pattern) => value.includes(pattern));
}

function assertNoDangerousCustomTemplateScalars(value: unknown, label: string): void {
  if (typeof value === "string") {
    if (hasDangerousArg(value)) {
      throw new Error(`${label} contains a dangerous sandbox or bypass flag; custom templates must not request danger-full-access`);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoDangerousCustomTemplateScalars(entry, `${label}[${index}]`));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    assertNoDangerousCustomTemplateScalars(entry, `${label}.${key}`);
  }
}

function assertNoImplicitDangerFullAccess(value: unknown, label: string): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoImplicitDangerFullAccess(entry, `${label}[${index}]`));
    return;
  }
  const object = value as Record<string, unknown>;
  if (
    object.type === "agent" &&
    (object.provider === "codewith" || object.provider === "codex") &&
    object.permissionMode === "bypass" &&
    object.sandbox === undefined
  ) {
    throw new Error(`${label} uses permissionMode=bypass for ${object.provider} without an explicit sandbox; set sandbox=workspace-write or read-only`);
  }
  for (const [key, entry] of Object.entries(object)) {
    assertNoImplicitDangerFullAccess(entry, `${label}.${key}`);
  }
}

function assertCustomTemplateSafety(value: unknown, label: string): void {
  assertNoDangerousCustomTemplateScalars(value, label);
  assertNoImplicitDangerFullAccess(value, label);
}

function customTemplateDefinitionFromJson(value: unknown, sourcePath: string): CustomLoopTemplateDefinition {
  assertRecord(value, sourcePath);
  const id = assertTemplateString(value.id, `${sourcePath}.id`);
  validateCustomTemplateId(id, `${sourcePath}.id`);
  const name = assertTemplateString(value.name, `${sourcePath}.name`);
  const description = assertTemplateString(value.description, `${sourcePath}.description`);
  const kind = assertTemplateKind(value.kind ?? "workflow", `${sourcePath}.kind`);
  const variables = validateCustomTemplateVariables(value.variables, `${sourcePath}.variables`);
  if (value.workflow === undefined) throw new Error(`${sourcePath}.workflow is required`);
  assertRecord(value.workflow, `${sourcePath}.workflow`);
  assertCustomTemplateSafety(value.workflow, `${sourcePath}.workflow`);
  return { id, name, description, kind, variables, workflow: value.workflow };
}

function customTemplateSummary(definition: CustomLoopTemplateDefinition, sourcePath: string): LoopTemplateSummary {
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    kind: definition.kind,
    variables: structuredClone(definition.variables),
    source: "custom",
    sourcePath,
  };
}

function readCustomTemplateFile(file: string): CustomLoopTemplateEntry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`failed to read custom template ${file}: ${message}`);
  }
  const definition = customTemplateDefinitionFromJson(parsed, file);
  return { definition, summary: customTemplateSummary(definition, file), path: file };
}

function assertNoTemplateCollisions(entries: CustomLoopTemplateEntry[]): void {
  const builtinKeys = builtinTemplateKeys();
  const seen = new Map<string, string>();
  for (const entry of entries) {
    for (const key of [entry.definition.id, entry.definition.name]) {
      if (builtinKeys.has(key)) {
        throw new Error(`custom template ${entry.definition.id} collides with built-in template key ${key}; choose a different id or name`);
      }
      const existing = seen.get(key);
      if (existing) {
        throw new Error(`custom template ${entry.definition.id} collides with ${existing} on key ${key}`);
      }
      seen.set(key, entry.definition.id);
    }
  }
}

function loadCustomLoopTemplatesRaw(): CustomLoopTemplateEntry[] {
  const dir = customLoopTemplatesDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.name.endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const file = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`refusing symlinked custom template file: ${file}`);
      if (!entry.isFile()) throw new Error(`custom template registry entry is not a regular file: ${file}`);
      return readCustomTemplateFile(file);
    });
}

function loadCustomLoopTemplates(): CustomLoopTemplateEntry[] {
  const entries = loadCustomLoopTemplatesRaw();
  assertNoTemplateCollisions(entries);
  return entries;
}

function getCustomLoopTemplate(id: string): CustomLoopTemplateEntry | undefined {
  return loadCustomLoopTemplates().find((template) => template.definition.id === id || template.definition.name === id);
}

function coerceCustomTemplateValue(raw: unknown, type: LoopTemplateVariableType | undefined, label: string): unknown {
  const normalizedType = type ?? "string";
  if (normalizedType === "string") return String(raw);
  if (normalizedType === "number") {
    const value = typeof raw === "number" ? raw : Number(String(raw));
    if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
    return value;
  }
  if (normalizedType === "boolean") {
    if (typeof raw === "boolean") return raw;
    const normalized = String(raw).trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
    throw new Error(`${label} must be a boolean`);
  }
  if (normalizedType === "json") {
    if (typeof raw !== "string") return raw;
    try {
      return JSON.parse(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${label} must be valid JSON: ${message}`);
    }
  }
  if (normalizedType === "string[]") {
    if (Array.isArray(raw)) return raw.map((entry) => String(entry));
    return String(raw).split(",").map((entry) => entry.trim()).filter(Boolean);
  }
  return String(raw);
}

function customTemplateValues(
  definition: CustomLoopTemplateDefinition,
  values: Record<string, string | undefined>,
): Record<string, unknown> {
  const variablesByName = new Map(definition.variables.map((variable) => [variable.name, variable]));
  for (const [name, value] of Object.entries(values)) {
    if (value !== undefined && !variablesByName.has(name)) {
      throw new Error(`unknown variable for custom template ${definition.id}: ${name}`);
    }
  }
  const rendered: Record<string, unknown> = {};
  for (const variable of definition.variables) {
    const raw = values[variable.name] ?? variable.default;
    if (raw === undefined || raw === "") {
      if (variable.required) throw new Error(`${variable.name} is required`);
      continue;
    }
    rendered[variable.name] = coerceCustomTemplateValue(raw, variable.type, variable.name);
  }
  return rendered;
}

function customTemplateValueForPlaceholder(values: Record<string, unknown>, name: string, templateId: string): unknown {
  if (!(name in values)) throw new Error(`custom template ${templateId} requires variable ${name}`);
  return values[name];
}

function stringifyCustomTemplateValue(value: unknown, name: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  if (Array.isArray(value) || typeof value === "object") return JSON.stringify(value);
  throw new Error(`custom template variable ${name} cannot be rendered as a string`);
}

function renderCustomTemplateNode(value: unknown, values: Record<string, unknown>, templateId: string): unknown {
  if (typeof value === "string") {
    const exact = CUSTOM_TEMPLATE_EXACT_PLACEHOLDER.exec(value);
    if (exact) return customTemplateValueForPlaceholder(values, exact[1], templateId);
    return value.replace(CUSTOM_TEMPLATE_PLACEHOLDER, (_match, name: string) =>
      stringifyCustomTemplateValue(customTemplateValueForPlaceholder(values, name, templateId), name),
    );
  }
  if (Array.isArray(value)) return value.map((entry) => renderCustomTemplateNode(entry, values, templateId));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, renderCustomTemplateNode(entry, values, templateId)]),
  );
}

function renderCustomLoopTemplate(entry: CustomLoopTemplateEntry, values: Record<string, string | undefined>): CreateWorkflowInput {
  const renderedValues = customTemplateValues(entry.definition, values);
  const rendered = renderCustomTemplateNode(entry.definition.workflow, renderedValues, entry.definition.id);
  assertCustomTemplateSafety(rendered, `custom template ${entry.definition.id}.workflow`);
  const workflow = workflowBodyFromJson(rendered);
  assertCustomTemplateSafety(workflow, `custom template ${entry.definition.id}.workflow`);
  return workflow;
}

export function validateCustomLoopTemplateFile(file: string): LoopTemplateSummary {
  const source = resolve(file);
  const entry = readCustomTemplateFile(source);
  const existing = loadCustomLoopTemplatesRaw().filter((template) => resolve(template.path) !== source);
  assertNoTemplateCollisions([...existing, entry]);
  return structuredClone(entry.summary);
}

export function importCustomLoopTemplate(file: string, opts: CustomLoopTemplateImportOptions = {}): CustomLoopTemplateImportResult {
  const source = resolve(file);
  const entry = readCustomTemplateFile(source);
  const dir = ensureCustomLoopTemplatesDir();
  const destination = join(dir, `${entry.definition.id}.json`);
  const replaced = existsSync(destination);
  const existing = loadCustomLoopTemplatesRaw().filter((template) => resolve(template.path) !== resolve(destination));
  assertNoTemplateCollisions([...existing, { ...entry, path: destination, summary: customTemplateSummary(entry.definition, destination) }]);
  if (replaced) {
    const stat = lstatSync(destination);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`refusing to replace non-regular custom template file: ${destination}`);
    if (!opts.replace) throw new Error(`custom template already exists: ${entry.definition.id}; use --replace to overwrite it`);
  }
  writeFileSync(destination, `${JSON.stringify(entry.definition, null, 2)}\n`, { mode: 0o600 });
  const imported = readCustomTemplateFile(destination);
  return { template: structuredClone(imported.summary), path: destination, replaced };
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
  if (source !== "builtin") templates.push(...loadCustomLoopTemplates().map((entry) => structuredClone(entry.summary)));
  return templates;
}

export function getLoopTemplate(id: string, opts: ListLoopTemplatesOptions = {}): LoopTemplateSummary | undefined {
  const source = opts.source ?? "all";
  if (source !== "custom") {
    const builtin = getBuiltinLoopTemplate(id);
    if (builtin) return builtin;
    if (source === "builtin") return undefined;
  }
  return getCustomLoopTemplate(id)?.summary;
}

export function renderTodosTaskWorkerVerifierWorkflow(input: TodosTaskWorkflowTemplateInput): CreateWorkflowInput {
  if (!input.taskId?.trim()) throw new Error("taskId is required");
  if (!input.projectPath?.trim()) throw new Error("projectPath is required");
  const todosProjectPath = input.todosProjectPath ?? input.routeProjectPath ?? input.projectPath;
  const plan = worktreePlan(input, input.taskId);
  const taskContext = {
    taskId: input.taskId,
    taskTitle: input.taskTitle,
    taskDescription: input.taskDescription,
    eventId: input.eventId,
    eventType: input.eventType,
    projectPath: input.projectPath,
    routeProjectPath: input.routeProjectPath,
    projectGroup: input.projectGroup,
    worktree: {
      mode: plan.mode,
      enabled: plan.enabled,
      cwd: plan.cwd,
      path: plan.path,
      branch: plan.branch,
      reason: plan.reason,
    },
  };
  const workerPrompt = [
    `/goal Complete todos task ${input.taskId} in ${input.projectPath}.`,
    "",
    "You are the worker agent for a task-triggered OpenLoops workflow.",
    worktreePrompt(plan),
    `Todos project path: ${todosProjectPath}`,
    "Use these exact todos commands so worktree cwd inference cannot attach to the wrong project:",
    `- Inspect first: todos --project ${todosProjectPath} inspect ${input.taskId}`,
    `- Claim/start if appropriate: todos --project ${todosProjectPath} start ${input.taskId}`,
    `- Record evidence: todos --project ${todosProjectPath} comment ${input.taskId} "<concise evidence and blockers>"`,
    "Investigate first before changing files. Use the todos CLI as the source of truth for the task.",
    "Inspect the repository/project state, implement only the task scope, run focused validation, preserve unrelated user changes, and update the task with comments, evidence, changed files, commits, and blockers.",
    "Do not dispatch or paste prompts into tmux panes. If additional work is required, create or update deduped todos tasks so task-created routing can start a fresh headless workflow.",
    "Do not mark the task complete in the worker step; the verifier step owns completion after independent validation.",
    "",
    `Task context JSON: ${compactJson(taskContext)}`,
  ].join("\n");
  const verifierPrompt = [
    `/goal Verify todos task ${input.taskId} after the worker step.`,
    "",
    "You are the verifier agent for a task-triggered OpenLoops workflow.",
    worktreePrompt(plan),
    `Todos project path: ${todosProjectPath}`,
    "Use these exact todos commands so worktree cwd inference cannot attach to the wrong project:",
    `- Inspect first: todos --project ${todosProjectPath} inspect ${input.taskId}`,
    `- Record verification: todos --project ${todosProjectPath} comment ${input.taskId} "<verification evidence or blocker>"`,
    `- If valid and complete: todos --project ${todosProjectPath} done ${input.taskId}`,
    "Use fresh context. Inspect the task, repository state, commits, tests, and worker evidence. Act as an adversarial reviewer focused on correctness, regressions, missing tests, security, and incomplete requirements.",
    "If the work is valid, record verification evidence in todos and mark/leave the task in the correct completed state according to the todos CLI. If it is not valid, add precise follow-up tasks or comments and leave the original task open or blocked with clear evidence.",
    "Do not dispatch or paste prompts into tmux panes. If additional work is required, create or update deduped todos tasks so task-created routing can start a fresh headless workflow.",
    "Do not make broad unrelated changes. Only apply tiny verification fixes when they are necessary and low risk; otherwise create follow-up tasks.",
    "",
    `Task context JSON: ${compactJson(taskContext)}`,
  ].join("\n");

  return {
    name: `todos-task-${input.taskId.slice(0, 8)}-worker-verifier`,
    description: `Task-triggered worker/verifier workflow for ${taskLabel(input)}`,
    version: 1,
    steps: workflowStepsWithWorktree(plan, [
      {
        id: "worker",
        name: "Worker",
        description: "Implement the todos task and record evidence.",
        target: agentTarget(input, workerPrompt, "worker", input.taskId, plan),
        timeoutMs: 45 * 60_000,
      },
      {
        id: "verifier",
        name: "Verifier",
        description: "Adversarially verify worker output and update todos.",
        dependsOn: ["worker"],
        target: {
          ...agentTarget(input, verifierPrompt, "verifier", input.taskId, plan),
          idleTimeoutMs: 10 * 60_000,
        },
        timeoutMs: 30 * 60_000,
      },
    ]),
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
    worktree: {
      mode: plan.mode,
      enabled: plan.enabled,
      cwd: plan.cwd,
      path: plan.path,
      branch: plan.branch,
      reason: plan.reason,
    },
  };
  const workerPrompt = [
    `/goal Handle Hasna event ${input.eventSource}/${input.eventType} (${input.eventId}) in ${input.projectPath}.`,
    "",
    "You are the worker agent for an event-triggered OpenLoops workflow.",
    worktreePrompt(plan),
    "Investigate first before changing files. Read the full event envelope and decide the narrow action required by that event. Preserve unrelated user changes and update the relevant local CLI/task/knowledge system with evidence, changed files, commits, and blockers.",
    "If the event is informational or does not require action, record that finding and stop without making changes.",
    "",
    `Event context JSON: ${compactJson(eventContext)}`,
    `Full event envelope JSON: ${input.eventJson}`,
  ].join("\n");
  const verifierPrompt = [
    `/goal Verify handling of Hasna event ${input.eventSource}/${input.eventType} (${input.eventId}).`,
    "",
    "You are the verifier agent for an event-triggered OpenLoops workflow.",
    worktreePrompt(plan),
    "Use fresh context. Inspect the event, repository/project state, worker evidence, tests, and any created tasks or notes. Act as an adversarial reviewer focused on correctness, regressions, security, missing evidence, and incomplete requirements.",
    "If the work is valid, record verification evidence in the relevant local system. If it is not valid, add precise follow-up tasks/comments and leave the event handling state open or blocked with clear evidence.",
    "",
    `Event context JSON: ${compactJson(eventContext)}`,
    `Full event envelope JSON: ${input.eventJson}`,
  ].join("\n");

  return {
    name: `event-${input.eventSource}-${input.eventType}-${input.eventId.slice(0, 8)}-worker-verifier`.replace(/[^a-zA-Z0-9._:-]+/g, "-"),
    description: `Event-triggered worker/verifier workflow for ${input.eventSource}/${input.eventType}`,
    version: 1,
    steps: workflowStepsWithWorktree(plan, [
      {
        id: "worker",
        name: "Worker",
        description: "Handle the Hasna event and record evidence.",
        target: agentTarget(input, workerPrompt, "worker", seed, plan),
        timeoutMs: 45 * 60_000,
      },
      {
        id: "verifier",
        name: "Verifier",
        description: "Adversarially verify event handling.",
        dependsOn: ["worker"],
        target: {
          ...agentTarget(input, verifierPrompt, "verifier", seed, plan),
          idleTimeoutMs: 10 * 60_000,
        },
        timeoutMs: 30 * 60_000,
      },
    ]),
  };
}

export function renderBoundedAgentWorkerVerifierWorkflow(input: BoundedAgentWorkflowTemplateInput): CreateWorkflowInput {
  if (!input.objective?.trim()) throw new Error("objective is required");
  if (!input.projectPath?.trim()) throw new Error("projectPath is required");
  const seed = `${input.projectPath}:${input.objective}`;
  const plan = worktreePlan(input, seed);
  const timeoutMs = input.timeoutMs && Number.isFinite(input.timeoutMs) ? input.timeoutMs : 45 * 60_000;
  const workerPrompt = [
    `/goal ${input.objective}`,
    "",
    "You are the worker step for a bounded OpenLoops agent workflow.",
    worktreePrompt(plan),
    "Investigate first. Keep scope narrow, use local project/task systems as the source of truth when relevant, preserve unrelated changes, run focused validation, and record concise evidence.",
    "Do not dispatch or paste prompts into tmux panes. If additional work is required, create or update deduped todos tasks so task-created routing can start a fresh headless workflow.",
    input.prompt ? "" : undefined,
    input.prompt,
  ].filter(Boolean).join("\n");
  const verifierPrompt = [
    `/goal Adversarially verify: ${input.objective}`,
    "",
    "You are the verifier step for a bounded OpenLoops agent workflow.",
    worktreePrompt(plan),
    "Use fresh context. Review the worker result for correctness, regressions, missing tests, safety, runaway-agent risk, output bounds, and incomplete evidence.",
    "If valid, record verification evidence. If invalid, create precise follow-up tasks or comments and leave the original work open. Do not make broad unrelated changes.",
  ].join("\n");

  return {
    name: input.name ?? `bounded-agent-${stableIndex(seed, 0xffffffff).toString(16).padStart(8, "0")}-worker-verifier`,
    description: `Bounded worker/verifier workflow for ${input.objective.slice(0, 180)}`,
    version: 1,
    steps: workflowStepsWithWorktree(plan, [
      {
        id: "worker",
        name: "Worker",
        description: "Execute the bounded objective and record evidence.",
        target: agentTarget(input, workerPrompt, "worker", seed, plan),
        timeoutMs,
      },
      {
        id: "verifier",
        name: "Verifier",
        description: "Adversarially verify the bounded objective result.",
        dependsOn: ["worker"],
        target: {
          ...agentTarget(input, verifierPrompt, "verifier", seed, plan),
          idleTimeoutMs: 10 * 60_000,
        },
        timeoutMs: Math.min(timeoutMs, 30 * 60_000),
      },
    ]),
  };
}

function renderLifecycleBoundedTemplate(id: string, values: Record<string, string | undefined>): CreateWorkflowInput | undefined {
  const projectPath = values.projectPath ?? values.cwd ?? process.cwd();
  const common = {
    name: values.name,
    projectPath,
    routeProjectPath: values.routeProjectPath,
    projectGroup: values.projectGroup,
    provider: values.provider as AgentProvider | undefined,
    authProfile: values.authProfile,
    authProfilePool: listVar(values.authProfilePool),
    workerAuthProfile: values.workerAuthProfile,
    verifierAuthProfile: values.verifierAuthProfile,
    account: values.account ? { profile: values.account, tool: values.accountTool } : undefined,
    accountPool: accountPoolVar(values.accountPool, values.accountTool),
    model: values.model,
    variant: values.variant,
    agent: values.agent,
    addDirs: listVar(values.addDirs ?? values.addDir),
    permissionMode: values.permissionMode as AgentPermissionMode | undefined,
    sandbox: (values.sandbox as AgentSandbox | undefined) ?? (id === REPORT_ONLY_TEMPLATE_ID ? "read-only" : undefined),
    manualBreakGlass: booleanVar(values.manualBreakGlass),
    worktreeMode: (values.worktreeMode as AgentWorktreeMode | undefined) ?? (id === REPORT_ONLY_TEMPLATE_ID ? "main" : "required"),
    worktreeRoot: values.worktreeRoot,
    worktreeBranchPrefix: values.worktreeBranchPrefix,
    timeoutMs: values.timeoutMs ? Number(values.timeoutMs) : undefined,
  };
  if (id === TASK_LIFECYCLE_TEMPLATE_ID) {
    const taskId = values.taskId ?? "";
    if (!taskId.trim()) throw new Error("taskId is required");
    return renderBoundedAgentWorkerVerifierWorkflow({
      ...common,
      name: values.name ?? `task-lifecycle-${slugSegment(taskId)}-worker-verifier`,
      objective: values.objective ?? `Run the full task lifecycle for todos task ${taskId}.`,
      prompt:
        values.prompt ??
        "Triage and dedupe the task, verify it is eligible for loop execution, create or update a concise plan artifact/comment, execute only the allowed scope, validate, record evidence, and let the verifier decide final task state. Add follow-up tasks instead of broadening scope.",
    });
  }
  if (id === PR_REVIEW_TEMPLATE_ID) {
    const pr = values.prUrl ?? values.prNumber ?? "";
    if (!pr.trim()) throw new Error("prUrl or prNumber is required");
    return renderBoundedAgentWorkerVerifierWorkflow({
      ...common,
      name: values.name ?? `pr-review-${slugSegment(pr)}-worker-verifier`,
      objective: values.objective ?? `Review and drive PR ${pr} toward merge-ready state.`,
      prompt:
        values.prompt ??
        "Inspect PR state, checks, conflicts, branch freshness, review requirements, and repo policy. Apply only owned logical fixes in the isolated worktree, validate, update the PR/task with evidence, and do not merge unless policy/checks make it clearly safe.",
    });
  }
  if (id === SCHEDULED_AUDIT_TEMPLATE_ID) {
    const objective = values.objective ?? "";
    if (!objective.trim()) throw new Error("objective is required");
    return renderBoundedAgentWorkerVerifierWorkflow({
      ...common,
      name: values.name ?? `scheduled-audit-${stableIndex(`${projectPath}:${objective}`, 0xffffffff).toString(16).padStart(8, "0")}-worker-verifier`,
      objective,
      prompt:
        values.prompt ??
        "Run the bounded audit, write compact evidence, create deduped todos tasks for actionable issues, and avoid implementation unless the task explicitly allows it.",
    });
  }
  if (id === KNOWLEDGE_REFRESH_TEMPLATE_ID) {
    const scope = values.scope ?? values.label ?? "recent knowledge";
    return renderBoundedAgentWorkerVerifierWorkflow({
      ...common,
      name: values.name ?? `knowledge-refresh-${slugSegment(scope)}-worker-verifier`,
      objective: values.objective ?? `Refresh and verify ${scope}.`,
      prompt:
        values.prompt ??
        "Inspect recent knowledge records, improve structure/schema where appropriate, avoid duplicates, create tasks for code changes instead of doing unrelated implementation, and record verification evidence.",
    });
  }
  if (id === REPORT_ONLY_TEMPLATE_ID) {
    const objective = values.objective ?? "";
    if (!objective.trim()) throw new Error("objective is required");
    return renderBoundedAgentWorkerVerifierWorkflow({
      ...common,
      name: values.name ?? `report-only-${stableIndex(`${projectPath}:${objective}`, 0xffffffff).toString(16).padStart(8, "0")}-worker-verifier`,
      objective,
      prompt:
        values.prompt ??
        "Produce a report only. Do not mutate repositories, tasks, secrets, databases, or external systems except for writing the requested report/evidence artifact.",
    });
  }
  if (id === INCIDENT_RESPONSE_TEMPLATE_ID) {
    const objective = values.objective ?? "";
    if (!objective.trim()) throw new Error("objective is required");
    const incident = values.incidentId ?? values.taskId ?? "incident";
    return renderBoundedAgentWorkerVerifierWorkflow({
      ...common,
      name: values.name ?? `incident-response-${slugSegment(incident)}-worker-verifier`,
      objective,
      prompt:
        values.prompt ??
        "Triage first, gather bounded evidence, mitigate only narrow allowed issues, preserve data/history/secrets, create follow-up tasks for larger fixes, and require verifier confirmation before closure.",
    });
  }
  return undefined;
}

function renderDeterministicCheckCreateTaskWorkflow(values: Record<string, string | undefined>): CreateWorkflowInput {
  const projectPath = values.projectPath ?? values.cwd ?? process.cwd();
  const checkCommand = values.checkCommand ?? "";
  if (!checkCommand.trim()) throw new Error("checkCommand is required");
  const seed = `${projectPath}:${checkCommand}`;
  return {
    name: values.name ?? `deterministic-check-${stableIndex(seed, 0xffffffff).toString(16).padStart(8, "0")}`,
    description:
      values.description ??
      "Deterministic check that writes compact evidence and upserts one deduped todos task when the expectation is not met.",
    version: 1,
    steps: [
      {
        id: "check",
        name: "Check",
        description: "Run the deterministic check/task-upsert command.",
        target: {
          type: "command",
          command: "bash",
          args: ["-lc", checkCommand],
          cwd: projectPath,
          timeoutMs: values.timeoutMs ? Number(values.timeoutMs) : 5 * 60_000,
          idleTimeoutMs: values.idleTimeoutMs ? Number(values.idleTimeoutMs) : 60_000,
        },
        timeoutMs: values.timeoutMs ? Number(values.timeoutMs) : 5 * 60_000,
      },
    ],
  };
}

function renderBuiltinLoopTemplate(id: string, values: Record<string, string | undefined>): CreateWorkflowInput {
  if (id === DETERMINISTIC_CHECK_CREATE_TASK_TEMPLATE_ID) {
    return renderDeterministicCheckCreateTaskWorkflow(values);
  }
  const lifecycle = renderLifecycleBoundedTemplate(id, values);
  if (lifecycle) return lifecycle;
  if (id === TODOS_TASK_WORKER_VERIFIER_TEMPLATE_ID) {
    return renderTodosTaskWorkerVerifierWorkflow({
      taskId: values.taskId ?? "",
      taskTitle: values.taskTitle,
      taskDescription: values.taskDescription,
      projectPath: values.projectPath ?? values.cwd ?? process.cwd(),
      todosProjectPath: values.todosProjectPath ?? values.todosProject,
      routeProjectPath: values.routeProjectPath,
      projectGroup: values.projectGroup,
      provider: values.provider as AgentProvider | undefined,
      authProfile: values.authProfile,
      authProfilePool: listVar(values.authProfilePool),
      workerAuthProfile: values.workerAuthProfile,
      verifierAuthProfile: values.verifierAuthProfile,
      account: values.account ? { profile: values.account, tool: values.accountTool } : undefined,
      accountPool: accountPoolVar(values.accountPool, values.accountTool),
      model: values.model,
      variant: values.variant,
      agent: values.agent,
      addDirs: listVar(values.addDirs ?? values.addDir),
      permissionMode: values.permissionMode as AgentPermissionMode | undefined,
      sandbox: values.sandbox as AgentSandbox | undefined,
      manualBreakGlass: booleanVar(values.manualBreakGlass),
      worktreeMode: values.worktreeMode as AgentWorktreeMode | undefined,
      worktreeRoot: values.worktreeRoot,
      worktreeBranchPrefix: values.worktreeBranchPrefix,
      eventId: values.eventId,
      eventType: values.eventType,
    });
  }
  if (id === EVENT_WORKER_VERIFIER_TEMPLATE_ID) {
    return renderEventWorkerVerifierWorkflow({
      eventId: values.eventId ?? "",
      eventType: values.eventType ?? "",
      eventSource: values.eventSource ?? "",
      eventSubject: values.eventSubject,
      eventMessage: values.eventMessage,
      eventJson: values.eventJson ?? "",
      projectPath: values.projectPath ?? values.cwd ?? process.cwd(),
      routeProjectPath: values.routeProjectPath,
      projectGroup: values.projectGroup,
      provider: values.provider as AgentProvider | undefined,
      authProfile: values.authProfile,
      authProfilePool: listVar(values.authProfilePool),
      workerAuthProfile: values.workerAuthProfile,
      verifierAuthProfile: values.verifierAuthProfile,
      account: values.account ? { profile: values.account, tool: values.accountTool } : undefined,
      accountPool: accountPoolVar(values.accountPool, values.accountTool),
      model: values.model,
      variant: values.variant,
      agent: values.agent,
      addDirs: listVar(values.addDirs ?? values.addDir),
      permissionMode: values.permissionMode as AgentPermissionMode | undefined,
      sandbox: values.sandbox as AgentSandbox | undefined,
      manualBreakGlass: booleanVar(values.manualBreakGlass),
      worktreeMode: values.worktreeMode as AgentWorktreeMode | undefined,
      worktreeRoot: values.worktreeRoot,
      worktreeBranchPrefix: values.worktreeBranchPrefix,
    });
  }
  if (id === BOUNDED_AGENT_WORKER_VERIFIER_TEMPLATE_ID) {
    return renderBoundedAgentWorkerVerifierWorkflow({
      name: values.name,
      objective: values.objective ?? "",
      prompt: values.prompt,
      projectPath: values.projectPath ?? values.cwd ?? process.cwd(),
      routeProjectPath: values.routeProjectPath,
      projectGroup: values.projectGroup,
      provider: values.provider as AgentProvider | undefined,
      authProfile: values.authProfile,
      authProfilePool: listVar(values.authProfilePool),
      workerAuthProfile: values.workerAuthProfile,
      verifierAuthProfile: values.verifierAuthProfile,
      account: values.account ? { profile: values.account, tool: values.accountTool } : undefined,
      accountPool: accountPoolVar(values.accountPool, values.accountTool),
      model: values.model,
      variant: values.variant,
      agent: values.agent,
      addDirs: listVar(values.addDirs ?? values.addDir),
      permissionMode: values.permissionMode as AgentPermissionMode | undefined,
      sandbox: values.sandbox as AgentSandbox | undefined,
      manualBreakGlass: booleanVar(values.manualBreakGlass),
      worktreeMode: values.worktreeMode as AgentWorktreeMode | undefined,
      worktreeRoot: values.worktreeRoot,
      worktreeBranchPrefix: values.worktreeBranchPrefix,
      timeoutMs: values.timeoutMs ? Number(values.timeoutMs) : undefined,
    });
  }
  throw new Error(`unknown template: ${id}`);
}

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

function accountPoolVar(value: string | undefined, tool?: string): AccountRef[] | undefined {
  return listVar(value)?.map((profile) => ({ profile, tool }));
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
  const custom = getCustomLoopTemplate(id);
  if (custom) return renderCustomLoopTemplate(custom, values);
  throw new Error(`unknown template: ${id}`);
}
