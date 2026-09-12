// WHICH OF THE TWO STORES A CLIENT GETS, decided from operator STORAGE configuration
// and from nothing else.
//
// There are exactly two client stores and there will only ever be two: the local
// SQLite file, or a client of an Emails `/v1` API. So the only question this module
// answers is "which one did the operator configure?", and the answer follows from
// the standard local opt-in (`HASNA_EMAILS_LOCAL=1`, alias `EMAILS_LOCAL=1`,
// src/lib/local-opt-in.ts) and the hosted configuration:
//
//   | HASNA_EMAILS_LOCAL | env authority / credential | database path | result                          |
//   |--------------------|----------------------------|---------------|---------------------------------|
//   | unset              | none in the environment    | unset         | resolve hosted (Keychain, file, |
//   |                    |                            |               | default gateway) or BOOT ERROR  |
//   | unset              | none in the environment    | set           | **HARD BOOT ERROR** — a path    |
//   |                    |                            |               | alone never selects the store   |
//   | set                | none in the environment    | any           | SQLite (that path, else the     |
//   |                    |                            |               | default file); NO Keychain read |
//   | set                | configured                 | unset         | hosted — the configured env     |
//   |                    |                            |               | outranks the flag               |
//   | any                | configured                 | set           | **HARD BOOT ERROR** (two stores)|
//
// THE OPT-IN IS ANSWERED FROM THE ENVIRONMENT BEFORE ANY KEYCHAIN OR DISK READ, and
// only when the environment configures no authority or credential. That order is the
// shared fail-closed contract (owner ruling 2026-09-04, hasna/apps#1720): a scrubbed
// environment plus the flag is a local run that physically cannot reach a credential
// store, and a configured environment plus a stale flag is a hosted run, never a local
// one. Until 1.6.1 a configured database PATH was the opt-in; it is now only the
// location of the local file, and a path without the flag is refused by name.
//
// THE API ARM IS THE SHARED RESOLVER. Until hasna/apps#1720 this module read
// EMAILS_SELF_HOSTED_URL and picked a credential from EMAILS_SESSION_TOKEN /
// EMAILS_IDP_TOKEN / EMAILS_SELF_HOSTED_API_KEY (or the EMAILS_CLIENT_ENV_SECRET
// pointer that delivered them). That chain is gone: the API authority and the
// operator key resolve through `@hasna/contracts/client` (src/lib/emails-credentials.ts) —
// the Keychain, `~/.hasna/emails/config/credentials`, the canonical
// HASNA_EMAILS_API_URL / HASNA_EMAILS_API_KEY names — fresh on every request. The
// one-release EMAILS_SELF_HOSTED_* aliases are RETIRED as of 1.6.1: they are read
// nowhere, and an environment that still exports one is refused by name rather than
// silently ignored. A live user session or agent identity token (the app's own
// principals) still wins as the bearer credential, but the URL always comes from the
// resolver.
//
// BOTH CONFIGURED IS A BOOT ERROR, NOT A PRECEDENCE RULE, and this is the whole
// reason the module exists. A precedence rule answers "which one wins?" when the
// question the operator actually asked was "which one did you mean?" — and it answers
// it SILENTLY. Two configured sources with a documented winner is not a safer design
// than a deployment switch; it *is* a deployment switch, with the switch position
// inferred instead of declared, and the failure mode is mail written to, or read from,
// the store the operator did not mean. The only honest answer to a contradiction is to
// refuse to start and name both settings.
//
// NOTHING CONFIGURED IS A BOOT ERROR TOO (the fail-closed ruling, 2026-09-04).
// The all-unset row used to serve local SQLite at the documented default path, with a
// one-line stderr notice; incident 715712 showed that shape still reads as a false
// green — a harness re-provision dropped the API environment and the CLI reported an
// empty mailbox at rc=0. Local storage is now reachable ONLY through the explicit
// opt-in flag, never through an absence of configuration and never through a path.
//
// WHAT THIS MODULE DELIBERATELY DOES NOT READ: any deployment-mode variable, and any
// module that resolves one. Selection here is a fact about STORAGE configuration. A
// resolver that consulted a deployment word would re-create the coupling that the
// store seam exists to remove. Grep this file for a mode read and you will find none;
// that absence is asserted by src/store-resolution.test.ts.
//
// CONSTRUCTION IS THE ONLY PLACE THE ANSWER IS VISIBLE. `StorePlan` is a two-arm
// discriminated union on purpose — an exhaustive `switch` over it means a THIRD arm
// would be a `tsc` error, which is the property that pins "exactly two stores"
// structurally rather than by comment. The `EmailStore` handed back carries no such
// discriminant: after construction nobody may ask what kind of store they have (see
// src/store/descriptor.ts for what happened the last time a label like that existed).

