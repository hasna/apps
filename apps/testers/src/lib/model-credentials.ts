import { detectProvider, resolveModel, type AIProvider } from "./ai-client.js";
import { loadConfig } from "./config.js";
import { parseCredentialEnvReference, resolveCredential } from "./secrets-resolver.js";

export const MODEL_PROVIDER_ENV_KEYS: Record<AIProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  zai: "ZAI_API_KEY",
};

export interface ModelCredentialValidationInput {
  provider: AIProvider;
  model: string;
  apiKey: string;
}

export interface ModelCredentialValidationResult {
  ok: boolean;
  status?: number;
  message?: string;
}

export interface ModelCredentialResolution {
  provider: AIProvider;
  model: string;
  envKey: string;
  reference: string;
  source: "env" | "optional-env" | "secret" | "literal";
  apiKey: string | null;
}

export interface ModelCredentialCheck {
  provider: AIProvider;
  model: string;
  envKey: string;
  reference: string;
  source: ModelCredentialResolution["source"];
  ok: boolean;
  status?: number;
  message?: string;
}

export function resolveModelCredentialReference(
  reference: string,
  env: Record<string, string | undefined> = process.env,
  credentialResolver: (value: string) => string | null = resolveCredential,
): Pick<ModelCredentialResolution, "source" | "apiKey"> {
  const envReference = parseCredentialEnvReference(reference, { allowOptional: true });
  if (envReference) {
    return {
      source: envReference.optional ? "optional-env" : "env",
      apiKey: envReference.name ? env[envReference.name] ?? null : null,
    };
  }
  if (reference.startsWith("@secrets:")) {
    return { source: "secret", apiKey: credentialResolver(reference) };
  }
  return { source: "literal", apiKey: reference };
}

export function resolveModelCredential(
  modelOrPreset?: string,
  options: {
    reference?: string;
    env?: Record<string, string | undefined>;
    credentialResolver?: (value: string) => string | null;
  } = {},
): ModelCredentialResolution {
  const model = resolveModel(modelOrPreset ?? loadConfig().defaultModel);
  const provider = detectProvider(model);
  const envKey = MODEL_PROVIDER_ENV_KEYS[provider];
  const reference = options.reference ?? `$${envKey}`;
  const resolved = resolveModelCredentialReference(
    reference,
    options.env,
    options.credentialResolver,
  );

  return {
    provider,
    model,
    envKey,
    reference,
    source: resolved.source,
    apiKey: resolved.apiKey,
  };
}

export async function validateModelCredential(
  input: ModelCredentialValidationInput,
): Promise<ModelCredentialValidationResult> {
  const endpoint = getModelCredentialValidationEndpoint(input.provider);
  if (!endpoint) {
    return { ok: true, message: `No live validation endpoint configured for provider ${input.provider}` };
  }

  try {
    const response = await fetch(endpoint.url, {
      headers: endpoint.headers(input.apiKey),
    });
    if (response.ok) return { ok: true, status: response.status };

    const text = await response.text().catch(() => "");
    return {
      ok: false,
      status: response.status,
      message: summarizeModelCredentialValidationError(text) ?? response.statusText,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function checkModelCredential(
  modelOrPreset?: string,
  options: {
    reference?: string;
    env?: Record<string, string | undefined>;
    credentialResolver?: (value: string) => string | null;
    validator?: (input: ModelCredentialValidationInput) => Promise<ModelCredentialValidationResult>;
  } = {},
): Promise<ModelCredentialCheck> {
  const resolved = resolveModelCredential(modelOrPreset, options);
  if (!resolved.apiKey) {
    return {
      provider: resolved.provider,
      model: resolved.model,
      envKey: resolved.envKey,
      reference: resolved.reference,
      source: resolved.source,
      ok: false,
      message: `Missing ${resolved.envKey} for model provider "${resolved.provider}"`,
    };
  }

  const validation = await (options.validator ?? validateModelCredential)({
    provider: resolved.provider,
    model: resolved.model,
    apiKey: resolved.apiKey,
  });

  return {
    provider: resolved.provider,
    model: resolved.model,
    envKey: resolved.envKey,
    reference: resolved.reference,
    source: resolved.source,
    ok: validation.ok,
    status: validation.status,
    message: validation.ok
      ? validation.message
      : validation.message ?? "provider rejected the credential",
  };
}

function getModelCredentialValidationEndpoint(provider: AIProvider): {
  url: string;
  headers: (apiKey: string) => Record<string, string>;
} | null {
  if (provider === "anthropic") {
    return {
      url: "https://api.anthropic.com/v1/models",
      headers: (apiKey) => ({
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      }),
    };
  }
  if (provider === "openai") {
    return {
      url: "https://api.openai.com/v1/models",
      headers: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
    };
  }
  if (provider === "cerebras") {
    return {
      url: "https://api.cerebras.ai/v1/models",
      headers: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
    };
  }
  if (provider === "zai") {
    return {
      url: "https://api.z.ai/api/paas/v4/models",
      headers: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
    };
  }
  if (provider === "google") {
    return {
      url: "https://generativelanguage.googleapis.com/v1beta/openai/models",
      headers: (apiKey) => ({ Authorization: `Bearer ${apiKey}` }),
    };
  }
  return null;
}

function summarizeModelCredentialValidationError(text: string): string | undefined {
  if (!text.trim()) return undefined;
  try {
    const parsed = JSON.parse(text) as {
      error?: { type?: string; message?: string; code?: string };
      message?: string;
    };
    return parsed.error?.type ?? parsed.error?.code ?? parsed.error?.message ?? parsed.message;
  } catch {
    return text.trim().slice(0, 200);
  }
}
