import { getActionLogs, listModelUsage } from "../db/index.js";
import {
  getWorkflowRun,
  listApprovals,
  listArtifacts,
  listObservations,
  listPolicyDecisions,
  listRunSteps,
  type WorkflowRun,
} from "../agent/runtime.js";

export type DashboardTimelineKind =
  | "run_step"
  | "model_decision"
  | "action"
  | "observation"
  | "approval"
  | "artifact"
  | "policy"
  | "verifier"
  | "model_usage";

export interface DashboardTimelineItem {
  id: string;
  kind: DashboardTimelineKind;
  source: string;
  timestamp: string;
  title: string;
  summary?: string;
  status?: string;
  step?: number;
  capability?: string;
  action?: unknown;
  result?: unknown;
  data?: unknown;
  artifact_path?: string;
  duration_ms?: number;
  tokens?: {
    input: number;
    output: number;
    total: number;
  };
  provider?: string;
  model?: string;
  cost_usd?: number;
}

export interface DashboardTimelineSnapshot {
  run: WorkflowRun | null;
  items: DashboardTimelineItem[];
  counts: Record<DashboardTimelineKind, number>;
  last_event_at?: string;
}

const KIND_SORT_PRIORITY: Record<DashboardTimelineKind, number> = {
  run_step: 10,
  model_decision: 20,
  action: 30,
  model_usage: 40,
  approval: 50,
  policy: 60,
  observation: 70,
  artifact: 80,
  verifier: 90,
};

export function buildSessionTimeline(sessionId: string): DashboardTimelineSnapshot {
  const run = getWorkflowRun(sessionId);
  const items: DashboardTimelineItem[] = [];

  for (const step of listRunSteps(sessionId)) {
    const action = redactSensitiveAction(step.action);
    items.push({
      id: `run-step:${step.id}`,
      kind: "run_step",
      source: "run_steps",
      timestamp: step.updated_at || step.created_at,
      title: `Step ${step.step_index + 1}`,
      summary: summarizeRuntimeStep(action, step.result),
      status: step.status,
      step: step.step_index,
      action,
      result: step.result,
    });
  }

  for (const log of getActionLogs(sessionId)) {
    const action = redactSensitiveAction(log.action);
    const title = typeof log.action?.type === "string" ? `Model chose ${log.action.type}` : "Model decision";
    items.push({
      id: `model-decision:${log.id}`,
      kind: "model_decision",
      source: "action_logs",
      timestamp: log.created_at,
      title,
      summary: log.reasoning,
      status: log.success ? "accepted" : "failed",
      step: log.step,
      action,
      tokens: tokenSummary(log.tokens_in, log.tokens_out),
    });
    items.push({
      id: `action:${log.id}`,
      kind: "action",
      source: "action_logs",
      timestamp: log.created_at,
      title: formatActionTitle(log.action),
      summary: log.error ?? actionSummary(log.action),
      status: log.success ? "succeeded" : "failed",
      step: log.step,
      action,
      artifact_path: log.screenshot_path,
      duration_ms: log.duration_ms,
      tokens: tokenSummary(log.tokens_in, log.tokens_out),
    });
  }

  for (const approval of listApprovals(sessionId)) {
    items.push({
      id: `approval:${approval.id}`,
      kind: "approval",
      source: "approvals",
      timestamp: approval.resolved_at ?? approval.created_at,
      title: `Approval: ${approval.capability}`,
      summary: approval.reason,
      status: approval.status,
      capability: approval.capability,
    });
  }

  for (const decision of listPolicyDecisions(sessionId)) {
    items.push({
      id: `policy:${decision.id}`,
      kind: "policy",
      source: "policy_decisions",
      timestamp: decision.created_at,
      title: `Policy: ${decision.capability}`,
      summary: decision.reason,
      status: decision.decision,
      capability: decision.capability,
      data: decision.metadata,
    });
  }

  for (const observation of listObservations(sessionId)) {
    const isVerifier = observation.kind === "verifier_decision";
    items.push({
      id: `observation:${observation.id}`,
      kind: isVerifier ? "verifier" : "observation",
      source: "observations",
      timestamp: observation.created_at,
      title: isVerifier ? "Verifier result" : `Observation: ${observation.kind}`,
      summary: summarizeObservation(observation.data),
      data: observation.data,
    });
  }

  for (const artifact of listArtifacts(sessionId)) {
    items.push({
      id: `artifact:${artifact.id}`,
      kind: "artifact",
      source: "artifacts",
      timestamp: artifact.created_at,
      title: `Artifact: ${artifact.kind}`,
      summary: artifact.sha256 ? `sha256 ${artifact.sha256}` : undefined,
      artifact_path: artifact.path,
      data: artifact.metadata,
    });
  }

  const usageById = new Map<string, ReturnType<typeof listModelUsage>[number]>();
  for (const event of [...listModelUsage({ runId: sessionId }), ...listModelUsage({ sessionId })]) {
    usageById.set(event.id, event);
  }
  for (const event of usageById.values()) {
    items.push({
      id: `model-usage:${event.id}`,
      kind: "model_usage",
      source: "model_usage",
      timestamp: event.created_at,
      title: `Model usage: ${event.phase}`,
      summary: `${event.input_tokens + event.output_tokens} tokens`,
      status: event.phase,
      tokens: {
        input: event.input_tokens,
        output: event.output_tokens,
        total: event.input_tokens + event.output_tokens,
      },
      provider: event.provider,
      model: event.model,
      cost_usd: event.cost_usd,
      data: event.metadata,
    });
  }

  const ordered = orderTimelineItems(items);
  const counts = emptyCounts();
  for (const item of ordered) counts[item.kind] += 1;

  return {
    run,
    items: ordered,
    counts,
    last_event_at: ordered.length > 0 ? ordered[ordered.length - 1]!.timestamp : undefined,
  };
}

