import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { AgentTarget, CreateWorkflowInput, WorkflowStepInput } from "../types.js";
import {
  BOUNDED_AGENT_WORKER_VERIFIER_TEMPLATE_ID,
  DETERMINISTIC_CHECK_CREATE_TASK_TEMPLATE_ID,
  EVENT_WORKER_VERIFIER_TEMPLATE_ID,
  INCIDENT_RESPONSE_TEMPLATE_ID,
  KNOWLEDGE_REFRESH_TEMPLATE_ID,
  PR_REVIEW_TEMPLATE_ID,
  REPORT_ONLY_TEMPLATE_ID,
  SCHEDULED_AUDIT_TEMPLATE_ID,
  TASK_LIFECYCLE_TEMPLATE_ID,
  TODOS_TASK_WORKER_VERIFIER_TEMPLATE_ID,
  importCustomLoopTemplate,
  listLoopTemplates,
  renderBoundedAgentWorkerVerifierWorkflow,
  renderLoopTemplate,
  renderTaskLifecycleWorkflow,
  renderTodosTaskWorkerVerifierWorkflow,
  validateCustomLoopTemplateFile,
} from "./templates.js";

let fixtureRoot: string;
let repoPath: string;
let resolvedRepoRoot: string;
let plainPath: string;
let worktreeRoot: string;
let previousDataDir: string | undefined;

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "loops-templates-test-"));
  repoPath = join(fixtureRoot, "repo");
  plainPath = join(fixtureRoot, "plain");
  worktreeRoot = join(fixtureRoot, "worktrees");
  mkdirSync(repoPath, { recursive: true });
  mkdirSync(plainPath, { recursive: true });
  mkdirSync(join(fixtureRoot, "data"), { recursive: true });
  execFileSync("git", ["init", "-q", repoPath]);
  resolvedRepoRoot = execFileSync("git", ["-C", repoPath, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  previousDataDir = process.env.LOOPS_DATA_DIR;
  process.env.LOOPS_DATA_DIR = join(fixtureRoot, "data");
});

afterAll(() => {
  if (previousDataDir === undefined) delete process.env.LOOPS_DATA_DIR;
  else process.env.LOOPS_DATA_DIR = previousDataDir;
  rmSync(fixtureRoot, { recursive: true, force: true });
});

/** Mirrors the template worktree seed hash so machine-dependent path hashes can be normalized. */
function stableHex(seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (Math.abs(hash >>> 0) % 0xffffffff).toString(16).padStart(8, "0");
}

function agentSteps(workflow: CreateWorkflowInput): WorkflowStepInput[] {
  return workflow.steps.filter((step) => step.target.type === "agent");
}

function stepById(workflow: CreateWorkflowInput, id: string): WorkflowStepInput {
  const step = workflow.steps.find((entry) => entry.id === id);
  if (!step) throw new Error(`missing step ${id} in ${workflow.name}`);
  return step;
}

function agentTargetOf(step: WorkflowStepInput): AgentTarget {
  if (step.target.type !== "agent" || !("prompt" in step.target)) throw new Error(`step ${step.id} is not a prompt agent step`);
  return step.target;
}

function commandOf(step: WorkflowStepInput): string {
  if (step.target.type !== "command") throw new Error(`step ${step.id} is not a command step`);
  return step.target.args?.[1] ?? "";
}

/** Replaces machine-dependent fixture paths and seed hashes so snapshots stay stable across machines. */
function normalized(workflow: CreateWorkflowInput, seeds: string[] = []): string {
  let text = JSON.stringify(workflow, null, 2);
  const replacements: Array<[string, string]> = [
    ...seeds.map((seed): [string, string] => [stableHex(`${resolvedRepoRoot}:${seed}`), "<HASH>"]),
    [resolvedRepoRoot, "<REPO>"],
    [repoPath, "<REPO>"],
    [fixtureRoot, "<FIXTURE>"],
  ];
  for (const [from, to] of replacements) {
    text = text.replaceAll(from, to);
  }
  return text;
}

