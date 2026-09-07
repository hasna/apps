// Best-effort install-time creation of the domains LOCAL DATA home directory,
// resolving the SAME effective home the runtime uses (src/lib/app-home.ts):
// an exact-app override (HASNA_DOMAINS_HOME / HASNA_DOMAINS_DIR, then the
// legacy unprefixed DOMAINS_HOME / DOMAINS_DIR aliases) wins; otherwise
// $HASNA_HOME/domains (the shared root override); otherwise the legacy
// ~/.hasna/domains default. Faithfully mirrors the runtime module — no
// @hasna/paths, no XDG, no HASNA_*_HOME kind overrides (stripped, hasna/apps#1720
// class B). Failures are non-fatal: the runtime creates the same directory on
// first use.
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

try {
  const env = process.env;
  const override = (
    env["HASNA_DOMAINS_HOME"] ||
    env["HASNA_DOMAINS_DIR"] ||
    env["DOMAINS_HOME"] ||
    env["DOMAINS_DIR"] ||
    ""
  ).trim();
  const home = env["HOME"] || env["USERPROFILE"] || homedir();

  let dir;
  if (override) {
    dir = override;
  } else {
    const hasnaHome = (env["HASNA_HOME"] || "").trim();
    dir = hasnaHome ? join(hasnaHome, "domains") : join(home, ".hasna", "domains");
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