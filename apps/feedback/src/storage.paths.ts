/**
 * feedback data-root resolution — thin app wrapper over the single paths
 * resolver in `@hasna/contracts` (ruling hasna/apps#1668). The resolver owns
 * platform placement (`~/.hasna/feedback` on macOS, XDG data root on Linux)
 * and the `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind overrides; this module
 * layers the feedback-specific exact-app override on top.
 */
import { resolve } from "node:path";
import { join } from "node:path";
import { dataDir as resolverDataDir, effectiveHome as resolveEffectiveHome } from "@hasna/contracts/paths";

/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export const effectiveHome = resolveEffectiveHome;
export const ENV_PREFIX = "HASNA_FEEDBACK_";
export const DEFAULT_FEEDBACK_FILE = "feedback.jsonl";

/**
 * The resolver feedback data root: kind overrides honored,
 * `~/.hasna/feedback` on macOS, `~/.local/share/hasna/feedback` on Linux.
 */
export function resolverDataRoot(): string {
  return resolverDataDir({ app: "feedback", home: effectiveHome(),  });
}

/**
 * The pre-ruling legacy root (`~/.hasna/feedback`). On macOS this equals the
 * resolver root; elsewhere it is kept only for historical-data migration.
 */
export function legacyDataRoot(): string {
  return join(effectiveHome(), ".hasna", "feedback");
}

export function exactDataRoot(): string | undefined {
  // First non-blank override wins. A blank or whitespace-only primary must not
  // shadow a valid secondary (nullish `??` does not fall through on "").
  for (const key of ["HASNA_FEEDBACK_HOME", "FEEDBACK_HOME"] as const) {
    const dir = process.env[key]?.trim();
    if (dir) return resolve(dir);
  }
  return undefined;
}

/** Read a setting by its prefixed name, then its legacy unprefixed aliases. */
export function readStorageEnv(
  env: Record<string, string | undefined>,
  suffix: string,
  legacyAliases: string[] = [],
): string | undefined {
  const names = [`${ENV_PREFIX}${suffix}`, `FEEDBACK_${suffix}`, ...legacyAliases];
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && value.trim()) return value;
  }
  return undefined;
}

export function resolveFeedbackDataDir(
  dataDir: string | undefined = readStorageEnv(process.env, "DATA_DIR"),
): string {
  // An explicit HASNA_FEEDBACK_DATA_DIR / FEEDBACK_DATA_DIR override names the
  // data dir directly and wins over the resolved home.
  return dataDir && dataDir.trim() ? dataDir : getDataDir();
}

export function resolveFeedbackFilePath(options: { dataDir?: string; filePath?: string } = {}): string {
  return options.filePath ?? join(resolveFeedbackDataDir(options.dataDir), DEFAULT_FEEDBACK_FILE);
}

/**
 * The effective feedback data root: an exact-app override wins
 * unconditionally; otherwise the resolver data root (ruling #1668 — the
 * resolver root IS the convention on every platform).
 */
export function getDataDir(): string {
  const exact = exactDataRoot();
  if (exact) return exact;
  return resolve(resolverDataRoot());
}
