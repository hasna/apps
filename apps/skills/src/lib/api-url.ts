/**
 * Where the Skills API lives, for this process, right now.
 *
 * This module is a thin reading of `fleet-credentials.ts`, which is itself a
 * thin reading of `@hasna/contracts/client`. It exists only so the two failure
 * MODES stay named:
 *
 *   - Read paths fail closed: `resolveApiUrl()` returns `undefined` when nothing
 *     is configured, and the caller keeps working against the bundled local
 *     registry.
 *   - Auth and write paths fail loudly: `requireApiUrl()` throws an error naming
 *     the missing configuration.
 *
 * Boundary rule (R1), unchanged in substance: an install with NO credential
 * produces no URL at all. The fleet gateway default in the shared seam applies
 * only once a credential has resolved, so an unconfigured OSS install still
 * names no host — see `resolveSkillsFleet`.
 *
 * A URL that IS configured while no credential resolves does not fall back to
 * local: it throws (SkillsFleetCredentialError). Reading local data because
 * authentication is unconfigured is the false green this ladder exists to
 * remove.
 */

import {
  MissingSkillsFleetError,
  resolveSkillsFleet,
  SKILLS_API_URL_ENV,
  type SkillsFleetOptions,
} from "./fleet-credentials.js";

/** The canonical env name. The unprefixed `SKILLS_API_URL` alias is still read. */
export const API_URL_ENV_VAR = SKILLS_API_URL_ENV;

/** Hint shown wherever a Skills API URL is required but absent. */
export const MISSING_API_URL_HINT =
  `run: skills auth login, or set ${API_URL_ENV_VAR}=<your Skills instance origin>, ` +
  `or run: skills setup --api-url <your Skills instance origin>`;

/** Kept under its old name: callers and tests match on this identity. */
export { MissingSkillsFleetError as MissingApiUrlError } from "./fleet-credentials.js";

type Env = Record<string, string | undefined>;

/**
 * Resolve the Skills origin in effect, or `undefined` when this install has
 * neither a credential nor an authority — i.e. runs on this machine.
 *
 * Throws when an authority IS configured and no credential resolves.
 */
export function resolveApiUrl(
  env: Env = process.env,
  options: SkillsFleetOptions = {},
): string | undefined {
  const fleet = resolveSkillsFleet(env, options);
  return fleet.mode === "hosted" ? fleet.apiOrigin : undefined;
}

/**
 * Resolve the Skills origin, or throw naming what is missing. Use this on every
 * auth and write path.
 */
export function requireApiUrl(
  action = "This command",
  env: Env = process.env,
  options: SkillsFleetOptions = {},
): string {
  const resolved = resolveApiUrl(env, options);
  if (!resolved) throw new MissingSkillsFleetError(action);
  return resolved;
}