import {
  assertNoRetiredEmailsClientAliases,
  resolveEmailsHostedTransport,
  EMAILS_API_URL_ENV,
  EMAILS_API_KEY_ENV,
  EMAILS_SESSION_TOKEN_ENV,
  EMAILS_IDP_TOKEN_ENV,
  isEmailsCredentialResolutionError,
  isEmailsTransportConfigurationError,
  type EmailsClientCredentialSetting,
} from "./lib/emails-credentials.js";
import {
  EMAILS_LOCAL_OPT_IN_ENV,
  EMAILS_LOCAL_OPT_IN_ENV_KEYS,
  configuredEmailsAuthorityEnvKeys,
  emailsLocalOptInSetting,
} from "./lib/local-opt-in.js";
import { noticeLocalEmailsMode } from "./lib/local-notice.js";
import type { EmailStore } from "./store/email-store.js";
import { createHttpEmailStore } from "./store-http/index.js";
import { createSqliteEmailStore } from "./store-sqlite/index.js";

/**
 * The settings that name WHERE a local SQLite file lives, in the precedence order the
 * database layer already applies: `HASNA_EMAILS_DB_PATH` is read BEFORE `EMAILS_DB_PATH`
 * (src/db/database.ts, `getDbPath`). Listed here so the resolution and the database
 * layer cannot disagree about which one wins, and so an error message can name the
 * key the operator actually has to change. A path is a LOCATION, not a selection: on
 * its own it never selects the local store (see `LOCAL_OPT_IN_SETTINGS`).
 */
export const DATABASE_PATH_SETTINGS = Object.freeze(["HASNA_EMAILS_DB_PATH", "EMAILS_DB_PATH"] as const);

/**
 * The ONLY settings that select the local store: the standard opt-in, canonical
 * name first. Answered from the environment before any Keychain or disk read, and only
 * when the environment configures no authority or credential (src/lib/local-opt-in.ts).
 */
export const LOCAL_OPT_IN_SETTINGS = EMAILS_LOCAL_OPT_IN_ENV_KEYS;

/** The canonical setting that names the Emails API origin. */
export const API_BASE_URL_SETTING = EMAILS_API_URL_ENV;

/**
 * Compatibility name for the vault pointer that used to DELIVER the API settings
 * (the URL and key). It no longer does: the shared credential resolver owns the
 * authority and the operator key, and `EMAILS_CLIENT_ENV_SECRET` now persists
 * only the app's own principals (session/identity tokens). Kept exported so test
 * scratch lists and scrub loops that name it keep compiling during the
 * one-release transition.
 */
export const API_SETTINGS_POINTER = "EMAILS_CLIENT_ENV_SECRET";

/**
 * The client credential settings, in the order the shared resolver applies them:
 * an explicit user session first, then the caller's own identity token — ADR-0002,
 * an agent uses ITS identity even when an operator key is also present — then the
 * @hasna/contracts-resolved API key under its canonical env spelling
 * `HASNA_EMAILS_API_KEY` (the retired `EMAILS_SELF_HOSTED_API_KEY` alias is refused).
 */
