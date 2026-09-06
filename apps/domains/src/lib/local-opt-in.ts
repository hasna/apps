/**
 * The routing preamble every surface runs before the credential chain: "did the
 * environment configure a domains authority, and if not, did the operator ask
 * for the on-box store?"
 *
 * It lives in one leaf module because the CLI, the MCP server and the SDK all
 * have to answer identically — a second spelling is a second thing that can
 * drift — and because the store must be able to ask without pulling the CLI's
 * world into a bundle. Its only imports are the env-key derivation from
 * @hasna/contracts, so the NAMES it looks for are the resolver's own rather
 * than a copy that can fall behind (hasna/apps#1720).
 *
 * LOCAL MODE IS DELIBERATE, NEVER A FALLBACK FROM FAILURE. The local SQLite
 * store is a real product mode for `@hasna/domains` (an on-box portfolio), so
 * it is reachable in exactly one way: an explicit local-path opt-in — one of
 * `HASNA_DOMAINS_DB_PATH` / `HASNA_DOMAINS_DIR` (or their legacy unprefixed
 * aliases) naming a concrete sqlite file or directory — and ONLY when the
 * environment itself configures no authority and no credential. A credential
 * that resolves but cannot be used, an authority that is set but malformed,
 * every one of those THROWS. And when local mode is selected every surface says
 * so, once per process, on stderr: a CLI silently reading an empty local
 * portfolio while the operator believes it is on the fleet is the false-green
 * this ruling exists to end.
 *
 * ORDER, AND WHY IT IS THIS WAY ROUND. A configured environment outranks the
 * opt-in: a run with `HASNA_DOMAINS_API_KEY` set goes hosted — and a local
 * path set alongside a configured authority is a CONFLICT that fails loudly
 * (see `db/store.ts`), never a silent preference. But when the environment
 * configures nothing, the opt-in is answered WITHOUT calling the resolver — so
 * no Keychain item and no credential file is read — which is what lets the
 * suite promise that a scrub of the environment physically cannot reach the
 * shared store, now that a credential can arrive from somewhere an env
 * dictionary cannot blank.
 */
import {
  clientTransportEnvKeys,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
  CREDENTIAL_PROFILE_ENV_KEY,
} from "@hasna/contracts/client";

/**
 * Env vars that name a local sqlite file or directory. Setting any of them is
 * the EXPLICIT LOCAL OPT-IN: the only route to LocalStore. The canonical
 * prefixed names win over the legacy unprefixed aliases everywhere the app
 * reads a path (see `db/database.ts`).
 */
export const LOCAL_PATH_VARS = [
  "HASNA_DOMAINS_DB_PATH",
  "DOMAINS_DB_PATH",
  "HASNA_DOMAINS_DIR",
  "DOMAINS_DIR",
] as const;

export type LocalOptInEnv = Record<string, string | undefined>;

/** The first local-path var this env sets, or undefined when none is set. */
export function explicitLocalPathVar(env: LocalOptInEnv = process.env): string | undefined {
  return LOCAL_PATH_VARS.find((key) => (env[key] ?? "").trim() !== "");
}

/** Every env name that can configure a domains authority or credential, resolver-derived. */
export function domainsAuthorityEnvKeys(): string[] {
  const keys = clientTransportEnvKeys("domains");
  return [
    ...keys.apiUrlKeys,
    ...keys.apiKeyKeys,
    credentialOverrideEnvKey("domains"),
    credentialPointerEnvKey("domains"),
    CREDENTIAL_PROFILE_ENV_KEY,
  ];
}

/**
 * Does the ENVIRONMENT itself configure a domains authority or credential?
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
export function hasDomainsEnvAuthorityIntent(env: LocalOptInEnv = process.env): boolean {
  return domainsAuthorityEnvKeys().some((key) => (env[key] ?? "").trim() !== "");
}

/**
 * True when this environment should be served by the on-box SQLite store: the
 * operator set an explicit local-path opt-in AND the environment configures no
 * authority and no credential. A configured environment outranks the opt-in —
 * see the module header.
 */
export function selectsLocalStore(env: LocalOptInEnv = process.env): boolean {
  return explicitLocalPathVar(env) !== undefined && !hasDomainsEnvAuthorityIntent(env);
}

let localNoticePrinted = false;

/** Reset the once-per-process local-mode notice. Test seam only. */
export function __resetLocalNotice(): void {
  localNoticePrinted = false;
}

/**
 * Announce local mode on stderr, once per process. The notice is one line and
 * names the path the operator opted into and how to go hosted; it never
 * contains a credential value.
 */
export function announceLocal(env: LocalOptInEnv = process.env, notice?: (line: string) => void): void {
  if (localNoticePrinted) return;
  localNoticePrinted = true;
  const pathVar = explicitLocalPathVar(env);
  const line =
    `domains: LOCAL mode — ${pathVar ? `${pathVar} set` : "explicit local opt-in"}; reading and writing the ` +
    `local SQLite store${pathVar ? ` at ${env[pathVar]}` : ""}, not the hosted fleet. To go hosted, set ` +
    `HASNA_DOMAINS_API_KEY (or the Keychain item hasna.credentials.domains.api-key / ` +
    `~/.hasna/domains/config/credentials), or unset ${pathVar ?? "the local path variable"}.`;
  if (notice) notice(line);
  else if (typeof process !== "undefined") process.stderr.write(`${line}\n`);
}