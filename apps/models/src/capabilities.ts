import {
  MODEL_CAPABILITY_SCHEMA_VERSION,
  type CapabilityLatencyClass,
  type CapabilityModality,
  type CapabilityRuntimeKind,
  type CapabilitySupport,
  type ModelCapability,
  type PrivacyRetentionClass,
  type ProviderHealthStatus,
} from "./types.js";

const SUPPORT_VALUES = new Set<CapabilitySupport>(["yes", "no", "partial"]);
const MODALITY_VALUES = new Set<CapabilityModality>(["text", "image", "audio", "video", "embedding"]);
const LATENCY_VALUES = new Set<CapabilityLatencyClass>(["low", "standard", "batch", "local"]);
const RUNTIME_VALUES = new Set<CapabilityRuntimeKind>(["hosted", "openai-compatible", "ollama", "lm-studio", "huggingface-artifact"]);
const HEALTH_VALUES = new Set<ProviderHealthStatus>(["available", "degraded", "unavailable", "unknown"]);
const RETENTION_VALUES = new Set<PrivacyRetentionClass>(["none", "ephemeral", "provider-retained", "unknown"]);

export interface CapabilityValidationResult {
  ok: boolean;
  errors: string[];
}

function isPositiveInteger(value: unknown): boolean {
  return Number.isInteger(value) && Number(value) > 0;
}

function validateSupport(value: unknown, field: string, errors: string[]): void {
  if (!SUPPORT_VALUES.has(value as CapabilitySupport)) errors.push(`${field} must be yes, no, or partial`);
}

function validateStringArray(value: unknown, field: string, errors: string[]): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim() === "")) {
    errors.push(`${field} must be an array of non-empty strings`);
  }
}

