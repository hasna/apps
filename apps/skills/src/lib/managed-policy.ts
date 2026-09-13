import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getDataDirReadOnly } from "./config.js";
import { SkillSelectionError } from "./selection-cache.js";

/** Lightweight, write-free policy check; importing agent integration would create an installer cycle. */
export function readManagedSkillPolicy(dataDir = getDataDirReadOnly()): { loading?: string; profileId?: string } | null {
  const path = join(dataDir, "agent-policy.json");
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_384) throw new Error();
    const policy: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!policy || typeof policy !== "object" || Array.isArray(policy)) throw new Error();
    const value = policy as { version?: unknown; loading?: unknown; profileId?: unknown };
    // Absence is the unmanaged compatibility case. An existing policy cannot
    // silently demote the station through a typo or a future schema version.
    if (value.loading !== "cli" || (value.version !== undefined && value.version !== 1)) throw new Error();
    if (value.profileId !== undefined && (typeof value.profileId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.profileId) || value.profileId.includes(".."))) throw new Error();
    return value as { loading?: string; profileId?: string };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new SkillSelectionError("INVALID_AGENT_POLICY", "The Skills agent loading policy is unreadable; refusing legacy fallback.");
  }
}
export function requiresCliSkillLoading(dataDir = getDataDirReadOnly()): boolean {
  return readManagedSkillPolicy(dataDir)?.loading === "cli";
}
