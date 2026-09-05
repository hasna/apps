import type { AgentWorktreeSpec, LoopTemplateSummary, LoopTemplateVariable } from "../types.js";

/**
 * Builtin template metadata, prompt kit, and deterministic script assets.
 *
 * The copy-edited prose blocks (worktree policy, exact-todos-commands stanzas,
 * evidence rules, no-tmux stanzas) live here as composable named fragments;
 * per-template wording deltas are explicit parameters so drift stays visible
 * in one place. Rendered wording is contract-tested in templates.test.ts.
 */

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
export const ROUTING_REMEDIATION_TEMPLATE_ID = "routing-remediation";

/**
 * Conversations channel that routing-health findings are reported to.
 *
 * Owner directive 2026-07-30 ("routine operational alerts are not tasks"): a routing
 * failure is a measurement, not a claim on someone's attention, so it must not be
 * filed as a todos task. Before that directive this template told the worker to
 * `todos task upsert` one blocker task per finding, and a single sweep on 2026-07-05
 * emitted 2,817 of them — none ever assigned, actioned, or commented on. Findings now
 * go to a run evidence artifact plus ONE aggregate post on this channel.
 */
export const ROUTING_REMEDIATION_ALERT_CHANNEL = "open-loops";

/**
 * Instruction fragment forbidding a routing-health worker from turning findings into
 * todos rows. Owner directive 2026-07-30: the task store is for work someone intends
 * to do; a routing failure is a measurement and belongs in evidence plus one aggregate
 * channel post.
 */
export function ROUTING_HEALTH_ALERTS_ARE_NOT_TASKS_FRAGMENT(alertChannel: string, blockerReportPath: string): string {
  return [
    "Routine operational alerts are NOT tasks (owner directive 2026-07-30). Do not create, upsert, or fingerprint a todos task for any routing finding, blocker, or health signal — not one per finding, not one per category, not one per run.",
    `Findings go to the blocker report artifact ${blockerReportPath} and to at most ONE aggregate summary post on the ${alertChannel} conversations channel.`,
    "The only todos writes this workflow may make are comments on the tasks it actually repaired.",
  ].join("\n");
}

export type AgentWorkflowRole = "triage" | "planner" | "worker" | "verifier";

// ---------------------------------------------------------------------------
// Template summary variable fragments
// ---------------------------------------------------------------------------

function projectPathVariable(description = "Repository or project working directory."): LoopTemplateVariable {
  return { name: "projectPath", required: true, description };
}

function routeScopeVariables(): LoopTemplateVariable[] {
  return [
    { name: "routeProjectPath", description: "Canonical project path used for scheduler concurrency limits." },
    { name: "projectGroup", description: "Optional project group used for scheduler concurrency limits." },
  ];
}

function roleAuthProfileVariable(role: AgentWorkflowRole): LoopTemplateVariable {
  return { name: `${role}AuthProfile`, description: `Provider-native auth profile for the ${role} step.` };
}

function agentTimeoutVariable(): LoopTemplateVariable {
  return {
    name: "timeoutMs",
    default: "unlimited",
    description: "Agent step timeout in milliseconds, or unlimited/none/null for no timeout. Deterministic helper steps remain bounded.",
  };
}

function verifierIdleTimeoutVariable(): LoopTemplateVariable {
  return {
    name: "verifierIdleTimeoutMs",
    default: "900000",
    description: "Verifier idle watchdog in milliseconds; use none/off to disable when an external heartbeat exists.",
  };
}

/** Shared agent/permission/worktree variable block for the worker+verifier templates. */
function workerVerifierAgentVariables(opts: { addDirs: boolean; branchNoun: string }): LoopTemplateVariable[] {
  return [
    { name: "provider", default: "codewith", description: "Agent provider: codewith, claude, cursor, opencode, aicopilot, or codex." },
    { name: "authProfile", description: "Provider-native auth profile, currently Codewith." },
    { name: "authProfilePool", description: "Comma-separated provider-native auth profiles; worker/verifier are selected deterministically." },
    roleAuthProfileVariable("worker"),
    roleAuthProfileVariable("verifier"),
    { name: "accountPool", description: "Comma-separated OpenAccounts profiles; worker/verifier are selected deterministically." },
    { name: "model", description: "Provider model." },
    { name: "variant", description: "Provider reasoning/model effort variant." },
    ...(opts.addDirs
      ? [{ name: "addDirs", description: "Comma-separated additional writable directories for provider sandboxes." }]
      : []),
    { name: "permissionMode", default: "bypass", description: "Provider permission mode: default, plan, auto, or bypass." },
    { name: "sandbox", default: "workspace-write", description: "Provider sandbox mode." },
    { name: "allowTools", description: "Comma-separated advisory provider session tool restrictions." },
    { name: "allowCommands", description: "Comma-separated advisory provider session command restrictions." },
    { name: "safetyReason", description: "Auditable reason required for advisory restrictions or relaxed sandbox access." },
    { name: "manualBreakGlass", default: "false", description: "Allow explicit danger-full-access in a generated workflow. Intended for manual emergency use only." },
    { name: "worktreeMode", default: "auto", description: "Worktree isolation mode: auto, required, off, or main." },
    { name: "worktreeRoot", default: "the repos worktrees root", description: "Base directory for Loops-managed git worktrees (canonical root per global-worktree-placement; resolve it with the repos CLI)." },
    { name: "worktreeBranchPrefix", default: "openloops", description: `Branch prefix for generated ${opts.branchNoun} worktree branches.` },
    agentTimeoutVariable(),
    verifierIdleTimeoutVariable(),
  ];
}

/** Shared variable tail for the lifecycle-derived bounded templates. */
function lifecycleSharedVariables(opts: {
  sandboxDefault?: string;
  worktreeModeDefault?: string;
  worktreeModeDescription?: string;
} = {}): LoopTemplateVariable[] {
  return [
    { name: "authProfilePool", description: "Comma-separated Codewith profiles for worker/verifier rotation." },
    { name: "provider", default: "codewith", description: "Agent provider." },
    { name: "sandbox", default: opts.sandboxDefault ?? "workspace-write", description: "Provider sandbox mode." },
    { name: "worktreeMode", default: opts.worktreeModeDefault ?? "required", description: opts.worktreeModeDescription ?? "Worktree isolation mode." },
    verifierIdleTimeoutVariable(),
  ];
}

