/**
 * mementos data-root resolution — thin app wrapper over the single paths
 * resolver in `@hasna/contracts` (ruling hasna/apps#1668). The resolver owns
 * platform placement (`the mementos data root` on macOS, XDG data root on Linux)
 * and the `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind overrides; this module
 * layers the mementos-specific exact-app override on top.
 */
import { resolve } from "node:path";
import { join } from "node:path";
import { dataDir as resolverDataDir, effectiveHome as resolveEffectiveHome } from "@hasna/contracts/paths";

/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export const effectiveHome = resolveEffectiveHome;

/**
 * The resolver mementos data root: kind overrides honored,
 * `the mementos data root` on macOS, `~/.local/share/hasna/mementos` on Linux.
 */
export function resolverDataRoot(): string {
  return resolverDataDir({ app: "mementos", home: effectiveHome(),  });
}

/**
 * The pre-ruling legacy root (`the mementos data root`). On macOS this equals the
 * resolver root; elsewhere it is kept only for historical-data migration.
 */
export function legacyDataRoot(): string {
  return join(effectiveHome(), ".hasna", "mementos");
}

export function exactDataRoot(): string | undefined {
  // First non-blank override wins. A blank or whitespace-only primary must not
  // shadow a valid secondary (nullish `??` does not fall through on "").
  for (const key of ["HASNA_MEMENTOS_HOME", "MEMENTOS_HOME"] as const) {
    const dir = process.env[key]?.trim();
    if (dir) return resolve(dir);
  }
  return undefined;
}

/**
 * The effective mementos data root: an exact-app override wins
 * unconditionally; otherwise the resolver data root (ruling #1668 — the
 * resolver root IS the convention on every platform).
 */
export function getDataRoot(): string {
  const exact = exactDataRoot();
  if (exact) return exact;
  return resolve(resolverDataRoot());
}
