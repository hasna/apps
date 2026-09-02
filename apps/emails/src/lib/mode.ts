// Transitional source adapter for callers not yet moved to the sole API seam.
// It never selects a backend. Public removal is part of the major-version
// capability migration; keeping this adapter is NOT whole-package completion.
import { loadEmailsClientConfig } from "./client-config.js";
import { assertNoRetiredEmailsSelectors, StoreConfigurationError } from "./client-settings.js";
export { EMAILS_CLIENT_ENV_SECRET_ENV } from "./client-env.js";

export type EmailsMode = "local" | "self_hosted";
export type EmailsModeLabel = "Local" | "Server API";
export const EMAILS_MODE_ENV = "EMAILS_MODE";
export const HASNA_EMAILS_MODE_ENV = "HASNA_EMAILS_MODE";
export const EMAILS_MODE_CONFIG_KEY = "emails_mode";
export const EMAILS_MODE_ENV_KEYS = [EMAILS_MODE_ENV, HASNA_EMAILS_MODE_ENV] as const;
export interface EmailsModeSource {
  kind: "env" | "config" | "default";
  name: string | null;
  value: string | null;
}
export interface EmailsModeResolution {
  mode: EmailsMode;
  label: EmailsModeLabel;
  source: EmailsModeSource;
  warning: string | null;
}

const LEGACY_HOSTED_ENV_KEYS = [
  "MAILERY_API_URL", "MAILERY_API_KEY", "MAILERY_CLOUD_API_URL", "MAILERY_CLOUD_TOKEN",
  "HASNA_MAILERY_API_URL", "HASNA_MAILERY_API_KEY", "HASNA_MAILERY_ENV_FILE",
] as const;

export function assertNoLegacyHostedEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  _options: { allowHostedApiEnvWithExplicitSelfHosted?: boolean } = {},
): void {
  assertNoRetiredEmailsSelectors(env);
  const present = LEGACY_HOSTED_ENV_KEYS.filter((key) => env[key] !== undefined);
  if (present.length) throw new StoreConfigurationError(
    `${present.join(", ")} belong to a retired runtime. Configure the Emails HTTPS API instead.`, present,
  );
}

export function labelForEmailsMode(_mode: EmailsMode): EmailsModeLabel { return "Server API"; }
export function normalizeEmailsMode(_value: string): never {
  throw new StoreConfigurationError("Emails deployment selectors are retired; configure the HTTPS API.", EMAILS_MODE_ENV_KEYS);
}
export function clientEnvPointerOverrideWarning(_key: string, _pointer: string): never {
  return normalizeEmailsMode("");
}
export function clientEnvCredentialOverrideWarning(_key: string, _url: string): never {
  return normalizeEmailsMode("");
}

export function resolveEmailsModeSelection(env: NodeJS.ProcessEnv = process.env): EmailsModeResolution {
  assertNoLegacyHostedEnvironment(env);
  const config = loadEmailsClientConfig(env);
  return {
    mode: "self_hosted", label: "Server API",
    source: { kind: "env", name: "HASNA_EMAILS_API_URL", value: config.baseUrl },
    warning: null,
  };
}
export const resolveEmailsMode = resolveEmailsModeSelection;
export function getEmailsMode(): EmailsMode {
  assertNoLegacyHostedEnvironment();
  return "self_hosted";
}