export const BUILTIN_TEMPLATE_SUMMARIES: LoopTemplateSummary[] = [
  {
    id: TODOS_TASK_WORKER_VERIFIER_TEMPLATE_ID,
    name: "Todos Task Worker + Verifier",
    description:
      "Create a one-shot workflow for a todos task: one agent performs the task, then a fresh verifier agent audits the result and records follow-up tasks or completion evidence.",
    kind: "workflow",
    variables: [
      { name: "taskId", required: true, description: "Todos task id to execute." },
      { name: "taskTitle", description: "Human-readable task title." },
      projectPathVariable(),
      { name: "todosProjectPath", description: "Todos storage project path used in worker/verifier commands." },
      ...routeScopeVariables(),
      ...workerVerifierAgentVariables({ addDirs: true, branchNoun: "task/event" }),
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
      projectPathVariable(),
      ...routeScopeVariables(),
      ...workerVerifierAgentVariables({ addDirs: true, branchNoun: "event" }),
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
      projectPathVariable(),
      ...routeScopeVariables(),
      ...workerVerifierAgentVariables({ addDirs: false, branchNoun: "bounded-agent" }),
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
      projectPathVariable(),
      { name: "authProfilePool", description: "Comma-separated Codewith profiles for worker/verifier rotation." },
      roleAuthProfileVariable("triage"),
      roleAuthProfileVariable("planner"),
      roleAuthProfileVariable("worker"),
      roleAuthProfileVariable("verifier"),
      { name: "accountPool", description: "Comma-separated OpenAccounts profiles for non-Codewith providers." },
      { name: "provider", default: "codewith", description: "Agent provider." },
      { name: "sandbox", default: "workspace-write", description: "Provider sandbox mode." },
      { name: "prHandoff", default: "false", description: "Add a bounded network-enabled PR handoff task step after the worker." },
      { name: "worktreeMode", default: "required", description: "Worktree isolation mode." },
      agentTimeoutVariable(),
      verifierIdleTimeoutVariable(),
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
      projectPathVariable("Repository working directory."),
      ...lifecycleSharedVariables(),
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
      projectPathVariable(),
      ...lifecycleSharedVariables(),
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
      projectPathVariable(),
      ...lifecycleSharedVariables(),
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
      projectPathVariable(),
      ...lifecycleSharedVariables({
        sandboxDefault: "read-only",
        worktreeModeDefault: "main",
        worktreeModeDescription: "Report-only workflows normally inspect the main checkout read-only.",
      }),
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
      projectPathVariable(),
      ...lifecycleSharedVariables(),
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
      projectPathVariable(),
      { name: "name", description: "Workflow name." },
      { name: "timeoutMs", default: "300000", description: "Check timeout in milliseconds." },
    ],
  },
  {
    id: ROUTING_REMEDIATION_TEMPLATE_ID,
    name: "Routing Remediation",
    description:
      "Run a bounded routing-doctor remediation workflow: deterministic preflight, safe Todos CLI repair, blocker evidence reporting to a conversations channel, and adversarial verification.",
    kind: "workflow",
    variables: [
      projectPathVariable("Repository/project path used for workflow evidence artifacts."),
      { name: "todosProjectPath", description: "Todos storage project path to inspect and repair; defaults to projectPath." },
      { name: "doctorJsonPath", description: "Optional existing todos doctor routing --json output to consume instead of running a fresh dry-run." },
      { name: "doctorProject", description: "Optional todos doctor routing --project scope (id, slug, or path)." },
      { name: "tag", description: "Optional todos doctor routing --tag scope." },
      { name: "status", default: "pending,in_progress", description: "Comma-separated task statuses for the doctor." },
      { name: "shard", description: "Optional deterministic shard such as 0/6." },
      { name: "limit", description: "Optional maximum tasks inspected by the doctor." },
      { name: "maxRepairs", default: "25", description: "Capacity gate: maximum safe_auto findings allowed in one apply run." },
      { name: "dryRun", default: "true", description: "When true, perform preflight/reporting only and do not apply repairs." },
      { name: "idempotencyKey", description: "Stable key used for evidence paths, undo records, and dedupe fingerprints." },
      { name: "evidenceDir", description: "Directory for doctor, preflight, apply, and recheck JSON artifacts." },
      { name: "undoDir", description: "Directory for todos doctor routing --undo-record output." },
      ...lifecycleSharedVariables({ worktreeModeDefault: "required" }),
    ],
  },
];

// ---------------------------------------------------------------------------
// Prompt fragments
// ---------------------------------------------------------------------------

export const NO_TMUX_DISPATCH_FRAGMENT =
  "Do not dispatch or paste prompts into tmux panes. If additional work is required, create or update deduped todos tasks so task-created routing can start a fresh headless workflow.";

export const WORKER_LEAVES_COMPLETION_FRAGMENT =
  "Do not mark the task complete in the worker step; the verifier step owns completion after independent validation.";

export const VERIFIER_TINY_FIXES_FRAGMENT =
  "Do not make broad unrelated changes. Only apply tiny verification fixes when they are necessary and low risk; otherwise create follow-up tasks.";

export const TASK_VERIFIER_DECISION_FRAGMENT =
  "If the work is valid, record verification evidence in todos and mark/leave the task in the correct completed state according to the todos CLI. If it is not valid, add precise follow-up tasks or comments and leave the original task open or blocked with clear evidence.";

export const LIFECYCLE_VERIFIER_DECISION_FRAGMENT =
  "If the work is valid, record verification evidence in todos and mark/leave the task completed according to the todos CLI. If not valid, add precise follow-up tasks or comments and leave the original task open or blocked with clear evidence.";

export const EVENT_VERIFIER_DECISION_FRAGMENT =
  "If the work is valid, record verification evidence in the relevant local system. If it is not valid, add precise follow-up tasks/comments and leave the event handling state open or blocked with clear evidence.";

export const BOUNDED_VERIFIER_REVIEW_FRAGMENT =
  "Use fresh context. Review the worker result for correctness, regressions, missing tests, safety, runaway-agent risk, output bounds, and incomplete evidence.";

export const BOUNDED_VERIFIER_DECISION_FRAGMENT =
  "If valid, record verification evidence. If invalid, create precise follow-up tasks or comments and leave the original work open. Do not make broad unrelated changes.";

export const TASK_REVIEW_FOCUS = "correctness, regressions, missing tests, security, and incomplete requirements";
export const EVENT_REVIEW_FOCUS = "correctness, regressions, security, missing evidence, and incomplete requirements";

export type BuiltinFlow = "task" | "lifecycle" | "event" | "bounded";

const FLOW_FRAGMENTS: Record<BuiltinFlow, { noun: string; description: string }> = {
  task: { noun: "agent", description: "a task-triggered Loops workflow" },
  lifecycle: { noun: "step", description: "a full task-triggered Loops lifecycle" },
  event: { noun: "agent", description: "an event-triggered Loops workflow" },
  bounded: { noun: "step", description: "a bounded Loops agent workflow" },
};

export function roleFragment(role: string, flow: BuiltinFlow): string {
  const { noun, description } = FLOW_FRAGMENTS[flow];
  return `You are the ${role} ${noun} for ${description}.`;
}

/**
 * `/goal` header lines. The blank separator line is intentionally part of the
 * fragment; prompts assembled with `.filter(Boolean)` historically drop it and
 * that rendering is contract-tested, so composition must preserve both shapes.
 */
export function goalHeaderFragment(goal: string, role: string, flow: BuiltinFlow): string[] {
  return [`/goal ${goal}`, "", roleFragment(role, flow)];
}

/**
 * Bounded lifecycle steps must not open native Codewith `/goal` state. The
 * workflow itself already owns durability and sequencing; each agent step only
 * needs a finite role/objective header plus exact task evidence instructions.
 */
export function boundedStepHeaderFragment(objective: string, role: string, flow: BuiltinFlow): string[] {
  return [`Objective: ${objective}`, "", roleFragment(role, flow)];
}

export function adversarialReviewFragment(inspect: string, focus: string): string {
  return `Use fresh context. Inspect ${inspect}. Act as an adversarial reviewer focused on ${focus}.`;
}

export const DEFAULT_VERIFIER_IDLE_TIMEOUT_MS = 15 * 60_000;

export function verifierIdleTimeoutMs(input: { verifierIdleTimeoutMs?: number }): number | undefined {
  if (input.verifierIdleTimeoutMs === undefined) return DEFAULT_VERIFIER_IDLE_TIMEOUT_MS;
  return input.verifierIdleTimeoutMs > 0 ? input.verifierIdleTimeoutMs : undefined;
}

export function verifierRuntimeGuidance(input: { verifierIdleTimeoutMs?: number }): string {
  const idleTimeout = verifierIdleTimeoutMs(input);
  return [
    "Verifier runtime contract:",
    idleTimeout
      ? `- Loops will mark this verifier timed_out after ${idleTimeout}ms without stdout/stderr. Emit a concise heartbeat/progress line before long checks.`
      : "- The verifier idle watchdog is disabled for this workflow; still emit concise progress before long checks.",
    "- Keep final evidence compact: summarize changed files, validation commands/results, findings, and the task decision instead of pasting bulky logs.",
    "- If validation cannot finish, record a clear blocked/failed task comment with the last completed check and the next concrete action.",
  ].join("\n");
}

function todosPromptCommand(todosProjectPath: string | undefined): string {
  const project = todosProjectPath?.trim();
  return project ? `todos --project ${project}` : "todos";
}

function todosShellCommand(todosProjectPath: string | undefined): string {
  const project = todosProjectPath?.trim();
  return project ? `todos --project ${shellQuote(project)}` : "todos";
}

