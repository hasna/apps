import { extractRouterHints } from "./analysis";
import { arrayDifference, arrayIntersection, arrayUnion } from "./utils";
import type {
  EffectiveRouterPolicy,
  PromptAnalysis,
  RoutePromptRequest,
  RouterCandidate,
  RouterConfig,
  RouterProviderDescriptor,
  RouterRouteConfig,
  RouterRuntimeOptions,
  RouterSkipReason,
} from "./types";

const chinaProviderIds = new Set(["deepseek", "qwen", "kimi", "zai", "siliconflow"]);

function strictBoolean(
  requestValue: boolean | undefined,
  routeValue: boolean | undefined,
  configValue: boolean | undefined,
  fallback: boolean,
): boolean {
  const base = routeValue ?? configValue ?? fallback;
  if (requestValue === undefined) return base;
  return requestValue && base;
}

function strictRequiredBoolean(
  requestValue: boolean | undefined,
  routeValue: boolean | undefined,
  configValue: boolean | undefined,
  fallback: boolean,
): boolean {
  const base = routeValue ?? configValue ?? fallback;
  if (requestValue === undefined) return base;
  return requestValue || base;
}

function strictMax(requestValue: number | undefined, routeValue: number | undefined): number | undefined {
  if (requestValue === undefined) return routeValue;
  if (routeValue === undefined) return requestValue;
  return Math.min(requestValue, routeValue);
}

export function isChinaProvider(provider: RouterProviderDescriptor): boolean {
  return (
    chinaProviderIds.has(provider.id) ||
    provider.jurisdiction?.toLowerCase() === "cn" ||
    (provider.regions ?? []).some((region) => region.toLowerCase() === "cn")
  );
}

export function mergePolicy(
  config: RouterConfig,
  route: RouterRouteConfig | undefined,
  request: RoutePromptRequest,
): EffectiveRouterPolicy {
  const hints = extractRouterHints(request);
  const configPolicy = config.policy;
  const routePolicy = route?.dataPolicy ?? {};
  const allowExpansion = configPolicy.allowRequestPolicyExpansion === true;
  const configuredAllowedRegions = routePolicy.allowedRegions ?? configPolicy.allowedRegions;
  const configuredBlockedRegions = routePolicy.blockedRegions ?? (routePolicy.allowedRegions ? undefined : configPolicy.blockedRegions);
  const allowedRegions = allowExpansion
    ? hints.allowedRegions ?? configuredAllowedRegions
    : arrayIntersection(configuredAllowedRegions, hints.allowedRegions);
  const blockedRegions = allowExpansion
    ? hints.blockedRegions ?? (hints.allowedRegions ? undefined : configuredBlockedRegions)
    : arrayUnion(configuredBlockedRegions, hints.blockedRegions);
  const configuredAllowedProviders = route?.providerAllowlist ?? routePolicy.allowedProviders ?? configPolicy.allowedProviders;
  const configuredBlockedProviders = route?.providerBlocklist ?? routePolicy.blockedProviders ?? configPolicy.blockedProviders;
  const requestBlockedProviders = arrayUnion(hints.blockedProviders, hints.providerIgnore);
  const requestAllowedProviders = hints.providerOnly ?? hints.allowedProviders;

  const allowedProviders = allowExpansion
    ? requestAllowedProviders ?? configuredAllowedProviders
    : arrayDifference(arrayIntersection(configuredAllowedProviders, requestAllowedProviders), requestBlockedProviders);
  const blockedProviders = allowExpansion
    ? requestBlockedProviders ?? configuredBlockedProviders
    : arrayUnion(configuredBlockedProviders, requestBlockedProviders);
  const maxInputUsdPerMillionTokens = strictMax(hints.maxInputUsdPerMillionTokens, route?.maxInputUsdPerMillionTokens);
  const maxOutputUsdPerMillionTokens = strictMax(hints.maxOutputUsdPerMillionTokens, route?.maxOutputUsdPerMillionTokens);

  return {
    ...(allowedProviders ? { allowedProviders } : {}),
    ...(blockedProviders ? { blockedProviders } : {}),
    ...(allowedRegions ? { allowedRegions } : {}),
    ...(blockedRegions ? { blockedRegions } : {}),
    allowTraining: allowExpansion
      ? hints.allowTraining ?? routePolicy.allowTraining ?? configPolicy.allowTraining ?? false
      : strictBoolean(hints.allowTraining, routePolicy.allowTraining, configPolicy.allowTraining, false),
    allowLogging: allowExpansion
      ? hints.allowLogging ?? routePolicy.allowLogging ?? configPolicy.allowLogging ?? false
      : strictBoolean(hints.allowLogging, routePolicy.allowLogging, configPolicy.allowLogging, false),
    allowChineseProviders: allowExpansion
      ? hints.allowChineseProviders ??
        routePolicy.allowChineseProviders ??
        configPolicy.allowChineseProviders ??
        allowedRegions?.includes("cn") ??
        false
      : strictBoolean(
          hints.allowChineseProviders ?? (hints.allowedRegions?.includes("cn") ? true : undefined),
          routePolicy.allowChineseProviders,
          configPolicy.allowChineseProviders ?? (configuredAllowedRegions?.includes("cn") ? true : undefined),
          false,
        ),
    zeroDataRetentionRequired: allowExpansion
      ? hints.zeroDataRetentionRequired ?? routePolicy.zeroDataRetentionRequired ?? configPolicy.zeroDataRetentionRequired ?? false
      : strictRequiredBoolean(
          hints.zeroDataRetentionRequired,
          routePolicy.zeroDataRetentionRequired,
          configPolicy.zeroDataRetentionRequired,
          false,
        ),
    byokOnly: allowExpansion
      ? hints.byokOnly ?? routePolicy.byokOnly ?? configPolicy.byokOnly ?? true
      : strictRequiredBoolean(hints.byokOnly, routePolicy.byokOnly, configPolicy.byokOnly, true),
    ...(maxInputUsdPerMillionTokens === undefined ? {} : { maxInputUsdPerMillionTokens }),
    ...(maxOutputUsdPerMillionTokens === undefined ? {} : { maxOutputUsdPerMillionTokens }),
  };
}

