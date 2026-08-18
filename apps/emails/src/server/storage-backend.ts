// WHICH INTERNAL STORE `emails-serve` USES, decided from operator STORAGE configuration
// and from nothing else.
//
// The server has exactly two internal stores and there will only ever be two: the local
// SQLite file behind the dashboard, or operator-owned PostgreSQL behind the `/v1` API. So
// the only question this module answers is "which one did the operator configure?", and the
// answer follows from one setting:
//
//   | HASNA_EMAILS_DATABASE_URL | result                                    |
//   |---------------------------|-------------------------------------------|
//   | unset / blank             | sqlite — the SQLite dashboard on loopback |
//   | set                       | postgresql — the operator `/v1` API       |
//
// WHAT THIS REPLACES, and why the replacement is a deletion rather than a rename. Until
// this module existed the same choice was made by a DEPLOYMENT WORD whose two values
// selected an entire product variant. That word had to stop deciding for a reason no amount
// of documentation fixes: it meant OPPOSITE things in the two shipped binaries. In the
// `emails` CLI, `self-hosted` means "become an HTTP client of somebody else's server"; here
// it meant "become a PostgreSQL server". One variable, two contradictory semantics, and a
// deployment that set it for one binary silently reconfigured the other. Storage
// configuration cannot contradict itself that way: a database URL is either present or it is
// not, and whichever binary reads it reaches the same conclusion.
//
// NO VALUE IS EVER QUOTED BACK. `HASNA_EMAILS_DATABASE_URL` routinely carries a password in
// its userinfo, and a boot failure is the single most likely thing to be captured in a log
// group, a CI transcript or a pasted terminal buffer. Messages name KEYS only, which is the
// same rule `StoreConfigurationError` follows on the client side.

/**
 * The setting that names operator-owned PostgreSQL. Presence selects the `/v1` API.
 * The canonical server contract name — the old database-URL spelling is gone
 * with the selector concept, and hasna.contract.json already names this key.
 */
export const SERVER_DATABASE_URL_SETTING = "HASNA_EMAILS_DATABASE_URL";


/**
 * The server's internal store. A two-arm union on purpose — an exhaustive `switch` over it
 * means a THIRD arm would be a `tsc` error, which is what pins "exactly two stores"
 * structurally rather than by comment.
 */
export type ServerStorageBackend = "sqlite" | "postgresql";

/**
 * A server configuration that cannot be resolved to exactly one internal store.
 *
 * A distinct class rather than a bare `Error` so a boot path can tell "the operator has to
 * change a setting" from a genuine fault, and `settings` carries the KEYS at fault — never
 * their values, because one of them is a database URL with a password in it.
 */
export class ServerStorageConfigurationError extends Error {
  readonly settings: readonly string[];

  constructor(message: string, settings: readonly string[]) {
    super(message);
    this.name = "ServerStorageConfigurationError";
    this.settings = Object.freeze([...settings]);
  }
}

/**
 * A setting is configured when it is present and not blank.
 *
 * Blank counts as absent because the deploy path writes `HASNA_EMAILS_DATABASE_URL` from a
 * secret reference, and an unresolved secret arrives as the empty string rather than missing.
 * Treating `""` as "PostgreSQL is configured" would take the API arm with no connection
 * string and fail several layers later, in the connection pool's words instead of the
 * operator's.
 */
function configured(env: NodeJS.ProcessEnv, key: string): string | null {
  const trimmed = env[key]?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
}

/**
 * Decide which internal store this server configuration means.
 *
 * The server's internal store follows `HASNA_EMAILS_DATABASE_URL` alone: present
 * means operator-owned PostgreSQL behind the `/v1` API; unset means the local
 * SQLite dashboard. The selector is gone — nothing here reads it,
 * nothing tolerates it, and a leftover selector variable in the environment
 * selects nothing and is simply never read.
 */
export function resolveServerStorageBackend(
  env: NodeJS.ProcessEnv = process.env,
): ServerStorageBackend {
  return configured(env, SERVER_DATABASE_URL_SETTING) === null ? "sqlite" : "postgresql";
}
