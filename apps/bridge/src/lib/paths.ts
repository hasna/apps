import { effectiveHome, getBridgeHome, getConfigPath } from "./app-home.js";

/**
 * The home directory for bridge data. Fleet law: app data lives at a
 * package-owned home — never cwd-relative. HOME is read directly so a fake
 * HOME in tests is honored; when HOME is unset we fall back to the
 * passwd-backed `os.homedir()` (the real user home), never `process.cwd()`.
 *
 * Resolution is delegated to `./app-home.js`, which routes through the
 * @hasna/paths resolver (XDG / macOS home layout). The legacy `~/.hasna/bridge`
 * default stays the effective home until the store is physically migrated to
 * the XDG data home or the operator sets `HASNA_DATA_HOME`; the `BRIDGE_HOME` /
 * `HASNA_BRIDGE_HOME` exact-app overrides win unconditionally.
 */
export function homeDir(): string {
  return effectiveHome();
}

export function bridgeHome(): string {
  return getBridgeHome();
}

export function defaultConfigPath(): string {
  return getConfigPath();
}
