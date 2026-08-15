/**
 * Shared hook DB writer — single write path for all observability hooks.
 * Never throws: errors are written to stderr only.
 */

import { getDb } from "../db";
import type { HookEventRow } from "../db/schema";

export type HookEventInput = Omit<HookEventRow, "id" | "timestamp"> & {
  timestamp?: string;
};

function nanoid(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 21);
}

export function writeHookEvent(event: HookEventInput): void {
  try {
    const db = getDb();
    const id = nanoid();
    const timestamp = event.timestamp ?? new Date().toISOString();

    db.run(
      `INSERT INTO hook_events
        (id, timestamp, session_id, hook_name, event_type, tool_name, tool_input, result, error, duration_ms, project_dir, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        timestamp,
        event.session_id,
        event.hook_name,
        event.event_type,
        event.tool_name ?? null,
        event.tool_input ? event.tool_input.slice(0, 500) : null,
        event.result ?? null,
        event.error ?? null,
        event.duration_ms ?? null,
        event.project_dir ?? null,
        event.metadata ?? null,
      ]
    );
  } catch (err) {
    process.stderr.write(`[hooks db-writer] failed to write event: ${err}\n`);
  }
}

const ALLOWED_EVENT_TYPES = new Set([
  "PreToolUse",
  "PostToolUse",
  "Stop",
  "Notification",
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
]);

/** Normalize a hook_event_name from hook input to a value the schema accepts. */
export function normalizeEventType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (ALLOWED_EVENT_TYPES.has(value)) return value;
  // Combined form (e.g. "PreToolUse:Bash") or an unknown event: strip a
  // matcher suffix and accept the bare event when it is in the schema.
  const bare = value.split(":")[0] ?? "";
  return ALLOWED_EVENT_TYPES.has(bare) ? bare : null;
}

/**
 * Pick the event type for a run record: the hook input's hook_event_name when
 * it is valid, else the hook's declared event. Guarantees a row lands for
 * every execution even when the agent passes an unknown event name.
 */
export function resolveEventType(inputEvent: unknown, fallbackEvent: string | null | undefined): string | null {
  const fromInput = normalizeEventType(inputEvent);
  if (fromInput) return fromInput;
  return normalizeEventType(fallbackEvent ?? null);
}

/**
 * Record one hook execution in hook_events — the row `hooks log` reads.
 * Written by every run path (CLI run, SDK runHook, MCP run tools) so a real
 * fire is always observable (bug ef58dcb7: 0 rows after real fires).
 *
 * Never throws: observability must not break execution. An invalid event type
 * or a missing DB is reported on stderr and skipped.
 */
export function recordHookRun(record: {
  hookName: string;
  eventType: string | null;
  version?: string | null;
  sha256?: string | null;
  sessionId?: string | null;
  toolName?: string | null;
  toolInput?: unknown;
  result?: "continue" | "block" | null;
  error?: string | null;
  exitCode: number;
  durationMs: number;
  projectDir?: string | null;
  metadata?: Record<string, unknown>;
}): void {
  const eventType = record.eventType ? normalizeEventType(record.eventType) : null;
  if (!eventType) {
    process.stderr.write(
      `[hooks db-writer] skipped event for '${record.hookName}': unsupported event type '${String(record.eventType)}'\n`,
    );
    return;
  }
  const metadata: Record<string, unknown> = {
    ...(record.metadata ?? {}),
    version: record.version ?? null,
    sha256: record.sha256 ?? null,
    exit_code: record.exitCode,
  };
  writeHookEvent({
    session_id: record.sessionId ?? "cli",
    hook_name: record.hookName,
    event_type: eventType as HookEventRow["event_type"],
    tool_name: record.toolName ?? null,
    tool_input: record.toolInput !== undefined ? JSON.stringify(record.toolInput) : null,
    result: record.result ?? null,
    error: record.error ?? null,
    duration_ms: record.durationMs,
    project_dir: record.projectDir ?? null,
    metadata: JSON.stringify(metadata),
  });
}
