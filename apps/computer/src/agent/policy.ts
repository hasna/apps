import { executeAction as executeDriverAction } from "../drivers/mac/input.js";
import { loadConfig } from "../lib/config.js";
import { logAuditEvent } from "../db/index.js";
import type { ActionResult, DriverAction, DriverExecutionContext, SafetyConfig } from "../types/index.js";
import { getEmergencyStopSignal, getRunControlDecision } from "./control.js";
import { checkAction } from "./safety.js";
import { relative, resolve } from "node:path";
import {
  acquireRuntimeLease,
  createRuntimeGoal,
  createWorkflowRun,
  releaseRuntimeLease,
  transitionWorkflowRun,
  type RuntimeLease,
} from "./runtime.js";

export type ActionPolicyStatus = "allowed" | "blocked" | "requires_confirmation";

export interface ActionPolicyDecision {
  allowed: boolean;
  status: ActionPolicyStatus;
  reason?: string;
}

export type ActionExecutionContext = DriverExecutionContext;
export type ActionExecutor = (action: DriverAction, context?: ActionExecutionContext) => Promise<ActionResult>;

export interface ActionAuditContext {
  actor?: string;
  transport?: string;
  capability?: string;
  metadata?: Record<string, unknown>;
  audit?: boolean;
}

export interface ActionPolicyOptions extends ActionAuditContext {
  safety?: SafetyConfig;
  approved?: boolean;
  sessionId?: string;
}

export interface ExecuteComputerActionOptions extends ActionPolicyOptions {
  executor?: ActionExecutor;
  signal?: AbortSignal;
  runtimeLease?: false | {
    runId?: string;
    resourceId?: string;
    holder?: string;
    ttlMs?: number;
    releaseOnComplete?: boolean;
  };
}

export function evaluateComputerAction(
  action: DriverAction,
  options: ActionPolicyOptions = {}
): ActionPolicyDecision {
  const runControl = getRunControlDecision(options.sessionId);
  if (!runControl.allowed) {
    return {
      allowed: false,
      status: "blocked",
      reason: runControl.reason,
    };
  }

  const safety = options.safety ?? loadConfig().safety;
  const safetyResult = checkAction(action, safety);

  if (!safetyResult.allowed) {
    return {
      allowed: false,
      status: "blocked",
      reason: safetyResult.reason ?? "Action blocked by safety policy",
    };
  }

  if (safetyResult.requiresConfirmation && !options.approved) {
    return {
      allowed: false,
      status: "requires_confirmation",
      reason: safetyResult.reason ?? "Action requires confirmation",
    };
  }

  return {
    allowed: true,
    status: "allowed",
    reason: safetyResult.reason,
  };
}

export interface TerminalCommandSpec {
  app: string;
  run?: string[];
  dir?: string;
}

export interface TerminalCommandPolicyOptions extends ActionAuditContext {
  approved?: boolean;
  workspaceRoots?: string[];
  sessionId?: string;
}

export function evaluateTerminalCommandPolicy(
  spec: TerminalCommandSpec,
  options: TerminalCommandPolicyOptions = {},
): ActionPolicyDecision {
  const runControl = getRunControlDecision(options.sessionId);
  if (!runControl.allowed) {
    return {
      allowed: false,
      status: "blocked",
      reason: runControl.reason,
    };
  }

  const commands = spec.run?.filter((command) => command.trim().length > 0) ?? [];
  const hasTerminalMutation = commands.length > 0 || Boolean(spec.dir);
  if (!hasTerminalMutation) return { allowed: true, status: "allowed" };

  const commandPolicy = evaluateTerminalCommandTextPolicy(commands);
  if (!commandPolicy.allowed) return commandPolicy;

  if (spec.dir) {
    const dir = resolve(spec.dir);
    const allowedRoots = terminalWorkspaceRoots(options.workspaceRoots);
    if (!allowedRoots.some((root) => pathIsInside(dir, root))) {
      return {
        allowed: false,
        status: "blocked",
        reason: `Terminal working directory must be inside an approved workspace root (${allowedRoots.join(", ")})`,
      };
    }
  } else if (commands.length > 0) {
    return {
      allowed: false,
      status: "blocked",
      reason: "Terminal commands require an explicit --dir inside an approved workspace root.",
    };
  }

  if (!options.approved) {
    return {
      allowed: false,
      status: "requires_confirmation",
      reason: "Terminal command execution requires explicit operator approval.",
    };
  }

  return { allowed: true, status: "allowed" };
}

export function evaluateTerminalCommandTextPolicy(commands: string[]): ActionPolicyDecision {
  for (const command of commands) {
    if (command.length > 4_000) {
      return {
        allowed: false,
        status: "blocked",
        reason: "Terminal command exceeds the maximum allowed length.",
      };
    }
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(command)) {
      return {
        allowed: false,
        status: "blocked",
        reason: "Terminal command contains unsupported control characters.",
      };
    }
    const normalized = command.replace(/\s+/g, " ").trim().toLowerCase();
    const blockedPattern = TERMINAL_COMMAND_BLOCKLIST.find((item) => item.pattern.test(normalized));
    if (blockedPattern) {
      return {
        allowed: false,
        status: "blocked",
        reason: `Terminal command blocked by command policy: ${blockedPattern.reason}`,
      };
    }
  }

  return { allowed: true, status: "allowed" };
}