export const API_CREDENTIAL_SETTINGS = Object.freeze([
  EMAILS_SESSION_TOKEN_ENV,
  EMAILS_IDP_TOKEN_ENV,
  EMAILS_API_KEY_ENV,
] as const);

/**
 * A configuration that cannot be resolved to exactly one store.
 *
 * A distinct class rather than a bare `Error` so a boot path can tell "the operator
 * has to change a setting" from a genuine fault, and `settings` carries the KEYS at
 * fault — never their values, because one of them can be a credential.
 */
export class StoreConfigurationError extends Error {
  readonly settings: readonly string[];

  constructor(message: string, settings: readonly string[]) {
    super(message);
    this.name = "StoreConfigurationError";
    this.settings = Object.freeze([...settings]);
  }
}

/**
 * The resolved decision. Consumed by `createConfiguredEmailStore` and by tests, and
 * by nothing else — it is not a runtime label for callers to branch on.
 */
export type StorePlan =
  | {
      readonly store: "sqlite";
      /**
       * The configured path AS GIVEN, or null when no path is configured and the
       * database layer's documented default file applies. Safe to print. Not
       * necessarily canonical: the database layer resolves symlinks and relative
       * segments when it opens the file, so this is what the operator wrote rather
       * than what the connection ends up bound to.
       */
      readonly databasePath: string | null;
      /**
       * Which setting selected this plan: the database-path key when one is
       * configured (the opt-in is set too — a path alone never gets here), else the
       * opt-in key itself. Never null.
       */
      readonly setting: string;
    }
  | {
      readonly store: "api";
      /**
       * The CREDENTIAL-FREE `<origin>/v1` base the client dials.
       *
       * A plan is the object most likely to reach a log line, and an operator who puts a
       * token in the URL's userinfo would otherwise have it serialised with the plan.
       * The credential is read at construction and never stored on the plan.
       */
      readonly baseUrl: string;
      /**
       * WHERE the authority came from: an env key NAME, a Keychain item reference, a
       * file PATH, or `"default"` (the shared default gateway). Never a credential value.
       */
      readonly setting: string;
      /** Which setting carries the credential. NEVER the credential itself. */
      readonly credentialSetting: EmailsClientCredentialSetting;
    };

/**
 * A setting is configured when it is present and not blank, and its value is the TRIMMED
 * text.
 *
 * Trimmed, not raw, because a value that reaches an environment variable through a file
 * or a secret store routinely arrives with a trailing newline: raw, that newline goes
 * into an `Authorization` header, and a raw `"   "` becomes a database file named three
 * spaces in the working directory. `getDbPath()` in the database layer applies the same
 * rule, which is what makes the two agree on what "configured" means as well as on which
 * setting wins.
 */
function configured(env: NodeJS.ProcessEnv, key: string): string | null {
  const trimmed = env[key]?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
}

/** Every database-path setting that is configured, in precedence order. */
function databasePathSettings(env: NodeJS.ProcessEnv): string[] {
  return DATABASE_PATH_SETTINGS.filter((key) => configured(env, key) !== null);
}

/**
 * Decide which store this configuration means, or throw.
 *
 * PURE: it reads only the environment handed to it and never touches the filesystem —
 * no path resolution that creates directories, no connection. The all-unset row and
 * every contradictory or incomplete row arrive as a typed `StoreConfigurationError`
 * whose `settings` name the keys at fault; there is no default to fall back to.
 */
