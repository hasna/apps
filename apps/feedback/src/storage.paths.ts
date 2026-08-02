import { homedir } from "node:os";
import { join } from "node:path";

export const DEFAULT_DATA_DIR = join(homedir(), ".hasna", "feedback");
export const DEFAULT_FEEDBACK_FILE = "feedback.jsonl";

/**
 * The contract's `storage.envPrefix` for this package. Configuration is read
 * from `HASNA_FEEDBACK_*` first, falling back to the historical unprefixed
 * `FEEDBACK_*` names so existing setups keep working.
 */
export const ENV_PREFIX = "HASNA_FEEDBACK_";

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
  return dataDir && dataDir.trim() ? dataDir : DEFAULT_DATA_DIR;
}

export function resolveFeedbackFilePath(options: { dataDir?: string; filePath?: string } = {}): string {
  return options.filePath ?? join(resolveFeedbackDataDir(options.dataDir), DEFAULT_FEEDBACK_FILE);
}
