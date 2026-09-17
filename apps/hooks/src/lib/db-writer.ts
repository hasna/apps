/**
 * Shared hook DB writer — single write path for all observability hooks.
 * Never throws: errors are written to stderr only.
 *
 * GATED (hasna/apps#1720 fail-closed ruling, W6 2026-09-11). This used to be
 * the one ungated path to ~/.hasna/hooks/hooks.db: every `hooks run`, every
 * MCP run tool and four bundled hook runtimes called it, and it created the
 * store on first write with no credential decision at all — a silent local
 * default. It now writes ONLY when the environment selects the on-box store
 * through the explicit opt-in (HASNA_HOOKS_LOCAL=1 / HOOKS_LOCAL=1, answered
 * from the env dictionary alone — no Keychain or disk read on the per-event
 * hot path). On the hosted route (a process-wide refusal installed by the CLI
 * gate / MCP startup, or any authority variable set in the env) and in an
 * unconfigured environment it prints ONE stderr line naming the opt-in and
 * writes nothing: the hosted registry has no event route to port to.
 */

import { getDb, isLocalStoreRefused, localStoreRefusalMessage } from "../db/index.js";
import type { HookEventRow } from "../db/schema";
import { hooksEventSinkRefusal, selectsHooksLocalStore } from "./local-opt-in.js";
import type { HooksLocalOptInEnv } from "./resolver-types.js";
import { redactEventPayload } from "./redact.js";

/** Where a hook event may land: the on-box store, or nowhere (with the reason). */
export type HookEventSink = { kind: "local" } | { kind: "refused"; reason: string };

/**
 * Decide the event sink from the env dictionary and the process-wide store
 * refusal ONLY — never the resolver, so agents' per-event `hooks run` and the
 * bundled hook children never pay a `security` spawn here (the CLI gate
 * already decided the route for the parent process).
 */
export function resolveHookEventSink(env: HooksLocalOptInEnv = process.env): HookEventSink {
  if (isLocalStoreRefused()) return { kind: "refused", reason: localStoreRefusalMessage() ?? hooksEventSinkRefusal() };
  if (selectsHooksLocalStore(env)) return { kind: "local" };
  // Hosted intent in the env, or nothing configured at all: either way there
  // is no local store to write and no hosted route to write to.
  return { kind: "refused", reason: hooksEventSinkRefusal() };
}

let sinkRefusalPrinted = false;

/** Reset the once-per-process sink refusal notice. Test seam only. */
export function __resetHookEventSinkNotice(): void {
  sinkRefusalPrinted = false;
}

export type HookEventInput = Omit<HookEventRow, "id" | "timestamp"> & {
  timestamp?: string;
};

function nanoid(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 21);
}

export function writeHookEvent(event: HookEventInput): void {
  const sink = resolveHookEventSink();
  if (sink.kind !== "local") {
    // Loud, once, and NOTHING opened: a refused write must never create
    // hooks.db as a side effect of being refused.
    if (!sinkRefusalPrinted) {
      sinkRefusalPrinted = true;
      process.stderr.write(`[hooks db-writer] ${sink.reason}\n`);
    }
    return;
  }
  try {
    const db = getDb();
    const id = nanoid();
    const timestamp = event.timestamp ?? new Date().toISOString();

    // P1-3 event-safe projection at WRITE time: tool_input, error and
    // metadata are redacted before local persistence, so nothing sensitive
    // ever lands in hook_events or flows to a remote sync store.
    const toolInput = redactEventPayload(event.tool_input);
    const error = redactEventPayload(event.error);
    const metadata = redactEventPayload(event.metadata);

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
        toolInput ? toolInput.slice(0, 500) : null,
        event.result ?? null,
        error ?? null,
        event.duration_ms ?? null,
        event.project_dir ?? null,
        metadata ?? null,
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
  "SubagentStart",
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