export function planEmailStore(env: NodeJS.ProcessEnv = process.env): StorePlan {
  // 0. THE RETIRED ALIASES ARE REFUSED BY NAME before anything else is read. A shell
  //    that still exports EMAILS_SELF_HOSTED_URL / EMAILS_SELF_HOSTED_API_KEY meant to
  //    configure an API; ignoring it silently would turn that intent into whatever
  //    the ambient tiers happen to hold. Pure env read, no Keychain.
  assertNoRetiredEmailsClientAliases(env);

  const databaseKeys = databasePathSettings(env);
  const hostedKeys = configuredEmailsAuthorityEnvKeys(env);
  const optIn = emailsLocalOptInSetting(env);

  // 1. THE CONTRADICTION, checked first and never resolved by precedence: a database
  //    path configured alongside ANY hosted signal in the environment (an authority,
  //    a credential name, a session or identity token) means two configured places
  //    to keep the mail and no way to tell which one was meant. Read from the env
  //    dictionary only — no Keychain or disk tier is consulted to decide this row.
  if (databaseKeys.length > 0 && hostedKeys.length > 0) {
    const offenders = [...databaseKeys, ...hostedKeys];
    throw new StoreConfigurationError(
      `${databaseKeys.join(" and ")} configure a local database and ${hostedKeys.join(" and ")} ` +
        `${hostedKeys.length > 1 ? "configure" : "configures"} an Emails API, so this ` +
        "installation has two configured places to keep its mail and no way to tell which " +
        "one you meant. " +
        `UNSET ONE: unset ${hostedKeys.join("/")} to use the local database (with ` +
        `${EMAILS_LOCAL_OPT_IN_ENV}=1), or unset ${databaseKeys.join("/")} to read and write ` +
        "through the API. There is deliberately no precedence rule — a winner picked for you " +
        "would silently send your mail to the store you did not mean.",
      offenders,
    );
  }

  // 2. TWO DATABASE SETTINGS NAMING DIFFERENT FILES is the same contradiction in a
  //    smaller box, and gets the same answer. The precedence between these two keys is
  //    documented, but it answers "which one wins?" — and when they name different files
  //    the question the operator actually asked is still "which one did you mean?".
  //    Naming the SAME file twice is harmless and passes.
  if (databaseKeys.length > 1) {
    const paths = new Set(databaseKeys.map((key) => configured(env, key)));
    if (paths.size > 1) {
      throw new StoreConfigurationError(
        `${databaseKeys.join(" and ")} are both set and name DIFFERENT database files, so ` +
          "this installation has two configured local databases and no way to tell which " +
          `one you meant. UNSET ONE. (Setting them to the same path is fine.)`,
        databaseKeys,
      );
    }
  }

  // 3. A PATH WITHOUT THE OPT-IN IS REFUSED, BY NAME. Until 1.6.1 this row selected
  //    SQLite; it was the last way to reach a local store without saying so. The path
  //    says where the file would live — only the flag says that this process may keep
  //    mail there.
  if (databaseKeys.length > 0 && optIn === null) {
    throw new StoreConfigurationError(
      `${databaseKeys.join(" and ")} ${databaseKeys.length > 1 ? "name" : "names"} a local ` +
        "database, but local mode is not enabled — a database path alone never selects the " +
        `local store. Local SQLite is opt-in only: set ${EMAILS_LOCAL_OPT_IN_ENV}=1 (alias ` +
        `${EMAILS_LOCAL_OPT_IN_ENV_KEYS[1]}=1) with no Emails API authority or credential ` +
        `configured, or unset ${databaseKeys.join("/")} to read and write through the hosted API.`,
      [...databaseKeys, ...EMAILS_LOCAL_OPT_IN_ENV_KEYS],
    );
  }

  // 4. THE OPT-IN, answered from the environment alone. With the flag set and nothing
  //    hosted configured in the environment, this is a local run — decided BEFORE the
  //    resolver is called, so no Keychain item and no credentials file is read. The
  //    path, when configured, is the file; otherwise the database layer's documented
  //    default applies (`getDbPath`). A flag beside a configured environment falls
  //    through: the configured environment outranks it.
  if (optIn !== null && hostedKeys.length === 0) {
    const pathSetting = databaseKeys[0];
    return Object.freeze({
      store: "sqlite" as const,
      databasePath: pathSetting === undefined ? null : (configured(env, pathSetting) as string),
      setting: pathSetting ?? optIn,
    });
  }

  // 5. The API, resolved through the shared @hasna/contracts client resolver. A URL
  //    with no credential cannot produce a working store, and answering 401 on every
  //    operation would look exactly like a store that legitimately declines everything —
  //    so the resolver FAILS LOUD and this row arrives as a typed rejection, not a
  //    fallback. The seam's own message names every tier that was consulted; the store
  //    resolution adds the one sentence naming the opt-in, and never a path.
  let hosted;
  try {
    hosted = resolveEmailsHostedTransport(env);
  } catch (error) {
    // A DELIBERATE tier the resolver could not honour (a blank override, a
    // profile with no credential, a malformed vault pointer) is the resolver's
    // own typed refusal; it is reported exactly like a missing credential —
    // one message, one exit — and never resolved around (#1720 validation).
    if (isEmailsTransportConfigurationError(error) || isEmailsCredentialResolutionError(error)) {
      throw new StoreConfigurationError(
        `${(error as Error).message} Local SQLite is opt-in only (${EMAILS_LOCAL_OPT_IN_ENV}=1 with ` +
          "no authority or credential configured) and is never a fallback.",
        [API_BASE_URL_SETTING, ...API_CREDENTIAL_SETTINGS, ...EMAILS_LOCAL_OPT_IN_ENV_KEYS],
      );
    }
    throw error;
  }
  return Object.freeze({
    store: "api" as const,
    // The CREDENTIAL-FREE origin: the resolver's `<origin>/v1` base with the
    // version segment stripped, so a plan, a status payload and a diagnostics
    // string all name the authority, not a route.
    baseUrl: hosted.baseUrl.replace(/\/v1$/, ""),
    setting: hosted.resolution.apiUrlSource ?? "default",
    credentialSetting: hosted.credentialSetting,
  });
}

