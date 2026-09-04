// Best-effort install-time creation of the telephony data directory, resolving
// the SAME effective data home the runtime uses (src/paths.ts): the
// Ruling #1668: the resolver data root (kind overrides honored).
// telephony.db already migrated there); otherwise the legacy
// ~/.hasna/telephony default. Failures are non-fatal: the runtime creates the
// same directories on first use.
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dataDir as resolverDataDir } from "@hasna/contracts/paths";

import { homedir } from "node:os";
import { join } from "node:path";

try {
  // Ruling #1668: the resolver data root is the convention on every platform.
  const env = process.env;
  const home = env["HOME"] || env["USERPROFILE"] || homedir();
  const dir = resolverDataDir({ app: "telephony", home, env });

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
