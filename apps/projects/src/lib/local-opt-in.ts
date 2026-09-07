/**
 * The routing preamble every surface runs before the credential chain: "did the
 * environment configure a Projects authority, and if not, did the operator ask
 * for the on-box store?"
 *
 * It lives in one leaf module because the CLI, the MCP server and the store
 * seam all have to answer identically — a second spelling is a second thing
 * that can drift. Its only imports are the env-key derivations from
 * @hasna/contracts, so the NAMES it looks for are the resolver's own rather
 * than a copy that can fall behind.
 *
 * ORDER, AND WHY IT IS THIS WAY ROUND. A configured environment outranks the
 * opt-in: a run with `HASNA_PROJECTS_API_KEY` set goes hosted, and a
 * half-configured one fails loudly, rather than quietly serving a different
 * dataset because a stale `HASNA_PROJECTS_LOCAL` was lying around. But when the
 * environment configures nothing, the opt-in is answered WITHOUT calling the
 * resolver — so no Keychain item and no credential file is read — which is what
 * lets a scrubbed test environment still promise that it physically cannot
 * reach the shared store, now that a credential can arrive from somewhere an
 * env dictionary cannot blank.
 *
 * There is NO implicit local fallback: a station that configures nothing at all
 * fails closed (non-zero exit, no SQLite, no local-fallback event) unless this
 * opt-in is set, and the opt-in run must say "local" on stderr (owner rulings
 * 2026-09-04, hasna/apps#1720/#1613/#1668/#1690).
 */
import {
  clientTransportEnvKeys,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
  CREDENTIAL_PROFILE_ENV_KEY,
} from "@hasna/contracts/client";

/** The deliberate unhosted opt-in, canonical name first. */
export const PROJECTS_LOCAL_OPT_IN_ENV_KEYS = ["HASNA_PROJECTS_LOCAL", "PROJECTS_LOCAL"] as const;

export type ProjectsLocalOptInEnv = Record<string, string | undefined>;

/** True when the operator deliberately asked for the unhosted local store. */
export function isProjectsLocalOptIn(env: ProjectsLocalOptInEnv = process.env): boolean {
  return PROJECTS_LOCAL_OPT_IN_ENV_KEYS.some((key) => (env[key] ?? "").trim() !== "");
}

/** Every env name that can configure a Projects authority or credential, resolver-derived. */
export function projectsAuthorityEnvKeys(): string[] {
  const keys = clientTransportEnvKeys("projects");
  return [
    ...keys.apiUrlKeys,
    ...keys.apiKeyKeys,
    credentialOverrideEnvKey("projects"),
    credentialPointerEnvKey("projects"),
    CREDENTIAL_PROFILE_ENV_KEY,
  ];
}

/**
 * Does the ENVIRONMENT itself configure a Projects authority or credential?
 *
 * Deliberately narrower than "does a credential resolve": answering it must not
 * touch the Keychain or the filesystem, because doing so would defeat the
 * isolation the opt-in short-circuit exists to provide. It reads the env
 * dictionary and nothing else.
 *
 * A DECLARED-BUT-BLANK variable counts as absent HERE — a blank has always been
 * this package's spelling for "not configured", and helpers in the wild blank
 * rather than delete. It is NOT absent once we do go hosted: the resolver
 * refuses a blank loudly rather than falling through to another identity, which
 * is the behaviour that matters at that point.
 */
export function hasProjectsEnvAuthorityIntent(env: ProjectsLocalOptInEnv = process.env): boolean {
  return projectsAuthorityEnvKeys().some((key) => (env[key] ?? "").trim() !== "");
}

/** True when this environment should be served by the on-box SQLite store. */
export function selectsProjectsLocalStore(env: ProjectsLocalOptInEnv = process.env): boolean {
  return !hasProjectsEnvAuthorityIntent(env) && isProjectsLocalOptIn(env);
}