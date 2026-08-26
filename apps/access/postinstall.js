// Best-effort install-time creation of the access home directories, resolved
// through @hasna/paths (XDG / macOS home layout). Failures are non-fatal: the
// runtime ensureAppHome() creates the same directories on first use.
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

try {
  const { cacheDir, configDir, dataDir, stateDir } = await import("@hasna/paths");
  const OPTIONS = { app: "access" };
  const DIRS = [
    configDir(OPTIONS),
    dataDir(OPTIONS),
    join(dataDir(OPTIONS), "exports"),
    join(dataDir(OPTIONS), "backups"),
    join(stateDir(OPTIONS), "logs"),
    join(cacheDir(OPTIONS), "tmp"),
  ];
  for (const dir of DIRS) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
    try {
      chmodSync(dir, 0o700);
    } catch {
      // best-effort on platforms without POSIX perms
    }
  }
} catch {
  // never fail an install over pre-created directories
}
