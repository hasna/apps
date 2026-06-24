import { getSession, setSessionStatus } from "../db/index.js";
import { getWorkflowRun, transitionWorkflowRun } from "./runtime.js";
import type { SessionStatus } from "../types/index.js";

export interface EmergencyStopState {
  active: boolean;
  reason?: string;
  requested_at?: string;
}

export interface RunControlDecision {
  allowed: boolean;
  status: "running" | "paused" | "emergency_stop" | "cancelled";
  reason?: string;
}

export interface SessionControlState {
  session_id: string;
  status: "paused" | "running" | "cancelled";
  reason?: string;
  requested_at?: string;
}

const emergencyStop: EmergencyStopState = { active: false };
const cancelledSessions = new Map<string, { reason?: string; requested_at: string }>();
const pausedSessions = new Map<string, { reason?: string; requested_at: string }>();
const sessionAbortControllers = new Map<string, AbortController>();
let emergencyAbortController = new AbortController();

export function requestEmergencyStop(reason?: string): EmergencyStopState {
  emergencyStop.active = true;
  emergencyStop.reason = reason;
  emergencyStop.requested_at = new Date().toISOString();
  if (!emergencyAbortController.signal.aborted) {
    emergencyAbortController.abort(reason ?? "Emergency stop is active");
  }
  abortActiveSessions(reason ?? "Emergency stop is active");
  return getEmergencyStop();
}

export function clearEmergencyStop(): EmergencyStopState {
  emergencyStop.active = false;
  emergencyStop.reason = undefined;
  emergencyStop.requested_at = undefined;
  emergencyAbortController = new AbortController();
  return getEmergencyStop();
}

export function getEmergencyStop(): EmergencyStopState {
  return { ...emergencyStop };
}

export function getEmergencyStopSignal(): AbortSignal {
  return emergencyAbortController.signal;
}

export function cancelSession(sessionId: string, reason?: string): void {
  cancelledSessions.set(sessionId, {
    reason,
    requested_at: new Date().toISOString(),
  });
  pausedSessions.delete(sessionId);
  sessionAbortControllers.get(sessionId)?.abort(reason ?? "Session cancelled");
  persistSessionControlStatus(sessionId, "cancelling", reason);
}

export function clearSessionCancellation(sessionId: string): void {
  cancelledSessions.delete(sessionId);
  sessionAbortControllers.delete(sessionId);
}

export function pauseSession(sessionId: string, reason?: string): SessionControlState {
  const requested_at = new Date().toISOString();
  pausedSessions.set(sessionId, { reason, requested_at });
  persistSessionControlStatus(sessionId, "paused", reason);
  return { session_id: sessionId, status: "paused", reason, requested_at };
}

export function resumeSession(sessionId: string): SessionControlState {
  pausedSessions.delete(sessionId);
  persistSessionControlStatus(sessionId, "running", undefined, { clearError: true, clearCompletedAt: true });
  return { session_id: sessionId, status: "running" };
}

export function clearSessionPause(sessionId: string): void {
  pausedSessions.delete(sessionId);
}

export function unregisterSessionAbortController(sessionId: string): void {
  sessionAbortControllers.delete(sessionId);
}

export function registerSessionAbortController(sessionId: string): AbortSignal {
  const existing = sessionAbortControllers.get(sessionId);
  if (existing) return existing.signal;

  const controller = new AbortController();
  sessionAbortControllers.set(sessionId, controller);
  const decision = getRunControlDecision(sessionId);
  if (!decision.allowed) {
    controller.abort(decision.reason ?? "Session cancelled");
  }
  return controller.signal;
}

export function getSessionAbortSignal(sessionId: string): AbortSignal | undefined {
  return sessionAbortControllers.get(sessionId)?.signal;
}

export function getRunControlDecision(sessionId?: string): RunControlDecision {
  if (emergencyStop.active) {
    return {
      allowed: false,
      status: "emergency_stop",
      reason: emergencyStop.reason ?? "Emergency stop is active",
    };
  }

  if (sessionId) {
    const cancellation = cancelledSessions.get(sessionId);
    if (cancellation) {
      return {
        allowed: false,
        status: "cancelled",
        reason: cancellation.reason ?? "Session cancelled",
      };
    }

    const pause = pausedSessions.get(sessionId);
    if (pause) {
      return {
        allowed: false,
        status: "paused",
        reason: pause.reason ?? "Session paused",
      };
    }

    const persisted = getPersistedRunControlDecision(sessionId);
    if (persisted) return persisted;
  }

  return { allowed: true, status: "running" };
}

export function resetRunControlForTests(): void {
  clearEmergencyStop();
  cancelledSessions.clear();
  pausedSessions.clear();
  sessionAbortControllers.clear();
}

function abortActiveSessions(reason: string): void {
  for (const controller of sessionAbortControllers.values()) {
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  }
}

function getPersistedRunControlDecision(sessionId: string): RunControlDecision | null {
  const session = getSession(sessionId);
  if (session?.status === "paused") {
    return { allowed: false, status: "paused", reason: session.error ?? "Session paused" };
  }
  if (session?.status === "cancelling" || session?.status === "cancelled") {
    return { allowed: false, status: "cancelled", reason: session.error ?? "Session cancelled" };
  }

  const run = getWorkflowRun(sessionId);
  if (run?.status === "paused") {
    return { allowed: false, status: "paused", reason: run.error ?? "Session paused" };
  }
  if (run?.status === "cancelling" || run?.status === "cancelled") {
    return { allowed: false, status: "cancelled", reason: run.error ?? "Session cancelled" };
  }

  return null;
}

function persistSessionControlStatus(
  sessionId: string,
  status: Extract<SessionStatus, "running" | "paused" | "cancelling" | "cancelled">,
  reason?: string,
  opts: { clearError?: boolean; clearCompletedAt?: boolean } = {},
): void {
  const session = getSession(sessionId);
  if (session && !isTerminalSessionStatus(session.status)) {
    setSessionStatus(sessionId, status, {
      error: status === "running" ? null : reason ?? null,
      clearError: opts.clearError,
      clearCompletedAt: opts.clearCompletedAt,
    });
  }

  const run = getWorkflowRun(sessionId);
  if (run && run.status !== status && !isTerminalSessionStatus(run.status)) {
    try {
      transitionWorkflowRun(sessionId, status, {
        error: status === "running" ? undefined : reason,
        clearError: opts.clearError,
      });
    } catch {
      // Run-control requests are best-effort for persisted state; the live loop
      // performs the authoritative transition when it observes the request.
    }
  }
}

function isTerminalSessionStatus(status: SessionStatus): boolean {
  return status === "cancelled" || status === "failed" || status === "completed" || status === "max_steps_exceeded";
}
