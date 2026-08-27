// Ensure the hooks agent-profile directory exists at the effective data root.
// Runs at install time (postinstall). Mirrors src/lib/app-home.ts resolution:
// granular data-dir override (HASNA_HOOKS_DATA_DIR/HOOKS_DATA_DIR), then
// exact-app override (HASNA_HOOKS_HOME/HOOKS_HOME), then the @hasna/paths
// resolver data root once adopted (HASNA_DATA_HOME set or hooks.db already
// present there), then the legacy ~/.hasna/hooks default. Best-effort — the
// package must never fail to install because this script cannot run.
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const HOME = process.env.HOME || process.env.USERPROFILE || homedir();

function legacyDataRoot() {
  return join(HOME, ".hasna", "hooks");
}

function adoptResolverRoot(resolved) {
  const override = process.env.HASNA_DATA_HOME;
  if (typeof override === "string" && override.trim().length > 0) return true;
  return existsSync(join(resolved, "hooks.db"));
}

async function effectiveDataRoot() {
  const explicit = process.env.HASNA_HOOKS_DATA_DIR ?? process.env.HOOKS_DATA_DIR;
  if (typeof explicit === "string" && explicit.trim().length > 0) return explicit.trim();

  const exact = process.env.HASNA_HOOKS_HOME?.trim() || process.env.HOOKS_HOME?.trim();
  if (exact) return resolve(exact);

  let resolved = null;
  try {
    const { dataDir } = await import("@hasna/paths");
    resolved = dataDir({ app: "hooks", home: HOME });
  } catch {
    // @hasna/paths unavailable — fall back to the legacy root.
  }
  if (resolved && adoptResolverRoot(resolved)) return resolve(resolved);
  return legacyDataRoot();
}

// Best-effort: a profile-directory creation failure must never block install.
try {
  const root = await effectiveDataRoot();
  mkdirSync(join(root, "profiles"), { recursive: true });
} catch {
  // ignore
}
