import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from "fs";
import { createHash, randomUUID } from "crypto";
import { join, dirname } from "path";
import { getDataDir } from "./db.js";
import { normalizeAgentName } from "./presence.js";
import { env } from "./env.js";

/**
 * Path of the installation-wide identity file.
 *
 * Resolved per call rather than once at import: the MCP server is a daemon that
 * can outlive any assumption made at load time, and a module-level constant
 * also made this module impossible to isolate in tests (they ended up unlinking
 * the developer's REAL identity file).
 */
function agentIdFile(): string {
  return join(getDataDir(), "agent-id");
}

/** Return the stable session id declared by the caller, if it has one. */
export function getDeclaredSessionId(): string | null {
  const sessionId = env.sessionId()?.trim();
  return sessionId || null;
}

/**
 * Path for one session's identity binding.
 *
 * The session id is hashed rather than interpolated into the path. Besides
 * avoiding path traversal, this lets callers use opaque runtime session ids
 * without leaking them into directory listings.
 */
function sessionIdentityFile(sessionId: string): string {
  const key = createHash("sha256").update(sessionId).digest("hex");
  return join(getDataDir(), "session-identities", `${key}.json`);
}

type SessionIdentityRecord = {
  version: 1;
  session_id: string;
  agent: string;
};

/** Read one session's persisted identity, verifying the unhashed key too. */
export function readSessionIdentity(
  sessionId: string | null = getDeclaredSessionId(),
): string | null {
  const declared = sessionId?.trim();
  if (!declared) return null;

  try {
    const record = JSON.parse(
      readFileSync(sessionIdentityFile(declared), "utf-8"),
    ) as Partial<SessionIdentityRecord>;
    if (record.version !== 1 || record.session_id !== declared) return null;
    const agent = typeof record.agent === "string" ? record.agent.trim() : "";
    return agent || null;
  } catch {
    return null;
  }
}

/**
 * Bind one stable session id to an agent without touching another session or
 * the installation-wide fallback. The rename makes the record replacement
 * atomic for readers in other CLI processes.
 */
export function bindSessionIdentity(name: string, sessionId: string): boolean {
  const declared = sessionId.trim();
  const agent = name.trim();
  if (!declared || !agent) return false;

  const target = sessionIdentityFile(declared);
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    mkdirSync(dirname(target), { recursive: true });
    const record: SessionIdentityRecord = {
      version: 1,
      session_id: declared,
      agent,
    };
    writeFileSync(temp, JSON.stringify(record) + "\n", {
      encoding: "utf-8",
      mode: 0o600,
    });
    renameSync(temp, target);
    return true;
  } catch {
    return false;
  } finally {
    try { rmSync(temp, { force: true }); } catch {}
  }
}

let cachedAutoName: string | null = null;

/**
 * Read the persisted identity straight from disk, bypassing the cache.
 *
 * Callers deciding whether to *rewrite* the identity file must use this, not
 * getAutoName(): in a long-lived daemon the cache can be days stale, and acting
 * on a stale cache is how one session overwrites another session's identity.
 */
export function readPersistedIdentity(): string | null {
  try {
    const name = readFileSync(agentIdFile(), "utf-8").trim();
    return name || null;
  } catch {
    return null;
  }
}

/** Write the identity file. Returns whether the write actually succeeded. */
function persistIdentity(name: string): boolean {
  try {
    mkdirSync(dirname(agentIdFile()), { recursive: true });
    writeFileSync(agentIdFile(), name + "\n", "utf-8");
    return true;
  } catch {
    // Non-fatal: the name still works for this process. Operators also pin this
    // file read-only on purpose, so a failed write is an expected outcome and
    // callers must report it rather than claim success.
    return false;
  }
}

/** Raised when identity cannot be resolved without guessing. */
export class IdentityError extends Error {
  readonly code = "IDENTITY_NOT_SET" as const;
  constructor(message: string) {
    super(message);
    this.name = "IdentityError";
  }
}

/**
 * Whether this process opted in to the machine-wide identity file.
 *
 * Opting in is a positive act, and that is the whole point: the file is a
 * legitimate answer for a context that owns the whole box (cron, a loop, the
 * blocker hook, a single-seat install) and an illegitimate one for a box
 * running several seats at once. Only the caller knows which it is, so only the
 * caller may say so.
 */
