import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { effectiveHome as resolveEffectiveHome, kindEnv, stateDir as resolverStateDir } from "@hasna/contracts/paths";

/**
 * Session-render snapshot-dir resolution through the single paths resolver in
 * `@hasna/contracts` (ruling #1668): pre-render rollback snapshots are STATE
 * data and live under the instructions state dir (`~/.hasna/instructions` on
 * macOS, `~/.local/state/hasna/instructions` on Linux).
 *
 * The legacy per-target-home `~/.hasna/session-render-snapshots` default stays
 * readable for migration while it holds the only snapshot store; once the
 * resolver state dir exists it is authoritative. The snapshot location also
 * carries the workspace root the managed-file write coordination anchors to
 * (the state dir's parent).
 */
const SESSION_RENDER_STATE_APP = "instructions";

function homeDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolveEffectiveHome(env);
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
  const override = env[kindEnv("state")];
  if (typeof override === "string" && override.trim().length > 0 && !existsSync(override)) {
    return resolverStateDir({
      app: SESSION_RENDER_STATE_APP,
      env: { ...env, [kindEnv("state")]: undefined },
      home: homeDir(env),
    });
  }
  return resolverStateDir({ app: SESSION_RENDER_STATE_APP, env, home: homeDir(env) });
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
  const resolvedPath = resolve(resolverSnapshotDir(env));
  // Legacy per-target-home snapshots remain readable for migration while they
  // hold the only snapshot store (ruling #1668).
  if (!existsSync(resolvedPath)) {
    const legacy = legacySnapshotDir(targetHome);
    if (existsSync(legacy)) {
      return { dir: resolve(legacy), workspaceRoot: targetHome, adopted: false };
    }
  }
  return { dir: resolvedPath, workspaceRoot: dirname(resolvedPath), adopted: true };
}

/**
 * Effective session-render snapshot dir for a target home: the resolver
 * instructions state dir (ruling #1668) while the legacy per-target-home
 * snapshots remain readable for migration.
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