function orderTimelineItems(items: DashboardTimelineItem[]): DashboardTimelineItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const time = timestampSortKey(a.item.timestamp) - timestampSortKey(b.item.timestamp);
      if (time !== 0) return time;
      const kind = KIND_SORT_PRIORITY[a.item.kind] - KIND_SORT_PRIORITY[b.item.kind];
      if (kind !== 0) return kind;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}

function emptyCounts(): Record<DashboardTimelineKind, number> {
  return {
    run_step: 0,
    model_decision: 0,
    action: 0,
    observation: 0,
    approval: 0,
    artifact: 0,
    policy: 0,
    verifier: 0,
    model_usage: 0,
  };
}

function timestampSortKey(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) return parsed;
  const sqliteParsed = Date.parse(`${value.replace(" ", "T")}Z`);
  return Number.isNaN(sqliteParsed) ? 0 : sqliteParsed;
}

function tokenSummary(input?: number, output?: number): DashboardTimelineItem["tokens"] | undefined {
  const inTokens = input ?? 0;
  const outTokens = output ?? 0;
  if (inTokens === 0 && outTokens === 0) return undefined;
  return {
    input: inTokens,
    output: outTokens,
    total: inTokens + outTokens,
  };
}

function formatActionTitle(action: unknown): string {
  const type = actionType(action);
  return type ? `Action: ${type}` : "Action";
}

function actionSummary(action: unknown): string | undefined {
  if (!action || typeof action !== "object") return undefined;
  if (actionType(action) === "click" && "point" in action) {
    const point = (action as { point?: { x?: unknown; y?: unknown } }).point;
    if (typeof point?.x === "number" && typeof point.y === "number") return `at ${point.x}, ${point.y}`;
  }
  if (actionType(action) === "type" && "text" in action) return "typed text";
  if (actionType(action) === "open_url" && "url" in action) return String((action as { url: unknown }).url);
  return undefined;
}

function actionType(action: unknown): string | undefined {
  if (!action || typeof action !== "object" || !("type" in action)) return undefined;
  const type = (action as { type?: unknown }).type;
  return typeof type === "string" ? type : undefined;
}

function redactSensitiveAction(action: unknown): unknown {
  if (!action || typeof action !== "object") return action;
  const record = action as Record<string, unknown>;
  if (record.type !== "type") return action;
  return {
    ...record,
    text: "[redacted]",
    text_length: typeof record.text === "string" ? record.text.length : undefined,
  };
}

function summarizeRuntimeStep(action: unknown, result: unknown): string | undefined {
  const actionLabel = actionType(action);
  const resultText = summarizeData(result);
  if (actionLabel && resultText) return `${actionLabel}: ${resultText}`;
  return actionLabel ?? resultText;
}

function summarizeObservation(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return summarizeData(data);
  const record = data as Record<string, unknown>;
  for (const key of ["summary", "reason", "next_step", "path"] as const) {
    if (typeof record[key] === "string") return record[key] as string;
  }
  if (typeof record.status === "string" && typeof record.confidence === "number") {
    return `${record.status} (${Math.round(record.confidence * 100)}% confidence)`;
  }
  return summarizeData(data);
}

function summarizeData(data: unknown): string | undefined {
  if (data === undefined || data === null) return undefined;
  if (typeof data === "string") return data;
  if (typeof data === "number" || typeof data === "boolean") return String(data);
  try {
    return JSON.stringify(data);
  } catch {
    return undefined;
  }
}