const TERMINAL_COMMAND_BLOCKLIST: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[a-z]*r[a-z]*f|-rf|-fr)\s+(\/|~|\$home)(\s|$)/, reason: "destructive recursive removal outside a scoped path" },
  { pattern: /\bsudo\b/, reason: "privileged sudo execution requires a dedicated operator workflow" },
  { pattern: /\bsu\s+(-|\w)/, reason: "user switching is not allowed through terminal orchestration" },
  { pattern: /\bchmod\s+(-[a-z]*r[a-z]*\s+)?777\s+(\/|~|\$home)(\s|$)/, reason: "broad permission changes are not allowed" },
  { pattern: /\bchown\s+(-[a-z]*r[a-z]*\s+)?[^|;&]+(\/|~|\$home)(\s|$)/, reason: "broad ownership changes are not allowed" },
  { pattern: /\bdd\s+if=.*\bof=\/dev\//, reason: "raw disk writes are not allowed" },
  { pattern: /\bmkfs(\.|-|_)?\w*\b/, reason: "filesystem formatting is not allowed" },
  { pattern: /\bdiskutil\s+(erase|partition|apfs\s+delete|apfs\s+erase)/, reason: "disk mutation is not allowed" },
  { pattern: /\b(sh|bash|zsh)\s+-c\s+["']?\s*curl\b.*\|\s*(sh|bash|zsh)\b/, reason: "download-and-execute pipelines are not allowed" },
  { pattern: /\bcurl\b.*\|\s*(sh|bash|zsh)\b/, reason: "download-and-execute pipelines are not allowed" },
  { pattern: /\bwget\b.*\|\s*(sh|bash|zsh)\b/, reason: "download-and-execute pipelines are not allowed" },
  { pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:/, reason: "fork-bomb patterns are not allowed" },
];

export async function recordTerminalCommandPolicyAudit(
  spec: TerminalCommandSpec,
  decision: ActionPolicyDecision,
  context: TerminalCommandPolicyOptions = {},
): Promise<void> {
  if (context.audit === false) return;
  const commands = spec.run?.filter((command) => command.trim().length > 0) ?? [];
  await logAuditEvent({
    event: "terminal.policy_decision",
    actor: context.actor,
    transport: context.transport ?? "sdk",
    capability: context.capability ?? "computer.terminal",
    action_type: "terminal_command",
    action_data: {
      app: spec.app,
      command_count: commands.length,
      has_dir: Boolean(spec.dir),
      redacted: true,
    },
    decision: decision.status,
    reason: decision.reason,
    metadata: context.metadata,
  });
}

export async function guardTerminalCommandPolicy(
  spec: TerminalCommandSpec,
  options: TerminalCommandPolicyOptions = {},
): Promise<ActionPolicyDecision> {
  const decision = evaluateTerminalCommandPolicy(spec, options);
  await recordTerminalCommandPolicyAudit(spec, decision, options);
  return decision;
}

function terminalWorkspaceRoots(overrides?: string[]): string[] {
  const roots = overrides?.length
    ? overrides
    : (process.env["COMPUTER_TERMINAL_WORKSPACE_ROOTS"]?.split(",") ?? [process.cwd()]);
  return roots
    .map((root) => root.trim())
    .filter(Boolean)
    .map((root) => resolve(root));
}

function pathIsInside(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith("/") && !rel.match(/^[A-Za-z]:/));
}

export function formatPolicyRejection(decision: ActionPolicyDecision): string {
  if (decision.status === "requires_confirmation") {
    return `Action requires confirmation: ${decision.reason ?? "approval required"}`;
  }
  return decision.reason ?? "Action blocked by safety policy";
}

export async function executeComputerAction(
  action: DriverAction,
  options: ExecuteComputerActionOptions = {}
): Promise<ActionResult> {
  const executionSignal = composeAbortSignals([options.signal, getEmergencyStopSignal()]);

  const decision = evaluateComputerAction(action, options);
  await recordActionPolicyAudit(action, decision, options);
  if (!decision.allowed) {
    return {
      success: false,
      error: formatPolicyRejection(decision),
      duration_ms: 0,
    };
  }

  const runtimeLease = prepareActionRuntimeLease(action, options);
  if (!runtimeLease.ok) {
    return {
      success: false,
      error: runtimeLease.error,
      duration_ms: 0,
    };
  }

  const executor = options.executor ?? executeDriverAction;
  try {
    if (executionSignal?.aborted) {
      return {
        success: false,
        error: abortReason(executionSignal),
        duration_ms: 0,
      };
    }
    const result = await executor(action, { signal: executionSignal });
    if (runtimeLease.ephemeralRunId) {
      transitionWorkflowRun(runtimeLease.ephemeralRunId, result.success ? "completed" : "failed", { error: result.error });
    }
    await recordActionExecutionAudit(action, result, options);
    return result;
  } catch (error) {
    if (runtimeLease.ephemeralRunId) {
      transitionWorkflowRun(runtimeLease.ephemeralRunId, "failed", { error: error instanceof Error ? error.message : String(error) });
    }
    throw error;
  } finally {
    if (runtimeLease.lease && runtimeLease.releaseOnComplete) {
      releaseRuntimeLease(runtimeLease.lease.id, {
        runId: runtimeLease.lease.run_id,
        holder: runtimeLease.lease.holder,
      });
    }
  }
}

function abortReason(signal: AbortSignal): string {
  const reason = signal.reason;
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string" && reason.trim().length > 0) return reason;
  return "Action cancelled";
}

function composeAbortSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (activeSignals.length === 0) return undefined;
  if (activeSignals.length === 1) return activeSignals[0];

  const controller = new AbortController();
  const abort = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  for (const signal of activeSignals) {
    if (signal.aborted) {
      abort(signal);
      break;
    }
    signal.addEventListener("abort", () => abort(signal), { once: true });
  }
  return controller.signal;
}

