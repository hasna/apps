import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stateDir } from "@hasna/paths";

/**
 * Session-render snapshot-dir resolution via the @hasna/paths resolver (XDG
 * state layout). Pre-render rollback snapshots are STATE data, not provider
 * files, so once the store has actually been migrated the renderer writes them
 * under the instructions state dir (`~/.local/state/hasna/instructions` on
 * Linux).
 *
 * The legacy per-target-home `~/.hasna/session-render-snapshots` default stays
 * the effective snapshot dir until the store has been physically migrated to
 * the resolver state dir (the resolved dir holds at least one snapshot file)
 * or the operator sets the state-kind override `HASNA_STATE_HOME` — an
 * existing snapshot store never becomes invisible on upgrade, mirroring the
 * configs store adoption in `app-home.ts`. A machine that only redirects
 * another kind (`HASNA_CONFIG_HOME` / `HASNA_DATA_HOME` / `HASNA_CACHE_HOME`)
 * must NOT have its snapshot store moved.
 *
 * The snapshot location also carries the workspace root the managed-file write
 * coordination must anchor to. The legacy location anchors to the target home
 * (as before); the resolver location anchors to the state dir's parent
 * (`~/.local/state/hasna`), which contains the snapshot dir, so the
 * atomic-write containment guards (`PROJECT_CONTEXT_PATH_ESCAPE` /
 * `PROJECT_CONTEXT_SYMLINK_REJECTED`) accept it regardless of which target home
 * the render was planning for. The restore guard mirrors the same resolution:
 * a snapshot written by the migrated layout is accepted for restore even when
 * it lives outside a nested project-root target home.
 */
const SESSION_RENDER_STATE_APP = "instructions";

function homeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env["HOME"] || env["USERPROFILE"] || homedir();
}

/** Pre-XDG default snapshot dir under a session target home. */
export function legacySnapshotDir(targetHome: string): string {
  return resolve(join(targetHome, ".hasna", "session-render-snapshots"));
}

/**
 * The @hasna/paths-resolved instructions state dir (XDG layout). A state-kind
 * override whose base does not exist falls back to the default HOME-based
 * resolution rather than failing closed on a path that cannot be created.
 */
export function resolverSnapshotDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.HASNA_STATE_HOME;
  if (typeof override === "string" && override.trim().length > 0 && !existsSync(override)) {
    return stateDir({
      app: SESSION_RENDER_STATE_APP,
      env: { ...env, HASNA_STATE_HOME: undefined },
      home: homeDir(env),
    });
  }
  return stateDir({ app: SESSION_RENDER_STATE_APP, env, home: homeDir(env) });
}

/**
 * Whether the resolver (XDG) state dir should be adopted as the snapshot dir.
 * Adoption requires the state-kind override `HASNA_STATE_HOME` pointing at an
 * existing base, or a store already physically migrated there (the resolved
 * dir holds at least one snapshot file). An empty pre-created dir does NOT
 * adopt — the legacy store must never become invisible merely because a
 * directory exists — and an override whose base does not exist falls through
 * to the default migration check instead of failing closed.
 */
export function adoptResolverSnapshotDir(
  resolved: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const override = env.HASNA_STATE_HOME;
  if (typeof override === "string" && override.trim().length > 0 && existsSync(override)) {
    return true;
  }
  if (!existsSync(resolved)) return false;
  return readdirSync(resolved).some((name) => name.endsWith(".json"));
}

/**
 * The effective snapshot location for a target home: the directory snapshots
 * are written to, the workspace root the atomic-write containment guards must
 * anchor to, and whether the resolver (XDG) state dir was adopted. Resolved
 * once per call so a write or restore never re-reads the state dir.
 */
export interface SessionRenderSnapshotLocation {
  /** The directory pre-render snapshots are written to. */
  dir: string;
  /** The workspace root the atomic-write containment guards anchor to. */
  workspaceRoot: string;
  /** Whether the resolver (XDG) state dir was adopted. */
  adopted: boolean;
}

export function resolveSessionRenderSnapshotLocation(
  targetHome: string,
  env: NodeJS.ProcessEnv = process.env,
): SessionRenderSnapshotLocation {
  const resolved = resolverSnapshotDir(env);
  if (!adoptResolverSnapshotDir(resolved, env)) {
    return { dir: legacySnapshotDir(targetHome), workspaceRoot: targetHome, adopted: false };
  }
  const resolvedPath = resolve(resolved);
  return { dir: resolvedPath, workspaceRoot: dirname(resolvedPath), adopted: true };
}

/**
 * Effective session-render snapshot dir for a target home: the resolver
 * instructions state dir once adopted (`HASNA_STATE_HOME` set with an existing
 * base, or the store migrated there), otherwise the legacy per-target-home
 * default.
 */
export function getSessionRenderSnapshotDir(
  targetHome: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveSessionRenderSnapshotLocation(targetHome, env).dir;
}

/**
 * The workspace root the managed-file snapshot write must anchor to — the
 * containing root so the atomic-write containment guards accept the path.
 * Legacy: the target home (unchanged). Resolver: the state dir's parent
 * (`~/.local/state/hasna`), which exists and contains the snapshot dir.
 */
export function sessionRenderSnapshotWorkspaceRoot(
  targetHome: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveSessionRenderSnapshotLocation(targetHome, env).workspaceRoot;
}
