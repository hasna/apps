/**
 * Test fixture: put THIS process (and the env it hands to children) on the
 * explicit local route for the on-box store.
 *
 * Why every store-writing suite needs it (hasna/apps#1720, W6 2026-09-11):
 * `writeHookEvent`, `hooks run`, `hooks-mcp` and `startSSEServer` all decide
 * their route from the env dictionary — the opt-in HASNA_HOOKS_LOCAL=1 counts
 * only when NO authority variable is set. bun runs every test file in one
 * process sharing one `process.env`, and the env-isolation suites seed
 * authority-shaped variables (HASNA_HOOKS_API_KEY, HASNA_HOOKS_API_URL,
 * HASNA_PROFILE, …) into it mid-run. A suite that merely sets the opt-in is
 * therefore hostage to file order: a stray authority variable silently turns
 * its writes into hosted-route refusals and its assertions into
 * "Received: 0". Scrubbing here makes each suite hermetic on its own.
 *
 * It also lifts any process-wide store refusal a previous in-process hosted
 * decision may have installed, so `getDb()` is reachable again.
 */
import { allowLocalStore } from "../db/index.js";

/** Every env name that configures a hooks authority/credential (the resolver's own set). */
export const HOOKS_AUTHORITY_ENV_KEYS = [
  "HASNA_HOOKS_API_URL",
  "HOOKS_API_URL",
  "HASNA_HOOKS_API_KEY",
  "HOOKS_API_KEY",
  "HASNA_HOOKS_API_KEY_OVERRIDE",
  "HASNA_HOOKS_API_KEY_REF",
  "HASNA_PROFILE",
] as const;

/**
 * Scrub authority variables, set the opt-in and keep the station's Keychain
 * out of any child (HASNA_STATION=no-such-station). Returns the restore
 * function for `afterAll`.
 */
export function enterLocalStoreRoute(): () => void {
  const saved: Record<string, string | undefined> = {};
  for (const key of [...HOOKS_AUTHORITY_ENV_KEYS, "HASNA_HOOKS_LOCAL", "HOOKS_LOCAL", "HASNA_STATION"]) {
    saved[key] = process.env[key];
  }
  for (const key of HOOKS_AUTHORITY_ENV_KEYS) delete process.env[key];
  process.env.HASNA_HOOKS_LOCAL = "1";
  process.env.HASNA_STATION = "no-such-station";
  allowLocalStore();
  return () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    allowLocalStore();
  };
}

/** A copy of `process.env` for a child process, on the explicit local route. */
export function localStoreChildEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const key of HOOKS_AUTHORITY_ENV_KEYS) delete env[key];
  env.HASNA_HOOKS_LOCAL = "1";
  env.HASNA_STATION = "no-such-station";
  return { ...env, ...extra };
}
