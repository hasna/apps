// WHICH OF THE TWO STORES A CLIENT GETS, decided from operator STORAGE configuration
// and from nothing else.
//
// There are exactly two client stores and there will only ever be two: the local
// SQLite file, or a client of an Emails `/v1` API. So the only question this module
// answers is "which one did the operator configure?", and the answer follows from
// which storage setting is present:
//
//   | database path | hosted resolution              | result                      |
//   |---------------|--------------------------------|-----------------------------|
//   | unset         | authority + credential resolve | the API client              |
//   | unset         | nothing / half resolves        | **HARD BOOT ERROR**         |
//   | set           | nothing resolves               | SQLite at that path         |
//   | set           | ANY authority or credential    | **HARD BOOT ERROR**         |
//
// THE API ARM IS THE SHARED RESOLVER NOW. Until hasna/apps#1720 this module read
// EMAILS_SELF_HOSTED_URL and picked a credential from EMAILS_SESSION_TOKEN /
// EMAILS_IDP_TOKEN / EMAILS_SELF_HOSTED_API_KEY (or the EMAILS_CLIENT_ENV_SECRET
// pointer that delivered them). That chain is gone: the API authority and the
// operator key resolve through `@hasna/contracts/client` (src/lib/emails-credentials.ts) —
// the Keychain, `~/.hasna/emails/config/credentials`, the canonical
// HASNA_EMAILS_API_URL / HASNA_EMAILS_API_KEY names (and their one-release
// EMAILS_SELF_HOSTED_* aliases) — fresh on every request. A live user session or
// agent identity token (the app's own principals) still wins as the bearer
// credential, but the URL always comes from the resolver.
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
// empty mailbox at rc=0. Local storage is now reachable ONLY through an explicit
// choice: a configured database path (the keys below), never through an absence of
// configuration.
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
  hostedEmailsAuthorityConfigured,
  resolveEmailsHostedTransport,
  EMAILS_API_URL_ENV,
  EMAILS_SELF_HOSTED_URL_ENV,
  EMAILS_SELF_HOSTED_API_KEY_ENV,
  EMAILS_SESSION_TOKEN_ENV,
  EMAILS_IDP_TOKEN_ENV,
  isEmailsTransportConfigurationError,
  type EmailsClientCredentialSetting,
} from "./lib/emails-credentials.js";
import { noticeLocalEmailsMode } from "./lib/local-notice.js";
import type { EmailStore } from "./store/email-store.js";
import { createHttpEmailStore } from "./store-http/index.js";
import { createSqliteEmailStore } from "./store-sqlite/index.js";

/**
 * The settings that name a local SQLite file, in the precedence order the database
 * layer already applies: `HASNA_EMAILS_DB_PATH` is read BEFORE `EMAILS_DB_PATH`
 * (src/db/database.ts, `getDbPath`). Listed here so the resolution and the database
 * layer cannot disagree about which one wins, and so an error message can name the
 * key the operator actually has to change.
 */
export const DATABASE_PATH_SETTINGS = Object.freeze(["HASNA_EMAILS_DB_PATH", "EMAILS_DB_PATH"] as const);

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
 * @hasna/contracts-resolved API key (whose env spelling is the `EMAILS_SELF_HOSTED_API_KEY`
 * alias, accepted for one release beside the canonical `HASNA_EMAILS_API_KEY`).
 */
export const API_CREDENTIAL_SETTINGS = Object.freeze([
  EMAILS_SESSION_TOKEN_ENV,
  EMAILS_IDP_TOKEN_ENV,
  EMAILS_SELF_HOSTED_API_KEY_ENV,
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
       * The configured path AS GIVEN. Safe to print. Not necessarily canonical: the
       * database layer resolves symlinks and relative segments when it opens the file,
       * so this is what the operator wrote rather than what the connection ends up
       * bound to. The documented default path is never produced here — a local store
       * requires an explicit path (see the module header).
       */
      readonly databasePath: string;
      /**
       * Which setting supplied the path. Never null: a local plan is only ever
       * produced from an explicitly configured database path.
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
  const databaseKeys = databasePathSettings(env);

  // 1. THE CONTRADICTION, checked first and never resolved by precedence: a database
  //    path configured alongside ANY hosted signal (an authority, a credential from
  //    any tier, a session or identity token) means two configured places to keep
  //    the mail and no way to tell which one was meant.
  if (databaseKeys.length > 0 && hostedEmailsAuthorityConfigured(env)) {
    const hostedKeys = [
      ...(configured(env, API_BASE_URL_SETTING) === null ? [] : [API_BASE_URL_SETTING]),
      ...(configured(env, EMAILS_SELF_HOSTED_URL_ENV) === null ? [] : [EMAILS_SELF_HOSTED_URL_ENV]),
      ...API_CREDENTIAL_SETTINGS.filter((key) => configured(env, key) !== null),
    ];
    const offenders = [...databaseKeys, ...hostedKeys];
    const hostedLabel = hostedKeys.length > 0
      ? `${hostedKeys.join(" and ")} ${hostedKeys.length > 1 ? "configure" : "configures"} an Emails API`
      : "an Emails API is also configured (an API URL, an API key, or a session)";
    throw new StoreConfigurationError(
      `${databaseKeys.join(" and ")} configure a local database and ${hostedLabel}, so this ` +
        "installation has two configured places to keep its mail and no way to tell which " +
        "one you meant. " +
        `UNSET ONE: unset ${hostedKeys.join("/")} to use the local database, or unset ` +
        `${databaseKeys.join("/")} to read and write through the API. There is deliberately ` +
        "no precedence rule — a winner picked for you would silently send your mail to the " +
        "store you did not mean.",
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

  // 3. The API, resolved through the shared @hasna/contracts client resolver. A URL
  //    with no credential cannot produce a working store, and answering 401 on every
  //    operation would look exactly like a store that legitimately declines everything —
  //    so the resolver FAILS LOUD and this row arrives as a typed rejection, not a
  //    fallback. The seam's own message names every tier that was consulted; the store
  //    resolution adds the explicit ways back to local in its own vocabulary.
  if (databaseKeys.length === 0) {
    let hosted;
    try {
      hosted = resolveEmailsHostedTransport(env);
    } catch (error) {
      if (isEmailsTransportConfigurationError(error)) {
        throw new StoreConfigurationError(
          `${(error as Error).message} ` +
            `To use the local database instead, choose it explicitly: set ` +
            `${DATABASE_PATH_SETTINGS.join(" or ")} to a database file. The local database ` +
            "is never served on an absence of configuration.",
          [API_BASE_URL_SETTING, ...API_CREDENTIAL_SETTINGS, ...DATABASE_PATH_SETTINGS],
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

  // 4. Local, from the EXPLICIT path the operator configured. `setting` is never
  //    null here — an unset row threw above — so a `doctor` line can report which
  //    key was chosen rather than a "defaulted" that no longer exists.
  const setting = databaseKeys[0] as string;
  return Object.freeze({
    store: "sqlite" as const,
    databasePath: configured(env, setting) as string,
    setting,
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
      // `getDatabase()` applies the same precedence this resolution reads, canonicalises
      // the value, and MEMOISES one connection per process — so any path computed here
      // can name a file the store is not bound to. `createSqliteEmailStore` defaults the
      // detail from the open connection's own filename instead, which cannot be wrong.
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