describe("prompt fragment composition", () => {
  const workflow = renderTodosTaskWorkerVerifierWorkflow({
    taskId: "task-1200",
    taskTitle: "Fix login",
    projectPath: "REPO_PLACEHOLDER",
    todosProjectPath: "/srv/todos",
    worktreeMode: "off",
  });
  const workerPrompt = agentTargetOf(stepById(workflow, "worker")).prompt;
  const verifierPrompt = agentTargetOf(stepById(workflow, "verifier")).prompt;

  test("worker prompt composes goal header, worktree policy, and exact todos commands in order", () => {
    expect(workerPrompt.startsWith("/goal Complete todos task task-1200 in REPO_PLACEHOLDER.\n\nYou are the worker agent for a task-triggered OpenLoops workflow.")).toBe(true);
    const lines = workerPrompt.split("\n");
    const stanzaStart = lines.indexOf("Use these exact todos commands so worktree cwd inference cannot attach to the wrong project:");
    expect(stanzaStart).toBeGreaterThan(0);
    expect(lines[stanzaStart - 1]).toBe("Todos project path: /srv/todos");
    expect(lines[stanzaStart + 1]).toBe("- Inspect first: todos --project /srv/todos inspect task-1200");
    expect(lines[stanzaStart + 2]).toBe("- Claim/start if appropriate: todos --project /srv/todos start task-1200");
    expect(lines[stanzaStart + 3]).toBe('- Record evidence: todos --project /srv/todos comment task-1200 "<concise evidence and blockers>"');
  });

  test("worker prompt keeps the no-tmux and completion-ownership stanzas", () => {
    expect(workerPrompt).toContain("Do not dispatch or paste prompts into tmux panes.");
    expect(workerPrompt).toContain("Do not mark the task complete in the worker step; the verifier step owns completion after independent validation.");
  });

  test("verifier prompt gets verification/done commands but not the claim/start command", () => {
    expect(verifierPrompt).toContain('- Record verification: todos --project /srv/todos comment task-1200 "<verification evidence or blocker>"');
    expect(verifierPrompt).toContain("- If valid and complete: todos --project /srv/todos done task-1200");
    expect(verifierPrompt).not.toContain("- Claim/start if appropriate:");
    expect(verifierPrompt).toContain("Act as an adversarial reviewer focused on correctness, regressions, missing tests, security, and incomplete requirements.");
  });

  test("todos source DB path pins worker-verifier commands to the exact source store", () => {
    const sourceDb = join(fixtureRoot, "source-store.db");
    const sourceWorkflow = renderTodosTaskWorkerVerifierWorkflow({
      taskId: "task-1200",
      taskTitle: "Fix login",
      projectPath: repoPath,
      todosProjectPath: repoPath,
      todosDbPath: sourceDb,
      worktreeMode: "off",
    });
    const gate = commandOf(stepById(sourceWorkflow, "source-task-gate"));
    const worker = agentTargetOf(stepById(sourceWorkflow, "worker")).prompt;
    const verifier = agentTargetOf(stepById(sourceWorkflow, "verifier")).prompt;

    expect(gate).toContain(`TODOS_DB_PATH='${sourceDb}' HASNA_TODOS_DB_PATH='${sourceDb}' todos --project '${repoPath}' --json inspect 'task-1200'`);
    expect(worker).toContain(`Todos DB path: ${sourceDb}`);
    expect(worker).toContain(`TODOS_DB_PATH='${sourceDb}' HASNA_TODOS_DB_PATH='${sourceDb}' todos --project ${repoPath} start task-1200`);
    expect(worker).toContain(`"todosDbPath":"${sourceDb}"`);
    expect(verifier).toContain(`TODOS_DB_PATH='${sourceDb}' HASNA_TODOS_DB_PATH='${sourceDb}' todos --project ${repoPath} done task-1200`);
  });

  test("disabled worktree policy prose explains the mode instead of listing worktree paths", () => {
    expect(workerPrompt).toContain("OpenLoops worktree policy:");
    expect(workerPrompt).toContain("- Worktree mode off did not select an isolated worktree: worktree mode disabled.");
    expect(workerPrompt).not.toContain("- Worktree root:");
  });

  test("enabled worktree policy prose lists cwd, root, branch, and original checkout", () => {
    const enabled = renderTodosTaskWorkerVerifierWorkflow({
      taskId: "task-1200",
      projectPath: repoPath,
      worktreeRoot,
    });
    const prompt = agentTargetOf(stepById(enabled, "worker")).prompt;
    expect(prompt).toContain("- Use the isolated git worktree as the only writeable repository checkout for this task/event.");
    expect(prompt).toContain(`- Original checkout: ${repoPath}`);
    expect(prompt).toContain("- Worktree root: ");
    expect(prompt).toContain("- Branch: openloops/repo/task-1200-");
  });

  test("lifecycle prompts drop the blank line after /goal (filter(Boolean) contract)", () => {
    const lifecycle = renderTaskLifecycleWorkflow({
      taskId: "task-1200",
      projectPath: repoPath,
      worktreeRoot,
    });
    const worker = agentTargetOf(stepById(lifecycle, "worker")).prompt;
    const verifier = agentTargetOf(stepById(lifecycle, "verifier")).prompt;
    expect(worker.startsWith("/goal Complete todos task task-1200 according to the planner evidence.\nYou are the worker step for a full task-triggered OpenLoops lifecycle.")).toBe(true);
    expect(verifier.startsWith("/goal Verify todos task task-1200 after the full lifecycle worker step.\nYou are the verifier step for a full task-triggered OpenLoops lifecycle.")).toBe(true);
  });

  test("lifecycle gate-stop fragment carries per-stage deltas", () => {
    const lifecycle = renderTaskLifecycleWorkflow({
      taskId: "task-1200",
      projectPath: repoPath,
      worktreeRoot,
      eventId: "evt-9",
    });
    const triage = agentTargetOf(stepById(lifecycle, "triage")).prompt;
    const planner = agentTargetOf(stepById(lifecycle, "planner")).prompt;
    expect(triage).toContain("The deterministic triage gate will stop later steps unless the latest triage marker is the exact go marker");
    expect(planner).toContain("The deterministic planner gate will stop the worker unless the latest planner marker is the exact go marker");
    expect(triage).toContain("openloops:triage=go task=task-1200 event=evt-9");
    expect(planner).toContain("openloops:planner=blocked task=task-1200 event=evt-9");
  });

  test("todos source DB path pins lifecycle gates and PR handoff todos commands", () => {
    const sourceDb = join(fixtureRoot, "source-lifecycle.db");
    const lifecycle = renderTaskLifecycleWorkflow({
      taskId: "task-1200",
      projectPath: repoPath,
      todosProjectPath: repoPath,
      todosDbPath: sourceDb,
      worktreeRoot,
      prHandoff: true,
    });
    const sourceGate = commandOf(stepById(lifecycle, "source-task-gate"));
    const triageGate = commandOf(stepById(lifecycle, "triage-gate"));
    const prHandoff = commandOf(stepById(lifecycle, "pr-handoff"));
    const triage = agentTargetOf(stepById(lifecycle, "triage")).prompt;

    expect(sourceGate).toContain(`TODOS_DB_PATH='${sourceDb}' HASNA_TODOS_DB_PATH='${sourceDb}' todos --project '${repoPath}' --json inspect 'task-1200'`);
    expect(triageGate).toContain(`TODOS_DB_PATH='${sourceDb}' HASNA_TODOS_DB_PATH='${sourceDb}' todos --project '${repoPath}' --json inspect 'task-1200'`);
    expect(prHandoff).toContain(`export OPENLOOPS_PR_HANDOFF_TODOS_DB_PATH='${sourceDb}'`);
    expect(prHandoff).toContain("const todosDbPath = process.env.OPENLOOPS_PR_HANDOFF_TODOS_DB_PATH || '';");
    expect(triage).toContain(`Todos DB path: ${sourceDb}`);
    expect(triage).toContain(`If the task should not proceed automatically, run: TODOS_DB_PATH='${sourceDb}' HASNA_TODOS_DB_PATH='${sourceDb}' todos --project ${repoPath} update task-1200 --status blocked`);
  });

  test("verifier runtime guidance reflects the idle watchdog configuration", () => {
    const defaults = renderTodosTaskWorkerVerifierWorkflow({ taskId: "t", projectPath: plainPath });
    const defaultVerifier = agentTargetOf(stepById(defaults, "verifier"));
    expect(defaultVerifier.prompt).toContain("OpenLoops will mark this verifier timed_out after 900000ms without stdout/stderr.");
    expect(defaultVerifier.idleTimeoutMs).toBe(900000);

    const disabled = renderLoopTemplate(TODOS_TASK_WORKER_VERIFIER_TEMPLATE_ID, {
      taskId: "t",
      projectPath: plainPath,
      verifierIdleTimeoutMs: "none",
    });
    const disabledVerifier = agentTargetOf(stepById(disabled, "verifier"));
    expect(disabledVerifier.prompt).toContain("The verifier idle watchdog is disabled for this workflow");
    expect(disabledVerifier.idleTimeoutMs).toBeUndefined();
  });
});

