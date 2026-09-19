// WHICH INTERNAL STORE `emails-serve` USES, decided from operator STORAGE configuration
// and from nothing else.
//
// The server has exactly two internal stores and there will only ever be two: the local
// SQLite file behind the dashboard, or operator-owned PostgreSQL behind the `/v1` API. So
// the only question this module answers is "which one did the operator configure?", and the
// answer follows from the PostgreSQL setting plus one explicit local opt-in:
//
//   | EMAILS_DATABASE_URL | HASNA_EMAILS_LOCAL | result                  |
//   |---------------------|--------------------|-------------------------|
//   | set                 | unset              | PostgreSQL `/v1` API    |
//   | unset / blank       | `1`                | loopback SQLite dashboard |
//   | otherwise           | otherwise          | refuse ambiguity/absence |
//
// WHAT THIS REPLACES, and why the replacement is a deletion rather than a rename. Until
// this module existed the same choice was made by a DEPLOYMENT WORD whose two values
// selected an entire product variant. That word had to stop deciding for a reason no amount
// of documentation fixes: it meant OPPOSITE things in the two shipped binaries. In the
// `emails` CLI, `self_hosted` means "become an HTTP client of somebody else's server"; here
// it meant "become a PostgreSQL server". One variable, two contradictory semantics, and a
// deployment that set it for one binary silently reconfigured the other. Storage
// configuration cannot contradict itself that way: the database URL selects PostgreSQL,
// the deliberate local flag selects SQLite, and absence selects nothing.
//
// NO VALUE IS EVER QUOTED BACK. `EMAILS_DATABASE_URL` routinely carries a password in its
// userinfo, and a boot failure is the single most likely thing to be captured in a log
// group, a CI transcript or a pasted terminal buffer. Messages name KEYS only, which is the
// same rule `StoreConfigurationError` follows on the client side.

import {
  EMAILS_LOCAL_OPT_IN_ENV,
  EMAILS_LOCAL_OPT_IN_ENV_KEYS,
  invalidEmailsLocalOptInSettings,
  isEmailsLocalOptIn,
} from "../lib/local-opt-in.js";

/** The setting that names operator-owned PostgreSQL. Presence selects the `/v1` API. */
export const SERVER_DATABASE_URL_SETTING = "EMAILS_DATABASE_URL";

/**
 * The retired deployment-word settings, in both spellings that ever selected a server
 * variant. Named here once; every other site in the tree reads them by role rather than
 * spelling them again.
 */
export const RETIRED_SERVER_MODE_SETTINGS = Object.freeze(["EMAILS_MODE", "HASNA_EMAILS_MODE"] as const);

/**
 * The two values the retired setting could historically hold on a server, mapped to the
 * store each one used to select.
 *
 * This map is the whole reason the retired setting is not simply refused, and the reason is
 * measured rather than assumed. THE CLIENT HALF OF THIS AXIS IS STILL LIVE — sixteen `emails`
 * CLI families still route on the word — so a single shell legitimately exports it for the
 * client and then runs the server from the same place. Three independent instances of exactly
 * that shape exist in this repository today: the hermetic test harness exports the local value
 * for every test and several of those tests spawn `emails-serve` with the inherited
 * environment; the container runtime smoke did the same; and `docs/SELF_HOSTED_RUNTIME.md`
 * shows a client block and a service block an operator would paste into one shell. A hard
 * refusal would break all three, which is not "failing closed" — it is failing on a
 * configuration that works, to punish vocabulary.
 *
 * So a value that AGREES with the storage configuration is tolerated and announced; a value
 * that CONTRADICTS it is refused; and a value that was never valid here is refused. When the
 * client families land and nothing needs the word, the tolerance goes with them.
 */
const RETIRED_VALUE_BACKENDS: ReadonlyMap<string, ServerStorageBackend> = new Map([
  ["local", "sqlite"],
  ["self_hosted", "postgresql"],
]);

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
 * Blank counts as absent because the deploy path writes `EMAILS_DATABASE_URL` from a secret
 * reference, and an unresolved secret arrives as the empty string rather than missing.
 * Absence does not select SQLite: the explicit local opt-in must independently say so.
 */
function configured(env: NodeJS.ProcessEnv, key: string): string | null {
  const trimmed = env[key]?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
}

/** The one-line notice emitted when a retired setting is present but no longer decides. */
export function retiredSettingNotice(settings: readonly string[]): string {
  return `${settings.join(" and ")} no longer selects anything in emails-serve and is IGNORED: `
    + `this server's internal store follows ${SERVER_DATABASE_URL_SETTING} or the explicit local opt-in. Delete `
    + `${settings.join(" and ")} — set ${SERVER_DATABASE_URL_SETTING} to serve the operator /v1 `
    + `API from your own PostgreSQL, or set ${EMAILS_LOCAL_OPT_IN_ENV}=1 with `
    + `${SERVER_DATABASE_URL_SETTING} unset to serve the local SQLite dashboard API.`;
}

/**
 * Emitted once per process, so a long-lived service does not repeat the notice on every
 * pool acquisition while a one-shot command still gets it.
 */
