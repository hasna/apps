import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { AGENT_NAMES } from "./names.js";
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
 * Check if a name is already taken in the agent_presence table.
 * Uses a lazy import to avoid circular dependency with db.ts.
 */
function isNameTaken(name: string): boolean {
  try {
    const { getDb } = require("./db.js");
    const db = getDb();
    const row = db.prepare("SELECT agent FROM agent_presence WHERE agent = ?").get(name);
    return !!row;
  } catch {
    return false;
  }
}

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

/**
 * Get or create a persistent auto-generated agent name.
 * Stored in ~/.hasna/conversations/agent-id so the same installation
 * always gets the same name. Checks the DB to avoid duplicates.
 */
export function getAutoName(): string {
  if (cachedAutoName) return cachedAutoName;

  const persisted = readPersistedIdentity();
  if (persisted) {
    cachedAutoName = persisted;
    return persisted;
  }

  // Pick a random name that isn't already taken
  const shuffled = [...AGENT_NAMES].sort(() => Math.random() - 0.5);
  let name = shuffled[0];
  for (const candidate of shuffled) {
    if (!isNameTaken(candidate)) {
      name = candidate;
      break;
    }
  }

  cachedAutoName = name;
  persistIdentity(name);
  return name;
}

/**
 * Resolve agent identity.
 * Priority: explicit flag → CONVERSATIONS_AGENT_ID env → auto-generated persistent name
 */
export function resolveIdentity(explicit?: string): string {
  const explicitValue = explicit?.trim();
  if (explicitValue) return explicitValue;
  const envValue = process.env.CONVERSATIONS_AGENT_ID?.trim();
  if (envValue) return envValue;
  return getAutoName();
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