export function todosInspectLine(todosProjectPath: string | undefined, taskId: string): string {
  return `- Inspect first: ${todosPromptCommand(todosProjectPath)} inspect ${taskId}`;
}

export function todosStartLine(todosProjectPath: string | undefined, taskId: string): string {
  return `- Claim/start if appropriate: ${todosPromptCommand(todosProjectPath)} start ${taskId}`;
}

export function todosEvidenceLine(todosProjectPath: string | undefined, taskId: string, placeholder: string): string {
  return `- Record evidence: ${todosPromptCommand(todosProjectPath)} comment ${taskId} "<${placeholder}>"`;
}

export function todosVerificationLine(todosProjectPath: string | undefined, taskId: string): string {
  return `- Record verification: ${todosPromptCommand(todosProjectPath)} comment ${taskId} "<verification evidence or blocker>"`;
}

export type TaskEvidenceRole = "worker" | "verifier";

export function taskEvidenceMarker(role: TaskEvidenceRole, taskId: string, eventId?: string): string {
  return `openloops:${role}=evidence task=${taskId}${eventId ? ` event=${eventId}` : ""}`;
}

export function todosTaskEvidenceLine(
  todosProjectPath: string | undefined,
  taskId: string,
  role: TaskEvidenceRole,
  marker: string,
  placeholder: string,
): string {
  return `- Record ${role} evidence: ${todosPromptCommand(todosProjectPath)} comment ${taskId} "${marker}\n<${placeholder}>"`;
}

export function todosDoneLine(todosProjectPath: string | undefined, taskId: string): string {
  return `- If valid and complete: ${todosPromptCommand(todosProjectPath)} done ${taskId}`;
}

/** Exact-todos-commands stanza: optional project pin, inspect, then role-specific command lines. */
export function todosExactCommandsFragment(todosProjectPath: string | undefined, taskId: string, commandLines: string[]): string[] {
  const project = todosProjectPath?.trim();
  return [
    project ? `Todos project path: ${project}` : "Todos project path: not specified; use the CLI default without --project.",
    project
      ? "Use these exact todos commands so worktree cwd inference cannot attach to the wrong project:"
      : "Use these exact todos commands and do not invent a --project value:",
    todosInspectLine(todosProjectPath, taskId),
    ...commandLines,
  ];
}

