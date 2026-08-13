import { extractRouterHints } from "./analysis";
import { isObject } from "./utils";
import type { EffectiveRouterPolicy, RoutePromptRequest, RouterGatewayCompatibility, RouterProviderDescriptor } from "./types";

export const gatewayDescriptors: Record<string, RouterGatewayCompatibility> = {
  direct: {
    kind: "direct",
    openAiCompatible: true,
    requestOptionsShape: "openai-compatible",
    notes: ["Direct provider or local open-gateway candidate; no upstream gateway routing options are added."],
  },
  openrouter: {
    kind: "openrouter",
    openAiCompatible: true,
    requestOptionsShape: "openrouter-provider",
    docsUrl: "https://openrouter.ai/docs/guides/routing/provider-selection",
    notes: ["Supports provider.order, only, ignore, sort, max_price, zdr, data_collection, and Auto Router plugin options."],
  },
  "vercel-ai-gateway": {
    kind: "vercel-ai-gateway",
    openAiCompatible: true,
    requestOptionsShape: "vercel-provider-options",
    docsUrl: "https://vercel.com/docs/ai-gateway/models-and-providers/provider-options",
    notes: ["Uses providerOptions.gateway for order, only, caching, and providerTimeouts."],
  },
  "litellm-proxy": {
    kind: "litellm-proxy",
    openAiCompatible: true,
    requestOptionsShape: "headers-and-config",
    docsUrl: "https://docs.litellm.ai/docs/proxy/load_balancing",
    notes: ["LiteLLM owns its internal load balancing; open-router treats it as one upstream candidate."],
  },
  portkey: {
    kind: "portkey",
    openAiCompatible: true,
    requestOptionsShape: "headers-and-config",
    docsUrl: "https://portkey.ai/docs/product/ai-gateway/load-balancing",
    notes: ["Portkey config selection is normally header/config driven."],
  },
  "cloudflare-ai-gateway": {
    kind: "cloudflare-ai-gateway",
    openAiCompatible: true,
    requestOptionsShape: "headers-and-config",
    docsUrl: "https://developers.cloudflare.com/ai-gateway/usage/rest-api/",
    notes: ["Cloudflare AI Gateway supports OpenAI-compatible /ai/v1/chat/completions and cf-aig-* headers."],
  },
  "kong-ai-gateway": {
    kind: "kong-ai-gateway",
    openAiCompatible: true,
    requestOptionsShape: "headers-and-config",
    docsUrl: "https://developer.konghq.com/ai-gateway/load-balancing/",
    notes: ["Kong AI Gateway can perform weighted, hash, usage, latency, semantic, and priority routing upstream."],
  },
  "helicone-ai-gateway": {
    kind: "helicone-ai-gateway",
    openAiCompatible: true,
    requestOptionsShape: "headers-and-config",
    docsUrl: "https://docs.helicone.ai/gateway/overview",
    notes: ["Helicone AI Gateway is OpenAI-compatible and configured through provider auth/base URL."],
  },
};

const openRouterProviderFields = new Set([
  "order",
  "allow_fallbacks",
  "require_parameters",
  "data_collection",
  "zdr",
  "enforce_distillable_text",
  "only",
  "ignore",
  "quantizations",
  "sort",
  "preferred_min_throughput",
  "max_price",
]);

function pickAllowed(input: unknown, allowed: Set<string>): Record<string, unknown> {
  if (!isObject(input)) return {};
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (allowed.has(key) && value !== undefined) output[key] = value;
  }
  return output;
}

function namespacedOptions(request: RoutePromptRequest, namespace: string): Record<string, unknown> {
  const snake = isObject(request.provider_options?.[namespace]) ? request.provider_options[namespace] : undefined;
  const camel = isObject(request.providerOptions?.[namespace]) ? request.providerOptions[namespace] : undefined;
  return {
    ...(isObject(snake) ? snake : {}),
    ...(isObject(camel) ? camel : {}),
  };
}

