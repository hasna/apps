// Postinstall data-dir provisioning for @hasna/files.
//
// Mirrors src/lib/paths.ts selection semantics so the installed surface and the
// runtime surface stay in parity: an exact-app override (HASNA_FILES_DATA_DIR,
// FILES_DATA_DIR, then HASNA_FILES_HOME, FILES_HOME) wins unconditionally;
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
import { isAbsolute, join, resolve } from "node:path";

function absoluteOverride(key) {
  const value = process.env[key]?.trim();
  return value && isAbsolute(value) ? value : undefined;
}

function effectiveDataRoot() {
  const exact =
    process.env.HASNA_FILES_DATA_DIR?.trim() ||
    process.env.FILES_DATA_DIR?.trim() ||
    process.env.HASNA_FILES_HOME?.trim() ||
    process.env.FILES_HOME?.trim();
  if (exact) return resolve(exact);

  const dataHome = absoluteOverride("HASNA_DATA_HOME");
  if (dataHome) return join(dataHome, "files");

  const hasnaHome =
    absoluteOverride("HASNA_HOME") ??
    join(process.env.HOME || process.env.USERPROFILE || homedir(), ".hasna");
  return join(hasnaHome, "files");
}

// Best-effort: a data-dir creation failure must never block install.
try {
  mkdirSync(effectiveDataRoot(), { recursive: true });
} catch {
  // ignore
}
