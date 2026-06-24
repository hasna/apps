import { logAuditEvent } from "../db/index.js";
import type { DriverAction, SafetyConfig } from "../types/index.js";
import { loadConfig } from "../lib/config.js";
import {
  evaluateComputerAction,
  formatPolicyRejection,
  guardTerminalCommandPolicy,
  recordActionPolicyAudit,
  type ActionPolicyDecision,
} from "./policy.js";
import {
  plannerToolSchemas,
  type AppToolInput,
  type BrowserToolInput,
  type ComputerToolInput,
  type FleetToolInput,
  type PlannerToolName,
  type StorageToolInput,
  type TerminalToolInput,
} from "./planner-tools.js";
import {
  evaluateFleetTransport,
  isFleetMutation,
  type FleetCapabilityTokenVerifier,
  type FleetTransportRequest,
} from "./fleet-transport.js";
import {
  evaluateFleetArtifactPullContract,
  type FleetArtifactMaterializeApproval,
} from "./fleet-artifacts.js";

export type CapabilitySubsystem =
  | "computer"
  | "open-browser"
  | "ghostty"
  | "app"
  | "open-machines"
  | "storage"
  | "memory"
  | "approval"
  | "observation";

export type CapabilityRouteStatus = "allowed" | "requires_confirmation" | "blocked" | "invalid";

export interface CapabilityRouterOptions {
  approved?: boolean;
  safety?: SafetyConfig;
  sessionId?: string;
  workspaceRoots?: string[];
  actor?: string;
  transport?: string;
  fleetTransport?: FleetTransportRequest;
  verifyFleetCapabilityToken?: FleetCapabilityTokenVerifier;
  artifactPullApproval?: FleetArtifactMaterializeApproval;
  metadata?: Record<string, unknown>;
}

export interface CapabilityRouteResult {
  toolName: PlannerToolName;
  subsystem: CapabilitySubsystem;
  capability: string;
  status: CapabilityRouteStatus;
  allowed: boolean;
  reason?: string;
  input?: unknown;
}

export async function routePlannerTool(
  toolName: PlannerToolName,
  input: unknown,
  options: CapabilityRouterOptions = {},
): Promise<CapabilityRouteResult> {
  const schema = plannerToolSchemas[toolName];
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const result: CapabilityRouteResult = {
      toolName,
      subsystem: subsystemForTool(toolName),
      capability: `planner.${toolName}`,
      status: "invalid",
      allowed: false,
      reason: parsed.error.issues.map((issue) => issue.message).join("; "),
    };
    await recordRouteAudit(result, input, options);
    return result;
  }

  switch (toolName) {
    case "computer":
      return routeComputer(parsed.data as ComputerToolInput, options);
    case "terminal":
      return routeTerminal(parsed.data as TerminalToolInput, options);
    case "app":
      return routeApp(parsed.data as AppToolInput, options);
    case "browser":
      return routeApprovalBacked(toolName, "open-browser", `browser.${(parsed.data as BrowserToolInput).action}`, parsed.data, options, isBrowserReadOnly(parsed.data as BrowserToolInput));
    case "fleet":
      return routeFleet(parsed.data as FleetToolInput, options);
    case "storage":
      return routeApprovalBacked(toolName, "storage", `storage.${(parsed.data as StorageToolInput).action}`, parsed.data, options, (parsed.data as StorageToolInput).action === "status");
    case "memory":
      return routeApprovalBacked(toolName, "memory", "memory.record", parsed.data, options, true);
    case "approval":
      return routeApprovalBacked(toolName, "approval", "approval.request", parsed.data, options, true);
    case "observation":
      return routeApprovalBacked(toolName, "observation", "observation.record", parsed.data, options, true);
  }
}