describe("executor-native worktree specs", () => {
  test("templates no longer emit prepare-worktree steps; agent targets carry the worktree spec", () => {
    const workflow = renderTodosTaskWorkerVerifierWorkflow({
      taskId: "task-1200",
      projectPath: repoPath,
      worktreeRoot,
    });
    expect(workflow.steps.map((step) => step.id)).toEqual(["source-task-gate", "worker", "verifier"]);
    expect(stepById(workflow, "worker").dependsOn).toEqual(["source-task-gate"]);
    for (const step of workflow.steps) {
      const command = step.target.type === "command" ? commandOf(step) : "";
      expect(command).not.toContain("git worktree add");
    }
    for (const step of agentSteps(workflow)) {
      const worktree = agentTargetOf(step).worktree;
      expect(worktree?.enabled).toBe(true);
      expect(worktree?.mode).toBe("auto");
      // The executor's native preparation requires repoRoot, path, and branch.
      expect(worktree?.repoRoot).toBe(resolvedRepoRoot);
      expect(worktree?.path?.startsWith(join(worktreeRoot, "repo"))).toBe(true);
      expect(worktree?.branch?.startsWith("openloops/repo/")).toBe(true);
      expect(worktree?.originalCwd).toBe(repoPath);
      expect(agentTargetOf(step).cwd).toBe(worktree?.cwd);
    }
  });

  test("worktree spec is disabled with a reason outside git repositories in auto mode", () => {
    const workflow = renderTodosTaskWorkerVerifierWorkflow({ taskId: "task-1200", projectPath: plainPath });
    const worktree = agentTargetOf(stepById(workflow, "worker")).worktree;
    expect(worktree?.enabled).toBe(false);
    expect(worktree?.reason).toBe("projectPath is not an existing git repository");
    expect(agentTargetOf(stepById(workflow, "worker")).cwd).toBe(plainPath);
  });

  test("worktreeMode=required fails closed when projectPath is not a git repository", () => {
    expect(() =>
      renderTodosTaskWorkerVerifierWorkflow({ taskId: "task-1200", projectPath: plainPath, worktreeMode: "required" }),
    ).toThrow("worktreeMode=required but projectPath is not an existing git repository");
  });

  test("lifecycle agent steps share one worktree spec while deterministic steps run in the original checkout", () => {
    const workflow = renderTaskLifecycleWorkflow({
      taskId: "task-1200",
      projectPath: repoPath,
      worktreeRoot,
      prHandoff: true,
    });
    const specs = agentSteps(workflow).map((step) => agentTargetOf(step).worktree);
    expect(specs).toHaveLength(4);
    for (const spec of specs) {
      expect(spec).toEqual(specs[0]);
      expect(spec?.enabled).toBe(true);
    }
    for (const id of ["source-task-gate", "triage-gate", "planner-gate", "pr-handoff"]) {
      const step = stepById(workflow, id);
      expect(step.target.type).toBe("command");
      expect(step.target.type === "command" ? step.target.cwd : undefined).toBe(repoPath);
    }
  });
});

