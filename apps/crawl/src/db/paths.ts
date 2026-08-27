import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

/**
 * @hasna/crawl data-home resolution through the @hasna/paths resolver.
 *
 * crawl stores its sqlite db (`data.db`), `config.json` and `screenshots/`
 * under a single data root. Historically that root was `~/.hasna/crawl`.
 * This module resolves the root through `@hasna/paths` (XDG / macOS home
 * layout) with a gated legacy adoption: the legacy `~/.hasna/crawl` stays the
 * effective data root until the store is physically migrated to the XDG data
 * home (`data.db` present there) or the operator sets the data-kind override
 * `HASNA_DATA_HOME`. An existing live store never becomes invisible on
 * upgrade. The exact-app override `HASNA_CRAWL_HOME` (then `CRAWL_HOME`) wins
 * unconditionally, and the db-path overrides (`HASNA_CRAWL_DB_PATH` /
 * `CRAWL_DB_PATH`) stay layered on top by `resolveDbPath`.
 */

/** The effective user home, mirroring the pre-existing crawl resolution (`HOME` || `USERPROFILE`). */
export function effectiveHome(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir() || "/tmp";
}

/** The legacy (pre-XDG) data root: `~/.hasna/crawl`. */
export function legacyDataRoot(): string {
  return join(effectiveHome(), ".hasna", "crawl");
}

/**
 * The @hasna/paths-resolved (XDG / macOS home layout) data root for crawl:
 * `~/.local/share/hasna/crawl` on Linux, `~/Library/Application
 * Support/Hasna/crawl` on macOS. The home override mirrors the pre-existing
 * `$HOME`-first resolution so the resolver follows the same home the legacy
 * path does.
 */
export function resolverDataRoot(): string {
  return dataDir({
    app: "crawl",
    home: process.env["HOME"] || process.env["USERPROFILE"] || undefined,
  });
}

/**
 * Whether the resolver (XDG) data root should be adopted as the effective
 * data root. The resolver root is adopted only when the operator has set
 * `HASNA_DATA_HOME` (the data-kind override — a deliberate opt-in to the XDG
 * layout) or the store has already been physically migrated there
 * (`data.db` exists — crawl's store file). A machine that only redirects
 * another kind (e.g. cache to tmpfs) must NOT have its data home moved, and a
 * live store at the legacy home must never become invisible on upgrade.
 */
export function adoptResolverDataRoot(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "data.db"));
}

/** The exact-app override root, when set: `HASNA_CRAWL_HOME`, then `CRAWL_HOME`. */
export function exactDataRoot(): string | undefined {
  const dir = process.env["HASNA_CRAWL_HOME"] ?? process.env["CRAWL_HOME"];
  if (dir && dir.trim()) return resolve(dir.trim());
  return undefined;
}

/**
 * The effective data root: an exact-app override (`HASNA_CRAWL_HOME`, then
 * `CRAWL_HOME`) wins unconditionally; otherwise the resolver (XDG) data root
 * once adopted; otherwise the legacy `~/.hasna/crawl` default.
 */
export function getDataRoot(): string {
  const exact = exactDataRoot();
  if (exact) return exact;
  const resolved = resolverDataRoot();
  return adoptResolverDataRoot(resolved) ? resolve(resolved) : resolve(legacyDataRoot());
}
