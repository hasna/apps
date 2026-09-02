import {
  EMAILS_CLIENT_ENV_SECRET_ENV, CLIENT_ENV_CREDENTIAL_SELECTION_KEYS,
} from "./lib/client-env.js";
import { loadEmailsClientConfig, resolveEmailsClientConfig } from "./lib/client-config.js";
import { EMAILS_API_URL_ENV, CLIENT_DATABASE_SETTINGS } from "./lib/client-settings.js";
import type { EmailStore } from "./store/email-store.js";
import { createHttpEmailStore } from "./store-http/index.js";

export { StoreConfigurationError } from "./lib/client-settings.js";
export const DATABASE_PATH_SETTINGS = CLIENT_DATABASE_SETTINGS;
export const API_BASE_URL_SETTING = EMAILS_API_URL_ENV;
export const API_CREDENTIAL_SETTINGS = CLIENT_ENV_CREDENTIAL_SELECTION_KEYS;
export const API_SETTINGS_POINTER = EMAILS_CLIENT_ENV_SECRET_ENV;

/** A credential-free description of the only client transport. */
export interface StorePlan {
  readonly store: "api";
  readonly baseUrl: string;
  readonly setting: string;
  readonly credentialSetting: (typeof CLIENT_ENV_CREDENTIAL_SELECTION_KEYS)[number];
}

/** Pure inspection. No directory creation, credentials lookup or database access. */
export function planEmailStore(env: NodeJS.ProcessEnv = process.env): StorePlan {
  const config = resolveEmailsClientConfig(env);
  return Object.freeze({
    store: "api",
    baseUrl: config.baseUrl.replace(/\/v1$/, ""),
    setting: API_BASE_URL_SETTING,
    credentialSetting: config.credentialSetting,
  });
}

/** Explicit pointer loading, then construction of the sole authenticated API store. */
export function createConfiguredEmailStore(): EmailStore {
  const config = loadEmailsClientConfig();
  return createHttpEmailStore({
    baseUrl: config.baseUrl,
    credential: config.credential,
    credentialSetting: config.credentialSetting,
    credentialFallbacks: config.credentialFallbacks,
  });
}
