// Best-effort install-time creation of the secrets data home, resolving the
// SAME effective data dir the runtime uses (src/data-dir.ts
// effectiveOperatorDataDir): the @hasna/paths XDG data home is used once
// adopted (`HASNA_DATA_HOME` set, or `vault.db` already migrated there);
// otherwise the legacy `~/.hasna/secrets` default. The explicit file-level
// overrides (`HASNA_SECRETS_DB_PATH`, `HASNA_SECRETS_KEY_DIR`) are layered on
// top of that root by the runtime and do not change which directory is
// created here. Failures are non-fatal: the runtime creates the same
// directories on first use.
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DATA_HOME_OVERRIDE = (process.env["HASNA_DATA_HOME"] || "").trim();

try {
  const { dataDir } = await import("@hasna/paths");
  const resolved = dataDir({ app: "secrets" });
  let root;
  if (DATA_HOME_OVERRIDE || existsSync(join(resolved, "vault.db"))) {
    root = resolved;
  } else {
    root = join(homedir(), ".hasna", "secrets");
  }
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
} catch {
  // never fail an install over pre-created directories
}