describe("gate steps", () => {
  test("gate steps declare blockedExitCodes [12] for the workflow runner", () => {
    const workflow = renderTaskLifecycleWorkflow({
      taskId: "task-1200",
      projectPath: repoPath,
      worktreeRoot,
      prHandoff: true,
    });
    const steps = workflow.steps as Array<WorkflowStepInput & { blockedExitCodes?: number[] }>;
    const gates = steps.filter((step) => step.id.endsWith("-gate"));
    expect(gates.map((step) => step.id)).toEqual(["source-task-gate", "triage-gate", "planner-gate"]);
    for (const gate of gates) {
      expect(gate.blockedExitCodes).toEqual([12]);
    }
    for (const step of steps.filter((entry) => !entry.id.endsWith("-gate"))) {
      expect(step.blockedExitCodes).toBeUndefined();
    }
  });

  test("lifecycle gate script blocks via exit code 12 with exact stage markers", () => {
    const workflow = renderTaskLifecycleWorkflow({ taskId: "task-1200", projectPath: repoPath, worktreeRoot });
    const command = commandOf(stepById(workflow, "triage-gate"));
    expect(command).toContain("process.exit(12);");
    expect(command).toContain('const goMarker = "openloops:triage=go task=task-1200";');
    expect(command).toContain('const blockedMarker = "openloops:triage=blocked task=task-1200";');
    expect(command).toContain("bun - <<'BUN'");
  });

  test("pr-handoff step is env-driven and bounded", () => {
    const workflow = renderTaskLifecycleWorkflow({
      taskId: "task-1200",
      projectPath: repoPath,
      worktreeRoot,
      prHandoff: true,
    });
    const step = stepById(workflow, "pr-handoff");
    const command = commandOf(step);
    expect(step.dependsOn).toEqual(["worker"]);
    expect(step.timeoutMs).toBe(120000);
    expect(command).toContain("export OPENLOOPS_PR_HANDOFF_TASK_ID='task-1200'");
    expect(command).toContain("export OPENLOOPS_PR_HANDOFF_ARTIFACT=");
    expect(command).toContain("process.env.OPENLOOPS_PR_HANDOFF_EXPECTED_BRANCH");
  });
});