let noticeEmitted = false;

/** Test seam: forget that the notice was emitted. Never called by product code. */
export function resetRetiredSettingNoticeForTests(): void {
  noticeEmitted = false;
}

/**
 * Decide which internal store this server configuration means, or throw.
 *
 * Pure apart from the one-shot stderr notice: it reads the environment it is handed and
 * touches nothing else, so a boot path and a test reach the same answer from the same input.
 */
export function resolveServerStorageBackend(
  env: NodeJS.ProcessEnv = process.env,
  options: { announce?: (message: string) => void } = {},
): ServerStorageBackend {
  const databaseConfigured = configured(env, SERVER_DATABASE_URL_SETTING) !== null;
  const invalidLocalSettings = invalidEmailsLocalOptInSettings(env);
  if (invalidLocalSettings.length > 0) {
    throw new ServerStorageConfigurationError(
      `${invalidLocalSettings.join(" and ")} must be exactly 1 to select the local SQLite `
        + `dashboard. Set ${SERVER_DATABASE_URL_SETTING} for PostgreSQL, or set `
        + `${EMAILS_LOCAL_OPT_IN_ENV}=1 explicitly for local SQLite.`,
      [...invalidLocalSettings, SERVER_DATABASE_URL_SETTING],
    );
  }

  const localSettings = EMAILS_LOCAL_OPT_IN_ENV_KEYS.filter((key) =>
    (env[key] ?? "").trim() === "1"
  );
  if (databaseConfigured && localSettings.length > 0) {
    throw new ServerStorageConfigurationError(
      `${localSettings.join(" and ")} explicitly selects local SQLite while `
        + `${SERVER_DATABASE_URL_SETTING} configures PostgreSQL. Remove the local opt-in or `
        + `remove ${SERVER_DATABASE_URL_SETTING}; emails-serve never guesses between stores.`,
      [...localSettings, SERVER_DATABASE_URL_SETTING],
    );
  }
  const backend: ServerStorageBackend = databaseConfigured ? "postgresql" : "sqlite";
  const present = RETIRED_SERVER_MODE_SETTINGS.filter((key) => configured(env, key) !== null);

  // A retired value never selects a store, but malformed and contradictory values
  // still fail in their own words before the missing-explicit-local check. That keeps
  // legacy diagnostics actionable without allowing the retired word to opt into SQLite.
  for (const key of present) {
    const value = (configured(env, key) as string).toLowerCase();
    const historical = RETIRED_VALUE_BACKENDS.get(value);
    if (historical === undefined) {
      throw new ServerStorageConfigurationError(
        `${key} holds a value that never selected anything in emails-serve. The deployment-mode `
          + "switch has been removed — there is no cloud, remote, hybrid, or hyphenated variant, and "
          + `there is no longer anything for a value to select. Delete ${key}: this server's internal `
          + `store follows ${SERVER_DATABASE_URL_SETTING} plus the explicit local opt-in: set `
          + `${SERVER_DATABASE_URL_SETTING} for PostgreSQL or ${EMAILS_LOCAL_OPT_IN_ENV}=1 for SQLite.`,
        [key, SERVER_DATABASE_URL_SETTING],
      );
    }
    if (historical !== backend) {
      throw new ServerStorageConfigurationError(
        `${key} asks for the ${historical} store while ${SERVER_DATABASE_URL_SETTING} `
          + `${databaseConfigured ? "configures PostgreSQL" : "is unset and cannot configure PostgreSQL"} — `
          + "two answers to where this server keeps its mail and no way to tell which one you meant. "
          + `${key} is retired and decides nothing, so DELETE IT and set `
          + `${SERVER_DATABASE_URL_SETTING} for PostgreSQL or ${EMAILS_LOCAL_OPT_IN_ENV}=1 for SQLite. `
          + "There is deliberately no precedence rule.",
        [key, SERVER_DATABASE_URL_SETTING, EMAILS_LOCAL_OPT_IN_ENV],
      );
    }
  }

  if (!databaseConfigured && !isEmailsLocalOptIn(env)) {
    throw new ServerStorageConfigurationError(
      `${SERVER_DATABASE_URL_SETTING} is not configured, and emails-serve will not silently `
        + `open SQLite. Set ${SERVER_DATABASE_URL_SETTING} for the operator /v1 API, or set `
        + `${EMAILS_LOCAL_OPT_IN_ENV}=1 explicitly for the loopback SQLite dashboard.`,
      [SERVER_DATABASE_URL_SETTING, EMAILS_LOCAL_OPT_IN_ENV],
    );
  }

  if (present.length === 0) return backend;

  // Present, historically valid, and in agreement: it decides nothing, and saying so is the
  // difference between removing the word and removing the word's last reader. An unannounced
  // ignore is the same hole with a smaller symptom — the next operator sets it, nothing reads
  // it, nothing complains, and they believe they configured something.
  if (!noticeEmitted) {
    noticeEmitted = true;
    const announce = options.announce ?? ((message: string) => console.error(message));
    announce(retiredSettingNotice(present));
  }
  return backend;
}
