import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { redactValue } from "./redaction.js";

export interface AgentReplayOptions {
  agent_id?: string;
  scenario?: string;
}

export interface AgentReplayStep {
  index: number;
  type: "context" | "plan" | "transition" | "command" | "file" | "artifact" | "approval" | "failure";
  source: string;
  label: string;
  status: string;
  command?: string;
  from_status?: string | null;
  to_status?: string | null;
  gate?: string;
  message?: string | null;
}

export interface AgentReplaySimulation {
  schema_version: 1;
  mode: "dry-run";
  mutates_database: false;
  scenario: string;
  fingerprint: string;
  agent_id: string | null;
  task: {
    id: string | null;
    title: string | null;
    initial_status: string | null;
    final_status: string | null;
  };
  plan: {
    id: string | null;
    name: string | null;
    status: string | null;
    task_count: number;
  } | null;
  steps: AgentReplayStep[];
  commands: {
    total: number;
    passed: number;
    failed: number;
    unknown: number;
  };
  approvals: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    expired: number;
  };
  failures: Array<{ source: string; message: string; command?: string }>;
  snapshot: {
    task_status: string | null;
    plan_status: string | null;
    files: string[];
    artifacts: string[];
    warnings: string[];
  };
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function asArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function normalizedStatus(value: unknown, fallback = "unknown"): string {
  return text(value) || fallback;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function unpackFixture(input: unknown): JsonObject {
  if (!isObject(input)) throw new Error("Replay fixture must be a JSON object");
  const contextPack = input["context_pack"];
  return isObject(contextPack) ? contextPack : input;
}

function approvalStatus(status: string): "pending" | "approved" | "rejected" | "expired" {
  if (status === "approved" || status === "rejected" || status === "expired") return status;
  return "pending";
}

function approvalsFromFixture(fixture: JsonObject, runs: JsonObject[]): Array<{ gate: string; status: "pending" | "approved" | "rejected" | "expired"; source: string; message: string | null }> {
  const explicit = [
    ...asArray(fixture["approvals"]),
    ...asArray(fixture["approval_decisions"]),
  ].map((item) => ({
    gate: text(item["gate"]) || text(item["name"]) || "approval",
    status: approvalStatus(normalizedStatus(item["status"], "pending")),
    source: "fixture.approvals",
    message: text(item["note"]) || text(item["reason"]),
  }));

  const fromEvents: Array<{ gate: string; status: "pending" | "approved" | "rejected" | "expired"; source: string; message: string | null }> = [];
  for (const run of runs) {
    for (const event of asArray(run["events"])) {
      const message = text(event["message"]);
      const data = isObject(event["data"]) ? event["data"] : {};
      const gate = text(data["gate"]) || text(data["approval_gate_name"]) || message?.match(/approval gate \w+: ([^\s]+)/)?.[1];
      const rawStatus = text(data["status"]) || message?.match(/approval gate (\w+):/)?.[1];
      if (gate && rawStatus) {
        fromEvents.push({
          gate,
          status: approvalStatus(rawStatus),
          source: "run.events",
          message,
        });
      }
    }
  }
  return [...explicit, ...fromEvents];
}

export function simulateAgentReplay(input: unknown, options: AgentReplayOptions = {}): AgentReplaySimulation {
  const fixture = redactValue(unpackFixture(input)) as JsonObject;
  const task = isObject(fixture["task"]) ? fixture["task"] : {};
  const plan = isObject(fixture["plan"]) ? fixture["plan"] : null;
  const runsContainer = isObject(fixture["runs"]) ? fixture["runs"] : {};
  const runs = asArray(runsContainer["items"] ?? fixture["runs"]);
  const traceability = isObject(fixture["traceability"]) ? fixture["traceability"] : {};
  const verifications = asArray(traceability["verifications"]);
  const steps: AgentReplayStep[] = [];
  const failures: AgentReplaySimulation["failures"] = [];
  const files = new Set<string>();
  const artifacts = new Set<string>();
  let currentStatus = text(task["status"]);

  function push(step: Omit<AgentReplayStep, "index">): void {
    steps.push({ index: steps.length + 1, ...step });
  }

  push({
    type: "context",
    source: "fixture.task",
    label: text(task["title"]) || "replay task",
    status: currentStatus || "unknown",
    to_status: currentStatus,
  });

  if (plan) {
    const planTasks = asArray(plan["tasks"]);
    push({
      type: "plan",
      source: "fixture.plan",
      label: text(plan["name"]) || text(plan["description"]) || "plan",
      status: normalizedStatus(plan["status"]),
      message: `${planTasks.length} plan task(s) in replay fixture`,
    });
  }

  for (const run of runs) {
    const runStatus = normalizedStatus(run["status"]);
    for (const event of asArray(run["events"])) {
      const eventType = normalizedStatus(event["event_type"]);
      const message = text(event["message"]);
      if (["started", "completed", "failed", "cancelled"].includes(eventType)) {
        const previous = currentStatus;
        currentStatus = eventType === "started" ? "in_progress" : eventType;
        push({
          type: "transition",
          source: "run.events",
          label: message || `run ${eventType}`,
          status: eventType,
          from_status: previous,
          to_status: currentStatus,
          message,
        });
        if (eventType === "failed") failures.push({ source: "run.events", message: message || "run failed" });
      } else {
        push({
          type: eventType === "file" ? "file" : eventType === "artifact" ? "artifact" : "transition",
          source: "run.events",
          label: message || eventType,
          status: eventType,
          message,
        });
      }
    }
    if (["completed", "failed", "cancelled"].includes(runStatus)) currentStatus = runStatus;

    for (const command of asArray(run["commands"])) {
      const status = normalizedStatus(command["status"]);
      const commandText = text(command["command"]) || "command";
      push({
        type: "command",
        source: "run.commands",
        label: commandText,
        status,
        command: commandText,
        message: text(command["output_summary"]),
      });
      if (status === "failed") failures.push({ source: "run.commands", message: text(command["output_summary"]) || "command failed", command: commandText });
    }
    for (const file of asArray(run["files"])) {
      const path = text(file["path"]);
      if (path) files.add(path);
      push({ type: "file", source: "run.files", label: path || "file", status: normalizedStatus(file["status"], "touched"), message: text(file["note"]) });
    }
    for (const artifact of asArray(run["artifacts"])) {
      const path = text(artifact["path"]);
      if (path) artifacts.add(path);
      push({ type: "artifact", source: "run.artifacts", label: path || "artifact", status: text(artifact["artifact_type"]) || "artifact", message: text(artifact["description"]) });
    }
  }

  for (const verification of verifications) {
    const status = normalizedStatus(verification["status"]);
    const commandText = text(verification["command"]) || "verification";
    push({
      type: "command",
      source: "traceability.verifications",
      label: commandText,
      status,
      command: commandText,
      message: text(verification["output_summary"]),
    });
    if (status === "failed") failures.push({ source: "traceability.verifications", message: text(verification["output_summary"]) || "verification failed", command: commandText });
  }

  const approvals = approvalsFromFixture(fixture, runs);
  for (const approval of approvals) {
    push({
      type: "approval",
      source: approval.source,
      label: approval.gate,
      status: approval.status,
      gate: approval.gate,
      message: approval.message,
    });
    if (approval.status === "rejected" || approval.status === "expired") failures.push({ source: approval.source, message: `approval ${approval.gate} is ${approval.status}` });
  }

  const commandSteps = steps.filter((step) => step.type === "command");
  const warnings: string[] = [];
  if (!task["id"]) warnings.push("fixture has no task id");
  if (approvals.some((approval) => approval.status === "pending")) warnings.push("replay contains pending approval gates");
  if (failures.length > 0) warnings.push("replay contains failed commands, runs, or approvals");

  return {
    schema_version: 1,
    mode: "dry-run",
    mutates_database: false,
    scenario: options.scenario || text(fixture["scenario"]) || "agent-replay",
    fingerprint: fingerprint({ fixture, options }),
    agent_id: options.agent_id || text(fixture["agent_id"]) || null,
    task: {
      id: text(task["id"]),
      title: text(task["title"]),
      initial_status: text(task["status"]),
      final_status: currentStatus,
    },
    plan: plan ? {
      id: text(plan["id"]),
      name: text(plan["name"]) || text(plan["description"]),
      status: text(plan["status"]),
      task_count: asArray(plan["tasks"]).length,
    } : null,
    steps,
    commands: {
      total: commandSteps.length,
      passed: commandSteps.filter((step) => step.status === "passed").length,
      failed: commandSteps.filter((step) => step.status === "failed").length,
      unknown: commandSteps.filter((step) => step.status !== "passed" && step.status !== "failed").length,
    },
    approvals: {
      total: approvals.length,
      pending: approvals.filter((approval) => approval.status === "pending").length,
      approved: approvals.filter((approval) => approval.status === "approved").length,
      rejected: approvals.filter((approval) => approval.status === "rejected").length,
      expired: approvals.filter((approval) => approval.status === "expired").length,
    },
    failures,
    snapshot: {
      task_status: currentStatus,
      plan_status: plan ? text(plan["status"]) : null,
      files: [...files].sort(),
      artifacts: [...artifacts].sort(),
      warnings,
    },
  };
}

export function simulateAgentReplayFile(path: string, options: AgentReplayOptions = {}): AgentReplaySimulation {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  return simulateAgentReplay(parsed, options);
}

export function renderAgentReplaySimulationMarkdown(simulation: AgentReplaySimulation): string {
  const lines = [
    `# Agent Replay Simulation: ${simulation.task.title || simulation.task.id || simulation.scenario}`,
    "",
    `Mode: ${simulation.mode}`,
    `Mutates database: ${simulation.mutates_database ? "yes" : "no"}`,
    `Fingerprint: ${simulation.fingerprint}`,
    "",
    "## Snapshot",
    `- Task status: ${simulation.snapshot.task_status || "unknown"}`,
    `- Commands: ${simulation.commands.passed} passed, ${simulation.commands.failed} failed, ${simulation.commands.unknown} unknown`,
    `- Approvals: ${simulation.approvals.approved} approved, ${simulation.approvals.pending} pending, ${simulation.approvals.rejected} rejected, ${simulation.approvals.expired} expired`,
    "",
    "## Steps",
    ...simulation.steps.map((step) => `- ${step.index}. ${step.type} [${step.status}] ${step.label}`),
    "",
    "## Warnings",
    ...(simulation.snapshot.warnings.length ? simulation.snapshot.warnings.map((warning) => `- ${warning}`) : ["- none"]),
  ];
  return lines.join("\n");
}