/**
 * Build the store this process's configuration means.
 *
 * NO `env` PARAMETER, unlike `planEmailStore`, and the asymmetry is deliberate. This
 * function acquires PROCESS-WIDE resources — `getDatabase()` memoises one SQLite
 * connection per process — so a caller who handed in a different environment object
 * would get a store bound to whatever the process had already opened, with diagnostics
 * naming the file it asked for. A store whose `detail` points at the wrong database is
 * worse than no diagnostics at all, so the affordance is not offered: `planEmailStore`
 * is the injectable, side-effect-light half, and this half reads the real environment.
 *
 * The `switch` is exhaustive over `StorePlan`, so a third store arm would fail to
 * compile here — which is the intended structural limit, not an oversight.
 */
export function createConfiguredEmailStore(): EmailStore {
  const plan = planEmailStore(process.env);
  switch (plan.store) {
    case "sqlite":
      // NEITHER the plan's path NOR a re-derived one is passed as the diagnostics detail.
      // `getDatabase()` applies the same precedence this resolution reads (a configured
      // path, else the documented default file), canonicalises the value, and MEMOISES
      // one connection per process — so any path computed here can name a file the
      // store is not bound to. `createSqliteEmailStore` defaults the detail from the
      // open connection's own filename instead, which cannot be wrong. The one stderr
      // line says this process is LOCAL, once (owner ruling 2026-09-04).
      noticeLocalEmailsMode();
      return createSqliteEmailStore();
    case "api":
      // `detail` is left to the store, which strips userinfo, query and fragment out of
      // the origin before it is printed. The credential is read here and never stored
      // anywhere this module can print it.
      return createHttpEmailStore({
        baseUrl: plan.baseUrl,
        credentialSetting: plan.credentialSetting,
        ...hostedEmailStoreCredential(),
      });
  }
}

/**
 * The bearer credential and its fallbacks for the API store, resolved fresh.
 *
 * Separate from `planEmailStore` so the plan stays credential-free (a plan is the
 * object most likely to reach a log line) and the credential is read exactly once
 * at construction, never stored on the plan.
 */
function hostedEmailStoreCredential(): {
  credential: string;
  credentialFallbacks: ReadonlyArray<{ setting: string; value: string }>;
} {
  const hosted = resolveEmailsHostedTransport(process.env);
  return {
    credential: hosted.credential,
    credentialFallbacks: hosted.credentialFallbacks,
  };
}