/**
 * Policy-backed public action executor.
 *
 * The raw macOS driver action runner remains available inside drivers/mac for
 * low-level driver implementations, but package-root consumers should use this
 * wrapper so confirmation and blocklist policy cannot be bypassed accidentally.
 */
export async function executeAction(action: DriverAction): Promise<ActionResult> {
  return executeComputerAction(action);
}

export async function recordActionPolicyAudit(
  action: DriverAction,
  decision: ActionPolicyDecision,
  context: ActionAuditContext = {}
): Promise<void> {
  if (context.audit === false) return;
  await logAuditEvent({
    event: "action.policy_decision",
    actor: context.actor,
    transport: context.transport ?? "sdk",
    capability: context.capability ?? `computer.${action.type}`,
    action_type: action.type,
    action_data: redactActionForAudit(action),
    decision: decision.status,
    reason: decision.reason,
    metadata: context.metadata,
  });
}

async function recordActionExecutionAudit(
  action: DriverAction,
  result: ActionResult,
  context: ActionAuditContext = {}
): Promise<void> {
  if (context.audit === false) return;
  await logAuditEvent({
    event: "action.execution_result",
    actor: context.actor,
    transport: context.transport ?? "sdk",
    capability: context.capability ?? `computer.${action.type}`,
    action_type: action.type,
    action_data: redactActionForAudit(action),
    decision: result.success ? "succeeded" : "failed",
    reason: result.error,
    metadata: {
      ...context.metadata,
      duration_ms: result.duration_ms,
      screenshot_captured: Boolean(result.screenshot),
    },
  });
}

export function redactActionForAudit(action: DriverAction): Record<string, unknown> {
  switch (action.type) {
    case "type":
      return {
        type: "type",
        text: "[redacted]",
        text_length: action.text.length,
        redacted: true,
      };
    case "open_url": {
      try {
        const url = new URL(action.url);
        return {
          type: "open_url",
          origin: url.origin,
          hostname: url.hostname,
          redacted: true,
        };
      } catch {
        return {
          type: "open_url",
          url: "[redacted]",
          redacted: true,
        };
      }
    }
    default:
      return { ...action };
  }
}

type PreparedActionRuntimeLease =
  | { ok: true; lease?: RuntimeLease; releaseOnComplete: boolean; ephemeralRunId?: string }
  | { ok: false; error: string };

function prepareActionRuntimeLease(action: DriverAction, options: ExecuteComputerActionOptions): PreparedActionRuntimeLease {
  if (options.runtimeLease === false || action.type === "wait") {
    return { ok: true, releaseOnComplete: false };
  }

  const leaseOptions = options.runtimeLease && typeof options.runtimeLease === "object" ? options.runtimeLease : {};
  let runId = leaseOptions.runId;
  let ephemeralRunId: string | undefined;
  try {
    if (!runId) {
      const goal = createRuntimeGoal({
        title: `Direct ${action.type} action`,
        prompt: `Policy-backed direct action: ${action.type}`,
      });
      const run = createWorkflowRun({ goalId: goal.id });
      transitionWorkflowRun(run.id, "running");
      runId = run.id;
      ephemeralRunId = run.id;
    }

    const lease = acquireRuntimeLease({
      resourceType: "computer_display",
      resourceId: leaseOptions.resourceId ?? "local:main",
      runId,
      holder: leaseOptions.holder ?? options.transport ?? "direct-action",
      ttlMs: leaseOptions.ttlMs ?? 60_000,
    });
    return {
      ok: true,
      lease,
      releaseOnComplete: leaseOptions.releaseOnComplete ?? !leaseOptions.runId,
      ephemeralRunId,
    };
  } catch (error) {
    if (ephemeralRunId) {
      transitionWorkflowRun(ephemeralRunId, "failed", { error: error instanceof Error ? error.message : String(error) });
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
