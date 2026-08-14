/**
 * Optional integrations with other @hasna/* packages.
 * Each integration is a no-op if the dependency is not installed.
 */

import type { Session, ActionLog } from "../types/index.js";

/**
 * Try to save a computer use session as a recording in open-recordings.
 * No-op if @hasna/recordings is not installed.
 */
export async function saveToRecordings(session: Session, logs: ActionLog[]): Promise<boolean> {
  try {
    const { saveRecording } = await import("@hasna/recordings" as any);
    await saveRecording({
      title: `Computer Use: ${session.task.slice(0, 100)}`,
      type: "computer-use",
      source: "computer",
      duration_ms: session.total_duration_ms,
      metadata: {
        session_id: session.id,
        provider: session.provider,
        model: session.model,
        steps: session.steps,
        tokens_in: session.total_tokens_in,
        tokens_out: session.total_tokens_out,
        status: session.status,
        tags: session.tags,
      },
      transcript: logs.map((l) => ({
        step: l.step,
        action: l.action.type,
        reasoning: l.reasoning?.slice(0, 200),
        success: l.success,
        timestamp: l.created_at,
      })),
    });
    return true;
  } catch {
    return false; // Not installed or error — no-op
  }
}

/**
 * Try to register a computer use session in open-sessions.
 * No-op if @hasna/sessions is not installed.
 */
export async function registerWithSessions(session: Session): Promise<boolean> {
  try {
    const mod = await import("@hasna/sessions" as any);
    const registerSession = mod.registerSession ?? mod.createSession ?? mod.saveSession;
    if (typeof registerSession !== "function") return false;
    await registerSession({
      id: session.id,
      type: "computer-use",
      source: "computer",
      status: session.status,
      metadata: {
        task: session.task,
        provider: session.provider,
        model: session.model,
        steps: session.steps,
      },
      started_at: session.created_at,
      ended_at: session.completed_at,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Try to push action logs to open-logs.
 * No-op if @hasna/logs is not installed.
 */
export async function pushToLogs(session: Session, logs: ActionLog[]): Promise<boolean> {
  try {
    const mod = await import("@hasna/logs" as any);
    const pushBatch = mod.logPushBatch ?? mod.pushBatch;
    if (typeof pushBatch !== "function") return false;
    await pushBatch(
      logs.map((l) => ({
        level: l.success ? "info" : "error",
        source: "computer",
        message: `[${l.action.type}] ${l.reasoning?.slice(0, 100) ?? ""}`,
        metadata: {
          session_id: session.id,
          step: l.step,
          action_type: l.action.type,
          success: l.success,
          error: l.error,
          duration_ms: l.duration_ms,
        },
        timestamp: l.created_at,
      }))
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Run all integrations after a session completes.
 * Returns which integrations succeeded.
 */
export async function runPostSessionIntegrations(
  session: Session,
  logs: ActionLog[]
): Promise<{ recordings: boolean; sessions: boolean; logs: boolean }> {
  const [recordings, sessions, logsPushed] = await Promise.all([
    saveToRecordings(session, logs),
    registerWithSessions(session),
    pushToLogs(session, logs),
  ]);
  return { recordings, sessions, logs: logsPushed };
}