async function routeFleet(input: FleetToolInput, options: CapabilityRouterOptions): Promise<CapabilityRouteResult> {
  const capability = `fleet.${input.action}`;
  const artifactDecision = input.action === "pull_artifact"
    ? evaluateFleetArtifactPullContract(input, { materializeApproval: options.artifactPullApproval })
    : undefined;
  if (artifactDecision?.status === "blocked") {
    const result: CapabilityRouteResult = {
      toolName: "fleet",
      subsystem: "open-machines",
      capability,
      status: artifactDecision.status,
      allowed: false,
      reason: artifactDecision.reason,
      input,
    };
    await recordRouteAudit(result, input, {
      ...options,
      metadata: {
        ...options.metadata,
        artifact_pull: artifactDecision.metadata,
        secure_remote_transport: "required",
      },
    });
    return result;
  }

  const decision = evaluateFleetTransport(input, {
    approved: options.approved,
    fleetTransport: options.fleetTransport,
    verifyCapabilityToken: options.verifyFleetCapabilityToken,
  });
  if (!decision.allowed) {
    const result: CapabilityRouteResult = {
      toolName: "fleet",
      subsystem: "open-machines",
      capability,
      status: decision.status,
      allowed: false,
      reason: decision.reason,
      input,
    };
    await recordRouteAudit(result, input, {
      ...options,
      metadata: {
        ...options.metadata,
        ...(artifactDecision ? { artifact_pull: artifactDecision.metadata } : {}),
        fleet_transport: decision.metadata,
        secure_remote_transport: isFleetMutation(input) ? "required" : "read_only",
      },
    });
    return result;
  }

  if (artifactDecision && !artifactDecision.allowed) {
    const result: CapabilityRouteResult = {
      toolName: "fleet",
      subsystem: "open-machines",
      capability,
      status: artifactDecision.status,
      allowed: false,
      reason: artifactDecision.reason,
      input,
    };
    await recordRouteAudit(result, input, {
      ...options,
      metadata: {
        ...options.metadata,
        artifact_pull: artifactDecision.metadata,
        fleet_transport: decision.metadata,
        secure_remote_transport: "required",
      },
    });
    return result;
  }

  const result: CapabilityRouteResult = {
    toolName: "fleet",
    subsystem: "open-machines",
    capability,
    status: decision.status,
    allowed: decision.allowed,
    reason: decision.reason,
    input,
  };
  await recordRouteAudit(result, input, {
    ...options,
    metadata: {
      ...options.metadata,
      ...(artifactDecision ? { artifact_pull: artifactDecision.metadata } : {}),
      fleet_transport: decision.metadata,
      secure_remote_transport: isFleetMutation(input) ? "required" : "read_only",
    },
  });
  return result;
}

async function routeComputer(input: ComputerToolInput, options: CapabilityRouterOptions): Promise<CapabilityRouteResult> {
  const action = toDriverAction(input);
  const decision = evaluateComputerAction(action, {
    safety: options.safety ?? loadConfig().safety,
    approved: options.approved,
    sessionId: options.sessionId,
  });
  await recordActionPolicyAudit(action, decision, {
    actor: options.actor,
    transport: options.transport ?? "planner",
    capability: `computer.${action.type}`,
    metadata: options.metadata,
  });
  const result = policyDecisionToRoute("computer", "computer", `computer.${action.type}`, input, decision);
  await recordRouteAudit(result, input, options);
  return result;
}

async function routeTerminal(input: TerminalToolInput, options: CapabilityRouterOptions): Promise<CapabilityRouteResult> {
  const decision = await guardTerminalCommandPolicy(
    { app: input.app, run: input.commands, dir: input.dir },
    {
      approved: options.approved,
      workspaceRoots: options.workspaceRoots,
      actor: options.actor,
      transport: options.transport ?? "planner",
      capability: "terminal.exec",
      metadata: options.metadata,
    },
  );
  const result = policyDecisionToRoute("terminal", "ghostty", "terminal.exec", input, decision);
  await recordRouteAudit(result, input, options);
  return result;
}

async function routeApp(input: AppToolInput, options: CapabilityRouterOptions): Promise<CapabilityRouteResult> {
  const decision = evaluateComputerAction({ type: "open_app", name: input.app }, {
    safety: options.safety ?? loadConfig().safety,
    approved: options.approved,
    sessionId: options.sessionId,
  });
  await recordActionPolicyAudit({ type: "open_app", name: input.app }, decision, {
    actor: options.actor,
    transport: options.transport ?? "planner",
    capability: "app.open",
    metadata: options.metadata,
  });
  const result = policyDecisionToRoute("app", "app", "app.open", input, decision);
  await recordRouteAudit(result, input, options);
  return result;
}

async function routeApprovalBacked(
  toolName: PlannerToolName,
  subsystem: CapabilitySubsystem,
  capability: string,
  input: unknown,
  options: CapabilityRouterOptions,
  safeWithoutApproval: boolean,
): Promise<CapabilityRouteResult> {
  const status: CapabilityRouteStatus = safeWithoutApproval || options.approved ? "allowed" : "requires_confirmation";
  const result: CapabilityRouteResult = {
    toolName,
    subsystem,
    capability,
    status,
    allowed: status === "allowed",
    reason: status === "requires_confirmation" ? `${capability} requires approval before execution.` : undefined,
    input,
  };
  await recordRouteAudit(result, input, options);
  return result;
}

function policyDecisionToRoute(
  toolName: PlannerToolName,
  subsystem: CapabilitySubsystem,
  capability: string,
  input: unknown,
  decision: ActionPolicyDecision,
): CapabilityRouteResult {
  return {
    toolName,
    subsystem,
    capability,
    status: decision.status,
    allowed: decision.allowed,
    reason: decision.allowed ? undefined : formatPolicyRejection(decision),
    input,
  };
}

