import {
  EMAILS_CLIENT_ENV_SECRET_ENV, loadEmailsClientEnvSecret, resolveEmailsClientCredentialCandidates,
  type EmailsClientCredentialCandidate, type EmailsClientCredentialSetting,
} from "./client-env.js";
import {
  EMAILS_API_URL_ENV, EMAILS_API_URL_SETTINGS, StoreConfigurationError,
  assertNoClientDatabaseSettings, assertNoRetiredEmailsSelectors, normalizeEmailsApiUrl, readAliasedSetting,
} from "./client-settings.js";

export interface EmailsClientConfig {
  readonly baseUrl: string;
  readonly credential: string;
  readonly credentialSetting: EmailsClientCredentialSetting;
  readonly credentialFallbacks: readonly EmailsClientCredentialCandidate[];
}

/** No configuration inspection opens a file, database or network connection. */
export function resolveEmailsClientBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  assertNoRetiredEmailsSelectors(env);
  assertNoClientDatabaseSettings(env);
  readAliasedSetting(env, [EMAILS_CLIENT_ENV_SECRET_ENV]);
  const endpoint = readAliasedSetting(env, EMAILS_API_URL_SETTINGS);
  if (!endpoint) throw new StoreConfigurationError(`${EMAILS_API_URL_ENV} is required. Configure the Emails HTTPS service.`, [EMAILS_API_URL_ENV]);
  return normalizeEmailsApiUrl(endpoint.value, endpoint.setting);
}

/** One authenticated API configuration, without a database or placement selector. */
export function resolveEmailsClientConfig(env: NodeJS.ProcessEnv = process.env): EmailsClientConfig {
  const baseUrl = resolveEmailsClientBaseUrl(env);
  const [primary, ...fallbacks] = resolveEmailsClientCredentialCandidates(env);
  if (!primary) throw new StoreConfigurationError(
    "An Emails API credential is required: configure HASNA_EMAILS_API_KEY, EMAILS_SESSION_TOKEN or EMAILS_IDP_TOKEN.",
    ["HASNA_EMAILS_API_KEY", "EMAILS_SESSION_TOKEN", "EMAILS_IDP_TOKEN"],
  );
  // A diagnostic snapshot must not serialize credentials. Callers can still
  // access them explicitly to construct the Authorization header.
  return Object.freeze(Object.defineProperties({ baseUrl, credentialSetting: primary.setting }, {
    credential: { value: primary.value, enumerable: false },
    credentialFallbacks: { value: Object.freeze(fallbacks), enumerable: false },
  })) as EmailsClientConfig;
}

/** Explicit credential-pointer delivery remains separate from pure resolution. */
export function loadEmailsClientConfig(env: NodeJS.ProcessEnv = process.env): EmailsClientConfig {
  assertNoRetiredEmailsSelectors(env);
  assertNoClientDatabaseSettings(env);
  if (env[EMAILS_CLIENT_ENV_SECRET_ENV] !== undefined) loadEmailsClientEnvSecret(env);
  return resolveEmailsClientConfig(env);
}
