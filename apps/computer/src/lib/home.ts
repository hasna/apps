import { homedir } from "node:os";
import { join } from "node:path";

const SERVICE_NAME = "computer";

/**
 * Resolve the user's home directory: $HOME, then $USERPROFILE (Windows), then
 * the OS user database. The canonical data root is ~/.hasna/computer, so a
 * home that cannot be resolved is a hard error — never a literal "~" path
 * (relative to cwd) and never an "undefined"-prefixed path.
 */
export function getHomeDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  if (!home || home === "~") {
    throw new Error("Cannot resolve the home directory: set HOME (or USERPROFILE) and try again");
  }
  return home;
}

/** Canonical data root for the computer app: ~/.hasna/computer. */
export function getAppDataDir(): string {
  return join(getHomeDir(), ".hasna", SERVICE_NAME);
}

/** Default screenshots directory for a session under the canonical data root. */
export function getDefaultScreenshotsDir(sessionId: string): string {
  return join(getAppDataDir(), "screenshots", sessionId);
}
