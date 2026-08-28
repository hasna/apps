// Best-effort install-time creation of the treasury home directory tree,
// resolving the SAME effective home the runtime uses (src/core/app-home.ts):
// an exact-app override (HASNA_TREASURY_HOME / TREASURY_HOME) wins;
// otherwise the @hasna/paths XDG data home once adopted (HASNA_DATA_HOME set,
// or treasury.db already migrated there); otherwise the legacy
// ~/.hasna/treasury default. Root + subdirs are created at mode 0700.
// Failures are non-fatal: the runtime creates the same directory tree on
// first use.
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

try {
  const { dataDir } = await import("@hasna/paths");
  const env = process.env;
  const override = (env["HASNA_TREASURY_HOME"] || env["TREASURY_HOME"] || "").trim();
  const dataHomeOverride = (env["HASNA_DATA_HOME"] || "").trim();
  const home = env["HOME"] || env["USERPROFILE"] || homedir();
  const subdirs = ["config", "data", "exports", "backups", "logs", "tmp"];

  let dir;
  if (override) {
    dir = override;
  } else {
    const resolved = dataDir({ app: "treasury", home, env });
    const adopted = Boolean(dataHomeOverride) || existsSync(join(resolved, "treasury.db"));
    dir = adopted ? resolved : join(home, ".hasna", "treasury");
  }

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // best-effort on platforms without POSIX perms
  }
  for (const sub of subdirs) {
    const d = join(dir, sub);
    if (!existsSync(d)) mkdirSync(d, { recursive: true, mode: 0o700 });
  }
} catch {
  // never fail an install over pre-created directories
}