describe("permission and break-glass fail-closed rendering", () => {
  test("danger-full-access stays fail-closed without manualBreakGlass", () => {
    expect(() =>
      renderTodosTaskWorkerVerifierWorkflow({ taskId: "t", projectPath: plainPath, sandbox: "danger-full-access" }),
    ).toThrow("danger-full-access is manual break-glass only");
    expect(() =>
      renderBoundedAgentWorkerVerifierWorkflow({
        objective: "audit",
        projectPath: plainPath,
        provider: "codex",
        sandbox: "danger-full-access",
      }),
    ).toThrow("danger-full-access is manual break-glass only");
    expect(() =>
      renderLoopTemplate(TASK_LIFECYCLE_TEMPLATE_ID, {
        taskId: "t",
        projectPath: repoPath,
        worktreeRoot,
        sandbox: "danger-full-access",
      }),
    ).toThrow("danger-full-access is manual break-glass only");
  });

  test("explicit manualBreakGlass renders with metadata-only break-glass allowlist", () => {
    const workflow = renderLoopTemplate(TODOS_TASK_WORKER_VERIFIER_TEMPLATE_ID, {
      taskId: "t",
      projectPath: plainPath,
      sandbox: "danger-full-access",
      manualBreakGlass: "true",
    });
    const target = agentTargetOf(stepById(workflow, "worker"));
    expect(target.sandbox).toBe("danger-full-access");
    expect(target.allowlist).toEqual({ enforcement: "metadata_only", commands: ["manual-break-glass"] });
  });

  test("codewith/codex default to workspace-write sandbox with bypass permission mode", () => {
    const workflow = renderTodosTaskWorkerVerifierWorkflow({ taskId: "t", projectPath: plainPath });
    const target = agentTargetOf(stepById(workflow, "worker"));
    expect(target.sandbox).toBe("workspace-write");
    expect(target.permissionMode).toBe("bypass");
    expect(target.configIsolation).toBe("safe");
  });

  test("native auth profiles are rejected for non-codewith providers", () => {
    expect(() =>
      renderTodosTaskWorkerVerifierWorkflow({
        taskId: "t",
        projectPath: plainPath,
        provider: "claude",
        authProfilePool: ["a", "b"],
      }),
    ).toThrow("supported only for provider codewith");
  });

  test("custom templates reject danger flags, implicit danger sandboxes, and prompt files", () => {
    const dangerous = join(fixtureRoot, "dangerous-template.json");
    writeFileSync(
      dangerous,
      JSON.stringify({
        id: "custom-danger",
        name: "Custom Danger",
        description: "tries to break glass",
        workflow: {
          name: "danger",
          steps: [{ id: "run", target: { type: "command", command: "codex", args: ["--sandbox", "danger-full-access"] } }],
        },
      }),
    );
    expect(() => validateCustomLoopTemplateFile(dangerous)).toThrow("dangerous sandbox or bypass flag");
    expect(() => importCustomLoopTemplate(dangerous)).toThrow("dangerous sandbox or bypass flag");

    const implicit = join(fixtureRoot, "implicit-danger-template.json");
    writeFileSync(
      implicit,
      JSON.stringify({
        id: "custom-implicit",
        name: "Custom Implicit",
        description: "bypass without sandbox",
        workflow: {
          name: "implicit",
          steps: [{ id: "run", target: { type: "agent", provider: "codex", prompt: "hi", permissionMode: "bypass" } }],
        },
      }),
    );
    expect(() => validateCustomLoopTemplateFile(implicit)).toThrow("without an explicit sandbox");

    const promptFile = join(fixtureRoot, "prompt-file-template.json");
    writeFileSync(
      promptFile,
      JSON.stringify({
        id: "custom-prompt-file",
        name: "Custom Prompt File",
        description: "prompt files disallowed",
        workflow: {
          name: "prompt-file",
          steps: [{ id: "run", target: { type: "agent", provider: "codewith", promptFile: "/tmp/x", sandbox: "read-only" } }],
        },
      }),
    );
    expect(() => validateCustomLoopTemplateFile(promptFile)).toThrow("promptFile");
  });

  test("custom templates cannot collide with builtin template keys", () => {
    const collision = join(fixtureRoot, "collision-template.json");
    writeFileSync(
      collision,
      JSON.stringify({
        id: TODOS_TASK_WORKER_VERIFIER_TEMPLATE_ID,
        name: "Shadow Builtin",
        description: "collides with a builtin id",
        workflow: { name: "shadow", steps: [{ id: "run", target: { type: "command", command: "true" } }] },
      }),
    );
    expect(() => validateCustomLoopTemplateFile(collision)).toThrow("collides with built-in template key");
  });

  test("well-formed custom templates import and render through the registry facade", () => {
    const custom = join(fixtureRoot, "echo-template.json");
    writeFileSync(
      custom,
      JSON.stringify({
        id: "custom-echo",
        name: "Custom Echo",
        description: "echoes a message",
        variables: [{ name: "message", required: true }],
        workflow: {
          name: "custom-echo-${message}",
          steps: [{ id: "echo", target: { type: "command", command: "echo", args: ["${message}"] } }],
        },
      }),
    );
    const imported = importCustomLoopTemplate(custom, { replace: true });
    expect(imported.template.source).toBe("custom");
    expect(listLoopTemplates({ source: "custom" }).map((entry) => entry.id)).toContain("custom-echo");
    const rendered = renderLoopTemplate("custom-echo", { message: "hello" });
    expect(rendered.name).toBe("custom-echo-hello");
    expect(rendered.steps[0]?.target.type).toBe("command");
  });
});

