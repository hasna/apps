import { z } from "zod";
import type {
  RouterConfig,
  RouterConfigInput,
  RouterConfigValidationResult,
  RouterDataPolicy,
  RouterModelDescriptor,
  RouterProviderDescriptor,
  RouterRouteConfig,
} from "./types";

const dataPolicySchema = z
  .object({
    allowTraining: z.boolean().optional(),
    allowLogging: z.boolean().optional(),
    allowedRegions: z.array(z.string().min(1)).optional(),
    blockedRegions: z.array(z.string().min(1)).optional(),
    allowedProviders: z.array(z.string().min(1)).optional(),
    blockedProviders: z.array(z.string().min(1)).optional(),
    zeroDataRetentionRequired: z.boolean().optional(),
    zeroDataRetentionAvailable: z.boolean().optional(),
    allowChineseProviders: z.boolean().optional(),
    allowRequestPolicyExpansion: z.boolean().optional(),
    byokOnly: z.boolean().optional(),
  })
  .passthrough();

const providerAuthSchema = z
  .object({
    type: z.enum(["bearer", "header", "none"]).optional(),
    apiKeyEnv: z.string().min(1).optional(),
    headerName: z.string().min(1).optional(),
    prefix: z.string().optional(),
  })
  .passthrough();

const providerHeaderValueSchema = z.union([
  z.string(),
  z
    .object({
      value: z.string().optional(),
      env: z.string().min(1).optional(),
      prefix: z.string().optional(),
      required: z.boolean().optional(),
    })
    .passthrough(),
]);

const gatewayCompatibilitySchema = z
  .object({
    kind: z.string().min(1),
    openAiCompatible: z.boolean(),
    requestOptionsShape: z.string().min(1).optional(),
    docsUrl: z.string().url().optional(),
    notes: z.array(z.string()).optional(),
  })
  .passthrough();

const providerSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1),
    kind: z.string().min(1).default("openai-compatible"),
    baseUrl: z.string().url().optional(),
    baseUrlEnv: z.string().min(1).optional(),
    apiKeyEnv: z.string().min(1).optional(),
    auth: providerAuthSchema.optional(),
    headers: z.record(providerHeaderValueSchema).optional(),
    enabled: z.boolean().optional(),
    regions: z.array(z.string().min(1)).optional(),
    jurisdiction: z.string().min(1).optional(),
    dataPolicy: dataPolicySchema.optional(),
    gateway: gatewayCompatibilitySchema.optional(),
  })
  .passthrough();

const modelSchema = z
  .object({
    id: z.string().min(1),
    providerId: z.string().min(1),
    providerModel: z.string().min(1),
    aliases: z.array(z.string().min(1)).optional(),
    capabilities: z
      .array(z.enum(["chat", "streaming", "tools", "json", "vision", "reasoning", "embeddings"]))
      .min(1),
    contextWindow: z.number().int().min(1).optional(),
    inputUsdPerMillionTokens: z.number().min(0).optional(),
    outputUsdPerMillionTokens: z.number().min(0).optional(),
    qualityScore: z.number().min(0).max(1).optional(),
    averageLatencyMs: z.number().min(1).optional(),
    successRate: z.number().min(0).max(1).optional(),
    throughputTokensPerSecond: z.number().min(0).optional(),
    taskQuality: z.record(z.number().min(0).max(1)).optional(),
    tags: z.array(z.string().min(1)).optional(),
  })
  .passthrough();

const routeSchema = z
  .object({
    id: z.string().min(1),
    mode: z
      .enum(["explicit", "fallback", "cheapest", "lowest-latency", "highest-throughput", "balanced", "smart"])
      .default("smart"),
    modelAliases: z.array(z.string().min(1)).optional(),
    providerAllowlist: z.array(z.string().min(1)).optional(),
    providerBlocklist: z.array(z.string().min(1)).optional(),
    maxInputUsdPerMillionTokens: z.number().min(0).optional(),
    maxOutputUsdPerMillionTokens: z.number().min(0).optional(),
    maxLatencyMs: z.number().min(1).optional(),
    fallbackModelIds: z.array(z.string().min(1)).optional(),
    dataPolicy: dataPolicySchema.optional(),
  })
  .passthrough();

const configSchema = z
  .object({
    policy: dataPolicySchema.optional(),
    providers: z.array(providerSchema).optional(),
    models: z.array(modelSchema).optional(),
    routes: z.array(routeSchema).optional(),
  })
  .passthrough();

const defaultPolicy: RouterDataPolicy = {
  allowTraining: false,
  allowLogging: false,
  allowChineseProviders: false,
  byokOnly: true,
};

function formatZodIssue(issue: z.ZodIssue): string {
  const path = issue.path.length > 0 ? issue.path.join(".") : "config";
  return `${path}: ${issue.message}`;
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (!seen.has(item.id)) {
      result.push(item);
      seen.add(item.id);
    }
  }
  return result;
}

export function normalizeRouterConfig(input: RouterConfigInput = {}): RouterConfig {
  return {
    policy: { ...defaultPolicy, ...(input.policy ?? {}) },
    providers: uniqueById((input.providers ?? []) as RouterProviderDescriptor[]),
    models: uniqueById((input.models ?? []) as RouterModelDescriptor[]),
    routes: uniqueById((input.routes ?? []) as RouterRouteConfig[]),
  };
}

export function validateRouterConfig(input: unknown): RouterConfigValidationResult {
  const parsed = configSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(formatZodIssue),
      warnings: [],
    };
  }

  const config = normalizeRouterConfig(parsed.data as RouterConfigInput);
  const warnings: string[] = [];
  const providerIds = new Set(config.providers.map((provider) => provider.id));

  for (const model of config.models) {
    if (!providerIds.has(model.providerId)) warnings.push(`model ${model.id} references missing provider ${model.providerId}`);
  }

  const modelIds = new Set(config.models.map((model) => model.id));
  for (const route of config.routes) {
    for (const modelId of route.fallbackModelIds ?? []) {
      if (!modelIds.has(modelId)) warnings.push(`route ${route.id} references missing fallback model ${modelId}`);
    }
  }

  return { ok: true, config, warnings };
}

export async function loadRouterConfig(path: string): Promise<RouterConfig> {
  const raw = JSON.parse(await Bun.file(path).text()) as unknown;
  const result = validateRouterConfig(raw);
  if (!result.ok) {
    throw new Error(result.errors.join("\n"));
  }
  return result.config;
}
