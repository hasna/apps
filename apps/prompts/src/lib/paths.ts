/**
 * prompts data-root resolution — thin app wrapper over the single paths
 * resolver in `@hasna/contracts` (ruling hasna/apps#1668). The resolver owns
 * platform placement (`~/.hasna/prompts` on macOS, XDG data root on Linux)
 * and the `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind overrides; this module
 * layers the prompts-specific exact-app override on top.
 */
import { resolve } from "node:path";
import { join } from "node:path";
import { dataDir as resolverDataDir, effectiveHome as resolveEffectiveHome } from "@hasna/contracts/paths";

/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export const effectiveHome = resolveEffectiveHome;

/**
 * The resolver prompts data root: kind overrides honored,
 * `~/.hasna/prompts` on macOS, `~/.local/share/hasna/prompts` on Linux.
 */
export function resolverDataRoot(): string {
  return resolverDataDir({ app: "prompts", home: effectiveHome(),  });
}

/**
 * The pre-ruling legacy root (`~/.hasna/prompts`). On macOS this equals the
 * resolver root; elsewhere it is kept only for historical-data migration.
 */
export function legacyDataRoot(): string {
  return join(effectiveHome(), ".hasna", "prompts");
}

export function exactDataRoot(): string | undefined {
  // First non-blank override wins. A blank or whitespace-only primary must not
  // shadow a valid secondary (nullish `??` does not fall through on "").
  for (const key of ["HASNA_PROMPTS_HOME", "PROMPTS_HOME"] as const) {
    const dir = process.env[key]?.trim();
    if (dir) return resolve(dir);
  }
  return undefined;
}
export function runsDir(): string {
  return join(getDataRoot(), "runs");
}
export function runbookPromptDir(): string {
  const exact = exactDataRoot();
  if (exact) return join(exact, "runbook");
  // Runbooks physically live under the loops app's data home (ruling #1668:
  // one resolver — the loops root owns them).
  return join(resolveDataDir({ app: "loops", home: effectiveHome() }), "prompts");
}

/**
 * The effective prompts data root: an exact-app override wins
 * unconditionally; otherwise the resolver data root (ruling #1668 — the
 * resolver root IS the convention on every platform).
 */
export function getDataRoot(): string {
  const exact = exactDataRoot();
  if (exact) return exact;
  return resolve(resolverDataRoot());
}
