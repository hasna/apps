// Best-effort install-time creation of the prompts data home, resolving the
// SAME effective data root the runtime uses (src/lib/paths.ts getDataRoot): an
// exact-app override (HASNA_PROMPTS_HOME / PROMPTS_HOME) wins; otherwise the
// Ruling #1668: the resolver data root (kind overrides honored).
// already migrated there); otherwise the legacy ~/.hasna/prompts default.
// Failures are non-fatal: the runtime creates the same directories on first
// use.
import { existsSync, mkdirSync } from "node:fs";
import { dataDir as resolverDataDir } from "@hasna/contracts/paths";

import { homedir } from "node:os";
import { join } from "node:path";

const EXACT_OVERRIDES = [
  (process.env["HASNA_PROMPTS_HOME"] || "").trim(),
  (process.env["PROMPTS_HOME"] || "").trim(),
].filter(Boolean);

try {
  // (local resolver — @hasna/paths deleted, hasna/apps#1535)
  const home = process.env["HOME"] || process.env["USERPROFILE"] || homedir();
  let root;
  if (EXACT_OVERRIDES.length > 0) {
    root = EXACT_OVERRIDES[0];
  } else {
    // Ruling #1668: the resolver data root is the convention on every platform.
    root = resolverDataDir({ app: "prompts", home });
  }
  for (const sub of ["", "runs"]) {
    mkdirSync(join(root, sub), { recursive: true });
  }
} catch {
  // never fail an install over pre-created directories
}