function intersects(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a?.length || !b?.length) return false;
  const bSet = new Set(b);
  return a.some((item) => bSet.has(item));
}

function hasAllowedRegion(provider: RouterProviderDescriptor, policy: EffectiveRouterPolicy): boolean {
  if (policy.blockedRegions?.length && intersects(provider.regions, policy.blockedRegions)) return false;
  if (policy.allowedRegions === undefined) return true;
  if (policy.allowedRegions.length === 0) return false;
  return intersects(provider.regions ?? [], policy.allowedRegions);
}

function providerCredentialEnv(provider: RouterProviderDescriptor): string | undefined {
  return provider.auth?.apiKeyEnv ?? provider.apiKeyEnv;
}

function providerRequiresCredential(provider: RouterProviderDescriptor): boolean {
  if (provider.auth?.type === "none") return false;
  return Boolean(providerCredentialEnv(provider));
}

function providerBaseUrl(provider: RouterProviderDescriptor, env: Record<string, string | undefined>): string | undefined {
  return provider.baseUrl ?? (provider.baseUrlEnv ? env[provider.baseUrlEnv] : undefined);
}

function providerHasRequiredDataPolicy(provider: RouterProviderDescriptor, policy: EffectiveRouterPolicy): boolean {
  if (!policy.allowTraining && provider.dataPolicy?.allowTraining !== false) return false;
  if (!policy.allowLogging && provider.dataPolicy?.allowLogging !== false) return false;
  if (policy.zeroDataRetentionRequired && provider.dataPolicy?.zeroDataRetentionAvailable !== true) return false;
  if (policy.byokOnly && provider.dataPolicy?.byokOnly === false) return false;
  return true;
}

export function candidateSkipReason(
  candidate: RouterCandidate,
  request: RoutePromptRequest,
  policy: EffectiveRouterPolicy,
  analysis: PromptAnalysis,
  runtime?: RouterRuntimeOptions,
): string | undefined {
  const hints = extractRouterHints(request);
  const env = runtime?.env ?? process.env;
  const { model, provider } = candidate;

  if (provider.enabled === false) return "provider is disabled";
  if (policy.allowedProviders !== undefined && !policy.allowedProviders.includes(provider.id)) {
    return "provider is not in allowed_providers";
  }
  if (policy.blockedProviders?.includes(provider.id)) return "provider is blocked";
  if (isChinaProvider(provider) && !policy.allowChineseProviders) {
    return "china provider requires allow_chinese_providers or allowed_regions including cn";
  }
  if (!hasAllowedRegion(provider, policy)) return "provider region is not allowed";
  if (!providerHasRequiredDataPolicy(provider, policy)) return "provider data policy is not allowed";
  if (runtime?.credentialMode === "skip-missing") {
    if (!providerBaseUrl(provider, env)) return `provider baseUrl env ${provider.baseUrlEnv ?? "(none)"} is not set`;
    const credentialEnv = providerCredentialEnv(provider);
    if (policy.byokOnly && !credentialEnv) return "provider is not configured for BYOK env credentials";
    if (providerRequiresCredential(provider) && (!credentialEnv || !env[credentialEnv])) {
      return `provider key env ${credentialEnv ?? "(none)"} is not set`;
    }
  }
  if (!model.capabilities.includes("chat")) return "model does not support chat";
  if (request.stream && !model.capabilities.includes("streaming")) return "model does not support streaming";
  for (const capability of analysis.requiredCapabilities) {
    if (!model.capabilities.includes(capability)) return `model does not support required capability ${capability}`;
  }
  const minContext = hints.minContextTokens ?? analysis.estimatedInputTokens + analysis.estimatedOutputTokens;
  if (model.contextWindow !== undefined && model.contextWindow < minContext) {
    return "model context window is below request minimum";
  }
  if (model.contextWindow === undefined && hints.minContextTokens !== undefined) {
    return "model context window is not configured for request minimum";
  }
  if (hints.minQuality !== undefined && (model.qualityScore === undefined || model.qualityScore < hints.minQuality)) {
    return "model quality score is below request minimum";
  }
  if (policy.maxInputUsdPerMillionTokens !== undefined && model.inputUsdPerMillionTokens === undefined) {
    return "model input price is not configured for policy";
  }
  if (
    policy.maxInputUsdPerMillionTokens !== undefined &&
    model.inputUsdPerMillionTokens! > policy.maxInputUsdPerMillionTokens
  ) {
    return "model input price exceeds policy";
  }
  if (policy.maxOutputUsdPerMillionTokens !== undefined && model.outputUsdPerMillionTokens === undefined) {
    return "model output price is not configured for policy";
  }
  if (
    policy.maxOutputUsdPerMillionTokens !== undefined &&
    model.outputUsdPerMillionTokens! > policy.maxOutputUsdPerMillionTokens
  ) {
    return "model output price exceeds policy";
  }
  return undefined;
}

export function skipped(candidate: RouterCandidate, reason: string): RouterSkipReason {
  return {
    provider: candidate.provider.id,
    model: candidate.model.id,
    providerModel: candidate.model.providerModel,
    reason,
  };
}
