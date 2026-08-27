import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { dataDir as resolverDataDir } from "@hasna/paths";

/**
 * @hasna/machines data-home resolution through the @hasna/paths resolver.
 *
 * machines stores its sqlite db (`machines.db`), manifest, roster, clipboard
 * and flip-ledger state under a single data root. Historically that root was
 * `~/.hasna/machines`. This module resolves the root through `@hasna/paths`
 * (XDG / macOS home layout) with a gated legacy adoption: the legacy
 * `~/.hasna/machines` stays the effective data root until the store has been
 * physically migrated to the XDG data home (`machines.db` present there) or
 * the operator sets the data-kind override `HASNA_DATA_HOME`. An existing
 * live store never becomes invisible on upgrade. The exact-app overrides
 * (`HASNA_MACHINES_HOME` / `MACHINES_HOME`, plus the pre-existing
 * `HASNA_MACHINES_DIR`) win unconditionally, and the per-file path overrides
 * (`HASNA_MACHINES_*_PATH`) stay layered on top.
 */

/** The effective user home, mirroring the pre-existing machines resolution (`HOME` || `USERPROFILE`). */
export function getHomeDir(): string {
  const home = process.env["HOME"] || process.env["USERPROFILE"] || homedir();
  if (!home) throw new Error("Could not resolve the user home directory");
  return home;
}

/** The legacy (pre-XDG) data root: `~/.hasna/machines`. */
export function getLegacyDataDir(): string {
  return join(getHomeDir(), ".hasna", "machines");
}

/**
 * The @hasna/paths-resolved (XDG / macOS home layout) data root for machines:
 * `~/.local/share/hasna/machines` on Linux, `~/Library/Application
 * Support/Hasna/machines` on macOS. The home override mirrors the pre-existing
 * `$HOME`-first resolution so the resolver follows the same home the legacy
 * path does.
 */
export function getResolverDataDir(): string {
  return resolverDataDir({ app: "machines", home: getHomeDir() });
}

/**
 * Whether the resolver (XDG) data root should be adopted as the effective
 * data root. The resolver root is adopted only when the operator has set
 * `HASNA_DATA_HOME` (the data-kind override — a deliberate opt-in to the XDG
 * layout) or the store has already been physically migrated there
 * (`machines.db` exists — machines' store file). A machine that only
 * redirects another kind (e.g. cache to tmpfs) must NOT have its data home
 * moved, and a live store at the legacy home must never become invisible on
 * upgrade.
 */
export function adoptResolverDataDir(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "machines.db"));
}

/** The exact-app override root, when set: `HASNA_MACHINES_HOME`, then `MACHINES_HOME`, then the legacy `HASNA_MACHINES_DIR`. */
export function getExactDataDir(): string | undefined {
  // First non-blank override wins. A blank or whitespace-only primary must not
  // shadow a valid secondary (nullish `??` does not fall through on "").
  for (const key of ["HASNA_MACHINES_HOME", "MACHINES_HOME", "HASNA_MACHINES_DIR"] as const) {
    const dir = process.env[key]?.trim();
    if (dir) return resolve(dir);
  }
  return undefined;
}

/**
 * The effective machines data root: an exact-app override
 * (`HASNA_MACHINES_HOME`, then `MACHINES_HOME`, then the pre-existing
 * `HASNA_MACHINES_DIR`) wins unconditionally; otherwise the resolver (XDG)
 * data root once adopted (`HASNA_DATA_HOME` set, or `machines.db` already
 * migrated there); otherwise the legacy `~/.hasna/machines` default — an
 * existing store never becomes invisible on upgrade.
 */
export function getDataDir(): string {
  const exact = getExactDataDir();
  if (exact) return exact;
  const resolved = getResolverDataDir();
  return adoptResolverDataDir(resolved) ? resolve(resolved) : resolve(getLegacyDataDir());
}

export function getDbPath(): string {
  return process.env["HASNA_MACHINES_DB_PATH"] || join(getDataDir(), "machines.db");
}

export function getManifestPath(): string {
  return process.env["HASNA_MACHINES_MANIFEST_PATH"] || join(getDataDir(), "machines.json");
}

/**
 * Resolve one exact manifest authority for candidate operations.
 * An explicit CLI path may not silently override a different environment path.
 */
export function resolveExactManifestPath(explicitPath?: string, env: NodeJS.ProcessEnv = process.env): string {
  const explicit = explicitPath?.trim() ? resolve(explicitPath) : null;
  const configured = env["HASNA_MACHINES_MANIFEST_PATH"]?.trim()
    ? resolve(env["HASNA_MACHINES_MANIFEST_PATH"]!)
    : null;
  if (explicit && configured && explicit !== configured) {
    throw new Error("Explicit --manifest and HASNA_MACHINES_MANIFEST_PATH resolve to different files.");
  }
  return explicit ?? configured ?? resolve(getManifestPath());
}

export function getNotificationsPath(): string {
  return process.env["HASNA_MACHINES_NOTIFICATIONS_PATH"] || join(getDataDir(), "notifications.json");
}

export function getFreezePath(): string {
  return process.env["HASNA_MACHINES_FREEZE_PATH"] || join(getDataDir(), "freeze.json");
}

export function getRolloutRecordsPath(): string {
  return process.env["HASNA_MACHINES_ROLLOUT_RECORDS_PATH"] || join(getDataDir(), "rollout-records.jsonl");
}

export function getRosterConfigPath(): string {
  return process.env["HASNA_MACHINES_ROSTER_CONFIG_PATH"] || join(getDataDir(), "roster.json");
}

export function getRosterRecordsPath(): string {
  return process.env["HASNA_MACHINES_ROSTER_RECORDS_PATH"] || join(getDataDir(), "roster-records.jsonl");
}

export function getRosterHeartbeatPath(): string {
  return process.env["HASNA_MACHINES_ROSTER_HEARTBEAT_PATH"] || join(getDataDir(), "roster-heartbeat.json");
}

export function getClipboardKeyPath(): string {
  return process.env["HASNA_MACHINES_CLIPBOARD_KEY_PATH"] || join(getDataDir(), "clipboard.key");
}

export function getClipboardHistoryPath(): string {
  return process.env["HASNA_MACHINES_CLIPBOARD_HISTORY_PATH"] || join(getDataDir(), "clipboard-history.json");
}

export function ensureParentDir(filePath: string): void {
  if (filePath === ":memory:") return;
  const dir = dirname(resolve(filePath));
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function ensureDataDir(): string {
  const dir = getDataDir();
  ensureParentDir(join(dir, ".keep"));
  return dir;
}

/**
 * The per-run flip ledger (P1-C). JSONL, one entry per machine per flip run.
 * Every row is value-free: machine, app, ts, result, source-of-value, sha256,
 * provenance-gate verdict.
 */
export function getFlipLedgerPath(): string {
  return process.env["HASNA_MACHINES_FLIP_LEDGER_PATH"] || join(getDataDir(), "flip-ledger.jsonl");
}
