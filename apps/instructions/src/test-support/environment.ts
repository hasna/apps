import { join } from "node:path";

/**
 * Test-only process environment. Do not inherit credential pointers, provider
 * homes, or application routing from the developer running the suite.
 * Explicit local mode also avoids the ambient macOS Keychain resolver.
 */
export function isolatedInstructionsTestEnv(
  home: string,
  parent: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TERM", "SystemRoot", "ComSpec", "SystemDrive"]) {
    if (parent[key] !== undefined) env[key] = parent[key];
  }
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    USER: "instructions-test",
    // Leave the general Hasna roots unset: they resolve under this HOME and
    // must follow a test's explicit HOME replacement rather than a stale pin.
    HASNA_STATE_HOME: join(home, "state"),
    HASNA_CONFIGS_HOME: join(home, "instructions"),
    CONFIGS_HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    XDG_CACHE_HOME: join(home, ".cache"),
    HASNA_INSTRUCTIONS_DB_PATH: join(home, "db.sqlite"),
    HASNA_INSTRUCTIONS_LOCAL: "1",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
  };
}
