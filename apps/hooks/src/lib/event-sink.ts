/**
 * The hosted hook-event client — where a hook event GOES and where `hooks log`
 * READS it from.
 *
 * Before this module every execution path (`hooks run`, the MCP run tools,
 * the four bundled observability hooks) called `writeHookEvent` and landed a
 * row in `~/.hasna/hooks/hooks.db` on the machine that fired it, with no
 * transport decision of any kind; `hooks log` and `hooks_log_*` read that same
 * file. Events were invisible to every other station and the store was a local
 * SQLite file the fleet rules forbid.
 *
 * Now the transport decides, exactly like every other hosted surface:
 *
 *   - remote (the default): `POST/GET/DELETE <origin>/api/v1/events` through
 *     the authority `src/lib/transport.ts` resolves — one strict URL+key pair,
 *     resolved fresh per call, never a value this module stores or logs.
 *   - local: ONLY under the deliberate opt-in `HASNA_HOOKS_LOCAL=1` (alias
 *     `HOOKS_LOCAL=1`), which routes back to `db-writer`/`getDb` as before.
 *
 * Two rules shape the code below.
 *
 * WRITES NEVER THROW. Observability must not break hook execution — a refused
 * credential or an unreachable registry writes one line to stderr and the hook
 * still runs. It does NOT fall back to SQLite: a silent local write is exactly
 * the false green the fleet rules forbid.
 *
 * READS FAIL LOUD. `hooks log` returning an empty list because the credential
 * was refused would be indistinguishable from "no events", so the read helpers
 * throw and the command reports the refusal.
 *
 * Imports of the resolver and of `db-writer` are DYNAMIC on purpose:
 * `db-writer` opens `bun:sqlite` at import time, so the hosted path must never
 * import it, and the bundled hook scripts run inside a sandboxed child where
 * pulling the resolver in for a code path that is not taken is pure cost.
 */

import { redactEventPayload } from "./redact.js";
import {
  boundedRowLimit,
  normalizeSince,
  resolveEventType,
  type FeedbackInput,
  type HookEventInput,
  type HookEventQuery,
  type HookEventRecord,
  type HookEventSummary,
  type HookEventType,
} from "./event-types.js";
import type { HooksCredentialOptions } from "./resolver-types.js";

/** Same ceiling the local writer applied before persisting a tool_input. */
const TOOL_INPUT_MAX = 500;
/** A hook fire must not hang on the network. */
const EVENT_REQUEST_TIMEOUT_MS = 10_000;

export interface EventClientOptions {
  env?: Record<string, string | undefined>;
  credentials?: HooksCredentialOptions;
  /** Test seam: the fetch implementation. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Where a write-path refusal is reported. Defaults to process.stderr. */
  notice?: (line: string) => void;
}

function report(options: EventClientOptions | undefined, line: string): void {
  if (options?.notice) options.notice(line);
  else if (typeof process !== "undefined") process.stderr.write(`${line}\n`);
}

/**
 * True when this environment deliberately opted out of the hosted route.
 * Re-exported from the opt-in module (owned elsewhere) so call sites take the
 * decision from ONE place.
 */
export async function usesLocalHookStore(env: Record<string, string | undefined> = process.env): Promise<boolean> {
  const { selectsHooksLocalStore } = await import("./local-opt-in.js");
  return selectsHooksLocalStore(env);
}

interface ResolvedAuthority {
  origin: string;
  apiKey: string;
}

/** Resolve the remote authority, or throw the resolver's own refusal. */
async function remoteAuthority(options: EventClientOptions = {}): Promise<ResolvedAuthority> {
  const { resolveHooksTransport } = await import("./transport.js");
  const transport = resolveHooksTransport(options.env ?? process.env, {
    credentials: options.credentials,
  });
  if (transport.mode !== "remote" || !transport.authority) {
    throw new Error(
      "hook events are hosted: no registry authority resolved. Set the Keychain item " +
        "hasna.credentials.hooks.api-key/.api-url, ~/.hasna/hooks/config/credentials, or HASNA_HOOKS_API_KEY. " +
        "HASNA_HOOKS_LOCAL=1 selects the on-box store instead.",
    );
  }
  return { origin: transport.authority.origin, apiKey: transport.authority.apiKey };
}

