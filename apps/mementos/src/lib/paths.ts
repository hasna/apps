import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

/**
 * @hasna/mementos data-home resolution through the @hasna/paths resolver.
 *
 * mementos stores its sqlite database (`mementos.db`), `config.json`, the
 * per-agent `agents/`, `profiles/`, `training/` and `backups/` data and the
 * remote-storage `storage/config.json` under a single data root. Historically
 * that root was `~/.hasna/mementos`. This module resolves the root through
 * `@hasna/paths` (XDG / macOS home layout) with a gated legacy adoption: the
 * legacy `~/.hasna/mementos` stays the effective data root until the store is
 * physically migrated to the XDG data home (`mementos.db` present there) or
 * the operator sets the data-kind override `HASNA_DATA_HOME`. An existing
 * live store never becomes invisible on upgrade. The exact-app overrides
 * `HASNA_MEMENTOS_HOME` (then `MEMENTOS_HOME`) win unconditionally, and the
 * db-path overrides (`HASNA_MEMENTOS_DB_PATH` / `MEMENTOS_DB_PATH`) stay
 * layered on top by `getDbPath`.
 *
 * Nothing moves on disk in this phase — the package just resolves the new
 * paths.
 */

/** The effective user home, mirroring the pre-existing mementos resolution (`HOME` || `USERPROFILE`). */
export function effectiveHome(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir() || "/tmp";
}

/** The legacy (pre-XDG) data root: `~/.hasna/mementos`. */
export function legacyDataRoot(): string {
  return join(effectiveHome(), ".hasna", "mementos");
}

/**
 * The @hasna/paths-resolved (XDG / macOS home layout) data root for mementos:
 * `~/.local/share/hasna/mementos` on Linux, `~/Library/Application
 * Support/Hasna/mementos` on macOS. The home override mirrors the pre-existing
 * `$HOME`-first resolution so the resolver follows the same home the legacy
 * path does.
 */
export function resolverDataRoot(): string {
  return dataDir({
    app: "mementos",
    home: process.env["HOME"] || process.env["USERPROFILE"] || undefined,
  });
}

/**
 * Whether the resolver (XDG) data root should be adopted as the effective
 * data root. The resolver root is adopted only when the operator has set
 * `HASNA_DATA_HOME` (the data-kind override — a deliberate opt-in to the XDG
 * layout) or the store has already been physically migrated there
 * (`mementos.db` exists — mementos' store file). A machine that only
 * redirects another kind (e.g. cache to tmpfs) must NOT have its data home
 * moved, and a live store at the legacy home must never become invisible on
 * upgrade.
 */
export function adoptResolverDataRoot(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "mementos.db"));
}

/** The exact-app override root, when set: `HASNA_MEMENTOS_HOME`, then `MEMENTOS_HOME`. */
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
 * The effective data root: an exact-app override (`HASNA_MEMENTOS_HOME`, then
 * `MEMENTOS_HOME`) wins unconditionally; otherwise the resolver (XDG) data
 * root once adopted; otherwise the legacy `~/.hasna/mementos` default.
 */
export function getDataRoot(): string {
  const exact = exactDataRoot();
  if (exact) return exact;
  const resolved = resolverDataRoot();
  return adoptResolverDataRoot(resolved) ? resolve(resolved) : resolve(legacyDataRoot());
}
