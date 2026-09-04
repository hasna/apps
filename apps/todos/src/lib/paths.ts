/**
 * todos data-root resolution — thin app wrapper over the single paths
 * resolver in `@hasna/contracts` (ruling hasna/apps#1668). The resolver owns
 * platform placement (`the todos data root` on macOS, XDG data root on Linux)
 * and the `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind overrides; this module
 * layers the todos-specific exact-app override on top.
 */
import { resolve } from "node:path";
import { join } from "node:path";
import { dataDir as resolverDataDir, effectiveHome as resolveEffectiveHome } from "@hasna/contracts/paths";

/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export const effectiveHome = resolveEffectiveHome;

/**
 * The resolver todos data root: kind overrides honored,
 * `the todos data root` on macOS, `~/.local/share/hasna/todos` on Linux.
 */
export function resolverHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolverDataDir({ app: "todos", home: effectiveHome(env), env, });
}

/**
 * The pre-ruling legacy root (`the todos data root`). On macOS this equals the
 * resolver root; elsewhere it is kept only for historical-data migration.
 */
export function legacyHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(effectiveHome(env), ".hasna", "todos");
}

export function getDefaultDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(getTodosDir(env), "todos.db");
}
export function getTrainingDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(getTodosDir(env), "training");
}
export function getConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(getTodosDir(env), "config.json");
}

/**
 * The effective todos data root (ruling #1668 — the resolver root IS
 * the convention on every platform); file-level store overrides are layered
 * on top by the individual store layers and always win regardless.
 */
export function getTodosDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(resolverHome(env));
}