describe("builtin rendered workflow snapshots", () => {
  test("todos-task-worker-verifier", () => {
    const workflow = renderLoopTemplate(TODOS_TASK_WORKER_VERIFIER_TEMPLATE_ID, {
      taskId: "task-1200",
      taskTitle: "Fix login bug",
      projectPath: repoPath,
      worktreeRoot,
      authProfilePool: "p1,p2,p3",
    });
    expect(normalized(workflow, ["task-1200"])).toMatchSnapshot();
  });

  test("event-worker-verifier", () => {
    const workflow = renderLoopTemplate(EVENT_WORKER_VERIFIER_TEMPLATE_ID, {
      eventId: "evt-7700",
      eventType: "repo.push",
      eventSource: "hasna",
      eventJson: '{"id":"evt-7700"}',
      projectPath: repoPath,
      worktreeRoot,
    });
    expect(normalized(workflow, ["hasna:repo.push:evt-7700"])).toMatchSnapshot();
  });

  test("task-lifecycle with pr handoff", () => {
    const workflow = renderLoopTemplate(TASK_LIFECYCLE_TEMPLATE_ID, {
      taskId: "task-1200",
      projectPath: repoPath,
      worktreeRoot,
      prHandoff: "true",
    });
    expect(normalized(workflow, ["task-1200"])).toMatchSnapshot();
  });

  test("bounded-agent-worker-verifier", () => {
    const workflow = renderLoopTemplate(BOUNDED_AGENT_WORKER_VERIFIER_TEMPLATE_ID, {
      name: "bounded-agent-audit-worker-verifier",
      objective: "Audit the scheduler",
      prompt: "Extra detail",
      projectPath: repoPath,
      worktreeMode: "off",
    });
    expect(normalized(workflow)).toMatchSnapshot();
  });

  test("pr-review", () => {
    const workflow = renderLoopTemplate(PR_REVIEW_TEMPLATE_ID, {
      prUrl: "https://github.com/org/repo/pull/42",
      projectPath: repoPath,
      worktreeMode: "off",
    });
    expect(normalized(workflow)).toMatchSnapshot();
  });

  test("scheduled-audit", () => {
    const workflow = renderLoopTemplate(SCHEDULED_AUDIT_TEMPLATE_ID, {
      name: "scheduled-audit-backups-worker-verifier",
      objective: "Audit backups",
      projectPath: repoPath,
      worktreeMode: "off",
    });
    expect(normalized(workflow)).toMatchSnapshot();
  });

  test("knowledge-refresh", () => {
    const workflow = renderLoopTemplate(KNOWLEDGE_REFRESH_TEMPLATE_ID, {
      scope: "loops runbooks",
      projectPath: repoPath,
      worktreeMode: "off",
    });
    expect(normalized(workflow)).toMatchSnapshot();
  });

  test("report-only stays read-only on the main checkout", () => {
    const workflow = renderLoopTemplate(REPORT_ONLY_TEMPLATE_ID, {
      name: "report-only-disk-usage-worker-verifier",
      objective: "Report disk usage",
      projectPath: repoPath,
    });
    const worker = agentTargetOf(stepById(workflow, "worker"));
    expect(worker.sandbox).toBe("read-only");
    expect(worker.worktree?.mode).toBe("main");
    expect(worker.worktree?.enabled).toBe(false);
    expect(normalized(workflow)).toMatchSnapshot();
  });

  test("incident-response", () => {
    const workflow = renderLoopTemplate(INCIDENT_RESPONSE_TEMPLATE_ID, {
      incidentId: "inc-9",
      objective: "Mitigate outage",
      projectPath: repoPath,
      worktreeMode: "off",
    });
    expect(normalized(workflow)).toMatchSnapshot();
  });

  test("deterministic-check-create-task", () => {
    const workflow = renderLoopTemplate(DETERMINISTIC_CHECK_CREATE_TASK_TEMPLATE_ID, {
      name: "deterministic-check-example",
      checkCommand: "true",
      projectPath: repoPath,
    });
    expect(normalized(workflow)).toMatchSnapshot();
  });

  test("builtin template summaries", () => {
    expect(JSON.stringify(listLoopTemplates({ source: "builtin" }), null, 2)).toMatchSnapshot();
  });
});
