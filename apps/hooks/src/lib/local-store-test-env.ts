/**
 * Test support: pin an environment to the ON-BOX hook-event store.
 *
 * Hook events are hosted by default, and the local opt-in is deliberately not
 * a trump card: `selectsHooksLocalStore` requires the opt-in AND the absence
 * of any configured authority, because an environment that names a registry
 * has said where its events belong. So a suite that asserts rows in the local
 * SQLite store has to remove the authority keys as well as set the opt-in.
 *
 * That is not hypothetical. `bun test` runs every file of this package in ONE
 * process, and `src/cli/qa-regressions.test.ts` exports a real
 * `HASNA_HOOKS_API_KEY` for its mock registry while it runs — so any suite
 * that merely set `HASNA_HOOKS_LOCAL=1` could still resolve an authority and
 * POST its fixture events to `https://api.hasna.com/hooks`, depending on file
 * order. Pinning removes the ordering dependency.
 *
 * The key list comes from the resolver (`hooksAuthorityEnvKeys`), never a
 * hardcoded copy, so a new credential tier cannot quietly slip past it.
 */

import { hooksAuthorityEnvKeys, HOOKS_LOCAL_OPT_IN_ENV_KEYS } from "./local-opt-in.js";

type Env = Record<string, string | undefined>;

/**
 * Remove every authority/credential variable from `env` and declare the local
 * opt-in. Returns a restore function that puts the environment back exactly as
 * it was — call it from `afterAll` so the next file starts clean.
 */
export function pinLocalHookStoreEnv(env: Env = process.env): () => void {
  const authorityKeys = hooksAuthorityEnvKeys();
  const saved = new Map<string, string | undefined>();
  for (const key of [...authorityKeys, ...HOOKS_LOCAL_OPT_IN_ENV_KEYS]) {
    saved.set(key, env[key]);
  }
  for (const key of authorityKeys) delete env[key];
  env.HASNA_HOOKS_LOCAL = "1";
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  };
}

/**
 * A child-process environment pinned to the on-box store: the parent's env
 * minus every authority variable, plus the opt-in and any extras.
 */
export function localHookStoreChildEnv(extra: Env = {}, base: Env = process.env): Env {
  const out: Env = { ...base };
  for (const key of hooksAuthorityEnvKeys()) delete out[key];
  out.HASNA_HOOKS_LOCAL = "1";
  return { ...out, ...extra };
}
