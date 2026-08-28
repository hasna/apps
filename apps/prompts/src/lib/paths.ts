import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

/**
 * @hasna/prompts data-home resolution through the @hasna/paths resolver.
 *
 * prompts stores its local SQLite database (`prompts.db`) and its dispatch
 * run records (under `runs/`) beneath a single data root. Historically that
 * root was `~/.hasna/prompts`. This module resolves the root through
 * `@hasna/paths` (XDG / macOS home layout) with a gated legacy adoption: the
 * legacy `~/.hasna/prompts` stays the effective data root until the store is
 * physically migrated to the XDG data home (`prompts.db` present there) or
 * the operator sets the data-kind override `HASNA_DATA_HOME`. An existing
 * live store never becomes invisible on upgrade. The exact-app overrides
 * `HASNA_PROMPTS_HOME` (then `PROMPTS_HOME`) win unconditionally, and the
 * per-file db-path overrides (`HASNA_PROMPTS_DB_PATH` / `PROMPTS_DB_PATH`)
 * stay layered on top by `getDbPath` in `db/database.ts`.
 *
 * Nothing moves on disk in this phase — the package just resolves the new
 * paths.
 */

/** The effective user home, mirroring the pre-existing prompts resolution (`HOME` || `USERPROFILE`). */
export function effectiveHome(): string {
  return process.env["HOME"] || process.env["USERPROFILE"] || homedir() || "/tmp";
}

/** The legacy (pre-XDG) data root: `~/.hasna/prompts`. */
export function legacyDataRoot(): string {
  return join(effectiveHome(), ".hasna", "prompts");
}

/**
 * The @hasna/paths-resolved (XDG / macOS home layout) data root for prompts:
 * `~/.local/share/hasna/prompts` on Linux, `~/Library/Application
 * Support/Hasna/prompts` on macOS. The home override mirrors the pre-existing
 * `$HOME`-first resolution so the resolver follows the same home the legacy
 * path does.
 */
export function resolverDataRoot(): string {
  return dataDir({
    app: "prompts",
    home: process.env["HOME"] || process.env["USERPROFILE"] || undefined,
  });
}

/**
 * Whether the resolver (XDG) data root should be adopted as the effective
 * data root. The resolver root is adopted only when the operator has set
 * `HASNA_DATA_HOME` (the data-kind override — a deliberate opt-in to the XDG
 * layout) or the store has already been physically migrated there
 * (`prompts.db` exists — prompts' store file). A machine that only redirects
 * another kind (e.g. cache to tmpfs) must NOT have its data home moved, and
 * a live store at the legacy home must never become invisible on upgrade.
 */
export function adoptResolverDataRoot(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const dataOverride = env.HASNA_DATA_HOME;
  if (typeof dataOverride === "string" && dataOverride.trim().length > 0) return true;
  return existsSync(join(resolved, "prompts.db"));
}

/** The exact-app override root, when set: `HASNA_PROMPTS_HOME`, then `PROMPTS_HOME`. */
export function exactDataRoot(): string | undefined {
  // First non-blank override wins. A blank or whitespace-only primary must not
  // shadow a valid secondary (nullish `??` does not fall through on "").
  for (const key of ["HASNA_PROMPTS_HOME", "PROMPTS_HOME"] as const) {
    const dir = process.env[key]?.trim();
    if (dir) return resolve(dir);
  }
  return undefined;
}

/**
 * The effective data root: an exact-app override (`HASNA_PROMPTS_HOME`, then
 * `PROMPTS_HOME`) wins unconditionally; otherwise the resolver (XDG) data
 * root once adopted; otherwise the legacy `~/.hasna/prompts` default.
 */
export function getDataRoot(): string {
  const exact = exactDataRoot();
  if (exact) return exact;
  const resolved = resolverDataRoot();
  return adoptResolverDataRoot(resolved) ? resolve(resolved) : resolve(legacyDataRoot());
}

/** The dispatch run-records directory: the effective data root's `runs` subdir. */
export function runsDir(): string {
  return join(getDataRoot(), "runs");
}

/**
 * The default prompt directory for `prompts runbook lint`. Runbook prompt
 * files are prompts-owned data, so once the data root adopts the resolver
 * (XDG) home they live at the adopted root's `runbook` subdir; until then the
 * legacy loops-prompt convention (`~/.hasna/loops/prompts`) stays the
 * default, so an existing runbook set stays reachable without `--dir`. An
 * exact-app override also points at the overridden root's `runbook` subdir.
 */
export function runbookPromptDir(): string {
  const exact = exactDataRoot();
  if (exact) return join(exact, "runbook");
  const resolved = resolverDataRoot();
  return adoptResolverDataRoot(resolved)
    ? join(resolve(resolved), "runbook")
    : join(effectiveHome(), ".hasna", "loops", "prompts");
}
