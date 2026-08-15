export const EXA_API_KEY_ENV = ["EXA", "API", "KEY"].join("_") as "EXA_API_KEY";

export interface ExaAuthOptions {
  apiKey?: string;
  env?: Record<string, string | undefined>;
}

export interface ExaConfigurationStatus {
  configured: boolean;
  env: typeof EXA_API_KEY_ENV;
  source: "env";
  message: string;
}

function readEnvValue(name: string, env: Record<string, string | undefined>): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

export function getExaApiKey(options: ExaAuthOptions = {}): string | undefined {
  const explicit = options.apiKey?.trim();
  if (explicit) return explicit;
  return readEnvValue(EXA_API_KEY_ENV, options.env ?? Bun.env);
}

export function requireExaApiKey(options: ExaAuthOptions = {}): string {
  const apiKey = getExaApiKey(options);
  if (!apiKey) {
    throw new Error(`${EXA_API_KEY_ENV} is not configured. Export ${EXA_API_KEY_ENV} to use Exa-backed features.`);
  }
  return apiKey;
}

export function getExaConfigurationStatus(options: ExaAuthOptions = {}): ExaConfigurationStatus {
  const configured = Boolean(getExaApiKey(options));
  return {
    configured,
    env: EXA_API_KEY_ENV,
    source: "env",
    message: configured
      ? `configured via ${EXA_API_KEY_ENV}`
      : `missing ${EXA_API_KEY_ENV}; export it before using Exa-backed features`,
  };
}
