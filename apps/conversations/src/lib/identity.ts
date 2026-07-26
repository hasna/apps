import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { AGENT_NAMES } from "./names.js";
import { getDataDir } from "./db.js";
import { normalizeAgentName } from "./presence.js";

const AGENT_ID_FILE = join(getDataDir(), "agent-id");

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
 * Get or create a persistent auto-generated agent name.
 * Stored in ~/.hasna/conversations/agent-id so the same installation
 * always gets the same name. Checks the DB to avoid duplicates.
 */
export function getAutoName(): string {
  if (cachedAutoName) return cachedAutoName;

  // Try to read existing name
  try {
    const name = readFileSync(AGENT_ID_FILE, "utf-8").trim();
    if (name) {
      cachedAutoName = name;
      return name;
    }
  } catch {
    // File doesn't exist yet
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

  // Persist it
  try {
    mkdirSync(dirname(AGENT_ID_FILE), { recursive: true });
    writeFileSync(AGENT_ID_FILE, name + "\n", "utf-8");
  } catch {
    // Non-fatal: name works for this session even if we can't persist
  }

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
 * A rename should move this installation's persisted identity only when the
 * agent being renamed IS the locally persisted identity. Renaming some other
 * agent by name must never hijack who this machine claims to be.
 */
export function isSelfRename(oldName: string, localIdentity: string): boolean {
  return normalizeAgentName(oldName) === normalizeAgentName(localIdentity);
}

/**
 * Update the cached auto name after a successful rename.
 */
export function updateCachedAutoName(newName: string): void {
  cachedAutoName = newName;
  try {
    mkdirSync(dirname(AGENT_ID_FILE), { recursive: true });
    writeFileSync(AGENT_ID_FILE, newName + "\n", "utf-8");
  } catch {
    // Non-fatal
  }
}

/**
 * Reset the cached auto name (for testing).
 */
export function _resetAutoName(): void {
  cachedAutoName = null;
}
