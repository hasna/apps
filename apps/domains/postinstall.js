// Best-effort install-time creation of the domains home directory, resolving
// the SAME effective home the runtime uses (src/lib/app-home.ts): an exact-app
// override (HASNA_DOMAINS_HOME / DOMAINS_HOME / HASNA_DOMAINS_DIR / DOMAINS_DIR)
// wins; otherwise the @hasna/paths XDG data home once adopted (HASNA_DATA_HOME
// set, or domains.db already migrated there); otherwise the legacy
// ~/.hasna/domains default. Failures are non-fatal: the runtime creates the
// same directory on first use.
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

try {
  const { dataDir } = await import("@hasna/paths");
  const env = process.env;
  const override = (
    env["HASNA_DOMAINS_HOME"] ||
    env["DOMAINS_HOME"] ||
    env["HASNA_DOMAINS_DIR"] ||
    env["DOMAINS_DIR"] ||
    ""
  ).trim();
  const dataHomeOverride = (env["HASNA_DATA_HOME"] || "").trim();
  const home = env["HOME"] || env["USERPROFILE"] || homedir();

  let dir;
  if (override) {
    dir = override;
  } else {
    const resolved = dataDir({ app: "domains", home, env });
    const adopted = Boolean(dataHomeOverride) || existsSync(join(resolved, "domains.db"));
    dir = adopted ? resolved : join(home, ".hasna", "domains");
  }

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // best-effort on platforms without POSIX perms
  }
} catch {
  // never fail an install over pre-created directories
}
