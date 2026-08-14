import { createHash } from "node:crypto";
import type { AgentSessionContract, WorkflowSpec } from "../types.js";
import { workflowStepAgentSessionContract } from "./agent-adapter.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

export function workflowDefinitionHash(workflow: WorkflowSpec): string {
  const definition = canonicalize({
    id: workflow.id,
    name: workflow.name,
    version: workflow.version,
    goal: workflow.goal,
    steps: workflow.steps,
  });
  return `sha256:${createHash("sha256").update(JSON.stringify(definition)).digest("hex")}`;
}

export interface InitialAgentSessionContractEvent {
  eventType: "agent_session_contract";
  stepId: string;
  payload: Record<string, unknown>;
}

function contractPayload(contract: AgentSessionContract): Record<string, unknown> {
  return JSON.parse(JSON.stringify(contract)) as Record<string, unknown>;
}

export function initialAgentSessionContractEvents(workflow: WorkflowSpec): InitialAgentSessionContractEvent[] {
  const events: InitialAgentSessionContractEvent[] = [];
  for (const step of workflow.steps) {
    if (step.target.type !== "agent") continue;
    const contract = workflowStepAgentSessionContract(step);
    if (!contract) continue;
    events.push({ eventType: "agent_session_contract", stepId: step.id, payload: contractPayload(contract) });
  }
  return events;
}
