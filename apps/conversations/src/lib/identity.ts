import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { getDataDir } from "./db.js";
import { normalizeAgentName } from "./presence.js";

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
  const raw = process.env.CONVERSATIONS_USE_MACHINE_IDENTITY?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function identityNotSet(persisted: string | null): IdentityError {
  const held = persisted
    ? `The machine identity file (${agentIdFile()}) currently names "${persisted}", but that identity belongs to whichever seat wrote it — it is not this session's to borrow.`
    : `The machine identity file (${agentIdFile()}) does not exist.`;
  return new IdentityError(
    `No agent identity for this session. ${held}\n` +
      `Declare one of:\n` +
      `  - CONVERSATIONS_AGENT_ID=<name>   per session (what a durable seat should set)\n` +
      `  - --from <name>                   per invocation\n` +
      `  - CONVERSATIONS_USE_MACHINE_IDENTITY=1   only where this process owns the whole machine's identity`,
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
 * Priority: explicit flag → CONVERSATIONS_AGENT_ID env → opted-in machine
 * identity file. There is deliberately no fourth rung: a session that declared
 * nothing gets an error, not a guess. Silent inheritance and silent invention
 * were the same bug, and both were invisible precisely because resolution
 * always succeeded.
 *
 * @throws {IdentityError} when nothing declared an identity for this session.
 */
export function resolveIdentity(explicit?: string): string {
  const explicitValue = explicit?.trim();
  if (explicitValue) return explicitValue;
  const envValue = process.env.CONVERSATIONS_AGENT_ID?.trim();
  if (envValue) return envValue;
  return getAutoName();
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
  if (process.env.CONVERSATIONS_AGENT_ID?.trim()) return "env var (CONVERSATIONS_AGENT_ID)";
  return `machine identity file, opted in via CONVERSATIONS_USE_MACHINE_IDENTITY (${agentIdFile()})`;
}

/**
 * Require an explicit identity (for headless/MCP use).
 * Throws if no identity is set via flag or env.
 */
export function requireIdentity(explicit?: string): string {
  const explicitValue = explicit?.trim();
  if (explicitValue) return explicitValue;
  const envValue = process.env.CONVERSATIONS_AGENT_ID?.trim();
  if (envValue) return envValue;
  throw new Error(
    "Agent identity required. Set CONVERSATIONS_AGENT_ID env var or pass --from flag."
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