/** The events route on a registry origin. Exported for the tests that assert the URL. */
export function eventsUrl(origin: string, path = "", query?: Record<string, string | undefined>): string {
  const url = new URL(`${origin.replace(/\/+$/, "")}/api/v1/events${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, value);
  }
  return url.toString();
}

async function request(
  method: string,
  url: string,
  authority: ResolvedAuthority,
  body: unknown,
  options: EventClientOptions,
): Promise<unknown> {
  const doFetch = options.fetchImpl ?? fetch;
  const res = await doFetch(url, {
    method,
    headers: {
      accept: "application/json",
      "x-api-key": authority.apiKey,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    // A 3xx would carry x-api-key to another origin (fetch strips
    // Authorization cross-origin but forwards custom headers). Same control
    // the sync client applies.
    redirect: "error",
    signal: AbortSignal.timeout(EVENT_REQUEST_TIMEOUT_MS),
  });
  if (res.status === 401) {
    throw new Error(`${method} ${new URL(url).pathname} refused: the registry rejected the resolved hooks API key`);
  }
  if (res.status === 503) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${method} ${new URL(url).pathname} unavailable: ${detail || "the registry has no event store"}`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${method} ${new URL(url).pathname} failed with status ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return res.json();
}

/** Apply the same write-time redaction and truncation the local writer applied. */
export function projectEventForTransport(event: HookEventInput): HookEventInput {
  const toolInput = redactEventPayload(event.tool_input ?? null);
  return {
    ...event,
    tool_input: toolInput ? toolInput.slice(0, TOOL_INPUT_MAX) : null,
    error: redactEventPayload(event.error ?? null),
    metadata: redactEventPayload(event.metadata ?? null),
  };
}

/** POST events to the hosted route. Throws on refusal — the routed helpers below swallow. */
export async function postHookEvents(
  events: HookEventInput[],
  options: EventClientOptions = {},
): Promise<{ events: HookEventRecord[]; count: number }> {
  const authority = await remoteAuthority(options);
  const body = { events: events.map(projectEventForTransport) };
  const response = (await request("POST", eventsUrl(authority.origin), authority, body, options)) as {
    events?: HookEventRecord[];
    count?: number;
  };
  return { events: response.events ?? [], count: response.count ?? response.events?.length ?? 0 };
}

export async function listHookEvents(
  query: HookEventQuery,
  options: EventClientOptions = {},
): Promise<HookEventRecord[]> {
  const authority = await remoteAuthority(options);
  const url = eventsUrl(authority.origin, "", {
    hook: query.hook,
    session: query.session,
    since: query.since,
    q: query.search,
    errors_only: query.errorsOnly ? "true" : undefined,
    limit: String(boundedRowLimit(query.limit, 50)),
  });
  const response = (await request("GET", url, authority, undefined, options)) as { events?: HookEventRecord[] };
  return response.events ?? [];
}

export async function deleteHookEvents(
  filter: { hook?: string },
  options: EventClientOptions = {},
): Promise<number> {
  const authority = await remoteAuthority(options);
  const url = eventsUrl(authority.origin, "", { hook: filter.hook });
  const response = (await request("DELETE", url, authority, undefined, options)) as { deleted?: number };
  return response.deleted ?? 0;
}

export async function hookEventSummary(
  since: string | null | undefined,
  options: EventClientOptions = {},
): Promise<HookEventSummary> {
  const authority = await remoteAuthority(options);
  const url = eventsUrl(authority.origin, "/summary", { since: normalizeSince(since) ?? undefined });
  return (await request("GET", url, authority, undefined, options)) as HookEventSummary;
}

export async function postFeedback(
  input: FeedbackInput,
  options: EventClientOptions = {},
): Promise<{ ok: boolean; id: string }> {
  const authority = await remoteAuthority(options);
  const url = `${authority.origin.replace(/\/+$/, "")}/api/v1/feedback`;
  return (await request("POST", url, authority, input, options)) as { ok: boolean; id: string };
}

/**
 * Write ONE hook event wherever this environment's transport says it belongs.
 * Never throws — the hook that produced the event keeps running either way.
 */
export async function writeHookEventRouted(
  event: HookEventInput,
  options: EventClientOptions = {},
): Promise<void> {
  try {
    if (await usesLocalHookStore(options.env ?? process.env)) {
      const { writeHookEvent } = await import("./db-writer.js");
      // db-writer's row type spells "absent" as null, not undefined.
      writeHookEvent({
        session_id: event.session_id,
        hook_name: event.hook_name,
        event_type: event.event_type,
        tool_name: event.tool_name ?? null,
        tool_input: event.tool_input ?? null,
        result: event.result ?? null,
        error: event.error ?? null,
        duration_ms: event.duration_ms ?? null,
        project_dir: event.project_dir ?? null,
        metadata: event.metadata ?? null,
        ...(event.timestamp === undefined ? {} : { timestamp: event.timestamp }),
      });
      return;
    }
    await postHookEvents([event], options);
  } catch (error) {
    report(options, `[hooks event-sink] event not recorded: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Record one hook EXECUTION. The metadata shape (version/sha256/exit_code) is
 * the one `recordHookRun` has always written, so rows produced before and
 * after the port read identically.
 */
export async function recordHookRunRouted(
  record: {
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
  },
  options: EventClientOptions = {},
): Promise<void> {
  const eventType = resolveEventType(record.eventType, null);
  if (!eventType) {
    report(
      options,
      `[hooks event-sink] skipped event for '${record.hookName}': unsupported event type '${String(record.eventType)}'`,
    );
    return;
  }
  await writeHookEventRouted(
    {
      session_id: record.sessionId ?? "cli",
      hook_name: record.hookName,
      event_type: eventType as HookEventType,
      tool_name: record.toolName ?? null,
      tool_input: record.toolInput !== undefined ? JSON.stringify(record.toolInput) : null,
      result: record.result ?? null,
      error: record.error ?? null,
      duration_ms: record.durationMs,
      project_dir: record.projectDir ?? null,
      metadata: JSON.stringify({
        ...(record.metadata ?? {}),
        version: record.version ?? null,
        sha256: record.sha256 ?? null,
        exit_code: record.exitCode,
      }),
    },
    options,
  );
}
