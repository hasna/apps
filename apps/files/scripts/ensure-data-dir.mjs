// Postinstall data-dir provisioning for @hasna/files.
//
// Mirrors src/lib/paths.ts selection semantics so the installed surface and
// the runtime surface stay in parity: an exact-app override
// (HASNA_FILES_DATA_DIR, FILES_DATA_DIR, then HASNA_FILES_HOME, FILES_HOME)
// wins unconditionally; otherwise the @hasna/paths (XDG / macOS home layout)
// data root once adopted (the operator set the data-kind override
// HASNA_DATA_HOME, or a files.db already exists there); otherwise the legacy
// ~/.hasna/files default. The legacy default is what keeps today's machines
// byte-identical; the resolver root is what the XDG home migration (hotfixes
// plan 0f49f56a, task P3.3) moves toward. Nothing else moves on disk — this
// only provisions the effective home so a first run lands in the right place.
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { dataDir } from "@hasna/paths";

function effectiveDataRoot() {
  const exact =
    process.env.HASNA_FILES_DATA_DIR?.trim() ||
    process.env.FILES_DATA_DIR?.trim() ||
    process.env.HASNA_FILES_HOME?.trim() ||
    process.env.FILES_HOME?.trim();
  if (exact) return resolve(exact);
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  const resolverRoot = dataDir({ app: "files", home });
  if (process.env.HASNA_DATA_HOME?.trim()) return resolverRoot;
  if (existsSync(join(resolverRoot, "files.db"))) return resolverRoot;
  return join(home, ".hasna", "files");
}

mkdirSync(effectiveDataRoot(), { recursive: true });