/** Worktree policy PROSE for agent guidance; enforcement is executor-native via target.worktree. */
export function worktreePrompt(plan: AgentWorktreeSpec): string {
  if (plan.enabled) {
    return [
      "Loops worktree policy:",
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
    "Loops worktree policy:",
    `- Worktree mode ${plan.mode} did not select an isolated worktree: ${plan.reason ?? "not enabled"}.`,
    `- Cwd: ${plan.cwd}`,
    "- Do not create ad hoc worktrees unless the task itself explicitly requires one.",
  ].join("\n");
}

export function worktreeContextFragment(plan: AgentWorktreeSpec): Record<string, unknown> {
  return {
    mode: plan.mode,
    enabled: plan.enabled,
    cwd: plan.cwd,
    path: plan.path,
    branch: plan.branch,
    reason: plan.reason,
  };
}

// ---------------------------------------------------------------------------
// Deterministic script assets (bash wrappers and bun heredoc bodies)
// ---------------------------------------------------------------------------

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export interface RoutingRemediationScopeOptions {
  doctorProject?: string;
  tag?: string;
  status?: string;
  shard?: string;
  limit?: string;
}

export interface RoutingRemediationPreflightCommandOptions extends RoutingRemediationScopeOptions {
  todosProjectPath: string;
  doctorJsonPath?: string;
  doctorOutputPath: string;
  preflightOutputPath: string;
  maxRepairs: number;
  dryRun: boolean;
  idempotencyKey: string;
  applyCommand: string;
  /** Where blocker findings are written as evidence instead of being filed as tasks. */
  blockerReportPath: string;
  /** Conversations channel the aggregate blocker summary is posted to. */
  alertChannel?: string;
}

export function routingRemediationDoctorScopeArgs(opts: RoutingRemediationScopeOptions): string[] {
  return [
    opts.doctorProject ? ["--project", opts.doctorProject] : [],
    opts.tag ? ["--tag", opts.tag] : [],
    opts.status ? ["--status", opts.status] : [],
    opts.shard ? ["--shard", opts.shard] : [],
    opts.limit ? ["--limit", opts.limit] : [],
  ].flat();
}

function displayCommand(command: string, args: string[]): string {
  const shellSafe = /^[A-Za-z0-9_./:@%+=,-]+$/;
  return [command, ...args.map((arg) => shellSafe.test(arg) ? arg : shellQuote(arg))].join(" ");
}

export function routingRemediationDoctorCommand(opts: RoutingRemediationScopeOptions & {
  todosProjectPath: string;
  apply?: boolean;
  undoRecordPath?: string;
}): string {
  const args = [
    "--project",
    opts.todosProjectPath,
    "doctor",
    "routing",
    "--json",
    ...(opts.apply ? ["--apply"] : []),
    ...(opts.apply && opts.undoRecordPath ? ["--undo-record", opts.undoRecordPath] : []),
    ...routingRemediationDoctorScopeArgs(opts),
  ];
  return displayCommand("todos", args);
}

const ROUTING_REMEDIATION_PREFLIGHT_SCRIPT = [
  "const { mkdirSync, readFileSync, writeFileSync } = await import('node:fs');",
  "const { dirname } = await import('node:path');",
  "const { spawnSync } = await import('node:child_process');",
  "const env = process.env;",
  "const required = (name) => {",
  "  const value = env[name];",
  "  if (!value || !value.trim()) throw new Error(`${name} is required`);",
  "  return value.trim();",
  "};",
  "const optional = (name) => {",
  "  const value = env[name];",
  "  return value && value.trim() ? value.trim() : undefined;",
  "};",
  "const parseJson = (text, label) => {",
  "  try { return JSON.parse(text || '{}'); } catch (error) { throw new Error(`${label} is not valid JSON: ${error?.message || error}`); }",
  "};",
  "const writeJson = (path, value) => {",
  "  mkdirSync(dirname(path), { recursive: true });",
  "  writeFileSync(path, `${JSON.stringify(value, null, 2)}\\n`);",
  "};",
  "const todosProject = required('OPENLOOPS_ROUTING_REMEDIATION_TODOS_PROJECT');",
  "const doctorJsonPath = optional('OPENLOOPS_ROUTING_REMEDIATION_DOCTOR_JSON');",
  "const doctorOutputPath = required('OPENLOOPS_ROUTING_REMEDIATION_DOCTOR_OUTPUT');",
  "const preflightOutputPath = required('OPENLOOPS_ROUTING_REMEDIATION_PREFLIGHT_OUTPUT');",
  "const idempotencyKey = required('OPENLOOPS_ROUTING_REMEDIATION_IDEMPOTENCY_KEY');",
  "const applyCommand = required('OPENLOOPS_ROUTING_REMEDIATION_APPLY_COMMAND');",
  "const blockerAlertChannel = required('OPENLOOPS_ROUTING_REMEDIATION_ALERT_CHANNEL');",
  "const blockerReportPath = required('OPENLOOPS_ROUTING_REMEDIATION_BLOCKER_REPORT');",
  "const scopeArgs = parseJson(env.OPENLOOPS_ROUTING_REMEDIATION_SCOPE_ARGS || '[]', 'scope args');",
  "if (!Array.isArray(scopeArgs) || !scopeArgs.every((entry) => typeof entry === 'string')) throw new Error('scope args must be a string array');",
  "const maxRepairs = Number(env.OPENLOOPS_ROUTING_REMEDIATION_MAX_REPAIRS || '25');",
  "if (!Number.isInteger(maxRepairs) || maxRepairs < 0) throw new Error('maxRepairs must be a non-negative integer');",
  "const dryRun = !['0', 'false', 'no', 'off'].includes(String(env.OPENLOOPS_ROUTING_REMEDIATION_DRY_RUN || 'true').toLowerCase());",
  "let doctor;",
  "let sourceDoctorRun;",
  "if (doctorJsonPath) {",
  "  doctor = parseJson(readFileSync(doctorJsonPath, 'utf8'), doctorJsonPath);",
  "  sourceDoctorRun = { type: 'file', path: doctorJsonPath };",
  "} else {",
  "  const args = ['--project', todosProject, 'doctor', 'routing', '--json', ...scopeArgs];",
  "  const result = spawnSync('todos', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });",
  "  if (![0, 1].includes(result.status ?? -1)) {",
  "    throw new Error(`todos doctor routing preflight failed status=${result.status ?? 'null'} ${String(result.stderr || result.error || result.stdout).slice(0, 500)}`);",
  "  }",
  "  doctor = parseJson(result.stdout, 'todos doctor routing output');",
  "  sourceDoctorRun = { type: 'command', command: ['todos', ...args].join(' ') };",
  "}",
  "if (doctor.schema_version !== 'todos.routing_doctor.v1') throw new Error(`unsupported routing doctor schema: ${doctor.schema_version || 'missing'}`);",
  "const findings = Array.isArray(doctor.findings) ? doctor.findings : [];",
  "const safeFindings = findings.filter((finding) => finding?.repair_class === 'safe_auto');",
  "const allowedSafeFields = new Set(['working_dir', 'task_list_id']);",
  "const safeFields = safeFindings.map((finding) => String(finding?.suggested_repair?.field || finding?.field || '__missing_safe_field__'));",
  "const unsupportedSafeFields = [...new Set(safeFields.filter((field) => !allowedSafeFields.has(field)))];",
  "const blockerClasses = new Set(['blocker_human', 'blocker_cross_repo', 'blocker_invalid_path', 'unsupported']);",
  "const blockerFindings = findings.filter((finding) => blockerClasses.has(String(finding?.repair_class || '')));",
  "const byCategory = findings.reduce((acc, finding) => {",
  "  const category = String(finding?.category || 'unknown');",
  "  acc[category] = (acc[category] || 0) + 1;",
  "  return acc;",
  "}, {});",
  "const preflight = {",
  "  schema_version: 'openloops.routing_remediation_preflight.v1',",
  "  generated_at: new Date().toISOString(),",
  "  ok: unsupportedSafeFields.length === 0 && safeFindings.length <= maxRepairs,",
  "  dry_run: dryRun,",
  "  idempotency_key: idempotencyKey,",
  "  source_doctor_run: sourceDoctorRun,",
  "  doctor_json_path: doctorOutputPath,",
  "  safe_auto: safeFindings.length,",
  "  blocker_findings: blockerFindings.length,",
  "  unsupported_findings: findings.filter((finding) => finding?.repair_class === 'unsupported').length,",
  "  by_category: byCategory,",
  "  allowed_safe_fields: [...allowedSafeFields],",
  "  unsupported_safe_fields: unsupportedSafeFields,",
  "  capacity: { max_repairs: maxRepairs, requested_repairs: safeFindings.length, allowed: safeFindings.length <= maxRepairs },",
  "  apply_allowed: !dryRun && unsupportedSafeFields.length === 0 && safeFindings.length <= maxRepairs,",
  "  apply_command: applyCommand,",
  "  blocker_alert_channel: blockerAlertChannel,",
  "  blocker_report_path: blockerReportPath,",
  "  blocker_repair_classes: [...blockerClasses],",
  "};",
  "writeJson(doctorOutputPath, doctor);",
  "writeJson(preflightOutputPath, preflight);",
  "// Blocker findings are telemetry, not work: they land in this artifact and are",
  "// summarised once to the alert channel. They must never become todos rows.",
  "const blockerByCategory = blockerFindings.reduce((acc, finding) => {",
  "  const category = String(finding?.category || 'unknown');",
  "  acc[category] = (acc[category] || 0) + 1;",
  "  return acc;",
  "}, {});",
  "writeJson(blockerReportPath, {",
  "  schema_version: 'openloops.routing_remediation_blockers.v1',",
  "  generated_at: preflight.generated_at,",
  "  idempotency_key: idempotencyKey,",
  "  alert_channel: blockerAlertChannel,",
  "  count: blockerFindings.length,",
  "  by_category: blockerByCategory,",
  "  findings: blockerFindings,",
  "});",
  "console.log(JSON.stringify({",
  "  ok: preflight.ok,",
  "  dry_run: preflight.dry_run,",
  "  idempotency_key: preflight.idempotency_key,",
  "  doctor_json_path: preflight.doctor_json_path,",
  "  preflight_output_path: preflightOutputPath,",
  "  safe_auto: preflight.safe_auto,",
  "  blocker_findings: preflight.blocker_findings,",
  "  blocker_report_path: blockerReportPath,",
  "  blocker_alert_channel: blockerAlertChannel,",
  "  unsupported_safe_fields: preflight.unsupported_safe_fields,",
  "  capacity: preflight.capacity,",
  "}));",
  "if (unsupportedSafeFields.length) {",
  "  console.error(`routing remediation preflight blocked unsupported safe_auto fields: ${unsupportedSafeFields.join(', ')}`);",
  "  process.exit(12);",
  "}",
  "if (safeFindings.length > maxRepairs) {",
  "  console.error(`routing remediation preflight blocked capacity: safe_auto=${safeFindings.length} maxRepairs=${maxRepairs}`);",
  "  process.exit(12);",
  "}",
].join("\n");

export function routingRemediationPreflightCommand(opts: RoutingRemediationPreflightCommandOptions): string {
  return [
    "set -euo pipefail",
    `export OPENLOOPS_ROUTING_REMEDIATION_TODOS_PROJECT=${shellQuote(opts.todosProjectPath)}`,
    `export OPENLOOPS_ROUTING_REMEDIATION_DOCTOR_JSON=${shellQuote(opts.doctorJsonPath ?? "")}`,
    `export OPENLOOPS_ROUTING_REMEDIATION_DOCTOR_OUTPUT=${shellQuote(opts.doctorOutputPath)}`,
    `export OPENLOOPS_ROUTING_REMEDIATION_PREFLIGHT_OUTPUT=${shellQuote(opts.preflightOutputPath)}`,
    `export OPENLOOPS_ROUTING_REMEDIATION_IDEMPOTENCY_KEY=${shellQuote(opts.idempotencyKey)}`,
    `export OPENLOOPS_ROUTING_REMEDIATION_MAX_REPAIRS=${shellQuote(String(opts.maxRepairs))}`,
    `export OPENLOOPS_ROUTING_REMEDIATION_DRY_RUN=${shellQuote(opts.dryRun ? "true" : "false")}`,
    `export OPENLOOPS_ROUTING_REMEDIATION_SCOPE_ARGS=${shellQuote(JSON.stringify(routingRemediationDoctorScopeArgs(opts)))}`,
    `export OPENLOOPS_ROUTING_REMEDIATION_APPLY_COMMAND=${shellQuote(opts.applyCommand)}`,
    `export OPENLOOPS_ROUTING_REMEDIATION_BLOCKER_REPORT=${shellQuote(opts.blockerReportPath)}`,
    `export OPENLOOPS_ROUTING_REMEDIATION_ALERT_CHANNEL=${shellQuote(opts.alertChannel ?? ROUTING_REMEDIATION_ALERT_CHANNEL)}`,
    "bun - <<'BUN'",
    ROUTING_REMEDIATION_PREFLIGHT_SCRIPT,
    "BUN",
  ].join("\n");
}

export function sourceTaskGateCommand(todosProjectPath: string | undefined, taskId: string): string {
  const projectLabel = todosProjectPath?.trim() || "default todos resolution";
  return [
    "set -euo pipefail",
    `${todosShellCommand(todosProjectPath)} --json inspect ${shellQuote(taskId)} >/dev/null`,
    `printf "source task %s resolved via %s\\n" ${shellQuote(taskId)} ${shellQuote(projectLabel)}`,
  ].join("\n");
}

export type LifecycleGateStage = "triage" | "planner";

/** Lifecycle gate script asset (bun heredoc body); go/blocked markers are injected between head and tail. */
const LIFECYCLE_GATE_SCRIPT_HEAD = [
  "const raw = process.env.TASK_JSON || '{}';",
  "const payload = JSON.parse(raw);",
  "const task = payload.task && typeof payload.task === 'object' ? payload.task : payload;",
  "const stage = process.env.STAGE || 'lifecycle';",
].join("\n");

const LIFECYCLE_GATE_SCRIPT_TAIL = [
  "const status = String(task.status || '').toLowerCase().replace(/_/g, '-');",
  "const metadata = task.metadata && typeof task.metadata === 'object' ? task.metadata : {};",
  "const automation = metadata.automation && typeof metadata.automation === 'object' ? metadata.automation : {};",
  "const comments = Array.isArray(task.comments) ? task.comments : [];",
  "const blockedStatuses = new Set(['blocked', 'cancelled', 'canceled', 'failed', 'archived', 'deleted', 'done', 'completed']);",
  "const truthy = (value) => value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true' || String(value).toLowerCase() === 'yes';",
  "const falsey = (value) => value === false || value === 0 || value === '0' || String(value).toLowerCase() === 'false' || String(value).toLowerCase() === 'no';",
  "const commentText = (comment) => String(comment?.content ?? comment?.text ?? comment?.body ?? comment?.comment ?? '');",
  "const tagsFrom = (value) => Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(',') : [];",
  "const records = [task, metadata, automation].filter((entry) => entry && typeof entry === 'object');",
  "const tags = new Set(records.flatMap((entry) => [entry.tags, entry.task_tags, entry.taskTags].flatMap(tagsFrom)).map((tag) => tag.trim().toLowerCase()).filter(Boolean));",
  "const markerState = (comment) => {",
  "  const line = commentText(comment).trimStart().split(/\\r?\\n/, 1)[0]?.trimEnd() || '';",
  "  if (line === goMarker) return 'go';",
  "  if (line === blockedMarker) return 'blocked';",
  "  if (line.startsWith(`openloops:${stage}=`)) return `invalid marker: ${line}`;",
  "  return undefined;",
  "};",
  "const markerTime = (comment, index) => {",
  "  const rawTime = comment?.created_at ?? comment?.createdAt ?? comment?.updated_at ?? comment?.updatedAt;",
  "  const parsed = rawTime ? Date.parse(String(rawTime)) : Number.NaN;",
  "  return Number.isFinite(parsed) ? parsed : index;",
  "};",
  "const markers = comments",
  "  .map((comment, index) => ({ state: markerState(comment), order: markerTime(comment, index), index }))",
  "  .filter((entry) => entry.state)",
  "  .sort((a, b) => a.order - b.order || a.index - b.index);",
  "const latestMarker = markers.at(-1)?.state;",
  "const blockers = [];",
  "if (blockedStatuses.has(status)) blockers.push(`task status is ${status}`);",
  "for (const tag of ['no-auto', 'manual', 'manual-required', 'approval-required', 'blocked', 'completed', 'done', 'cancelled', 'canceled', 'failed', 'archived']) {",
  "  if (tags.has(tag)) blockers.push(`task has disallowed tag ${tag}`);",
  "}",
  "for (const [key, source] of records.entries()) {",
  "  if (truthy(source.no_auto) || truthy(source.noAuto)) blockers.push(`${key}.no_auto is true`);",
  "  if (truthy(source.manual) || truthy(source.manual_required) || truthy(source.manualRequired) || String(source.mode || '').toLowerCase() === 'manual') blockers.push(`${key}.manual/mode requires manual handling`);",
  "  if (truthy(source.requires_approval) || truthy(source.requiresApproval) || truthy(source.approval_required) || truthy(source.approvalRequired)) blockers.push(`${key}.requires_approval is true`);",
  "  if (falsey(source.auto) || falsey(source.enabled) || falsey(source.allowed) || falsey(source.automation_allowed) || falsey(source.automationAllowed) || falsey(source.loop_allowed) || falsey(source.loopAllowed)) blockers.push(`${key} disallows loop automation`);",
  "}",
  "if (latestMarker !== 'go') blockers.push(latestMarker ? `latest ${stage} marker is ${latestMarker}` : `missing exact ${goMarker} comment`);",
  "if (blockers.length) {",
  "  console.error(`task lifecycle ${stage} gate blocked ${task.id || task.taskId || 'task'}: ${blockers.join('; ')}`);",
  "  process.exit(12);",
  "}",
  "console.log(`task lifecycle ${stage} gate passed for ${task.id || task.taskId || 'task'} status=${status || 'unknown'}`);",
].join("\n");

export function lifecycleGateCommand(
  todosProjectPath: string | undefined,
  taskId: string,
  stage: LifecycleGateStage,
  goMarker: string,
  blockedMarker: string,
): string {
  return [
    "set -euo pipefail",
    `task_json="$(${todosShellCommand(todosProjectPath)} --json inspect ${shellQuote(taskId)})"`,
    `TASK_JSON="$task_json" STAGE=${shellQuote(stage)} bun - <<'BUN'`,
    LIFECYCLE_GATE_SCRIPT_HEAD,
    `const goMarker = ${JSON.stringify(goMarker)};`,
    `const blockedMarker = ${JSON.stringify(blockedMarker)};`,
    LIFECYCLE_GATE_SCRIPT_TAIL,
    "BUN",
  ].join("\n");
}

const TASK_EVIDENCE_GATE_SCRIPT = [
  "const raw = process.env.TASK_JSON || '{}';",
  "const payload = JSON.parse(raw);",
  "const task = payload.task && typeof payload.task === 'object' ? payload.task : payload;",
  "const status = String(task.status || '').toLowerCase().replace(/_/g, '-');",
  "const taskId = process.env.TASK_ID || String(task.id || task.taskId || 'task');",
  "const workerMarker = process.env.WORKER_MARKER || '';",
  "const verifierMarker = process.env.VERIFIER_MARKER || '';",
  "const completedStatuses = new Set(['completed', 'done']);",
  "const commentText = (comment) => String(comment?.content ?? comment?.text ?? comment?.body ?? comment?.comment ?? '');",
  "const taskComments = Array.isArray(task.comments) ? task.comments : [];",
  "const payloadComments = Array.isArray(payload.comments) ? payload.comments : [];",
  "const comments = taskComments.length ? taskComments : payloadComments;",
  "const markerTime = (comment, index) => {",
  "  const rawTime = comment?.created_at ?? comment?.createdAt ?? comment?.updated_at ?? comment?.updatedAt;",
  "  const parsed = rawTime ? Date.parse(String(rawTime)) : Number.NaN;",
  "  return Number.isFinite(parsed) ? parsed : index;",
  "};",
  "const markerRecord = (marker) => comments",
  "  .map((comment, index) => {",
  "    const text = commentText(comment);",
  "    const firstLine = text.trimStart().split(/\\r?\\n/, 1)[0]?.trimEnd() || '';",
  "    const body = text.trimStart().split(/\\r?\\n/).slice(1).join('\\n').trim();",
  "    return { marker: firstLine, body, order: markerTime(comment, index), index };",
  "  })",
  "  .filter((entry) => entry.marker === marker)",
  "  .sort((a, b) => a.order - b.order || a.index - b.index)",
  "  .at(-1);",
  "const hasEvidenceBody = (entry) => {",
  "  if (!entry) return false;",
  "  if (entry.body.length < 12) return false;",
  "  if (/^<[^>]+>$/.test(entry.body)) return false;",
  "  if (/placeholder|verification evidence or blocker|concise evidence/i.test(entry.body)) return false;",
  "  return true;",
  "};",
  "const worker = markerRecord(workerMarker);",
  "const verifier = markerRecord(verifierMarker);",
  "const blockers = [];",
  "if (!completedStatuses.has(status)) blockers.push(`task status is ${status || 'unknown'}, expected completed/done`);",
  "if (!worker) blockers.push(`missing worker evidence marker: ${workerMarker}`);",
  "else if (!hasEvidenceBody(worker)) blockers.push('worker evidence marker has no concrete non-placeholder body');",
  "if (!verifier) blockers.push(`missing verifier evidence marker: ${verifierMarker}`);",
  "else if (!hasEvidenceBody(verifier)) blockers.push('verifier evidence marker has no concrete non-placeholder body');",
  "if (worker && verifier && verifier.order < worker.order) blockers.push('verifier evidence marker predates worker evidence marker');",
  "if (blockers.length) {",
  "  console.error(`task evidence gate failed for ${taskId}: ${blockers.join('; ')}`);",
  "  process.exit(1);",
  "}",
  "console.log(JSON.stringify({",
  "  ok: true,",
  "  taskId,",
  "  status,",
  "  evidence: {",
  "    worker: { marker: workerMarker, order: worker.order },",
  "    verifier: { marker: verifierMarker, order: verifier.order },",
  "  },",
  "}));",
].join("\n");

export function taskEvidenceGateCommand(
  todosProjectPath: string | undefined,
  taskId: string,
  workerMarker: string,
  verifierMarker: string,
): string {
  return [
    "set -euo pipefail",
    `task_json="$(${todosShellCommand(todosProjectPath)} --json inspect ${shellQuote(taskId)})"`,
    `TASK_JSON="$task_json" TASK_ID=${shellQuote(taskId)} WORKER_MARKER=${shellQuote(workerMarker)} VERIFIER_MARKER=${shellQuote(verifierMarker)} bun - <<'BUN'`,
    TASK_EVIDENCE_GATE_SCRIPT,
    "BUN",
  ].join("\n");
}

/** PR handoff script asset (bun heredoc body); fully env-driven via OPENLOOPS_PR_HANDOFF_*. */
const PR_HANDOFF_SCRIPT = [
  "const { readFileSync, realpathSync } = await import('node:fs');",
  "const { spawnSync } = await import('node:child_process');",
  "const artifactPath = process.env.OPENLOOPS_PR_HANDOFF_ARTIFACT || '';",
  "const taskId = process.env.OPENLOOPS_PR_HANDOFF_TASK_ID || '';",
  "const todosProject = process.env.OPENLOOPS_PR_HANDOFF_TODOS_PROJECT || '';",
  "const fallbackWorktree = process.env.OPENLOOPS_PR_HANDOFF_WORKTREE || process.cwd();",
  "const expectedRoot = process.env.OPENLOOPS_PR_HANDOFF_WORKTREE_ROOT || fallbackWorktree;",
  "const expectedBranch = process.env.OPENLOOPS_PR_HANDOFF_EXPECTED_BRANCH || '';",
  "const todosBin = process.env.OPENLOOPS_PR_HANDOFF_TODOS_BIN || 'todos';",
  "const gitBin = process.env.OPENLOOPS_PR_HANDOFF_GIT_BIN || 'git';",
  "const ghBin = process.env.OPENLOOPS_PR_HANDOFF_GH_BIN || 'gh';",
  "const raw = readFileSync(artifactPath, 'utf8');",
  "const artifact = JSON.parse(raw);",
  "const stringField = (...keys) => {",
  "  for (const key of keys) {",
  "    const value = artifact[key];",
  "    if (typeof value === 'string' && value.trim()) return value.trim();",
  "  }",
  "  return undefined;",
  "};",
  "const scrubUrlCredentials = (value) => String(value || '').replace(/(https?:\\/\\/)[^\\s/@]+:[^\\s/@]+@/gi, '$1').replace(/(https?:\\/\\/)[^\\s/@]+@/gi, '$1');",
  "const run = (command, args, options = {}) => spawnSync(command, args, { encoding: 'utf8', ...options });",
  "const todosArgs = (...args) => todosProject ? ['--project', todosProject, ...args] : args;",
  "const todos = (...args) => run(todosBin, todosArgs(...args));",
  "const comment = (text) => {",
  "  const result = todos('comment', taskId, text);",
  "  if (result.status !== 0) console.error(`failed to comment original task: ${result.stderr || result.stdout || result.status}`);",
  "};",
  "const repoPath = stringField('worktreePath', 'localRepoPath', 'repoPath', 'cwd') || fallbackWorktree;",
  "const artifactTaskId = stringField('taskId', 'sourceTaskId', 'originalTaskId');",
  "const branch = stringField('branch', 'headBranch');",
  "const base = stringField('base', 'baseBranch') || 'main';",
  "const remote = stringField('remote') || 'origin';",
  "let commit = stringField('commit', 'commitSha', 'sha');",
  "const repo = stringField('githubRepo', 'repoSlug', 'repository');",
  "const repoDisplay = scrubUrlCredentials(repo || stringField('repo', 'remoteUrl') || '');",
  "const artifactError = scrubUrlCredentials(artifact.error);",
  "const prUrl = stringField('prUrl', 'pullRequestUrl');",
  "const title = stringField('title', 'prTitle') || `PR handoff for ${taskId}`;",
  "const body = stringField('body', 'prBody') || [",
  "  `Loops PR handoff for task ${taskId}.`,",
  "  `Commit: ${commit || 'unknown'}`,",
  "  `Branch: ${branch || 'unknown'}`,",
  "  artifact.validation ? `Validation: ${artifact.validation}` : undefined,",
  "  artifactError ? `Worker network error: ${artifactError}` : undefined,",
  "].filter(Boolean).join('\\n\\n');",
  "const fingerprint = stringField('fingerprint') || `openloops:pr-handoff:${taskId}:${branch || 'missing-branch'}:${commit || 'missing-commit'}`;",
  "const repoTagSource = (repoDisplay || repoPath).split(/[/:]/).filter(Boolean).at(-1) || 'unknown';",
  "const repoTag = `repo:${repoTagSource.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown'}`;",
  "const metadata = {",
  "  route_enabled: true,",
  "  source: 'openloops.pr-handoff',",
  "  original_task_id: taskId,",
  "  repo: repoDisplay,",
  "  branch: branch || '',",
  "  base,",
  "  commit: commit || '',",
  "  artifact_path: artifactPath,",
  "  fingerprint,",
  "  automation: { allowed: true, mode: 'auto' },",
  "  no_tmux_dispatch: true,",
  "};",
  "const upsertTask = (why) => {",
  "  const safeWhy = scrubUrlCredentials(why);",
  "  const description = [",
  "    `Loops could not complete network PR handoff for original task ${taskId}.`,",
  "    `Reason: ${safeWhy}`,",
  "    `Fingerprint: ${fingerprint}`,",
  "    `Repository: ${repoDisplay || 'unknown'}`,",
  "    `Worktree: ${repoPath}`,",
  "    `Branch: ${branch || 'unknown'}`,",
  "    `Base: ${base}`,",
  "    `Commit: ${commit || 'unknown'}`,",
  "    `Artifact: ${artifactPath}`,",
  "    artifact.validation ? `Validation: ${artifact.validation}` : undefined,",
  "    artifactError ? `Worker error: ${artifactError}` : undefined,",
  "    'Do not rerun implementation work. Push the recorded commit/branch, open or update the PR, then comment the original task with the PR URL and validation evidence.',",
  "  ].filter(Boolean).join('\\n\\n');",
  "  const result = todos(",
  "    'task',",
  "    'upsert',",
  "    '--fingerprint', fingerprint,",
  "    '--title', `PR handoff for ${taskId}`,",
  "    '-d', description,",
  "    '-p', 'high',",
  "    '-t', ['auto:route', 'pr-handoff', 'github', 'network', repoTag].join(','),",
  "    '--metadata-json', JSON.stringify(metadata),",
  "    '--working-dir', repoPath,",
  "  );",
  "  if (result.status !== 0) throw new Error(`todos task upsert failed: ${scrubUrlCredentials(result.stderr || result.stdout || result.status)}`);",
  "  comment(`openloops:pr-handoff=pending task=${taskId} artifact=${artifactPath} fingerprint=${fingerprint} reason=${safeWhy}`);",
  "  console.log(`queued PR handoff task fingerprint=${fingerprint}`);",
  "};",
  "const queueNetworkHandoff = (why) => { upsertTask(why); process.exit(0); };",
  "const invalidArtifact = (why) => {",
  "  comment(`openloops:pr-handoff=invalid task=${taskId} artifact=${artifactPath} reason=${why}`);",
  "  console.error(`invalid PR handoff artifact: ${why}`);",
  "  process.exit(0);",
  "};",
  "const preflightGitHub = () => {",
  "  const probe = run(gitBin, ['-C', repoPath, 'ls-remote', '--heads', remote, base]);",
  "  if (probe.status !== 0) queueNetworkHandoff(`github preflight failed before push/PR: ${String(probe.stderr || probe.stdout || probe.status).slice(0, 300)}`);",
  "};",
  "const canonicalPath = (path) => {",
  "  try { return realpathSync(path); } catch { return path; }",
  "};",
  "if (artifactTaskId && artifactTaskId !== taskId) invalidArtifact(`artifact task id ${artifactTaskId} does not match expected ${taskId}`);",
  "if (!branch || !commit) invalidArtifact('artifact missing branch or commit');",
  "const topLevel = run(gitBin, ['-C', repoPath, 'rev-parse', '--show-toplevel']);",
  "if (topLevel.status !== 0) invalidArtifact(`artifact repoPath is not a git worktree: ${String(topLevel.stderr || topLevel.stdout || topLevel.status).slice(0, 300)}`);",
  "const actualRoot = canonicalPath(String(topLevel.stdout || '').trim());",
  "const wantedRoot = canonicalPath(expectedRoot);",
  "if (actualRoot !== wantedRoot) invalidArtifact(`artifact repo root mismatch: expected ${wantedRoot}, got ${actualRoot}`);",
  "const currentBranch = run(gitBin, ['-C', repoPath, 'branch', '--show-current']);",
  "const actualBranch = String(currentBranch.stdout || '').trim();",
  "if (currentBranch.status !== 0 || !actualBranch) invalidArtifact(`could not resolve current branch for artifact repo: ${String(currentBranch.stderr || currentBranch.stdout || currentBranch.status).slice(0, 300)}`);",
  "if (expectedBranch && branch !== expectedBranch) invalidArtifact(`artifact branch ${branch} does not match expected ${expectedBranch}`);",
  "if (branch !== actualBranch) invalidArtifact(`artifact branch ${branch} does not match current worktree branch ${actualBranch}`);",
  "const resolvedCommit = run(gitBin, ['-C', repoPath, 'rev-parse', '--verify', `${commit}^{commit}`]);",
  "if (resolvedCommit.status !== 0) invalidArtifact(`artifact commit is not present in repo: ${String(resolvedCommit.stderr || resolvedCommit.stdout || resolvedCommit.status).slice(0, 300)}`);",
  "commit = String(resolvedCommit.stdout || commit).trim();",
  "const reachable = run(gitBin, ['-C', repoPath, 'merge-base', '--is-ancestor', commit, 'HEAD']);",
  "if (reachable.status !== 0) invalidArtifact(`artifact commit ${commit} is not reachable from HEAD`);",
  "preflightGitHub();",
  "if (prUrl) {",
  "  const viewed = run(ghBin, ['pr', 'view', prUrl, '--json', 'url,headRefName', '--jq', '.url + \"\\\\n\" + .headRefName']);",
  "  if (viewed.status !== 0) queueNetworkHandoff(`could not verify existing PR URL: ${String(viewed.stderr || viewed.stdout || viewed.status).slice(0, 300)}`);",
  "  const [verifiedUrl, verifiedHead] = String(viewed.stdout || '').trim().split(/\\r?\\n/);",
  "  if (!verifiedUrl || !/^https?:\\/\\//.test(verifiedUrl)) invalidArtifact('verified PR URL was missing or invalid');",
  "  if (verifiedHead && verifiedHead !== branch) invalidArtifact(`verified PR head ${verifiedHead} does not match artifact branch ${branch}`);",
  "  comment(`openloops:pr-handoff=done task=${taskId} pr=${verifiedUrl} commit=${commit} branch=${branch}`);",
  "  console.log(`PR handoff already complete: ${verifiedUrl}`);",
  "  process.exit(0);",
  "}",
  "const push = run(gitBin, ['-C', repoPath, 'push', remote, `${commit}:refs/heads/${branch}`]);",
  "if (push.status !== 0) {",
  "  upsertTask(`git push failed: ${String(push.stderr || push.stdout || push.status).slice(0, 300)}`);",
  "  process.exit(0);",
  "}",
  "const ghRepoArgs = repo ? ['--repo', repo] : [];",
  "const existing = run(ghBin, ['pr', 'list', ...ghRepoArgs, '--head', branch, '--state', 'all', '--json', 'url', '--jq', '.[0].url']);",
  "let finalPrUrl = existing.status === 0 ? String(existing.stdout || '').trim() : '';",
  "if (!finalPrUrl) {",
  "  const created = run(ghBin, ['pr', 'create', ...ghRepoArgs, '--base', base, '--head', branch, '--title', title, '--body', body], { cwd: repoPath });",
  "  if (created.status !== 0) {",
  "    upsertTask(`gh pr create failed: ${String(created.stderr || created.stdout || created.status).slice(0, 300)}`);",
  "    process.exit(0);",
  "  }",
  "  finalPrUrl = String(created.stdout || '').trim().split(/\\r?\\n/).find((line) => /^https?:\\/\\//.test(line)) || String(created.stdout || '').trim();",
  "}",
  "comment(`openloops:pr-handoff=done task=${taskId} pr=${finalPrUrl} commit=${commit} branch=${branch}`);",
  "console.log(`PR handoff complete: ${finalPrUrl}`);",
].join("\n");

/**
 * No-artifact / direct-PR handoff path (bun heredoc body). Workers that push
 * their own branch and open the PR themselves (e.g. cursor workers) write no
 * handoff artifact. Detect that worker-opened PR by head branch and record the
 * same `openloops:pr-handoff=done` evidence the artifact path records, so the
 * verifier's PR-evidence gate is satisfied and the task flows to the merge
 * lane. Always finishes 0 (best-effort): a missing PR or any gh/git/todos error
 * is tolerated, never fails the step. Fully env-driven via OPENLOOPS_PR_HANDOFF_*.
 */
const PR_HANDOFF_NO_ARTIFACT_SCRIPT = [
  "const { spawnSync } = await import('node:child_process');",
  "const artifactPath = process.env.OPENLOOPS_PR_HANDOFF_ARTIFACT || '';",
  "const taskId = process.env.OPENLOOPS_PR_HANDOFF_TASK_ID || '';",
  "const todosProject = process.env.OPENLOOPS_PR_HANDOFF_TODOS_PROJECT || '';",
  "const worktree = process.env.OPENLOOPS_PR_HANDOFF_WORKTREE || process.cwd();",
  "const expectedBranch = process.env.OPENLOOPS_PR_HANDOFF_EXPECTED_BRANCH || '';",
  "const todosBin = process.env.OPENLOOPS_PR_HANDOFF_TODOS_BIN || 'todos';",
  "const gitBin = process.env.OPENLOOPS_PR_HANDOFF_GIT_BIN || 'git';",
  "const ghBin = process.env.OPENLOOPS_PR_HANDOFF_GH_BIN || 'gh';",
  "process.stdout.write(`no PR handoff artifact at ${artifactPath}\\n`);",
  "const run = (command, args, options = {}) => {",
  "  try { return spawnSync(command, args, { encoding: 'utf8', ...options }); }",
  "  catch (error) { return { status: 1, stdout: '', stderr: String((error && error.message) || error) }; }",
  "};",
  "const todosArgs = (...args) => todosProject ? ['--project', todosProject, ...args] : args;",
  "const comment = (text) => {",
  "  const result = run(todosBin, todosArgs('comment', taskId, text));",
  "  if (result.status !== 0) console.error(`failed to comment original task: ${result.stderr || result.stdout || result.status}`);",
  "};",
  "const scrubUrlCredentials = (value) => String(value || '').replace(/(https?:\\/\\/)[^\\s/@]+@/gi, '$1').replace(/(https?:\\/\\/)[^\\s/@]+:[^\\s/@]+@/gi, '$1');",
  "const upsertTask = (why, branch, commit, remoteUrl) => {",
  "  const safeWhy = scrubUrlCredentials(why);",
  "  const displayRemoteUrl = scrubUrlCredentials(remoteUrl);",
  "  const fingerprint = `openloops:pr-handoff:${taskId}:${branch || 'missing-branch'}:${commit || 'missing-commit'}`;",
  "  const repoTagSource = String(displayRemoteUrl || worktree).split(/[/:]/).filter(Boolean).at(-1) || 'unknown';",
  "  const repoTag = `repo:${repoTagSource.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown'}`;",
  "  const metadata = { route_enabled: true, source: 'openloops.pr-handoff', original_task_id: taskId, repo: displayRemoteUrl || '', branch: branch || '', commit: commit || '', fingerprint, automation: { allowed: true, mode: 'auto' }, no_tmux_dispatch: true };",
  "  const description = [",
  "    `Loops could not complete no-artifact PR handoff for original task ${taskId}.`,",
  "    `Reason: ${safeWhy}`,",
  "    `Fingerprint: ${fingerprint}`,",
  "    `Repository: ${displayRemoteUrl || 'unknown'}`,",
  "    `Worktree: ${worktree}`,",
  "    `Branch: ${branch || 'unknown'}`,",
  "    `Commit: ${commit || 'unknown'}`,",
  "    'Do not rerun implementation work. Use the recorded worktree/branch/commit to verify or create the PR, then comment the original task with the PR URL and validation evidence.',",
  "  ].filter(Boolean).join('\\n\\n');",
  "  const result = run(todosBin, todosArgs('task', 'upsert', '--fingerprint', fingerprint, '--title', `PR handoff for ${taskId}`, '-d', description, '-p', 'high', '-t', ['auto:route', 'pr-handoff', 'github', 'network', repoTag].join(','), '--metadata-json', JSON.stringify(metadata), '--working-dir', worktree));",
  "  if (result.status !== 0) {",
  "    const upsertError = scrubUrlCredentials(result.stderr || result.stdout || result.status);",
  "    console.error(`todos task upsert failed: ${upsertError}`);",
  "    comment(`openloops:pr-handoff=failed task=${taskId} fingerprint=${fingerprint} reason=todos-upsert-failed detail=${String(upsertError).slice(0, 300)}`);",
  "    return;",
  "  }",
  "  comment(`openloops:pr-handoff=pending task=${taskId} fingerprint=${fingerprint} reason=${safeWhy}`);",
  "  console.log(`queued PR handoff task fingerprint=${fingerprint}`);",
  "};",
  "const main = () => {",
  "  let branch = expectedBranch;",
  "  if (!branch) {",
  "    const shown = run(gitBin, ['-C', worktree, 'branch', '--show-current']);",
  "    branch = String((shown.status === 0 ? shown.stdout : '') || '').trim();",
  "  }",
  "  if (!branch) { console.log('pr-handoff: no artifact and no resolvable branch; nothing to hand off'); return; }",
  "  const head = run(gitBin, ['-C', worktree, 'rev-parse', 'HEAD']);",
  "  const commitFromHead = String((head.status === 0 ? head.stdout : '') || '').trim();",
  "  const remoteUrlResult = run(gitBin, ['-C', worktree, 'remote', 'get-url', 'origin']);",
  "  const remoteUrl = String((remoteUrlResult.status === 0 ? remoteUrlResult.stdout : '') || '').trim();",
  "  if (remoteUrl) {",
  "    const probe = run(gitBin, ['-C', worktree, 'ls-remote', '--heads', 'origin', branch]);",
  "    if (probe.status !== 0) { upsertTask(`github preflight failed before PR lookup: ${String(probe.stderr || probe.stdout || probe.status).slice(0, 300)}`, branch, commitFromHead, remoteUrl); return; }",
  "  }",
  "  const listed = run(ghBin, ['pr', 'list', '--head', branch, '--state', 'open', '--json', 'url,number,headRefName,headRefOid'], { cwd: worktree });",
  "  if (listed.status !== 0) {",
  "    const reason = `gh PR lookup failed for branch ${branch}: ${String(listed.stderr || listed.stdout || listed.status).slice(0, 300)}`;",
  "    if (remoteUrl) upsertTask(reason, branch, commitFromHead, remoteUrl);",
  "    else console.log(`pr-handoff: no artifact; PR lookup failed for branch ${branch}: ${String(listed.stderr || listed.stdout || listed.status).slice(0, 300)}`);",
  "    return;",
  "  }",
  "  let prs = [];",
  "  try { prs = JSON.parse(String(listed.stdout || '[]')); } catch { prs = []; }",
  "  const pr = Array.isArray(prs) ? prs.find((entry) => entry && entry.headRefName === branch && typeof entry.url === 'string' && entry.url) : undefined;",
  "  if (!pr) { console.log(`pr-handoff: no artifact and no open PR for branch ${branch}; worker completed without opening a PR`); return; }",
  "  let commit = String(pr.headRefOid || '').trim();",
  "  if (!commit) commit = commitFromHead;",
  "  comment(`openloops:pr-handoff=done task=${taskId} pr=${pr.url} commit=${commit || 'unknown'} branch=${branch}`);",
  "  console.log(`PR handoff complete (worker-opened PR): ${pr.url}`);",
  "};",
  "try { main(); } catch (error) { console.error(`pr-handoff no-artifact detection error (ignored): ${String((error && error.message) || error)}`); }",
].join("\n");

export interface PrHandoffCommandOptions {
  artifactPath: string;
  taskId: string;
  todosProjectPath?: string;
  worktreeCwd: string;
  worktreeRoot: string;
  expectedBranch: string;
}

export function prHandoffCommand(opts: PrHandoffCommandOptions): string {
  return [
    "set -euo pipefail",
    `export OPENLOOPS_PR_HANDOFF_ARTIFACT=${shellQuote(opts.artifactPath)}`,
    `export OPENLOOPS_PR_HANDOFF_TASK_ID=${shellQuote(opts.taskId)}`,
    `export OPENLOOPS_PR_HANDOFF_TODOS_PROJECT=${shellQuote(opts.todosProjectPath?.trim() || "")}`,
    `export OPENLOOPS_PR_HANDOFF_WORKTREE=${shellQuote(opts.worktreeCwd)}`,
    `export OPENLOOPS_PR_HANDOFF_WORKTREE_ROOT=${shellQuote(opts.worktreeRoot)}`,
    `export OPENLOOPS_PR_HANDOFF_EXPECTED_BRANCH=${shellQuote(opts.expectedBranch)}`,
    // Never `exit` explicitly from this login shell (`bash -lc`): with `set -e`
    // active, a failing ~/.bash_logout — e.g. `clear_console` with no
    // controlling TTY when the daemon runs under systemd with SHLVL=1 — hands
    // its own non-zero status back as the shell's exit code, overriding an
    // explicit `exit 0`. That is what marked the no-artifact path failed
    // (exit 1) and skipped the verifier. Both branches instead fall through to
    // the natural end of the `if`, which preserves the intended status (matching
    // the gate steps, which already end naturally). Covered by templates.test.ts.
    "if [ ! -s \"$OPENLOOPS_PR_HANDOFF_ARTIFACT\" ]; then",
    "bun - <<'OPENLOOPS_PR_HANDOFF_NOARTIFACT'",
    PR_HANDOFF_NO_ARTIFACT_SCRIPT,
    "OPENLOOPS_PR_HANDOFF_NOARTIFACT",
    "else",
    "bun - <<'BUN'",
    PR_HANDOFF_SCRIPT,
    "BUN",
    "fi",
  ].join("\n");
}
