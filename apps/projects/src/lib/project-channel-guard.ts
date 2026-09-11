/**
 * The channel-validity rule, split out of `project-channel.ts` so the write-time
 * guard can be reached from a storage layer.
 *
 * `project-channel.ts` imports the SQLite registry module (ensure reads the
 * project row and records an audit event there), so a store that must not pull
 * `bun:sqlite` in — the PostgreSQL `projects-serve` store — cannot import it.
 * Nothing in this module touches a database: it is the channel-name normalizer,
 * the conversations CLI probe and the guard over a `conversations_channel`
 * value. `project-channel.ts` re-exports every symbol here, so existing
 * importers keep importing from the same place.
 */

import type { WorkspaceIntegrations } from "../types/workspace.js";
import { env } from "./env.js";

export const PROJECT_CHANNEL_INTEGRATION_KEY = "conversations_channel";

export interface ConversationsRunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type ConversationsChannelRunner = (args: string[]) => ConversationsRunResult;

export function normalizeProjectChannelName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9.-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

export const CONVERSATIONS_CLI_TIMEOUT_MS = 15_000;

export function conversationsCliRunner(binary?: string): ConversationsChannelRunner {
  const executable = binary?.trim() || env.conversationsBin()?.trim() || "conversations";
  return (args) => {
    try {
      const result = Bun.spawnSync({
        cmd: [executable, ...args],
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
        timeout: CONVERSATIONS_CLI_TIMEOUT_MS,
      });
      return {
        ok: result.exitCode === 0,
        stdout: Buffer.from(result.stdout).toString("utf-8"),
        stderr: Buffer.from(result.stderr).toString("utf-8"),
      };
    } catch (err) {
      return { ok: false, stdout: "", stderr: err instanceof Error ? err.message : String(err) };
    }
  };
}

/**
 * A synchronous read-only probe of whether one conversations channel exists.
 *
 * Doctor and link surfaces use this to validate the channel a project ADVERTISES
 * through `integrations.conversations_channel` against the real conversations
 * app. Verdicts are deliberately tri-state: only a channel observed in a
 * successfully listed channel set is "missing"; anything that prevented the
 * listing (no CLI, auth, a parse failure) is "unknown" and never a false error.
 */
export type ProjectChannelExistenceVerdict = "exists" | "missing" | "unknown";

export interface ProjectChannelExistenceResult {
  verdict: ProjectChannelExistenceVerdict;
  /** Why an "unknown" verdict was reached (CLI failure, parse failure). */
  detail?: string;
}

export type ProjectChannelExistenceProbe = (channel: string) => ProjectChannelExistenceResult;

/** The channel-list surface the CLI prints as a bare JSON array on stdout (compact.ts). */
export function conversationsChannelListResult(result: ConversationsRunResult): { ok: true; names: string[] } | { ok: false; detail: string } {
  if (!result.ok) {
    return { ok: false, detail: result.stderr.trim() || result.stdout.trim() || "conversations channel list failed" };
  }
  let rows: unknown;
  try {
    rows = JSON.parse(result.stdout);
  } catch {
    return { ok: false, detail: "could not parse conversations channel list JSON output" };
  }
  if (!Array.isArray(rows)) {
    return { ok: false, detail: "conversations channel list JSON output was not an array" };
  }
  const names = rows
    .map((row) => (row && typeof row === "object" && typeof (row as { name?: unknown }).name === "string" ? (row as { name: string }).name : ""))
    .filter((name) => name.length > 0);
  return { ok: true, names };
}

/** Exact (normalized) membership of one channel in a channel-name set. */
export function conversationsChannelExistence(
  names: readonly string[],
  channel: string,
): { verdict: "exists" } | { verdict: "missing" } {
  const target = normalizeProjectChannelName(channel);
  const exists = names.some((name) => normalizeProjectChannelName(name) === target);
  return exists ? { verdict: "exists" } : { verdict: "missing" };
}

/**
 * An existence probe built from any {@link ConversationsChannelRunner}. The
 * channel listing is fetched once and cached for the lifetime of the probe, so
 * a multi-project doctor run performs one listing, not one per project.
 */
export function conversationsChannelProbe(runner: ConversationsChannelRunner): ProjectChannelExistenceProbe {
  let cached: { ok: true; names: string[] } | { ok: false; detail: string } | null = null;
  return (channel) => {
    if (cached === null) cached = conversationsChannelListResult(runner(["channel", "list", "-j"]));
    if (!cached.ok) return { verdict: "unknown", detail: cached.detail };
    return conversationsChannelExistence(cached.names, channel);
  };
}

/**
 * Process-scoped channel-name cache shared across probe instances, so repeated
 * doctor entry points (CLI per-project calls, MCP/agent tool calls) perform one
 * `conversations channel list` per process instead of one per project.
 */
const channelNameListCache = new Map<string, { ok: true; names: string[] } | { ok: false; detail: string }>();

