import type {
  AccountRef,
  AgentPermissionMode,
  AgentProvider,
  AgentSandbox,
  CreateWorkflowInput,
  LoopTemplateSummary,
  WorkflowStep,
} from "../types.js";

export const TODOS_TASK_WORKER_VERIFIER_TEMPLATE_ID = "todos-task-worker-verifier";
export const EVENT_WORKER_VERIFIER_TEMPLATE_ID = "event-worker-verifier";
export const BOUNDED_AGENT_WORKER_VERIFIER_TEMPLATE_ID = "bounded-agent-worker-verifier";

export interface TodosTaskWorkflowTemplateInput {
  taskId: string;
  taskTitle?: string;
  taskDescription?: string;
  projectPath: string;
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
  permissionMode?: AgentPermissionMode;
  sandbox?: AgentSandbox;
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
  permissionMode?: AgentPermissionMode;
  sandbox?: AgentSandbox;
}

export interface BoundedAgentWorkflowTemplateInput {
  name?: string;
  objective: string;
  prompt?: string;
  projectPath: string;
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
  permissionMode?: AgentPermissionMode;
  sandbox?: AgentSandbox;
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
      { name: "provider", default: "codewith", description: "Agent provider: codewith, claude, cursor, opencode, aicopilot, or codex." },
      { name: "authProfile", description: "Provider-native auth profile, currently Codewith." },
      { name: "authProfilePool", description: "Comma-separated provider-native auth profiles; worker/verifier are selected deterministically." },
      { name: "workerAuthProfile", description: "Provider-native auth profile for the worker step." },
      { name: "verifierAuthProfile", description: "Provider-native auth profile for the verifier step." },
      { name: "accountPool", description: "Comma-separated OpenAccounts profiles; worker/verifier are selected deterministically." },
      { name: "model", description: "Provider model." },
      { name: "variant", description: "Provider reasoning/model effort variant." },
      { name: "permissionMode", default: "bypass", description: "Provider permission mode: default, plan, auto, or bypass." },
      { name: "sandbox", default: "danger-full-access", description: "Provider sandbox mode." },
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
      { name: "provider", default: "codewith", description: "Agent provider: codewith, claude, cursor, opencode, aicopilot, or codex." },
      { name: "authProfile", description: "Provider-native auth profile, currently Codewith." },
      { name: "authProfilePool", description: "Comma-separated provider-native auth profiles; worker/verifier are selected deterministically." },
      { name: "workerAuthProfile", description: "Provider-native auth profile for the worker step." },
      { name: "verifierAuthProfile", description: "Provider-native auth profile for the verifier step." },
      { name: "accountPool", description: "Comma-separated OpenAccounts profiles; worker/verifier are selected deterministically." },
      { name: "model", description: "Provider model." },
      { name: "variant", description: "Provider reasoning/model effort variant." },
      { name: "permissionMode", default: "bypass", description: "Provider permission mode: default, plan, auto, or bypass." },
      { name: "sandbox", default: "danger-full-access", description: "Provider sandbox mode." },
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
      { name: "provider", default: "codewith", description: "Agent provider: codewith, claude, cursor, opencode, aicopilot, or codex." },
      { name: "authProfile", description: "Provider-native auth profile, currently Codewith." },
      { name: "authProfilePool", description: "Comma-separated provider-native auth profiles; worker/verifier are selected deterministically." },
      { name: "workerAuthProfile", description: "Provider-native auth profile for the worker step." },
      { name: "verifierAuthProfile", description: "Provider-native auth profile for the verifier step." },
      { name: "accountPool", description: "Comma-separated OpenAccounts profiles; worker/verifier are selected deterministically." },
      { name: "model", description: "Provider model." },
      { name: "variant", description: "Provider reasoning/model effort variant." },
      { name: "permissionMode", default: "bypass", description: "Provider permission mode: default, plan, auto, or bypass." },
      { name: "sandbox", default: "danger-full-access", description: "Provider sandbox mode." },
      { name: "timeoutMs", default: "2700000", description: "Step timeout in milliseconds." },
    ],
  },
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
  | "permissionMode"
  | "sandbox"
>;

type AgentWorkflowRole = "worker" | "verifier";

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

