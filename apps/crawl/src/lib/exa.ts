const EXA_ENV_NAME = ["EXA", "API", "KEY"].join("_");
export { EXA_ENV_NAME as EXA_API_KEY_ENV };

export interface ExaAuthOptions {
  apiKey?: string;
  env?: Record<string, string | undefined>;
}

export interface ExaWebSearchStatus {
  available: boolean;
  env: typeof EXA_ENV_NAME;
  source: "env";
  setup: string;
}

function readEnvValue(name: string, env: Record<string, string | undefined>): string | undefined {
  const value = env[name]?.trim();
  return value ? value : undefined;
}

export function getExaApiKey(options: ExaAuthOptions = {}): string | undefined {
  const explicit = options.apiKey?.trim();
  if (explicit) return explicit;
  return readEnvValue(EXA_ENV_NAME, options.env ?? process.env);
}

export function requireExaApiKey(options: ExaAuthOptions = {}): string {
  const apiKey = getExaApiKey(options);
  if (!apiKey) {
    throw new Error(`${EXA_ENV_NAME} is not set. Export ${EXA_ENV_NAME} before using Exa web search.`);
  }
  return apiKey;
}

export function checkExaWebSearch(options: ExaAuthOptions = {}): ExaWebSearchStatus {
  const available = Boolean(getExaApiKey(options));
  return {
    available,
    env: EXA_ENV_NAME,
    source: "env",
    setup: available
      ? `configured via ${EXA_ENV_NAME}`
      : `set ${EXA_ENV_NAME} in the process environment before running crawl search-web`,
  };
}
