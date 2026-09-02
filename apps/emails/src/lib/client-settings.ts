/** Pure configuration rules shared by clients and service startup. No I/O. */
export const EMAILS_API_URL_ENV = "HASNA_EMAILS_API_URL";
export const EMAILS_API_KEY_ENV = "HASNA_EMAILS_API_KEY";
export const EMAILS_API_URL_SETTINGS = Object.freeze([
  EMAILS_API_URL_ENV, "EMAILS_API_URL", "EMAILS_SELF_HOSTED_URL",
] as const);
export const EMAILS_API_KEY_SETTINGS = Object.freeze([
  EMAILS_API_KEY_ENV, "EMAILS_API_KEY", "EMAILS_SELF_HOSTED_API_KEY",
] as const);

// These inputs never select a transport. Presence, including a blank value,
// means an operator still has configuration to remove.
export const RETIRED_EMAILS_SELECTOR_SETTINGS = Object.freeze([
  "EMAILS_MODE", "HASNA_EMAILS_MODE", "EMAILS_STORAGE_MODE", "HASNA_EMAILS_STORAGE_MODE",
  "EMAILS_BACKEND", "HASNA_EMAILS_BACKEND", "EMAILS_LOCAL", "HASNA_EMAILS_LOCAL",
  "MAILERY_MODE", "HASNA_MAILERY_MODE", "MAILERY_STORAGE_MODE", "HASNA_MAILERY_STORAGE_MODE",
  "MAILERY_API_URL", "MAILERY_API_KEY", "MAILERY_CLOUD_API_URL", "MAILERY_CLOUD_TOKEN",
  "HASNA_MAILERY_API_URL", "HASNA_MAILERY_API_KEY", "HASNA_MAILERY_ENV_FILE",
] as const);

export const CLIENT_DATABASE_SETTINGS = Object.freeze([
  "EMAILS_DB_PATH", "HASNA_EMAILS_DB_PATH", "EMAILS_DATABASE_URL", "HASNA_EMAILS_DATABASE_URL",
  "EMAILS_POSTGRES_URL", "HASNA_EMAILS_POSTGRES_URL", "DATABASE_URL",
] as const);

export class StoreConfigurationError extends Error {
  readonly settings: readonly string[];
  constructor(message: string, settings: readonly string[]) {
    super(message);
    this.name = "StoreConfigurationError";
    this.settings = Object.freeze([...settings]);
  }
}

export function assertNoRetiredEmailsSelectors(env: NodeJS.ProcessEnv): void {
  const present = RETIRED_EMAILS_SELECTOR_SETTINGS.filter((key) => env[key] !== undefined);
  if (present.length) {
    throw new StoreConfigurationError(
      `${present.join(", ")} are retired. Remove them. Emails clients require an authenticated HTTPS API; ` +
      "the service requires server-side PostgreSQL. No local fallback exists.", present,
    );
  }
}

export function assertNoClientDatabaseSettings(env: NodeJS.ProcessEnv): void {
  const present = CLIENT_DATABASE_SETTINGS.filter((key) => env[key] !== undefined);
  if (present.length) {
    throw new StoreConfigurationError(
      `${present.join(", ")} cannot configure an Emails client. Keep database settings on the service; ` +
      `configure ${EMAILS_API_URL_ENV} and an API credential here. Existing files are not modified.`, present,
    );
  }
}

/** Equivalent aliases are accepted; blank or conflicting aliases fail closed. */
export function readAliasedSetting<K extends string>(
  env: NodeJS.ProcessEnv, keys: readonly K[],
): { setting: K; value: string } | null {
  const present = keys.filter((key) => env[key] !== undefined);
  if (!present.length) return null;
  if (present.some((key) => !env[key]!.trim())) {
    throw new StoreConfigurationError(`${present.join(", ")} must not be blank.`, present);
  }
  const values = new Set(present.map((key) => env[key]!.trim()));
  if (values.size !== 1) {
    throw new StoreConfigurationError(`${present.join(", ")} conflict. Configure one value for this setting.`, present);
  }
  return { setting: present[0]!, value: env[present[0]!]!.trim() };
}

/** Validate before adding /v1; do not silently discard URL credentials or ambiguity. */
export function normalizeEmailsApiUrl(value: string, setting = EMAILS_API_URL_ENV): string {
  const reject = (): never => {
    throw new StoreConfigurationError(
      `${setting} must be an HTTPS URL without userinfo, query, fragment or control characters. ` +
      "Plain HTTP is permitted only for an explicit loopback development service.", [setting],
    );
  };
  if (!value.trim() || /[\u0000-\u0020\u007f\\]/.test(value)) return reject();
  let url: URL;
  try { url = new URL(value); } catch { return reject(); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return reject();
  if (url.username || url.password || url.search || url.hash || value.includes("?") || value.includes("#")) return reject();
  url.pathname = `${url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "")}/v1`;
  return url.toString().replace(/\/+$/, "");
}

export function validateEmailsCredential(value: string, setting: string): string {
  const trimmed = value.trim();
  if (!trimmed || /[\u0000-\u0020\u007f]/.test(trimmed)) {
    throw new StoreConfigurationError(`${setting} must contain one nonblank bearer credential.`, [setting]);
  }
  return trimmed;
}
