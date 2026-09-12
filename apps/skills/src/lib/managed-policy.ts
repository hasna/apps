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
    const value = policy as { loading?: unknown; profileId?: unknown };
    if (value.loading !== undefined && typeof value.loading !== "string") throw new Error();
    if (value.profileId !== undefined && (typeof value.profileId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value.profileId))) throw new Error();
    return value as { loading?: string; profileId?: string };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new SkillSelectionError("INVALID_AGENT_POLICY", "The Skills agent loading policy is unreadable; refusing legacy fallback.");
  }
}
export function requiresCliSkillLoading(dataDir = getDataDirReadOnly()): boolean {
  return readManagedSkillPolicy(dataDir)?.loading === "cli";
}
