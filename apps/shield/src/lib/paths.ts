import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

/**
 * @hasna/shield data-home resolution through the @hasna/paths resolver.
 *
 * shield stores its local SQLite database (`shield.db`), its global alert
 * config (`alerts.json`) and its global CLI config (`config.json`) beneath a
 * single data root. Historically that root was `~/.hasna/security`. This
 * module resolves the root through `@hasna/paths` (XDG / macOS home layout)
 * with a gated legacy adoption: the legacy `~/.hasna/security` stays the
 * effective data root until the store is physically migrated to the XDG data
 * home (`shield.db` present there) or the operator sets the data-kind
 * override `HASNA_DATA_HOME`. An existing live store never becomes invisible
 * on upgrade. The exact-app override `HASNA_SHIELD_HOME` wins unconditionally,
 * and the per-file db-path override (`SECURITY_DB`) stays layered on top by
 * `getDbPath` in `db/database.ts`.
 *
 * The store folder is named `security`, not `shield`: `~/.hasna/security` has
 * been shield's data root since the store's own `~/.hasna/shield` ->
 * `~/.hasna/security` consolidation, and the contract declares
 * `~/.hasna/security/shield.db`. So the resolver app slug is `security` and
 * the XDG data home is `~/.local/share/hasna/security` on Linux.
 *
 * Nothing moves on disk in this phase — the package just resolves the new
 * paths.
 */

/** The effective user home, mirroring the pre-existing shield resolution (`HOME` || `USERPROFILE`). */
export function getHomeDir(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir() || "/tmp";
}

/** The legacy (pre-XDG) data root: `~/.hasna/security`. */
export function getLegacyDataRoot(): string {
  return join(getHomeDir(), ".hasna", "security");
}

/**
 * The @hasna/paths-resolved (XDG / macOS home layout) data root for shield's
 * store: `~/.local/share/hasna/security` on Linux, `~/Library/Application
 * Support/Hasna/security` on macOS. The home override mirrors the pre-existing
 * `$HOME`-first resolution so the resolver follows the same home the legacy
 * path does.
 */
export function getResolverDataRoot(): string {
  return dataDir({
    app: "security",
    home: process.env["HOME"] || process.env["USERPROFILE"] || undefined,
  });
}

/**
 * Whether the resolver (XDG) data root should be adopted as the effective
 * data root. The resolver root is adopted only when the operator has set
 * `HASNA_DATA_HOME` (the data-kind override — a deliberate opt-in to the XDG
 * layout) or the store has already been physically migrated there
 * (`shield.db` exists — shield's store file). A machine that only redirects
 * another kind (e.g. cache to tmpfs) must NOT have its data home moved, and
 * a live store at the legacy home must never become invisible on upgrade.
 */
export function adoptResolverDataRoot(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "shield.db"));
}

/** The exact-app override root, when set: `HASNA_SHIELD_HOME`. */
export function getExactDataRoot(): string | undefined {
  const dir = process.env["HASNA_SHIELD_HOME"];
  if (dir && dir.trim()) return resolve(dir.trim());
  return undefined;
}

/**
 * The effective data root: an exact-app override (`HASNA_SHIELD_HOME`) wins
 * unconditionally; otherwise the resolver (XDG) data root once adopted;
 * otherwise the legacy `~/.hasna/security` default.
 */
export function getDataRoot(): string {
  const exact = getExactDataRoot();
  if (exact) return exact;
  const resolved = getResolverDataRoot();
  return adoptResolverDataRoot(resolved) ? resolve(resolved) : getLegacyDataRoot();
}
