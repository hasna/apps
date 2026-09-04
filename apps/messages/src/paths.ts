/**
 * Messages data-root resolution — thin app wrapper over the single paths
 * resolver in `@hasna/contracts` (ruling hasna/apps#1668). The resolver owns
 * platform placement (`~/.hasna/messages` on macOS, XDG data root on Linux)
 * and the `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind overrides; this module
 * layers the messages-specific exact-app override on top.
 */
import { resolve } from "node:path";
import { join } from "node:path";
import { dataDir, effectiveHome } from "@hasna/contracts/paths";

/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export const getHomeDir = effectiveHome;

/**
 * The resolver data root for messages: kind overrides honored,
 * `~/.hasna/messages` on macOS, `~/.local/share/hasna/messages` on Linux.
 */
export function getResolverDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return dataDir({ app: "messages", home: effectiveHome(env), env });
}

/**
 * The pre-ruling legacy root (`~/.hasna/messages`). On macOS this equals the
 * resolver root; elsewhere it is kept only for historical-data migration.
 */
export function getLegacyDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(effectiveHome(env), ".hasna", "messages");
}

/** The exact-app override root, when set: `HASNA_MESSAGES_HOME`. */
export function getExactDataRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const dir = env["HASNA_MESSAGES_HOME"];
  if (dir && dir.trim()) return resolve(dir.trim());
  return undefined;
}

/**
 * The effective data root: an exact-app override (`HASNA_MESSAGES_HOME`) wins
 * unconditionally; otherwise the resolver data root (ruling #1668 — the
 * resolver root IS the convention on every platform). The store path
 * (`HASNA_MESSAGES_SQLITE_PATH`) is layered on top of this by the SQLite
 * store layer, so an explicit store path always wins regardless.
 */
export function getDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const exact = getExactDataRoot(env);
  if (exact) return exact;
  return resolve(getResolverDataRoot(env));
}