import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

/**
 * The contract's `storage.envPrefix` for this package. Configuration is read
 * from `HASNA_FEEDBACK_*` first, falling back to the historical unprefixed
 * `FEEDBACK_*` names so existing setups keep working.
 */
export const ENV_PREFIX = "HASNA_FEEDBACK_";

/** The legacy append-only JSONL store file name. */
export const DEFAULT_FEEDBACK_FILE = "feedback.jsonl";

/**
 * The legacy (pre-XDG) default data dir: `~/.hasna/feedback`. Retained as the
 * effective data dir until the @hasna/paths-resolved XDG data home is adopted
 * (`HASNA_DATA_HOME` set or a store file already present at the resolver
 * root).
 */
export const DEFAULT_DATA_DIR = join(homedir(), ".hasna", "feedback");

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

/** The effective user home, mirroring the pre-existing feedback resolution. */
export function effectiveHome(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir() || "/tmp";
}

/** The legacy (pre-XDG) data root: `~/.hasna/feedback`. */
export function legacyDataRoot(): string {
  return join(effectiveHome(), ".hasna", "feedback");
}

/**
 * The @hasna/paths-resolved (XDG / macOS home layout) data root for feedback:
 * `~/.local/share/hasna/feedback` on Linux, `~/Library/Application
 * Support/Hasna/feedback` on macOS. The home override mirrors the pre-existing
 * `$HOME`-first resolution so the resolver follows the same home the legacy
 * path does.
 */
export function resolverDataRoot(): string {
  return dataDir({
    app: "feedback",
    home: process.env["HOME"] || process.env["USERPROFILE"] || undefined,
  });
}

/**
 * Whether the resolver (XDG) data root should be adopted as the effective data
 * root. The resolver root is adopted only when the operator has set
 * `HASNA_DATA_HOME` (the data-kind override — a deliberate opt-in to the XDG
 * layout) or the store has already been physically migrated there
 * (`feedback.db` or `feedback.jsonl` — feedback's store files). A machine that
 * only redirects another kind (e.g. cache to tmpfs) must NOT have its data
 * home moved, and a live store at the legacy home must never become invisible
 * on upgrade.
 */
export function adoptResolverDataRoot(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return (
    existsSync(join(resolved, "feedback.db")) || existsSync(join(resolved, "feedback.jsonl"))
  );
}

/** The exact-app override root, when set: `HASNA_FEEDBACK_HOME`, then `FEEDBACK_HOME`. */
export function exactDataRoot(): string | undefined {
  // First non-blank override wins. A blank or whitespace-only primary must not
  // shadow a valid secondary (nullish `??` does not fall through on "").
  for (const key of ["HASNA_FEEDBACK_HOME", "FEEDBACK_HOME"] as const) {
    const dir = process.env[key]?.trim();
    if (dir) return resolve(dir);
  }
  return undefined;
}

/**
 * The effective data dir: an exact-app override (`HASNA_FEEDBACK_HOME`, then
 * `FEEDBACK_HOME`) wins unconditionally; otherwise the resolver (XDG) data
 * root once adopted; otherwise the legacy `~/.hasna/feedback` default.
 */
export function getDataDir(): string {
  const exact = exactDataRoot();
  if (exact) return exact;
  const resolved = resolverDataRoot();
  return adoptResolverDataRoot(resolved) ? resolve(resolved) : resolve(legacyDataRoot());
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
