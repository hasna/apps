/**
 * Emails data-root resolution — thin app wrapper over the single paths
 * resolver in `@hasna/contracts` (ruling hasna/apps#1668). The resolver owns
 * platform placement (`~/.hasna/emails` on macOS, XDG data root on Linux)
 * and the `HASNA_{CONFIG,DATA,STATE,CACHE}_HOME` kind overrides; this module
 * layers the emails-specific exact-app override on top. The old in-package
 * resolver copy and the legacy/adoption dance were deleted with the ruling.
 */
import { resolve } from "node:path";
import { dataDir, effectiveHome } from "@hasna/contracts/paths";
import { join } from "node:path";

/** Resolve the user's home directory: $HOME, then $USERPROFILE, then the OS user database. */
export const getHomeDir = effectiveHome;

/**
 * The resolver data root for emails: kind overrides honored,
 * `~/.hasna/emails` on macOS, `~/.local/share/hasna/emails` on Linux.
 */
export function getResolverDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return dataDir({ app: "emails", home: effectiveHome(env), env });
}

/** The exact-app override root, when set: `HASNA_EMAILS_HOME`, then `EMAILS_HOME`. */
export function getExactDataRoot(env: NodeJS.ProcessEnv = process.env): string | undefined {
  // First-nonblank selection: a set-but-whitespace override must not suppress
  // a valid fallback (release-review P1, publish-all lane 248f6ed8). The
  // postinstall script (scripts/ensure-private-data-dir.mjs) selects with the
  // same `?.trim() ||` semantics, so the two surfaces stay in parity.
  const dir = env["HASNA_EMAILS_HOME"]?.trim() || env["EMAILS_HOME"]?.trim();
  if (dir) return resolve(dir);
  return undefined;
}

/**
 * The pre-ruling legacy root (`~/.hasna/emails`). On macOS this equals the
 * resolver root (ruling #1668 moved the resolver TO this layout); elsewhere
 * it is kept only for the Windows `.emails` migration path and HOME
 * canonicalization in `db/database.ts` and for migrating historically
 * misplaced keyring files.
 */
export function getLegacyDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(effectiveHome(env), ".hasna", "emails");
}

/**
 * The effective data root: an exact-app override (`HASNA_EMAILS_HOME`, then
 * `EMAILS_HOME`) wins unconditionally; otherwise the resolver data root
 * (ruling #1668 — the resolver root IS the convention on every platform).
 * The store path (`HASNA_EMAILS_DB_PATH` / `EMAILS_DB_PATH` / `--db`) is
 * layered on top of this by the database layer, so an explicit store path
 * always wins regardless.
 */
export function getDataRoot(env: NodeJS.ProcessEnv = process.env): string {
  const exact = getExactDataRoot(env);
  if (exact) return exact;
  return resolve(getResolverDataRoot(env));
}