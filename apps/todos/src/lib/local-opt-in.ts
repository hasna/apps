/**
 * The routing preamble every surface runs before the credential chain: "did the
 * environment configure a Todos authority, and if not, did the operator ask for
 * the on-box store?"
 *
 * It lives in one leaf module because the CLI, the MCP server and the SDK all
 * have to answer identically — a second spelling is a second thing that can
 * drift — and because the SDK must be able to ask without pulling the CLI's
 * `cloud-router` (and its transitive world) into a zero-dependency bundle. Its
 * only import is the env-key derivation from @hasna/contracts, so the NAMES it
 * looks for are the resolver's own rather than a copy that can fall behind.
 *
 * ORDER, AND WHY IT IS THIS WAY ROUND. A configured environment outranks the
 * opt-in: a run with `HASNA_TODOS_API_KEY` set goes hosted, and a
 * half-configured one fails loudly, rather than quietly serving a different
 * dataset because a stale `HASNA_TODOS_LOCAL` was lying around. But when the
 * environment configures nothing, the opt-in is answered WITHOUT calling the
 * resolver — so no Keychain item and no credential file is read — which is what
 * lets `@hasna/todos/testing` still promise that a scrubbed test environment
 * physically cannot reach the shared store, now that a credential can arrive
 * from somewhere an env dictionary cannot blank.
 */
import {
  clientTransportEnvKeys,
  credentialOverrideEnvKey,
  credentialPointerEnvKey,
  CREDENTIAL_PROFILE_ENV_KEY,
} from "@hasna/contracts/client";

/** The deliberate unhosted opt-in, canonical name first. */
export const TODOS_LOCAL_OPT_IN_ENV_KEYS = ["HASNA_TODOS_LOCAL", "TODOS_LOCAL"] as const;

export type TodosLocalOptInEnv = Record<string, string | undefined>;

/** True when the operator deliberately asked for the unhosted local store. */
export function isTodosLocalOptIn(env: TodosLocalOptInEnv = process.env): boolean {
  return TODOS_LOCAL_OPT_IN_ENV_KEYS.some((key) => (env[key] ?? "").trim() !== "");
}

/** Every env name that can configure a Todos authority or credential, resolver-derived. */
export function todosAuthorityEnvKeys(): string[] {
  const keys = clientTransportEnvKeys("todos");
  return [
    ...keys.apiUrlKeys,
    ...keys.apiKeyKeys,
    credentialOverrideEnvKey("todos"),
    credentialPointerEnvKey("todos"),
    CREDENTIAL_PROFILE_ENV_KEY,
  ];
}

/**
 * Does the ENVIRONMENT itself configure a Todos authority or credential?
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
export function hasTodosEnvAuthorityIntent(env: TodosLocalOptInEnv = process.env): boolean {
  return todosAuthorityEnvKeys().some((key) => (env[key] ?? "").trim() !== "");
}

/** True when this environment should be served by the on-box SQLite store. */
export function selectsTodosLocalStore(env: TodosLocalOptInEnv = process.env): boolean {
  return !hasTodosEnvAuthorityIntent(env) && isTodosLocalOptIn(env);
}

/**
 * The environment as the resolver should see it: every authority/credential
 * variable that is DECLARED BUT BLANK removed.
 *
 * A blank has always been this package's spelling for "not configured" — it is
 * how `@hasna/todos/testing` scrubbed an inherited environment, how the CLI's
 * admitted-local redaction neutralised routing, and how consumer fixtures in
 * other repos still write it. @hasna/contracts takes the opposite and, for its
 * purposes, correct view: a declared-but-blank credential is a misconfiguration
 * it refuses loudly rather than resolving around, because a blank that fell
 * through would authenticate as a different principal than the operator named.
 *
 * Both are right at their own layer, and the mismatch is not hypothetical: an
 * environment carrying a real `HASNA_TODOS_API_KEY` alongside a blank legacy
 * alias — the exact shape a scrubbed-then-overridden fixture produces — is a
 * complete, unambiguous configuration that would otherwise be refused for the
 * alias nobody set. Normalising here keeps "blank means unset" true at the
 * Todos seam while leaving the resolver's stricter rule intact for everything
 * it does receive: a value that is present is still policed, and two aliases
 * that actually disagree still refuse.
 */
export function todosResolverEnv<T extends TodosLocalOptInEnv>(env: T): T {
  const blanks = todosAuthorityEnvKeys().filter(
    (key) => key in env && (env[key] ?? "").trim() === "",
  );
  if (blanks.length === 0) return env;
  const next = { ...env } as T;
  for (const key of blanks) delete next[key];
  return next;
}
