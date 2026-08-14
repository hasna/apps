export interface WorkflowPromptArgument {
  name: string;
  description: string;
  required: boolean;
}

export interface WorkflowPromptDefinition {
  id: string;
  title: string;
  description: string;
  arguments: WorkflowPromptArgument[];
  tags: string[];
  template: string;
}

export interface WorkflowPromptRenderInput {
  objective?: string;
  task_id?: string;
  agent_id?: string;
  context?: string;
}

export interface WorkflowPromptRender {
  id: string;
  title: string;
  description: string;
  local_only: true;
  messages: Array<{ role: "user"; content: { type: "text"; text: string } }>;
}

const COMMON_ARGUMENTS: WorkflowPromptArgument[] = [
  { name: "objective", description: "Goal, request, incident, or review objective.", required: false },
  { name: "task_id", description: "Optional local task ID to ground the workflow.", required: false },
  { name: "agent_id", description: "Optional local agent identity.", required: false },
  { name: "context", description: "Optional pasted local context, logs, or notes.", required: false },
];

export const WORKFLOW_PROMPTS: WorkflowPromptDefinition[] = [
  {
    id: "goal_planning",
    title: "/goal planning",
    description: "Turn a goal into local tasks, dependencies, acceptance criteria, and verification steps.",
    arguments: COMMON_ARGUMENTS,
    tags: ["goal", "planning", "tasks"],
    template: "Create a local execution plan for the objective. Break it into tasks, dependencies, acceptance criteria, and verification commands. Keep all actions local-first and call out any approval gates before risky work.",
  },
  {
    id: "task_claiming",
    title: "Task claiming",
    description: "Choose and claim the next ready local task without bypassing blockers or locks.",
    arguments: COMMON_ARGUMENTS,
    tags: ["claim", "queue", "agents"],
    template: "Inspect ready tasks, dependencies, locks, and current agent focus. Recommend the next local task to claim and explain why blocked or duplicate tasks should stay untouched.",
  },
  {
    id: "review",
    title: "Review workflow",
    description: "Review task evidence, changed files, tests, and requested changes using local state.",
    arguments: COMMON_ARGUMENTS,
    tags: ["review", "evidence", "quality"],
    template: "Review the local task evidence and changed files. Prioritize correctness, regressions, missing tests, security risk, and whether acceptance criteria are actually proven.",
  },
  {
    id: "verification",
    title: "Verification workflow",
    description: "Plan and record local verification commands, artifacts, and failure follow-up.",
    arguments: COMMON_ARGUMENTS,
    tags: ["verification", "tests", "evidence"],
    template: "Design a verification pass for the task. Include focused tests, full-suite or boundary checks when needed, artifact capture, and how to record pass/fail evidence locally.",
  },
  {
    id: "handoff",
    title: "Handoff workflow",
    description: "Create a concise local handoff with current state, blockers, files, commands, and next steps.",
    arguments: COMMON_ARGUMENTS,
    tags: ["handoff", "continuation", "agents"],
    template: "Prepare a local agent handoff. Include completed work, exact files and commands, open blockers, remaining risks, and the next safe action.",
  },
  {
    id: "release_prep",
    title: "Release preparation",
    description: "Prepare a local package release checklist with compatibility, install, and rollback checks.",
    arguments: COMMON_ARGUMENTS,
    tags: ["release", "package", "verification"],
    template: "Build a release preparation checklist from local evidence. Cover compatibility, package exports, no-cloud boundaries, install/update verification, changelog notes, and rollback guidance.",
  },
  {
    id: "import_triage",
    title: "Import triage",
    description: "Triage imported issues, logs, or Markdown into deduped local tasks.",
    arguments: COMMON_ARGUMENTS,
    tags: ["imports", "triage", "dedupe"],
    template: "Triage the imported local data. Identify duplicates, source links, redaction needs, task grouping, priorities, and safe dry-run/apply steps.",
  },
  {
    id: "incident_response",
    title: "Incident response",
    description: "Coordinate local incident investigation, evidence, mitigation, and follow-up tasks.",
    arguments: COMMON_ARGUMENTS,
    tags: ["incident", "ops", "evidence"],
    template: "Run an incident response workflow. Establish impact, timeline, suspected causes, immediate mitigation, verification, evidence capture, and follow-up tasks.",
  },
];

export function listWorkflowPrompts(): WorkflowPromptDefinition[] {
  return WORKFLOW_PROMPTS.map((prompt) => ({ ...prompt, arguments: [...prompt.arguments], tags: [...prompt.tags] }));
}

export function getWorkflowPrompt(id: string): WorkflowPromptDefinition | null {
  const normalized = id.trim().toLowerCase().replace(/[-\s]+/g, "_");
  return listWorkflowPrompts().find((prompt) => prompt.id === normalized) || null;
}

function renderContext(input: WorkflowPromptRenderInput): string {
  const lines = [
    input.objective ? `Objective: ${input.objective}` : null,
    input.task_id ? `Task ID: ${input.task_id}` : null,
    input.agent_id ? `Agent: ${input.agent_id}` : null,
    input.context ? `Context:\n${input.context}` : null,
  ].filter(Boolean);
  return lines.length ? `\n\n${lines.join("\n")}` : "";
}

export function renderWorkflowPrompt(id: string, input: WorkflowPromptRenderInput = {}): WorkflowPromptRender {
  const prompt = getWorkflowPrompt(id);
  if (!prompt) throw new Error(`Unknown workflow prompt: ${id}`);
  return {
    id: prompt.id,
    title: prompt.title,
    description: prompt.description,
    local_only: true,
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `${prompt.template}${renderContext(input)}`,
      },
    }],
  };
}

export function renderWorkflowPromptMarkdown(id: string, input: WorkflowPromptRenderInput = {}): string {
  const rendered = renderWorkflowPrompt(id, input);
  return [
    `# ${rendered.title}`,
    "",
    rendered.description,
    "",
    "```text",
    rendered.messages[0]!.content.text,
    "```",
  ].join("\n");
}