function agentTarget(
  input: AgentWorkflowTemplateInput,
  prompt: string,
  role: AgentWorkflowRole,
  seed: string,
): WorkflowStep["target"] {
  const provider = input.provider ?? "codewith";
  assertNativeAuthProfileSupport(input, provider);
  const sandbox =
    input.sandbox ??
    (provider === "codewith" || provider === "codex"
      ? "danger-full-access"
      : provider === "cursor"
        ? "disabled"
        : undefined);
  return {
    type: "agent",
    provider,
    prompt,
    cwd: input.projectPath,
    model: input.model,
    variant: input.variant,
    agent: input.agent,
    authProfile: provider === "codewith" ? authProfileForRole(input, role, seed) : undefined,
    configIsolation: "safe",
    permissionMode: input.permissionMode ?? "bypass",
    sandbox,
    account: accountForRole(input, role, seed),
    timeoutMs: 45 * 60_000,
  };
}

export function listLoopTemplates(): LoopTemplateSummary[] {
  return TEMPLATE_SUMMARIES.map((template) => structuredClone(template));
}

export function getLoopTemplate(id: string): LoopTemplateSummary | undefined {
  return listLoopTemplates().find((template) => template.id === id || template.name === id);
}

export function renderTodosTaskWorkerVerifierWorkflow(input: TodosTaskWorkflowTemplateInput): CreateWorkflowInput {
  if (!input.taskId?.trim()) throw new Error("taskId is required");
  if (!input.projectPath?.trim()) throw new Error("projectPath is required");
  const taskContext = {
    taskId: input.taskId,
    taskTitle: input.taskTitle,
    taskDescription: input.taskDescription,
    eventId: input.eventId,
    eventType: input.eventType,
    projectPath: input.projectPath,
  };
  const workerPrompt = [
    `/goal Complete todos task ${input.taskId} in ${input.projectPath}.`,
    "",
    "You are the worker agent for a task-triggered OpenLoops workflow.",
    "Investigate first before changing files. Use the todos CLI as the source of truth for the task.",
    "Claim/start the task if appropriate, inspect the repository/project state, implement only the task scope, run focused validation, preserve unrelated user changes, and update the task with comments, evidence, changed files, commits, and blockers.",
    "Do not dispatch or paste prompts into tmux panes. If additional work is required, create or update deduped todos tasks so task-created routing can start a fresh headless workflow.",
    "Do not mark the task complete unless the work is genuinely done and validated.",
    "",
    `Task context JSON: ${compactJson(taskContext)}`,
  ].join("\n");
  const verifierPrompt = [
    `/goal Verify todos task ${input.taskId} after the worker step.`,
    "",
    "You are the verifier agent for a task-triggered OpenLoops workflow.",
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
    steps: [
      {
        id: "worker",
        name: "Worker",
        description: "Implement the todos task and record evidence.",
        target: agentTarget(input, workerPrompt, "worker", input.taskId),
        timeoutMs: 45 * 60_000,
      },
      {
        id: "verifier",
        name: "Verifier",
        description: "Adversarially verify worker output and update todos.",
        dependsOn: ["worker"],
        target: agentTarget(input, verifierPrompt, "verifier", input.taskId),
        timeoutMs: 30 * 60_000,
      },
    ],
  };
}

export function renderEventWorkerVerifierWorkflow(input: EventWorkflowTemplateInput): CreateWorkflowInput {
  if (!input.eventId?.trim()) throw new Error("eventId is required");
  if (!input.eventType?.trim()) throw new Error("eventType is required");
  if (!input.eventSource?.trim()) throw new Error("eventSource is required");
  if (!input.eventJson?.trim()) throw new Error("eventJson is required");
  if (!input.projectPath?.trim()) throw new Error("projectPath is required");
  const eventContext = {
    eventId: input.eventId,
    eventType: input.eventType,
    eventSource: input.eventSource,
    eventSubject: input.eventSubject,
    eventMessage: input.eventMessage,
    projectPath: input.projectPath,
  };
  const workerPrompt = [
    `/goal Handle Hasna event ${input.eventSource}/${input.eventType} (${input.eventId}) in ${input.projectPath}.`,
    "",
    "You are the worker agent for an event-triggered OpenLoops workflow.",
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
    steps: [
      {
        id: "worker",
        name: "Worker",
        description: "Handle the Hasna event and record evidence.",
        target: agentTarget(input, workerPrompt, "worker", `${input.eventSource}:${input.eventType}:${input.eventId}`),
        timeoutMs: 45 * 60_000,
      },
      {
        id: "verifier",
        name: "Verifier",
        description: "Adversarially verify event handling.",
        dependsOn: ["worker"],
        target: agentTarget(input, verifierPrompt, "verifier", `${input.eventSource}:${input.eventType}:${input.eventId}`),
        timeoutMs: 30 * 60_000,
      },
    ],
  };
}

