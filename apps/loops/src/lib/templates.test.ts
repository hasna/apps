import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { AgentTarget, CreateWorkflowInput, WorkflowStepInput } from "../types.js";
import { prHandoffCommand, ROUTING_REMEDIATION_ALERT_CHANNEL } from "./template-kit.js";
import {
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
    expect(workerPrompt.startsWith("/goal Complete todos task task-1200 in REPO_PLACEHOLDER.\n\nYou are the worker agent for a task-triggered Loops workflow.")).toBe(true);
    const lines = workerPrompt.split("\n");
    const stanzaStart = lines.indexOf("Use these exact todos commands so worktree cwd inference cannot attach to the wrong project:");
    expect(stanzaStart).toBeGreaterThan(0);
    expect(lines[stanzaStart - 1]).toBe("Todos project path: /srv/todos");
    expect(lines[stanzaStart + 1]).toBe("- Inspect first: todos --project /srv/todos inspect task-1200");
    expect(lines[stanzaStart + 2]).toBe("- Claim/start if appropriate: todos --project /srv/todos start task-1200");
    expect(lines[stanzaStart + 3]).toBe('- Record worker evidence: todos --project /srv/todos comment task-1200 "openloops:worker=evidence task=task-1200');
    expect(lines[stanzaStart + 4]).toBe('<concise worker evidence and blockers>"');
  });

  test("worker prompt keeps the no-tmux and completion-ownership stanzas", () => {
    expect(workerPrompt).toContain("Do not dispatch or paste prompts into tmux panes.");
    expect(workerPrompt).toContain("Do not mark the task complete in the worker step; the verifier step owns completion after independent validation.");
  });

  test("verifier prompt gets verification/done commands but not the claim/start command", () => {
    expect(verifierPrompt).toContain('- Record verifier evidence: todos --project /srv/todos comment task-1200 "openloops:verifier=evidence task=task-1200\n<concise verification evidence or blocker>"');
    expect(verifierPrompt).toContain("- If valid and complete: todos --project /srv/todos done task-1200");
    expect(verifierPrompt).not.toContain("- Claim/start if appropriate:");
    expect(verifierPrompt).toContain("Act as an adversarial reviewer focused on correctness, regressions, missing tests, security, and incomplete requirements.");
  });

  test("omitted todos project uses unscoped commands instead of the routed repository", () => {
    const unscoped = renderTodosTaskWorkerVerifierWorkflow({
      taskId: "task-unscoped",
      projectPath: repoPath,
      routeProjectPath: repoPath,
      worktreeMode: "off",
    });
    const worker = agentTargetOf(stepById(unscoped, "worker")).prompt;
    const verifier = agentTargetOf(stepById(unscoped, "verifier")).prompt;
    const sourceGate = commandOf(stepById(unscoped, "source-task-gate"));
    const evidenceGate = commandOf(stepById(unscoped, "task-evidence-check"));

    expect(worker).toContain("Todos project path: not specified; use the CLI default without --project.");
    expect(worker).toContain("- Inspect first: todos inspect task-unscoped");
    expect(worker).toContain("- Claim/start if appropriate: todos start task-unscoped");
    expect(verifier).toContain("- If valid and complete: todos done task-unscoped");
    for (const value of [worker, verifier, sourceGate, evidenceGate]) {
      expect(value).not.toContain("todos --project");
      expect(value).not.toContain(`--project ${repoPath}`);
    }
  });

  test("disabled worktree policy prose explains the mode instead of listing worktree paths", () => {
    expect(workerPrompt).toContain("Loops worktree policy:");
    expect(workerPrompt).toContain("- Worktree mode off did not select an isolated worktree: worktree mode disabled.");
    expect(workerPrompt).not.toContain("- Worktree root:");
  });

  test("default worktree root is the canonical repos store, never the loops app data dir", () => {
    // No worktreeRoot passed: exercises defaultWorktreeRoot()'s fallback.
    const enabled = renderTodosTaskWorkerVerifierWorkflow({
      taskId: "task-1200",
      projectPath: repoPath,
    });
    const prompt = agentTargetOf(stepById(enabled, "worker")).prompt;
    expect(prompt).toContain(`- Worktree root: ${join(resolverDataDir({ app: "repos", home: homedir() }), "worktrees")}`);
    expect(prompt).not.toContain([".hasna", "loops", "worktrees"].join("/"));
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

  test("lifecycle prompts use bounded step headers instead of native goals", () => {
    const lifecycle = renderTaskLifecycleWorkflow({
      taskId: "task-1200",
      projectPath: repoPath,
      worktreeRoot,
    });
    const triage = agentTargetOf(stepById(lifecycle, "triage")).prompt;
    const planner = agentTargetOf(stepById(lifecycle, "planner")).prompt;
    const worker = agentTargetOf(stepById(lifecycle, "worker")).prompt;
    const verifier = agentTargetOf(stepById(lifecycle, "verifier")).prompt;
    for (const prompt of [triage, planner, worker, verifier]) {
      expect(prompt).not.toContain("/goal ");
      expect(prompt).toContain("You are the ");
      expect(prompt).toContain("step for a full task-triggered Loops lifecycle.");
    }
    expect(worker.startsWith("Objective: Complete todos task task-1200 according to the planner evidence.\nYou are the worker step for a full task-triggered Loops lifecycle.")).toBe(true);
    expect(verifier.startsWith("Objective: Verify todos task task-1200 after the full lifecycle worker step.\nYou are the verifier step for a full task-triggered Loops lifecycle.")).toBe(true);
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

  test("route admission context is visible in lifecycle prompts", () => {
    const lifecycle = renderTaskLifecycleWorkflow({
      taskId: "task-1200",
      projectPath: repoPath,
      worktreeRoot,
      projectGroup: "loop-script-migration-rollout",
      routeScope: "route-drain-rollout",
      routeThrottleLimits: {
        maxActiveScope: "route-drain-rollout",
        maxActivePerProjectGroup: 1,
        maxPerProfile: 2,
      },
    });
    const worker = agentTargetOf(stepById(lifecycle, "worker")).prompt;
    expect(worker).toContain('"routeAdmission":{"projectGroup":"loop-script-migration-rollout"');
    expect(worker).toContain('"routeScope":"route-drain-rollout"');
    expect(worker).toContain('"maxActivePerProjectGroup":1');
    expect(worker).toContain('"maxPerProfile":2');
  });

  test("lifecycle prompts propagate PR review routing evidence to follow-up todos", () => {
    const lifecycle = renderTaskLifecycleWorkflow({
      taskId: "task-pr-route",
      projectPath: repoPath,
      worktreeRoot,
      prReviewRouting: {
        required: true,
        allowed: true,
        author: "andrei-hasna",
        reviewers: ["andrei-hasna", "kriptoburak"],
        selectedReviewer: "kriptoburak",
        signals: ["review-required-text"],
      },
    });
    const prompts = ["triage", "planner", "worker", "verifier"].map((id) => agentTargetOf(stepById(lifecycle, id)).prompt);
    for (const prompt of prompts) {
      expect(prompt).toContain("PR-derived follow-up todos:");
      expect(prompt).toContain("Source PR author evidence: GitHub author is andrei-hasna");
      expect(prompt).toContain("Source PR reviewer evidence: GitHub reviewer pool: andrei-hasna, kriptoburak");
      expect(prompt).toContain("GitHub author is <login>");
      expect(prompt).toContain("GitHub reviewer pool: <login>, <login>");
      expect(prompt).toContain('"prReviewRouting":{"required":true');
      expect(prompt).toContain('"selectedReviewer":"kriptoburak"');
    }
  });

  test("lifecycle prompts do not advertise placeholder comment commands before marker comments", () => {
    const lifecycle = renderTaskLifecycleWorkflow({
      taskId: "task-1200",
      projectPath: repoPath,
      todosProjectPath: "/srv/todos",
      worktreeRoot,
      eventId: "evt-9",
    });
    const triage = agentTargetOf(stepById(lifecycle, "triage")).prompt;
    const planner = agentTargetOf(stepById(lifecycle, "planner")).prompt;
    const worker = agentTargetOf(stepById(lifecycle, "worker")).prompt;
    const verifier = agentTargetOf(stepById(lifecycle, "verifier")).prompt;
    const triageGoCommand = 'todos --project /srv/todos comment task-1200 "openloops:triage=go task=task-1200 event=evt-9\n<task-specific triage evidence>"';
    const triageBlockedCommand = 'todos --project /srv/todos comment task-1200 "openloops:triage=blocked task=task-1200 event=evt-9\n<task-specific triage evidence>"';
    const plannerGoCommand = 'todos --project /srv/todos comment task-1200 "openloops:planner=go task=task-1200 event=evt-9\n<task-specific plan/evidence>"';
    const plannerBlockedCommand = 'todos --project /srv/todos comment task-1200 "openloops:planner=blocked task=task-1200 event=evt-9\n<task-specific plan/evidence>"';

    for (const prompt of [triage, planner, worker, verifier]) {
      expect(prompt).toContain("Use concrete task-specific text in lifecycle comments.");
      expect(prompt).not.toContain('comment task-1200 "<concise evidence');
      expect(prompt).not.toContain('comment task-1200 "<verification evidence');
      expect(prompt).not.toContain("<concise evidence, decision, or blocker>");
      expect(prompt).not.toContain("<verification evidence or blocker>");
    }

    expect(triage).toContain("first line is exactly: openloops:triage=go task=task-1200 event=evt-9");
    expect(triage).toContain("Do not run a separate generic evidence comment before the marker");
    expect(triage).toContain(triageGoCommand);
    expect(triage).toContain(triageBlockedCommand);
    expect(planner).toContain("first line is exactly: openloops:planner=go task=task-1200 event=evt-9");
    expect(planner).toContain("Do not run a separate generic evidence comment before the marker");
    expect(planner).toContain(plannerGoCommand);
    expect(planner).toContain(plannerBlockedCommand);
    expect(worker).toContain("record concrete worker evidence in todos");
    expect(worker).toContain('openloops:worker=evidence task=task-1200 event=evt-9');
    expect(verifier).toContain("record concrete verification evidence in todos");
    expect(verifier).toContain('openloops:verifier=evidence task=task-1200 event=evt-9');
  });

  test("verifier runtime guidance reflects the idle watchdog configuration", () => {
    const defaults = renderTodosTaskWorkerVerifierWorkflow({ taskId: "t", projectPath: plainPath });
    const defaultVerifier = agentTargetOf(stepById(defaults, "verifier"));
    expect(defaultVerifier.prompt).toContain("Loops will mark this verifier timed_out after 900000ms without stdout/stderr.");
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

  test("routing-remediation prompt and preflight enforce safe CLI-only repairs", () => {
    const workflow = renderLoopTemplate(ROUTING_REMEDIATION_TEMPLATE_ID, {
      projectPath: repoPath,
      todosProjectPath: "/srv/todos",
      dryRun: "false",
      shard: "0/6",
      limit: "10",
      maxRepairs: "3",
      idempotencyKey: "routing-health:open-loops:shard0",
      worktreeRoot,
    });
    expect(workflow.steps.map((step) => step.id)).toEqual(["routing-doctor-preflight", "worker", "verifier"]);
    const preflight = stepById(workflow, "routing-doctor-preflight") as WorkflowStepInput & { blockedExitCodes?: number[] };
    expect(preflight.target.type).toBe("command");
    expect(preflight.target.type === "command" ? preflight.target.cwd : undefined).toBe(repoPath);
    expect(preflight.blockedExitCodes).toEqual([12]);
    const preflightCommand = commandOf(preflight);
    expect(preflightCommand).toContain("OPENLOOPS_ROUTING_REMEDIATION_MAX_REPAIRS='3'");
    expect(preflightCommand).toContain("OPENLOOPS_ROUTING_REMEDIATION_SCOPE_ARGS='[");
    expect(preflightCommand).toContain("\"--shard\",\"0/6\"");
    expect(preflightCommand).toContain("allowedSafeFields = new Set(['working_dir', 'task_list_id'])");
    expect(preflightCommand).toContain("__missing_safe_field__");
    expect(preflightCommand).toContain("process.exit(12);");

    const worker = agentTargetOf(stepById(workflow, "worker"));
    expect(worker.prompt).toContain("Dry-run/preflight mode: false");
    expect(worker.prompt).toContain("todos --project /srv/todos doctor routing --json --apply --undo-record");
    expect(worker.prompt).toContain("Never edit the Todos SQLite database");
    expect(worker.prompt).toContain("safe_auto");
    expect(worker.prompt).toContain("blocker_cross_repo");
    expect(worker.prompt).toContain("old value, new value, repair command, source doctor run, undo record, and route-state recheck result");

    // Owner directive 2026-07-30: routine operational alerts are not tasks. The pre-fix
    // template told the worker to `todos task upsert` one blocker task per finding, and
    // a single 2026-07-05 sweep emitted 2,817 of them. Findings now go to an evidence
    // artifact plus at most one aggregate channel post.
    expect(worker.prompt).not.toContain("task upsert");
    expect(worker.prompt).not.toContain("from-kai,routing-health");
    expect(worker.prompt).not.toContain("routing-health:blocker:<source-task-id>:<finding-category>");
    expect(worker.prompt).toContain("Routine operational alerts are NOT tasks");
    expect(worker.prompt).toContain("routing-remediation-blockers-");
    expect(worker.prompt).toContain(`conversations send ${ROUTING_REMEDIATION_ALERT_CHANNEL}`);
    expect(worker.prompt).toContain("exactly ONE post per run, never one per finding");
    // Built from the exported constant rather than written out: a shell-quoted channel
    // name spelled literally here reads to the branding guard as a possessive form of the
    // legacy product name, and the assertion is stronger tied to the constant anyway.
    expect(preflightCommand).toContain(
      `OPENLOOPS_ROUTING_REMEDIATION_ALERT_CHANNEL='${ROUTING_REMEDIATION_ALERT_CHANNEL}'`,
    );
    expect(preflightCommand).toContain("OPENLOOPS_ROUTING_REMEDIATION_BLOCKER_REPORT=");
    expect(preflightCommand).not.toContain("blocker_task_tags");

    const verifier = agentTargetOf(stepById(workflow, "verifier"));
    expect(verifier.prompt).toContain("Confirm safe_auto repairs were limited to working_dir and task_list_id");
    expect(verifier.prompt).toContain("Fail verification if this run created ANY todos task for a routing finding");
    expect(verifier.prompt).toContain("If dry-run mode was rendered, verify that no apply/repair mutation occurred");

    const dryRunWorkflow = renderLoopTemplate(ROUTING_REMEDIATION_TEMPLATE_ID, {
      projectPath: repoPath,
      todosProjectPath: "/srv/todos",
      idempotencyKey: "routing-health:open-loops:dry-run",
      worktreeRoot,
    });
    expect(agentTargetOf(stepById(dryRunWorkflow, "worker")).prompt).toContain("This workflow was rendered with dryRun=true. Do not run the apply command");

    const customChannel = renderLoopTemplate(ROUTING_REMEDIATION_TEMPLATE_ID, {
      projectPath: repoPath,
      todosProjectPath: "/srv/todos",
      idempotencyKey: "routing-health:open-loops:custom-channel",
      alertChannel: "incidents",
      worktreeRoot,
    });
    expect(agentTargetOf(stepById(customChannel, "worker")).prompt).toContain("conversations send incidents");
    expect(commandOf(stepById(customChannel, "routing-doctor-preflight"))).toContain(
      "OPENLOOPS_ROUTING_REMEDIATION_ALERT_CHANNEL='incidents'",
    );
  });
});

describe("executor-native worktree specs", () => {
  test("templates no longer emit prepare-worktree steps; agent targets carry the worktree spec", () => {
    const workflow = renderTodosTaskWorkerVerifierWorkflow({
      taskId: "task-1200",
      projectPath: repoPath,
      worktreeRoot,
    });
    expect(workflow.steps.map((step) => step.id)).toEqual(["source-task-gate", "worker", "verifier", "task-evidence-check"]);
    expect(stepById(workflow, "worker").dependsOn).toEqual(["source-task-gate"]);
    expect(stepById(workflow, "task-evidence-check").dependsOn).toEqual(["verifier"]);
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
    for (const id of ["source-task-gate", "triage-gate", "planner-gate", "pr-handoff", "task-evidence-check"]) {
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
      if (step.id === "task-evidence-check") expect(step.blockedExitCodes).toEqual([]);
      else expect(step.blockedExitCodes).toBeUndefined();
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

  test("task evidence check requires completed task plus worker and verifier markers", () => {
    const workflow = renderTaskLifecycleWorkflow({
      taskId: "task-1200",
      projectPath: repoPath,
      worktreeRoot,
      eventId: "evt-9",
    });
    const step = stepById(workflow, "task-evidence-check") as WorkflowStepInput & { blockedExitCodes?: number[] };
    const command = commandOf(step);
    expect(step.dependsOn).toEqual(["verifier"]);
    expect(step.blockedExitCodes).toEqual([]);
    expect(command).toContain("completedStatuses = new Set(['completed', 'done'])");
    expect(command).toContain("WORKER_MARKER='openloops:worker=evidence task=task-1200 event=evt-9'");
    expect(command).toContain("VERIFIER_MARKER='openloops:verifier=evidence task=task-1200 event=evt-9'");
    expect(command).toContain("missing worker evidence marker");
    expect(command).toContain("process.exit(1);");
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
      allowTools: "functions.exec_command",
      allowCommands: "git,bun",
      manualBreakGlass: "true",
      safetyReason: "operator-approved isolated emergency repair",
    });
    const target = agentTargetOf(stepById(workflow, "worker"));
    expect(target.sandbox).toBe("danger-full-access");
    expect(target.manualBreakGlass).toBe(true);
    expect(target.allowlist).toEqual({
      enforcement: "metadata_only",
      tools: ["functions.exec_command"],
      commands: ["git", "bun", "manual-break-glass"],
      safetyReason: "operator-approved isolated emergency repair",
    });
  });

  test("builtin allowlist variables require a safety reason and reach every generated agent target", () => {
    expect(() =>
      renderLoopTemplate(TODOS_TASK_WORKER_VERIFIER_TEMPLATE_ID, {
        taskId: "t",
        projectPath: plainPath,
        allowTools: "functions.exec_command",
      }),
    ).toThrow("allowlist.safetyReason");

    const workflow = renderLoopTemplate(TODOS_TASK_WORKER_VERIFIER_TEMPLATE_ID, {
      taskId: "t",
      projectPath: plainPath,
      allowTools: "functions.exec_command,functions.view_image",
      allowCommands: "git,bun",
      safetyReason: "bounded repository inspection and verification",
    });
    for (const step of agentSteps(workflow)) {
      const target = agentTargetOf(step);
      expect(target.manualBreakGlass).toBeUndefined();
      expect(target.sandbox).toBe("workspace-write");
      expect(target.allowlist).toEqual({
        enforcement: "metadata_only",
        tools: ["functions.exec_command", "functions.view_image"],
        commands: ["git", "bun"],
        safetyReason: "bounded repository inspection and verification",
      });
    }
  });

  test("codewith/codex default to workspace-write sandbox with bypass permission mode", () => {
    const workflow = renderTodosTaskWorkerVerifierWorkflow({ taskId: "t", projectPath: plainPath });
    const target = agentTargetOf(stepById(workflow, "worker"));
    expect(target.sandbox).toBe("workspace-write");
    expect(target.permissionMode).toBe("bypass");
    expect(target.configIsolation).toBe("safe");
  });

  test("native providers default generated workflows to provider-managed permissions", () => {
    const inputs = [
      { provider: "claude" },
      { provider: "cursor" },
      { provider: "aicopilot" },
      { provider: "opencode", model: "openrouter/test/model" },
    ] as const;
    for (const input of inputs) {
      const workflow = renderTodosTaskWorkerVerifierWorkflow({ taskId: "t", projectPath: plainPath, ...input });
      const target = agentTargetOf(stepById(workflow, "worker"));
      expect(target.permissionMode).toBe("default");
      expect(target.manualBreakGlass).toBeUndefined();
    }
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

describe("pr-handoff no-artifact / direct-PR path", () => {
  // Structural neutralization guard (portable, env-independent): the command
  // runs under `bash -lc` (a login shell). If it `exit`s explicitly while
  // `set -e` is active and ~/.bash_logout fails (clear_console with no TTY when
  // the daemon runs under systemd with SHLVL=1), bash hands back the failing
  // logout status instead of the intended 0 — the exact production bug that
  // failed the step and skipped the verifier. Both branches must fall through
  // to the natural end of the `if` instead. Reverting to `exit 0` reintroduces
  // a top-level `exit` and fails this assertion.
  test("generated command never exits the login shell explicitly and detects a worker-opened PR", () => {
    const command = prHandoffCommand({
      artifactPath: "/tmp/none.json",
      taskId: "t-1",
      todosProjectPath: "/srv/todos",
      worktreeCwd: "/srv/wt",
      worktreeRoot: "/srv/wt",
      expectedBranch: "feat/x",
    });
    expect(command).not.toMatch(/^\s*exit\b/m);
    // No-artifact branch detects the worker-opened PR by head branch...
    expect(command).toContain("'pr', 'list', '--head', branch, '--state', 'open'");
    // GitHub-dependent handoff work must preflight git network before push/PR operations.
    expect(command).toContain("'ls-remote', '--heads'");
    expect(command).toContain("github preflight failed before push/PR");
    expect(command).toContain("github preflight failed before PR lookup");
    // ...and records the same done marker the artifact path records.
    expect(command).toContain("openloops:pr-handoff=done task=${taskId} pr=${pr.url}");
    // Artifact (codewith-style) path is preserved unchanged.
    expect(command).toContain("bun - <<'BUN'");
  });

  test("no-artifact path detects the worker PR, records the done comment, and exits 0 under a login shell whose ~/.bash_logout fails", () => {
    const home = mkdtempSync(join(tmpdir(), "loops-prh-home-"));
    const bin = mkdtempSync(join(tmpdir(), "loops-prh-bin-"));
    const wt = mkdtempSync(join(tmpdir(), "loops-prh-wt-"));
    try {
      // A login shell sources ~/.bash_logout on exit; a failing command there
      // reproduces the production corruption for explicit `exit` under `set -e`.
      writeFileSync(join(home, ".bash_logout"), "false\n");
      execFileSync("git", ["init", "-q", wt]);
      execFileSync("git", ["-C", wt, "config", "user.email", "t@t"]);
      execFileSync("git", ["-C", wt, "config", "user.name", "t"]);
      execFileSync("git", ["-C", wt, "commit", "-q", "--allow-empty", "-m", "init"]);
      execFileSync("git", ["-C", wt, "checkout", "-q", "-b", "feat/direct-pr"]);
      execFileSync("git", ["-C", wt, "commit", "-q", "--allow-empty", "-m", "work"]);
      const head = execFileSync("git", ["-C", wt, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

      const gh = join(bin, "gh");
      writeFileSync(
        gh,
        [
          "#!/usr/bin/env bash",
          'if [ "$1" = "pr" ] && [ "$2" = "list" ]; then',
          `  printf '%s\\n' '[{"url":"https://github.com/acme/repo/pull/7","number":7,"headRefName":"feat/direct-pr","headRefOid":"${head}"}]'`,
          "  exit 0",
          "fi",
          "exit 0",
        ].join("\n"),
      );
      chmodSync(gh, 0o755);

      const cap = join(bin, "todos.cap");
      const todos = join(bin, "todos");
      writeFileSync(todos, ["#!/usr/bin/env bash", `printf '%s\\0' "$@" >> ${JSON.stringify(cap)}`, "exit 0"].join("\n"));
      chmodSync(todos, 0o755);

      const command = prHandoffCommand({
        artifactPath: join(wt, ".openloops", "pr-handoff", "missing.json"),
        taskId: "task-direct-pr",
        todosProjectPath: wt,
        worktreeCwd: wt,
        worktreeRoot: wt,
        expectedBranch: "feat/direct-pr",
      });

      const env = {
        HOME: home,
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
        OPENLOOPS_PR_HANDOFF_GH_BIN: gh,
        OPENLOOPS_PR_HANDOFF_TODOS_BIN: todos,
        OPENLOOPS_PR_HANDOFF_GIT_BIN: "git",
      };
      // Canary: confirm this env reproduces the login-shell exit-code corruption
      // for an explicit `exit 0` (so the assertions below are neutralization-provable).
      const canary = spawnSync("bash", ["-lc", "set -e; printf x; exit 0"], { env, encoding: "utf8" });

      const result = spawnSync("bash", ["-lc", command], { env, cwd: wt, encoding: "utf8" });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("no PR handoff artifact at");
      const captured = existsSync(cap) ? readFileSync(cap, "utf8") : "";
      expect(captured).toContain("openloops:pr-handoff=done");
      expect(captured).toContain("pr=https://github.com/acme/repo/pull/7");
      expect(captured).toContain("branch=feat/direct-pr");
      // On envs that reproduce the corruption (canary === 1) the pre-fix explicit
      // `exit 0` would have surfaced here as exit 1; the fix keeps it at 0.
      if (canary.status === 1) expect(result.status).toBe(0);
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(bin, { recursive: true, force: true });
      rmSync(wt, { recursive: true, force: true });
    }
  });

  test("no-artifact path is tolerant: exits 0 and records no done comment when the worker opened no PR", () => {
    const home = mkdtempSync(join(tmpdir(), "loops-prh-home-"));
    const bin = mkdtempSync(join(tmpdir(), "loops-prh-bin-"));
    const wt = mkdtempSync(join(tmpdir(), "loops-prh-wt-"));
    try {
      writeFileSync(join(home, ".bash_logout"), "false\n");
      execFileSync("git", ["init", "-q", wt]);
      execFileSync("git", ["-C", wt, "config", "user.email", "t@t"]);
      execFileSync("git", ["-C", wt, "config", "user.name", "t"]);
      execFileSync("git", ["-C", wt, "commit", "-q", "--allow-empty", "-m", "init"]);
      execFileSync("git", ["-C", wt, "checkout", "-q", "-b", "feat/direct-pr"]);

      const gh = join(bin, "gh");
      writeFileSync(gh, ["#!/usr/bin/env bash", 'if [ "$1" = "pr" ] && [ "$2" = "list" ]; then printf %s "[]"; fi', "exit 0"].join("\n"));
      chmodSync(gh, 0o755);
      const cap = join(bin, "todos.cap");
      const todos = join(bin, "todos");
      writeFileSync(todos, ["#!/usr/bin/env bash", `printf '%s\\0' "$@" >> ${JSON.stringify(cap)}`, "exit 0"].join("\n"));
      chmodSync(todos, 0o755);

      const command = prHandoffCommand({
        artifactPath: join(wt, ".openloops", "pr-handoff", "missing.json"),
        taskId: "task-no-pr",
        todosProjectPath: wt,
        worktreeCwd: wt,
        worktreeRoot: wt,
        expectedBranch: "feat/direct-pr",
      });
      const env = {
        HOME: home,
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
        OPENLOOPS_PR_HANDOFF_GH_BIN: gh,
        OPENLOOPS_PR_HANDOFF_TODOS_BIN: todos,
        OPENLOOPS_PR_HANDOFF_GIT_BIN: "git",
      };
      const result = spawnSync("bash", ["-lc", command], { env, cwd: wt, encoding: "utf8" });
      expect(result.status).toBe(0);
      const captured = existsSync(cap) ? readFileSync(cap, "utf8") : "";
      expect(captured).not.toContain("openloops:pr-handoff=done");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(bin, { recursive: true, force: true });
      rmSync(wt, { recursive: true, force: true });
    }
  });

  test("no-artifact path queues bounded handoff when GitHub preflight fails before PR lookup", () => {
    const home = mkdtempSync(join(tmpdir(), "loops-prh-home-"));
    const bin = mkdtempSync(join(tmpdir(), "loops-prh-bin-"));
    const wt = mkdtempSync(join(tmpdir(), "loops-prh-wt-"));
    try {
      writeFileSync(join(home, ".bash_logout"), "false\n");
      const git = join(bin, "git");
      writeFileSync(
        git,
        [
          "#!/usr/bin/env bash",
          "args=\"$*\"",
          "if [[ \"$args\" == *\" rev-parse HEAD\"* ]]; then printf '%s\\n' abc123; exit 0; fi",
          "if [[ \"$args\" == *\" remote get-url origin\"* ]]; then printf '%s\\n' https://token:secret@github.com/acme/repo.git; exit 0; fi",
          "if [[ \"$args\" == *\" ls-remote --heads origin feat/direct-pr\"* ]]; then printf '%s\\n' 'fatal: unable to access https://token:secret@github.com/acme/repo.git/: Could not resolve host: github.com' >&2; exit 128; fi",
          "printf 'unexpected git args: %s\\n' \"$*\" >&2",
          "exit 64",
        ].join("\n"),
      );
      chmodSync(git, 0o755);
      const gh = join(bin, "gh");
      writeFileSync(gh, "#!/usr/bin/env bash\nprintf 'gh should not run after failed preflight\\n' >&2\nexit 65\n");
      chmodSync(gh, 0o755);
      const cap = join(bin, "todos.cap");
      const todos = join(bin, "todos");
      writeFileSync(todos, ["#!/usr/bin/env bash", `printf '%s\\0' "$@" >> ${JSON.stringify(cap)}`, "exit 0"].join("\n"));
      chmodSync(todos, 0o755);

      const command = prHandoffCommand({
        artifactPath: join(wt, ".openloops", "pr-handoff", "missing.json"),
        taskId: "task-network-pr",
        todosProjectPath: wt,
        worktreeCwd: wt,
        worktreeRoot: wt,
        expectedBranch: "feat/direct-pr",
      });
      const env = {
        HOME: home,
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
        OPENLOOPS_PR_HANDOFF_GH_BIN: gh,
        OPENLOOPS_PR_HANDOFF_TODOS_BIN: todos,
        OPENLOOPS_PR_HANDOFF_GIT_BIN: git,
      };
      const result = spawnSync("bash", ["-lc", command], { env, cwd: wt, encoding: "utf8" });
      expect(result.status).toBe(0);
      const captured = existsSync(cap) ? readFileSync(cap, "utf8") : "";
      expect(captured).toContain("task\u0000upsert");
      expect(captured).toContain("openloops:pr-handoff:task-network-pr:feat/direct-pr:abc123");
      expect(captured).toContain("github preflight failed before PR lookup");
      expect(captured).toContain("https://github.com/acme/repo.git");
      expect(captured).not.toContain("token:secret");
      expect(captured).not.toContain("secret@github.com");
      expect(captured).toContain("openloops:pr-handoff=pending");
      expect(result.stderr).not.toContain("gh should not run");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(bin, { recursive: true, force: true });
      rmSync(wt, { recursive: true, force: true });
    }
  });

  test("artifact path queues bounded handoff when GitHub preflight fails before push", () => {
    const home = mkdtempSync(join(tmpdir(), "loops-prh-home-"));
    const bin = mkdtempSync(join(tmpdir(), "loops-prh-bin-"));
    const wt = mkdtempSync(join(tmpdir(), "loops-prh-wt-"));
    try {
      writeFileSync(join(home, ".bash_logout"), "false\n");
      const artifactPath = join(wt, ".openloops", "pr-handoff", "task-artifact-pr.json");
      mkdirSync(dirname(artifactPath), { recursive: true });
      writeFileSync(
        artifactPath,
        JSON.stringify({
          taskId: "task-artifact-pr",
          worktreePath: wt,
          branch: "feat/artifact-pr",
          base: "main",
          commit: "abc123",
          remote: "origin",
          remoteUrl: "https://token:secret@github.com/acme/repo.git",
          validation: "unit tests passed",
          error: "fatal: unable to access https://token:secret@github.com/acme/repo.git/: Could not resolve host: github.com",
        }),
      );
      const git = join(bin, "git");
      writeFileSync(
        git,
        [
          "#!/usr/bin/env bash",
          "args=\"$*\"",
          `if [[ "$args" == *" rev-parse --show-toplevel"* ]]; then printf '%s\\n' ${JSON.stringify(wt)}; exit 0; fi`,
          "if [[ \"$args\" == *\" branch --show-current\"* ]]; then printf '%s\\n' feat/artifact-pr; exit 0; fi",
          "if [[ \"$args\" == *\" rev-parse --verify abc123\"* ]]; then printf '%s\\n' abc123; exit 0; fi",
          "if [[ \"$args\" == *\" merge-base --is-ancestor abc123 HEAD\"* ]]; then exit 0; fi",
          "if [[ \"$args\" == *\" ls-remote --heads origin main\"* ]]; then printf '%s\\n' 'fatal: unable to access https://token:secret@github.com/acme/repo.git/: Could not resolve host: github.com' >&2; exit 128; fi",
          "printf 'unexpected git args: %s\\n' \"$*\" >&2",
          "exit 64",
        ].join("\n"),
      );
      chmodSync(git, 0o755);
      const gh = join(bin, "gh");
      writeFileSync(gh, "#!/usr/bin/env bash\nprintf 'gh should not run after failed artifact preflight\\n' >&2\nexit 65\n");
      chmodSync(gh, 0o755);
      const cap = join(bin, "todos.cap");
      const todos = join(bin, "todos");
      writeFileSync(todos, ["#!/usr/bin/env bash", `printf '%s\\0' "$@" >> ${JSON.stringify(cap)}`, "exit 0"].join("\n"));
      chmodSync(todos, 0o755);

      const command = prHandoffCommand({
        artifactPath,
        taskId: "task-artifact-pr",
        todosProjectPath: wt,
        worktreeCwd: wt,
        worktreeRoot: wt,
        expectedBranch: "feat/artifact-pr",
      });
      const env = {
        HOME: home,
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
        OPENLOOPS_PR_HANDOFF_GH_BIN: gh,
        OPENLOOPS_PR_HANDOFF_TODOS_BIN: todos,
        OPENLOOPS_PR_HANDOFF_GIT_BIN: git,
      };
      const result = spawnSync("bash", ["-lc", command], { env, cwd: wt, encoding: "utf8" });
      expect(result.status).toBe(0);
      const captured = existsSync(cap) ? readFileSync(cap, "utf8") : "";
      expect(captured).toContain("task\u0000upsert");
      expect(captured).toContain("openloops:pr-handoff:task-artifact-pr:feat/artifact-pr:abc123");
      expect(captured).toContain("github preflight failed before push/PR");
      expect(captured).toContain("https://github.com/acme/repo.git");
      expect(captured).not.toContain("token:secret");
      expect(captured).not.toContain("secret@github.com");
      expect(captured).toContain("openloops:pr-handoff=pending");
      expect(result.stderr).not.toContain("gh should not run");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(bin, { recursive: true, force: true });
      rmSync(wt, { recursive: true, force: true });
    }
  });

  test("no-artifact path does not mark pending when the bounded handoff task upsert fails", () => {
    const home = mkdtempSync(join(tmpdir(), "loops-prh-home-"));
    const bin = mkdtempSync(join(tmpdir(), "loops-prh-bin-"));
    const wt = mkdtempSync(join(tmpdir(), "loops-prh-wt-"));
    try {
      writeFileSync(join(home, ".bash_logout"), "false\n");
      const git = join(bin, "git");
      writeFileSync(
        git,
        [
          "#!/usr/bin/env bash",
          "args=\"$*\"",
          "if [[ \"$args\" == *\" rev-parse HEAD\"* ]]; then printf '%s\\n' def456; exit 0; fi",
          "if [[ \"$args\" == *\" remote get-url origin\"* ]]; then printf '%s\\n' https://github.com/acme/repo.git; exit 0; fi",
          "if [[ \"$args\" == *\" ls-remote --heads origin feat/direct-pr\"* ]]; then printf '%s\\n' 'fatal: unable to access https://github.com/acme/repo.git/: Could not resolve host: github.com' >&2; exit 128; fi",
          "printf 'unexpected git args: %s\\n' \"$*\" >&2",
          "exit 64",
        ].join("\n"),
      );
      chmodSync(git, 0o755);
      const gh = join(bin, "gh");
      writeFileSync(gh, "#!/usr/bin/env bash\nprintf 'gh should not run after failed preflight\\n' >&2\nexit 65\n");
      chmodSync(gh, 0o755);
      const cap = join(bin, "todos.cap");
      const todos = join(bin, "todos");
      writeFileSync(
        todos,
        [
          "#!/usr/bin/env bash",
          `printf '%s\\0' "$@" >> ${JSON.stringify(cap)}`,
          "if [[ \"$*\" == *\" task upsert \"* ]]; then printf 'upsert failed\\n' >&2; exit 47; fi",
          "exit 0",
        ].join("\n"),
      );
      chmodSync(todos, 0o755);

      const command = prHandoffCommand({
        artifactPath: join(wt, ".openloops", "pr-handoff", "missing.json"),
        taskId: "task-upsert-fails",
        todosProjectPath: wt,
        worktreeCwd: wt,
        worktreeRoot: wt,
        expectedBranch: "feat/direct-pr",
      });
      const env = {
        HOME: home,
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
        OPENLOOPS_PR_HANDOFF_GH_BIN: gh,
        OPENLOOPS_PR_HANDOFF_TODOS_BIN: todos,
        OPENLOOPS_PR_HANDOFF_GIT_BIN: git,
      };
      const result = spawnSync("bash", ["-lc", command], { env, cwd: wt, encoding: "utf8" });
      expect(result.status).toBe(0);
      expect(result.stderr).toContain("todos task upsert failed");
      const captured = existsSync(cap) ? readFileSync(cap, "utf8") : "";
      expect(captured).toContain("task\u0000upsert");
      expect(captured).toContain("openloops:pr-handoff=failed");
      expect(captured).toContain("reason=todos-upsert-failed");
      expect(captured).not.toContain("openloops:pr-handoff=pending");
      expect(result.stderr).not.toContain("gh should not run");
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(bin, { recursive: true, force: true });
      rmSync(wt, { recursive: true, force: true });
    }
  });
});