function validateModalities(value: unknown, field: string, errors: string[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${field} must include at least one modality`);
    return;
  }
  for (const item of value) {
    if (!MODALITY_VALUES.has(item as CapabilityModality)) errors.push(`${field} contains unsupported modality: ${String(item)}`);
  }
}

function validatePrice(value: unknown, field: string, errors: string[]): void {
  if (value !== null && (typeof value !== "number" || value < 0)) errors.push(`${field} must be null or a non-negative number`);
}

export function validateModelCapability(capability: ModelCapability): CapabilityValidationResult {
  const errors: string[] = [];
  if (capability.schemaVersion !== MODEL_CAPABILITY_SCHEMA_VERSION) errors.push(`schemaVersion must be ${MODEL_CAPABILITY_SCHEMA_VERSION}`);
  if (!capability.capabilityVersion) errors.push("capabilityVersion is required");
  if (!capability.provider) errors.push("provider is required");
  if (!capability.modelId) errors.push("modelId is required");
  validateStringArray(capability.aliases, "aliases", errors);
  if (!isPositiveInteger(capability.contextWindowTokens)) errors.push("contextWindowTokens must be a positive integer");
  if (!isPositiveInteger(capability.maxOutputTokens)) errors.push("maxOutputTokens must be a positive integer");
  validateModalities(capability.modalities?.input, "modalities.input", errors);
  validateModalities(capability.modalities?.output, "modalities.output", errors);
  validateSupport(capability.toolUse, "toolUse", errors);
  validateSupport(capability.functionCalling, "functionCalling", errors);
  validateSupport(capability.structuredOutput, "structuredOutput", errors);
  validateSupport(capability.jsonMode, "jsonMode", errors);
  if (!capability.pricing) {
    errors.push("pricing is required");
  } else {
    if (!capability.pricing.currency) errors.push("pricing.currency is required");
    validatePrice(capability.pricing.inputPerMillionTokens, "pricing.inputPerMillionTokens", errors);
    validatePrice(capability.pricing.outputPerMillionTokens, "pricing.outputPerMillionTokens", errors);
    if (!capability.pricing.effectiveAt) errors.push("pricing.effectiveAt is required");
  }
  if (!LATENCY_VALUES.has(capability.latencyClass)) errors.push("latencyClass is invalid");
  validateStringArray(capability.safetyLabels, "safetyLabels", errors);
  if (!capability.privacy) {
    errors.push("privacy is required");
  } else {
    if (!RETENTION_VALUES.has(capability.privacy.retention)) errors.push("privacy.retention is invalid");
  }
  if (!capability.runtime) {
    errors.push("runtime is required");
  } else {
    if (!RUNTIME_VALUES.has(capability.runtime.kind)) errors.push("runtime.kind is invalid");
    validateStringArray(capability.runtime.fileFormats, "runtime.fileFormats", errors);
  }
  if (!capability.providerHealth) {
    errors.push("providerHealth is required");
  } else {
    if (!HEALTH_VALUES.has(capability.providerHealth.status)) errors.push("providerHealth.status is invalid");
    if (!capability.providerHealth.checkedAt) errors.push("providerHealth.checkedAt is required");
  }
  if (!capability.source?.type || !capability.source.retrievedAt) errors.push("source.type and source.retrievedAt are required");
  if (!capability.updatedAt) errors.push("updatedAt is required");
  return { ok: errors.length === 0, errors };
}

export function assertModelCapability(capability: ModelCapability): ModelCapability {
  const result = validateModelCapability(capability);
  if (!result.ok) throw new Error(`Invalid model capability: ${result.errors.join("; ")}`);
  return capability;
}

function baseCapability(overrides: Partial<ModelCapability>): ModelCapability {
  const now = "2026-07-06T00:00:00.000Z";
  return assertModelCapability({
    schemaVersion: MODEL_CAPABILITY_SCHEMA_VERSION,
    capabilityVersion: "2026-07-06.fixture",
    provider: "fixture",
    modelId: "fixture/model",
    aliases: [],
    displayName: null,
    contextWindowTokens: 8192,
    maxOutputTokens: 2048,
    modalities: { input: ["text"], output: ["text"] },
    toolUse: "no",
    functionCalling: "no",
    structuredOutput: "no",
    jsonMode: "no",
    pricing: {
      currency: "USD",
      inputPerMillionTokens: null,
      outputPerMillionTokens: null,
      effectiveAt: now,
    },
    latencyClass: "standard",
    safetyLabels: [],
    privacy: { retention: "unknown", usedForTraining: null, zeroRetentionAvailable: null },
    runtime: { kind: "hosted", fileFormats: [] },
    providerHealth: { status: "unknown", checkedAt: now },
    source: { type: "fixture", retrievedAt: now },
    updatedAt: now,
    metadata: {},
    ...overrides,
  });
}

export const MODEL_CAPABILITY_FIXTURES: ModelCapability[] = [
  baseCapability({
    provider: "openai-compatible",
    modelId: "gpt-4.1-mini",
    aliases: ["openai:gpt-4.1-mini", "gpt-4.1-mini"],
    displayName: "OpenAI-compatible GPT-4.1 Mini",
    contextWindowTokens: 1_000_000,
    maxOutputTokens: 32768,
    toolUse: "yes",
    functionCalling: "yes",
    structuredOutput: "yes",
    jsonMode: "yes",
    pricing: { currency: "USD", inputPerMillionTokens: 0.4, outputPerMillionTokens: 1.6, effectiveAt: "2026-07-06T00:00:00.000Z" },
    latencyClass: "low",
    safetyLabels: ["hosted", "policy-filtered"],
    privacy: { retention: "provider-retained", usedForTraining: false, zeroRetentionAvailable: true },
    runtime: { kind: "openai-compatible", endpointEnv: "OPENAI_BASE_URL", fileFormats: [] },
    providerHealth: { status: "available", checkedAt: "2026-07-06T00:00:00.000Z" },
  }),
  baseCapability({
    provider: "ollama",
    modelId: "llama3.1:8b-instruct-q4_K_M",
    aliases: ["ollama:llama3.1:8b", "llama3.1:8b"],
    displayName: "Llama 3.1 8B Instruct via Ollama",
    contextWindowTokens: 131072,
    maxOutputTokens: 8192,
    toolUse: "partial",
    functionCalling: "partial",
    structuredOutput: "partial",
    jsonMode: "partial",
    latencyClass: "local",
    safetyLabels: ["local-runtime", "operator-managed"],
    privacy: { retention: "none", usedForTraining: false, zeroRetentionAvailable: true },
    runtime: { kind: "ollama", endpointEnv: "OLLAMA_HOST", minimumRamGb: 8, quantization: "q4_K_M", fileFormats: ["gguf"] },
    providerHealth: { status: "unknown", checkedAt: "2026-07-06T00:00:00.000Z", detail: "Requires local Ollama runtime probe" },
  }),
  baseCapability({
    provider: "lm-studio",
    modelId: "local/phi-3-mini-4k-instruct",
    aliases: ["lmstudio:phi-3-mini", "phi-3-mini"],
    displayName: "Phi-3 Mini via LM Studio",
    contextWindowTokens: 4096,
    maxOutputTokens: 2048,
    toolUse: "no",
    functionCalling: "no",
    structuredOutput: "partial",
    jsonMode: "partial",
    latencyClass: "local",
    safetyLabels: ["local-runtime", "operator-managed"],
    privacy: { retention: "none", usedForTraining: false, zeroRetentionAvailable: true },
    runtime: { kind: "lm-studio", endpointEnv: "LM_STUDIO_BASE_URL", minimumRamGb: 6, quantization: "q4", fileFormats: ["gguf"] },
    providerHealth: { status: "unknown", checkedAt: "2026-07-06T00:00:00.000Z", detail: "Requires local LM Studio runtime probe" },
  }),
  baseCapability({
    provider: "huggingface",
    modelId: "mistralai/Mistral-7B-Instruct-v0.3",
    aliases: ["hf:mistralai/Mistral-7B-Instruct-v0.3"],
    displayName: "Mistral 7B Instruct artifact",
    contextWindowTokens: 32768,
    maxOutputTokens: 8192,
    toolUse: "no",
    functionCalling: "no",
    structuredOutput: "no",
    jsonMode: "partial",
    latencyClass: "batch",
    safetyLabels: ["open-weight", "license-required"],
    privacy: { retention: "none", usedForTraining: false, zeroRetentionAvailable: true },
    runtime: { kind: "huggingface-artifact", minimumRamGb: 16, minimumVramGb: 8, quantization: null, fileFormats: ["safetensors", "gguf"] },
    providerHealth: { status: "available", checkedAt: "2026-07-06T00:00:00.000Z" },
  }),
  baseCapability({
    provider: "openai-compatible",
    modelId: "provider/down-model",
    aliases: ["down-model"],
    displayName: "Unavailable provider fixture",
    providerHealth: { status: "unavailable", checkedAt: "2026-07-06T00:00:00.000Z", detail: "Provider probe failed" },
    runtime: { kind: "openai-compatible", endpointEnv: "DOWN_PROVIDER_BASE_URL", fileFormats: [] },
    safetyLabels: ["fixture-unavailable"],
  }),
];
