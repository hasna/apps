// Postinstall data-dir provisioning for @hasna/files.
//
// Mirrors src/lib/paths.ts selection semantics so the installed surface and the
// runtime surface stay in parity: the first absolute exact-app override
// (HASNA_FILES_DATA_DIR, FILES_DATA_DIR, then HASNA_FILES_HOME, FILES_HOME)
// wins unconditionally;
// then HASNA_DATA_HOME; otherwise the canonical ~/.hasna/files (home-layout
// ruling, 2026-09-04 — HASNA_HOME relocates the ~/.hasna root).
//
// This script used to carry a copy of the deleted @hasna/paths fork and could
// therefore CREATE ~/Library/Application Support/Hasna/files (macOS) or
// ~/.local/share/hasna/files (Linux) at install time, and would adopt that root
// merely because a files.db already sat there. Both are gone: install provisions
// only the canonical home (or an explicit override).
//
// Best-effort: an override pointing at an uncreatable path must never fail the
// install — the runtime provisions the effective home on first use the same way.
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

function absoluteOverride(env, key) {
  const value = env[key]?.trim();
  return value && isAbsolute(value) ? value : undefined;
}

/** Pure resolver exported so runtime/script parity is executable in tests. */
export function effectiveDataRoot(env = process.env, fallbackHome) {
  for (const key of [
    "HASNA_FILES_DATA_DIR",
    "FILES_DATA_DIR",
    "HASNA_FILES_HOME",
    "FILES_HOME",
  ]) {
    const exact = absoluteOverride(env, key);
    if (exact) return exact;
  }

  const dataHome = absoluteOverride(env, "HASNA_DATA_HOME");
  if (dataHome) return join(dataHome, "files");

  const hasnaHome = absoluteOverride(env, "HASNA_HOME");
  if (hasnaHome) return join(hasnaHome, "files");

  const envHome = absoluteOverride(env, "HOME") ?? absoluteOverride(env, "USERPROFILE");
  const resolvedHome = envHome ?? fallbackHome ?? homedir();
  if (!isAbsolute(resolvedHome)) throw new Error("Unable to resolve the user's home directory");
  return join(resolvedHome, ".hasna", "files");
}

/** Best-effort provisioner used only by the package postinstall. */
export function ensureDataDir(env = process.env, fallbackHome) {
  try {
    const root = effectiveDataRoot(env, fallbackHome);
    mkdirSync(root, { recursive: true });
    return root;
  } catch {
    return null;
  }
}

if (import.meta.main) {
  // A data-dir creation failure must never block installation. Runtime local
  // startup performs the authoritative safety checks before opening SQLite.
  ensureDataDir();
}