export function renderBoundedAgentWorkerVerifierWorkflow(input: BoundedAgentWorkflowTemplateInput): CreateWorkflowInput {
  if (!input.objective?.trim()) throw new Error("objective is required");
  if (!input.projectPath?.trim()) throw new Error("projectPath is required");
  const seed = `${input.projectPath}:${input.objective}`;
  const timeoutMs = input.timeoutMs && Number.isFinite(input.timeoutMs) ? input.timeoutMs : 45 * 60_000;
  const workerPrompt = [
    `/goal ${input.objective}`,
    "",
    "You are the worker step for a bounded OpenLoops agent workflow.",
    "Investigate first. Keep scope narrow, use local project/task systems as the source of truth when relevant, preserve unrelated changes, run focused validation, and record concise evidence.",
    "Do not dispatch or paste prompts into tmux panes. If additional work is required, create or update deduped todos tasks so task-created routing can start a fresh headless workflow.",
    input.prompt ? "" : undefined,
    input.prompt,
  ].filter(Boolean).join("\n");
  const verifierPrompt = [
    `/goal Adversarially verify: ${input.objective}`,
    "",
    "You are the verifier step for a bounded OpenLoops agent workflow.",
    "Use fresh context. Review the worker result for correctness, regressions, missing tests, safety, runaway-agent risk, output bounds, and incomplete evidence.",
    "If valid, record verification evidence. If invalid, create precise follow-up tasks or comments and leave the original work open. Do not make broad unrelated changes.",
  ].join("\n");

  return {
    name: input.name ?? `bounded-agent-${stableIndex(seed, 0xffffffff).toString(16).padStart(8, "0")}-worker-verifier`,
    description: `Bounded worker/verifier workflow for ${input.objective.slice(0, 180)}`,
    version: 1,
    steps: [
      {
        id: "worker",
        name: "Worker",
        description: "Execute the bounded objective and record evidence.",
        target: agentTarget(input, workerPrompt, "worker", seed),
        timeoutMs,
      },
      {
        id: "verifier",
        name: "Verifier",
        description: "Adversarially verify the bounded objective result.",
        dependsOn: ["worker"],
        target: agentTarget(input, verifierPrompt, "verifier", seed),
        timeoutMs: Math.min(timeoutMs, 30 * 60_000),
      },
    ],
  };
}

export function renderLoopTemplate(id: string, values: Record<string, string | undefined>): CreateWorkflowInput {
  if (id === TODOS_TASK_WORKER_VERIFIER_TEMPLATE_ID) {
    return renderTodosTaskWorkerVerifierWorkflow({
      taskId: values.taskId ?? "",
      taskTitle: values.taskTitle,
      taskDescription: values.taskDescription,
      projectPath: values.projectPath ?? values.cwd ?? process.cwd(),
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
      permissionMode: values.permissionMode as AgentPermissionMode | undefined,
      sandbox: values.sandbox as AgentSandbox | undefined,
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
      permissionMode: values.permissionMode as AgentPermissionMode | undefined,
      sandbox: values.sandbox as AgentSandbox | undefined,
    });
  }
  if (id === BOUNDED_AGENT_WORKER_VERIFIER_TEMPLATE_ID) {
    return renderBoundedAgentWorkerVerifierWorkflow({
      name: values.name,
      objective: values.objective ?? "",
      prompt: values.prompt,
      projectPath: values.projectPath ?? values.cwd ?? process.cwd(),
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
      permissionMode: values.permissionMode as AgentPermissionMode | undefined,
      sandbox: values.sandbox as AgentSandbox | undefined,
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

function accountPoolVar(value: string | undefined, tool?: string): AccountRef[] | undefined {
  return listVar(value)?.map((profile) => ({ profile, tool }));
}