function machineIdentityAllowed(): boolean {
  const raw = env.useMachineIdentity()?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function identityNotSet(persisted: string | null): IdentityError {
  const held = persisted
    ? `The machine identity file (${agentIdFile()}) currently names "${persisted}", but that identity belongs to whichever seat wrote it — it is not this session's to borrow.`
    : `The machine identity file (${agentIdFile()}) does not exist.`;
  return new IdentityError(
    `No agent identity for this session. ${held}\n` +
      `Declare one of:\n` +
      `  - HASNA_CONVERSATIONS_AGENT_ID=<name>   per session (what a durable seat should set; legacy CONVERSATIONS_AGENT_ID accepted)\n` +
      `  - --from <name>                   per invocation\n` +
      `  - HASNA_CONVERSATIONS_SESSION_ID=<id>   then run conversations agents register <name> (legacy CONVERSATIONS_SESSION_ID accepted)\n` +
      `  - HASNA_CONVERSATIONS_USE_MACHINE_IDENTITY=1   only where this process owns the whole machine's identity (legacy CONVERSATIONS_USE_MACHINE_IDENTITY accepted)`,
  );
}

/**
 * Read the machine-wide identity, or throw.
 *
 * This used to be `getAutoName()`, and it used to do two things that made
 * attribution unreliable. It no longer does either.
 *
 * It no longer INVENTS. With no file present it picked a random name from the
 * pool and *persisted it as the machine identity*, so a name nobody chose
 * became the default author for the CLI, the MCP server and the blocker hook
 * alike. An identity registry that mints identities cannot be a record of who
 * did what.
 *
 * It no longer hands the file to every caller by DEFAULT. One file served the
 * whole box, so the last writer's identity became everyone's: on 2026-07-30 a
 * deliberate write of "agent-ceo" (correct for that one seat) silently
 * reattributed a day of work from six other seats on the same machine. Callers
 * that genuinely own the machine identity opt in; everyone else gets an error
 * naming the identity they would have borrowed.
 */
export function getAutoName(): string {
  const persisted = readPersistedIdentity();

  // The gate is evaluated BEFORE the cache, and the order is the whole point.
  // updateCachedAutoName() is called by register_agent's seed-if-absent and by
  // rename's self-adoption, so the cache holds an identity that some *other*
  // caller in this process claimed. Checking it first put that identity ahead
  // of the gate, which reproduced the original defect inside a long-lived
  // daemon: one seat's deliberate `register --identity` or self-rename became
  // every later undeclared caller's identity. That is not hypothetical for the
  // MCP HTTP server — it builds a fresh McpServer per request with
  // `sessionIdGenerator: undefined`, so the per-connection rung is inert and
  // undeclared callers land here.
  if (!machineIdentityAllowed()) throw identityNotSet(persisted ?? cachedAutoName);

  if (cachedAutoName) return cachedAutoName;
  if (persisted) {
    cachedAutoName = persisted;
    return persisted;
  }

  throw identityNotSet(null);
}

/**
 * Resolve agent identity.
 *
 * Priority: explicit flag → CONVERSATIONS_AGENT_ID env → identity bound to the
 * declared CONVERSATIONS_SESSION_ID → opted-in machine identity file. There is
 * deliberately no fifth rung: a session that declared nothing gets an error,
 * not a guess. Silent inheritance and silent invention were the same bug, and
 * both were invisible precisely because resolution always succeeded.
 *
 * @throws {IdentityError} when nothing declared an identity for this session.
 */
export function resolveIdentity(explicit?: string): string {
  const explicitValue = explicit?.trim();
  if (explicitValue) return explicitValue;
  const envValue = env.agentId()?.trim();
  if (envValue) return envValue;
  const sessionValue = readSessionIdentity();
  if (sessionValue) return sessionValue;
  return getAutoName();
}

/**
 * Split a comma-separated identity list into its entries.
 *
 * Returns `[]` when nothing usable was given, so callers can distinguish "no
 * list supplied" from "a list that resolved to one name" and fall through to
 * the normal single-identity resolution.
 *
 * Entries are trimmed, blanks dropped, and duplicates removed
 * case-insensitively while keeping the FIRST spelling — a list that names the
 * same seat twice must not double every row of a union read.
 */
export function parseIdentityList(value?: string): string[] {
  if (!value) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value.split(",")) {
    const name = raw.trim();
    if (!name) continue;
    const key = normalizeAgentName(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Resolve one or more agent identities, in declared order.
 *
 * A seat routinely answers to two names — an agent name and a seat slug — and
 * the queues behind them are genuinely disjoint (measured 2026-08-02: 46 tasks
 * on one, 71 on the other, intersection 0). A reader armed on one name reports
 * an empty inbox for the other's traffic, at exit 0, which is indistinguishable
 * from a quiet channel.
 *
 * The contract callers depend on: **reads union across the whole list; the
 * FIRST entry is primary and is the only identity anything writes under.** A
 * monitor that posts, heartbeats or registers under an arbitrary entry of a
 * list is worse than one that simply cannot read the second queue, because the
 * damage it does is attributed to a seat that did not do it.
 *
 * Falls back to {@link resolveIdentity} — including its refusal to invent a
 * name — when no list was supplied.
 *
 * @throws {IdentityError} when nothing declared an identity for this session.
 */
export function resolveIdentities(explicit?: string): string[] {
  const explicitList = parseIdentityList(explicit);
  if (explicitList.length > 0) return explicitList;

  const envList = parseIdentityList(env.agentId());
  if (envList.length > 0) return envList;

  const sessionIdentity = readSessionIdentity();
  if (sessionIdentity) return [sessionIdentity];

  return [getAutoName()];
}

/**
 * Describe, in operator-facing words, where the resolved identity came from.
 *
 * `whoami` used to build this string itself and always reported
 * "auto-generated (<path>)" whenever the value had not come from the flag or
 * the env var — including when it had plainly been READ from the file. That
 * made an inherited identity indistinguishable from an invented one in the one
 * diagnostic an operator would reach for while working out why their messages
 * were signed by somebody else.
 */
export function describeIdentitySource(explicit?: string): string {
  if (explicit?.trim()) return "explicit (--from flag)";
  if (env.agentId()?.trim()) return "env var (HASNA_CONVERSATIONS_AGENT_ID, legacy CONVERSATIONS_AGENT_ID)";
  if (readSessionIdentity()) {
    return "session identity file keyed by HASNA_CONVERSATIONS_SESSION_ID (legacy CONVERSATIONS_SESSION_ID)";
  }
  return `machine identity file, opted in via CONVERSATIONS_USE_MACHINE_IDENTITY (${agentIdFile()})`;
}

/**
 * Require a caller-scoped identity (for headless/MCP use).
 * Throws if no identity is set via flag, agent env, or session binding.
 */
export function requireIdentity(explicit?: string): string {
  const explicitValue = explicit?.trim();
  if (explicitValue) return explicitValue;
  const envValue = env.agentId()?.trim();
  if (envValue) return envValue;
  const sessionValue = readSessionIdentity();
  if (sessionValue) return sessionValue;
  throw new Error(
    "Agent identity required. Set HASNA_CONVERSATIONS_AGENT_ID (legacy CONVERSATIONS_AGENT_ID), bind HASNA_CONVERSATIONS_SESSION_ID with agents register, or pass --from."
  );
}

/**
 * Whether a rename should carry the installation's identity along with it.
 *
 * True only when the agent being renamed IS the persisted identity — otherwise
 * the file would be left naming an agent that no longer exists, or, worse, we
 * would hijack an identity belonging to another session on the same machine.
 */
export function isSelfRename(oldName: string, localIdentity: string | null): boolean {
  if (!localIdentity) return false;
  return normalizeAgentName(oldName) === normalizeAgentName(localIdentity);
}

/**
 * Adopt `newName` as this installation's identity.
 *
 * Returns false when the identity file could not be written (e.g. pinned
 * read-only). On failure the in-memory name is left ALONE: adoption is
 * all-or-nothing. Moving the cache first made resolveIdentity() report the name
 * that was not adopted, so callers reporting the failure printed the exact
 * opposite of the truth — and in the long-lived MCP daemon that wrong name
 * stuck for the process's lifetime, with no path back to the file's value.
 */
export function updateCachedAutoName(newName: string): boolean {
  if (!persistIdentity(newName)) return false;
  cachedAutoName = newName;
  return true;
}

/**
 * Reset the cached auto name (for testing).
 */
export function _resetAutoName(): void {
  cachedAutoName = null;
}