async function recordRouteAudit(
  result: CapabilityRouteResult,
  rawInput: unknown,
  options: CapabilityRouterOptions,
): Promise<void> {
  await logAuditEvent({
    event: "planner.route_decision",
    actor: options.actor,
    transport: options.transport ?? "planner",
    capability: result.capability,
    action_type: result.toolName,
    action_data: redactRouteInput(result.toolName, rawInput),
    decision: result.status,
    reason: result.reason,
    metadata: {
      subsystem: result.subsystem,
      ...options.metadata,
    },
  });
}

function toDriverAction(input: ComputerToolInput): DriverAction {
  switch (input.action) {
    case "screenshot":
      return { type: "screenshot" };
    case "click":
      return { type: "click", point: input.point, button: input.button, count: input.count };
    case "type":
      return { type: "type", text: input.text };
    case "key":
      return { type: "key", keys: input.keys };
    case "scroll":
      return { type: "scroll", point: input.point, deltaX: input.deltaX, deltaY: input.deltaY };
    case "wait":
      return { type: "wait", ms: input.ms };
    case "open_url":
      return { type: "open_url", url: input.url };
    case "open_app":
      return { type: "open_app", name: input.name };
  }
}

function subsystemForTool(toolName: PlannerToolName): CapabilitySubsystem {
  const map: Record<PlannerToolName, CapabilitySubsystem> = {
    computer: "computer",
    browser: "open-browser",
    terminal: "ghostty",
    app: "app",
    fleet: "open-machines",
    storage: "storage",
    memory: "memory",
    approval: "approval",
    observation: "observation",
  };
  return map[toolName];
}

function isBrowserReadOnly(input: BrowserToolInput): boolean {
  return input.action === "status" || input.action === "snapshot";
}

function isFleetReadOnly(input: FleetToolInput): boolean {
  return input.action === "capabilities" || input.action === "route";
}

function redactRouteInput(toolName: PlannerToolName, input: unknown): unknown {
  if (typeof input !== "object" || input === null) return { redacted: true };
  const value = input as Record<string, unknown>;
  if (toolName === "terminal") {
    const commands = Array.isArray(value.commands) ? value.commands : [];
    return { app: value.app, command_count: commands.length, has_dir: Boolean(value.dir), redacted: true };
  }
  if (toolName === "computer" && value.action === "type") {
    const text = typeof value.text === "string" ? value.text : "";
    return { action: "type", text_length: text.length, redacted: true };
  }
  if (toolName === "browser" && value.action === "type") {
    const text = typeof value.text === "string" ? value.text : "";
    return { action: "type", text_length: text.length, has_session_id: typeof value.sessionId === "string" && value.sessionId.length > 0, redacted: true };
  }
  if (toolName === "browser") {
    return {
      action: value.action,
      has_session_id: typeof value.sessionId === "string" && value.sessionId.length > 0,
      ...(typeof value.url === "string" ? { url: redactAuditUrl(value.url) } : {}),
      redacted: true,
    };
  }
  if (toolName === "fleet") {
    return {
      action: value.action,
      has_machine_id: typeof value.machineId === "string" && value.machineId.length > 0,
      has_workspace_path: typeof value.workspacePath === "string" && value.workspacePath.length > 0,
      has_artifact_id: typeof value.artifactId === "string" && value.artifactId.length > 0,
      artifact_namespace: typeof value.artifactId === "string" && value.artifactId.includes("/")
        ? value.artifactId.split("/", 1)[0]
        : undefined,
      source_scope: value.sourceScope,
      pull_mode: value.mode,
      max_bytes: value.maxBytes,
      expected_sha256_present: typeof value.expectedSha256 === "string" && value.expectedSha256.length > 0,
      timeout_ms: value.timeoutMs,
      redacted: true,
    };
  }
  if (toolName === "memory") {
    const body = typeof value.body === "string" ? value.body : "";
    return { scope: value.scope, title: value.title, body_length: body.length, redacted: true };
  }
  return value;
}

function redactAuditUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = url.username ? "<user>" : "";
    url.password = url.password ? "<redacted>" : "";
    const sensitiveKeys = ["token", "access_token", "refresh_token", "id_token", "code", "password", "secret", "key", "api_key", "apikey", "session", "cookie"];
    for (const key of [...url.searchParams.keys()]) {
      if (sensitiveKeys.some((sensitive) => key.toLowerCase().includes(sensitive))) {
        url.searchParams.set(key, "<redacted>");
      }
    }
    return url.toString();
  } catch {
    return "<invalid-url>";
  }
}
