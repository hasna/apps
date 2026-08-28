// Best-effort install-time creation of the telephony data directory, resolving
// the SAME effective data home the runtime uses (src/paths.ts): the
// @hasna/paths XDG data home once adopted (HASNA_DATA_HOME set, or
// telephony.db already migrated there); otherwise the legacy
// ~/.hasna/telephony default. Failures are non-fatal: the runtime creates the
// same directories on first use.
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

try {
  const { dataDir } = await import("@hasna/paths");
  const env = process.env;
  const dataHomeOverride = (env["HASNA_DATA_HOME"] || "").trim();
  const home = env["HOME"] || env["USERPROFILE"] || homedir();

  const resolved = dataDir({ app: "telephony", home, env });
  const adopted = Boolean(dataHomeOverride) || existsSync(join(resolved, "telephony.db"));
  const dir = adopted ? resolved : join(home, ".hasna", "telephony");

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // best-effort on platforms without POSIX perms
  }
  if (!existsSync(join(dir, "audio"))) {
    mkdirSync(join(dir, "audio"), { recursive: true, mode: 0o700 });
  }
} catch {
  // Non-fatal: the runtime creates the same directories on first use.
}