export function conversationsCliChannelProbe(binary?: string): ProjectChannelExistenceProbe {
  const executable = binary?.trim() || env.conversationsBin()?.trim() || "conversations";
  return (channel) => {
    if (!channelNameListCache.has(executable)) {
      channelNameListCache.set(
        executable,
        conversationsChannelListResult(conversationsCliRunner(executable)(["channel", "list", "-j"])),
      );
    }
    const cached = channelNameListCache.get(executable)!;
    if (!cached.ok) return { verdict: "unknown", detail: cached.detail };
    return conversationsChannelExistence(cached.names, channel);
  };
}

/**
 * Whether doctor/link surfaces should validate advertised conversations
 * channels against the conversations app on this box. Off in tests (a probe
 * would spawn a CLI that is not there); on by default where the conversations
 * CLI is expected (the fleet). Set HASNA_PROJECTS_CHANNEL_VERIFY (or
 * PROJECTS_CHANNEL_VERIFY) to force on/off.
 */
export function shouldProbeConversationsChannel(envValue: Record<string, string | undefined> = process.env): boolean {
  const flag = (envValue["HASNA_PROJECTS_CHANNEL_VERIFY"] ?? envValue["PROJECTS_CHANNEL_VERIFY"])?.trim().toLowerCase();
  if (flag) {
    if (["1", "true", "on", "yes"].includes(flag)) return true;
    if (["0", "false", "off", "no"].includes(flag)) return false;
  }
  if (envValue["NODE_ENV"] === "test") return false;
  return true;
}

/**
 * The probe a write-side channel guard uses when the caller supplies none.
 * `undefined` when this box cannot reach the conversations app (tests, or
 * `HASNA_PROJECTS_CHANNEL_VERIFY=0`) — an unverifiable write is never refused,
 * see {@link assertProjectChannelWritable}.
 */
export function projectChannelWriteProbe(
  envValue: Record<string, string | undefined> = process.env,
): ProjectChannelExistenceProbe | undefined {
  return shouldProbeConversationsChannel(envValue) ? conversationsCliChannelProbe() : undefined;
}

/**
 * The channel name a write would newly pin, or `null` when the write leaves
 * `integrations.conversations_channel` alone (absent on both sides, or
 * byte-equal to what the record already held — a full-integrations write that
 * merely carries the existing value forward is not a new claim).
 */
export function changedProjectChannel(
  next: WorkspaceIntegrations | undefined,
  previous: WorkspaceIntegrations | undefined,
): string | null {
  const normalized = (value: string | undefined): string | null => {
    const trimmed = value?.trim();
    return trimmed ? normalizeProjectChannelName(trimmed) : null;
  };
  const nextChannel = normalized(next?.[PROJECT_CHANNEL_INTEGRATION_KEY]);
  const previousChannel = normalized(previous?.[PROJECT_CHANNEL_INTEGRATION_KEY]);
  if (!nextChannel || nextChannel === previousChannel) return null;
  return nextChannel;
}

/**
 * Refuse a write that would pin `integrations.conversations_channel` at a name
 * the conversations app has no channel for (BUG-0063).
 *
 * The registry stores the channel as a free-form name and nothing validated it,
 * so a renamed project kept pointing at its old name — `employee-contracts`
 * still carrying `employee-contract-closing`. That name resolved as an agent DM
 * handle and not as a channel, so the project-channel post fell through to the
 * DM lane (nobody watching the project channel ever saw it) or failed closed
 * with HTTP 400 "Channel ... does not exist, so this message was not sent."
 *
 * Only a positive `missing` verdict refuses the write. An unavailable probe
 * (`probe` undefined, e.g. tests, or a box with no conversations CLI) or an
 * `unknown` verdict passes through: this guard must never invent a failure
 * from an answer it could not obtain — the same discipline the workspace
 * doctor follows when it reports "not verified" instead of a fabricated
 * error.
 */
export function assertProjectChannelWritable(
  channel: string | null | undefined,
  options: { probe?: ProjectChannelExistenceProbe } = {},
): void {
  const target = channel?.trim();
  if (!target) return;
  const probe = options.probe;
  if (!probe) return;
  const result = probe(target);
  if (result.verdict !== "missing") return;
  throw new Error(
    `Refusing to pin integrations.${PROJECT_CHANNEL_INTEGRATION_KEY} "${target}": the conversations app has no channel with that name, `
    + `so a project-channel post would fail closed (HTTP 400 "Channel \\"${target}\\" does not exist, so this message was not sent.") `
    + `or land in an agent DM of the same name instead of in a channel. `
    + `Create the channel first (conversations channel create ${target}) or point the project at a channel that exists `
    + `(conversations channel list -j). Set HASNA_PROJECTS_CHANNEL_VERIFY=0 to skip this check.`,
  );
}

/**
 * The write-time guard for an integration mutation: checks the channel only
 * when this write actually sets or changes it, so a full-integrations write
 * that carries an existing (already-broken) value forward still succeeds and
 * the repair stays a deliberate, separate act.
 */
export function assertProjectChannelIntegrationWritable(
  next: WorkspaceIntegrations | undefined,
  previous: WorkspaceIntegrations | undefined,
  options: { probe?: ProjectChannelExistenceProbe; env?: Record<string, string | undefined> } = {},
): void {
  const channel = changedProjectChannel(next, previous);
  if (!channel) return;
  const probe = options.probe ?? projectChannelWriteProbe(options.env);
  assertProjectChannelWritable(channel, { probe });
}