export function buildOpenRouterGatewayHints(
  request: RoutePromptRequest,
  policy?: EffectiveRouterPolicy,
): Record<string, unknown> {
  const hints = extractRouterHints(request);
  const options = namespacedOptions(request, "openrouter");
  const providerOptions = {
    ...pickAllowed(request.provider, openRouterProviderFields),
    ...pickAllowed(isObject(options.provider) ? options.provider : undefined, openRouterProviderFields),
  };

  if (hints.providerOrder && providerOptions.order === undefined) providerOptions.order = hints.providerOrder;
  if (hints.providerOnly && providerOptions.only === undefined) providerOptions.only = hints.providerOnly;
  if (hints.providerIgnore && providerOptions.ignore === undefined) providerOptions.ignore = hints.providerIgnore;
  if (hints.providerSort && providerOptions.sort === undefined) providerOptions.sort = hints.providerSort;
  if (hints.allowFallbacks !== undefined && providerOptions.allow_fallbacks === undefined) {
    providerOptions.allow_fallbacks = hints.allowFallbacks;
  }
  if (policy?.zeroDataRetentionRequired || hints.zdr === true || hints.zeroDataRetentionRequired) providerOptions.zdr = true;
  else if (hints.zdr !== undefined && providerOptions.zdr === undefined) providerOptions.zdr = hints.zdr;
  if (hints.dataCollection && providerOptions.data_collection === undefined) providerOptions.data_collection = hints.dataCollection;
  if (policy?.allowLogging === false || hints.allowLogging === false) providerOptions.data_collection = "deny";
  if (hints.maxPrice && providerOptions.max_price === undefined) providerOptions.max_price = hints.maxPrice;

  const plugins: Record<string, unknown>[] = [];
  const allowedModels = hints.openrouter?.allowedModels;
  const costQualityTradeoff = hints.openrouter?.costQualityTradeoff ?? hints.costQualityTradeoff;
  if (allowedModels?.length || costQualityTradeoff !== undefined) {
    plugins.push({
      id: "auto-router",
      ...(allowedModels?.length ? { allowed_models: allowedModels } : {}),
      ...(costQualityTradeoff === undefined ? {} : { cost_quality_tradeoff: costQualityTradeoff }),
    });
  }

  const sessionId = hints.stickySessionId ?? hints.sessionId ?? request.session_id;
  return {
    ...(Object.keys(providerOptions).length ? { provider: providerOptions } : {}),
    ...(plugins.length ? { plugins } : {}),
    ...(sessionId ? { session_id: sessionId } : {}),
  };
}

export function buildVercelGatewayHints(
  request: RoutePromptRequest,
  _policy?: EffectiveRouterPolicy,
): Record<string, unknown> {
  const hints = extractRouterHints(request);
  const options = namespacedOptions(request, "vercel");
  const gatewayInput = isObject(options.gateway) ? options.gateway : options;
  const gateway = pickAllowed(gatewayInput, new Set(["models", "order", "only", "caching", "providerTimeouts"]));

  if (hints.providerOrder && gateway.order === undefined) gateway.order = hints.providerOrder;
  if (hints.providerOnly && gateway.only === undefined) gateway.only = hints.providerOnly;
  if (hints.caching && gateway.caching === undefined) gateway.caching = hints.caching;
  if (hints.providerTimeouts && gateway.providerTimeouts === undefined) gateway.providerTimeouts = hints.providerTimeouts;

  return Object.keys(gateway).length ? { providerOptions: { gateway } } : {};
}

export function gatewayHintsForProvider(
  provider: RouterProviderDescriptor | undefined,
  request: RoutePromptRequest,
  policy?: EffectiveRouterPolicy,
): Record<string, unknown> | undefined {
  if (!provider) return undefined;
  if (provider.id === "openrouter" || provider.kind === "openrouter" || provider.gateway?.kind === "openrouter") {
    const options = buildOpenRouterGatewayHints(request, policy);
    return Object.keys(options).length ? options : undefined;
  }
  if (provider.id === "vercel-ai-gateway" || provider.gateway?.kind === "vercel-ai-gateway") {
    const options = buildVercelGatewayHints(request, policy);
    return Object.keys(options).length ? options : undefined;
  }
  return undefined;
}
