import { clamp01, isObject, unique } from "./utils";
import type {
  ChatMessage,
  PromptAnalysis,
  RoutePromptRequest,
  RouterHints,
  RouterModelCapability,
  RouterTaskType,
} from "./types";

const taskPriority: RouterTaskType[] = [
  "vision",
  "tool-use",
  "json",
  "coding",
  "reasoning",
  "long-context",
  "summarization",
  "bulk-cheap",
  "low-latency-chat",
  "chat",
];

const knownTasks = new Set<RouterTaskType>(taskPriority);

function normalizeTask(value: string): RouterTaskType | undefined {
  const normalized = value.toLowerCase().replace(/_/g, "-").trim();
  if (normalized === "tools" || normalized === "tool") return "tool-use";
  if (normalized === "long" || normalized === "long-context-window") return "long-context";
  if (normalized === "summary" || normalized === "summarize") return "summarization";
  if (normalized === "cheap" || normalized === "bulk") return "bulk-cheap";
  if (normalized === "latency" || normalized === "fast") return "low-latency-chat";
  return knownTasks.has(normalized as RouterTaskType) ? (normalized as RouterTaskType) : undefined;
}

function isRouterTask(value: RouterTaskType | undefined): value is RouterTaskType {
  return value !== undefined;
}

function explicitTasks(hints: RouterHints | undefined): RouterTaskType[] {
  const raw = hints?.task;
  const values = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  return unique(values.filter((value): value is string => typeof value === "string").map(normalizeTask).filter(isRouterTask));
}

function contentText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((item) => JSON.stringify(item)).join("\n");
  return "";
}

function hasVisionContent(content: ChatMessage["content"]): boolean {
  if (!Array.isArray(content)) return false;
  return content.some((item) => {
    const type = typeof item.type === "string" ? item.type.toLowerCase() : "";
    return type.includes("image") || "image_url" in item || "input_image" in item;
  });
}

export function requestText(request: RoutePromptRequest): string {
  const messageText = (request.messages ?? []).map((message) => contentText(message.content)).join("\n");
  return [request.prompt, messageText].filter((value): value is string => typeof value === "string").join("\n");
}

export function estimateInputTokens(request: RoutePromptRequest, hints?: RouterHints): number {
  if (hints?.expectedInputTokens !== undefined) return Math.max(1, Math.ceil(hints.expectedInputTokens));
  const chars = requestText(request).length;
  return Math.max(1, Math.ceil(chars / 4));
}

export function estimateOutputTokens(request: RoutePromptRequest, hints?: RouterHints): number {
  if (hints?.expectedOutputTokens !== undefined) return Math.max(1, Math.ceil(hints.expectedOutputTokens));
  const maxTokens = request.max_completion_tokens ?? request.max_tokens;
  return typeof maxTokens === "number" && maxTokens > 0 ? Math.ceil(maxTokens) : 512;
}

function addScore(scores: Partial<Record<RouterTaskType, number>>, task: RouterTaskType, amount: number): void {
  scores[task] = clamp01((scores[task] ?? 0) + amount);
}

function keywordScore(text: string, patterns: RegExp[]): number {
  return patterns.reduce((score, pattern) => score + (pattern.test(text) ? 1 : 0), 0);
}

function inferredScores(request: RoutePromptRequest, hints: RouterHints | undefined): Partial<Record<RouterTaskType, number>> {
  const text = requestText(request);
  const lower = text.toLowerCase();
  const scores: Partial<Record<RouterTaskType, number>> = { chat: 0.2 };
  const tokenEstimate = estimateInputTokens(request, hints);

  for (const task of explicitTasks(hints)) addScore(scores, task, 0.85);

  if ((request.messages ?? []).some((message) => hasVisionContent(message.content))) addScore(scores, "vision", 0.9);
  if (request.tools?.length || request.tool_choice !== undefined) addScore(scores, "tool-use", 0.85);
  if (request.response_format !== undefined) addScore(scores, "json", 0.8);

  const codingHits = keywordScore(lower, [
    /\btypescript\b|\bjavascript\b|\bpython\b|\brust\b|\bgo\b|\bsql\b/,
    /\bimplement\b|\brefactor\b|\bdebug\b|\bstack trace\b|\bdiff\b|\bpatch\b/,
    /\bfunction\b|\bclass\b|\binterface\b|\bunit test\b|\bcli\b|\bapi\b/,
    /```/,
  ]);
  if (codingHits) addScore(scores, "coding", Math.min(0.9, 0.25 * codingHits));

  const reasoningHits = keywordScore(lower, [
    /\breason\b|\bprove\b|\bderive\b|\bsolve\b|\banalyze\b/,
    /\btradeoff\b|\bwhy\b|\bstep by step\b|\bconstraint\b/,
    /\bmath\b|\btheorem\b|\boptimize\b/,
  ]);
  if (reasoningHits) addScore(scores, "reasoning", Math.min(0.85, 0.25 * reasoningHits));

  if (tokenEstimate >= 16_000 || (hints?.minContextTokens ?? 0) >= 64_000) addScore(scores, "long-context", 0.9);
  else if (tokenEstimate >= 8_000) addScore(scores, "long-context", 0.55);

  if (/\bsummar(y|ize|ise|ization)\b|\btl;dr\b|\brecap\b/.test(lower)) addScore(scores, "summarization", 0.75);
  if (/\bbatch\b|\bbulk\b|\bclassify each\b|\bfor each row\b|\bcheap\b|\blow cost\b/.test(lower)) {
    addScore(scores, "bulk-cheap", 0.75);
  }
  if ((text.length <= 180 && !scores.coding && !scores.reasoning) || hints?.priority === "latency") {
    addScore(scores, "low-latency-chat", 0.55);
  }
  if (/\bjson\b|\bschema\b|\bstructured output\b|\bvalid object\b/.test(lower)) addScore(scores, "json", 0.6);

  return scores;
}

function requiredCapabilities(
  request: RoutePromptRequest,
  taskTypes: RouterTaskType[],
  hints: RouterHints | undefined,
): RouterModelCapability[] {
  const caps: RouterModelCapability[] = [...(hints?.requiredCapabilities ?? [])];
  if (request.stream) caps.push("streaming");
  if (request.tools?.length || request.tool_choice !== undefined || taskTypes.includes("tool-use")) caps.push("tools");
  if (request.response_format !== undefined || taskTypes.includes("json")) caps.push("json");
  if (taskTypes.includes("vision")) caps.push("vision");
  return unique(caps);
}

function complexityFromScores(scores: Partial<Record<RouterTaskType, number>>, estimatedInputTokens: number): number {
  const reasoning = scores.reasoning ?? 0;
  const coding = scores.coding ?? 0;
  const longContext = scores["long-context"] ?? 0;
  const json = scores.json ?? 0;
  const tokenPressure = clamp01(estimatedInputTokens / 64_000);
  return clamp01(0.15 + reasoning * 0.3 + coding * 0.22 + longContext * 0.2 + json * 0.08 + tokenPressure * 0.25);
}

function sourceHintsFor(request: RoutePromptRequest, hints: RouterHints | undefined, taskTypes: RouterTaskType[]): string[] {
  const hintsOut: string[] = [];
  if (hints?.task !== undefined) hintsOut.push(`explicit task hint: ${JSON.stringify(hints.task)}`);
  if (hints?.priority) hintsOut.push(`priority hint: ${hints.priority}`);
  if (hints?.requiredCapabilities?.length) hintsOut.push(`required capabilities: ${hints.requiredCapabilities.join(", ")}`);
  if (request.tools?.length) hintsOut.push("request contains tools");
  if (request.response_format !== undefined) hintsOut.push("request contains response_format");
  if (request.stream) hintsOut.push("request asks for streaming");
  if (taskTypes.length) hintsOut.push(`inferred tasks: ${taskTypes.join(", ")}`);
  return hintsOut;
}

export function extractRouterHints(request: RoutePromptRequest): RouterHints {
  const gateway = request.gateway;
  const openrouterOptions = isObject(request.provider_options?.openrouter)
    ? request.provider_options.openrouter
    : isObject(request.providerOptions?.openrouter)
      ? request.providerOptions.openrouter
      : undefined;

  return {
    ...(request.hints ?? {}),
    ...(gateway?.task === undefined ? {} : { task: gateway.task }),
    ...(gateway?.priority === undefined ? {} : { priority: gateway.priority }),
    ...(gateway?.cost_quality_tradeoff === undefined ? {} : { costQualityTradeoff: gateway.cost_quality_tradeoff }),
    ...(gateway?.sticky_session_id === undefined ? {} : { stickySessionId: gateway.sticky_session_id }),
    ...(gateway?.session_id === undefined ? {} : { sessionId: gateway.session_id }),
    ...(gateway?.min_quality === undefined ? {} : { minQuality: gateway.min_quality }),
    ...(gateway?.min_context_tokens === undefined ? {} : { minContextTokens: gateway.min_context_tokens }),
    ...(gateway?.expected_input_tokens === undefined ? {} : { expectedInputTokens: gateway.expected_input_tokens }),
    ...(gateway?.required_capabilities === undefined ? {} : { requiredCapabilities: gateway.required_capabilities }),
    ...(gateway?.provider_order === undefined ? {} : { providerOrder: gateway.provider_order }),
    ...(gateway?.provider_only === undefined ? {} : { providerOnly: gateway.provider_only }),
    ...(gateway?.provider_ignore === undefined ? {} : { providerIgnore: gateway.provider_ignore }),
    ...(gateway?.provider_sort === undefined ? {} : { providerSort: gateway.provider_sort }),
    ...(gateway?.allow_fallbacks === undefined ? {} : { allowFallbacks: gateway.allow_fallbacks }),
    ...(gateway?.zdr === undefined ? {} : { zdr: gateway.zdr }),
    ...(gateway?.data_collection === undefined ? {} : { dataCollection: gateway.data_collection }),
    ...(gateway?.max_price === undefined ? {} : { maxPrice: gateway.max_price }),
    ...(gateway?.caching === undefined ? {} : { caching: gateway.caching }),
    ...(gateway?.provider_timeouts === undefined ? {} : { providerTimeouts: gateway.provider_timeouts }),
    ...(gateway?.allowed_providers === undefined ? {} : { allowedProviders: gateway.allowed_providers }),
    ...(gateway?.blocked_providers === undefined ? {} : { blockedProviders: gateway.blocked_providers }),
    ...(gateway?.allowed_regions === undefined ? {} : { allowedRegions: gateway.allowed_regions }),
    ...(gateway?.blocked_regions === undefined ? {} : { blockedRegions: gateway.blocked_regions }),
    ...(gateway?.allow_chinese_providers === undefined ? {} : { allowChineseProviders: gateway.allow_chinese_providers }),
    ...(gateway?.allow_training === undefined ? {} : { allowTraining: gateway.allow_training }),
    ...(gateway?.allow_logging === undefined ? {} : { allowLogging: gateway.allow_logging }),
    ...(gateway?.zero_data_retention_required === undefined
      ? {}
      : { zeroDataRetentionRequired: gateway.zero_data_retention_required }),
    ...(gateway?.byok_only === undefined ? {} : { byokOnly: gateway.byok_only }),
    ...(gateway?.max_input_usd_per_million_tokens === undefined
      ? {}
      : { maxInputUsdPerMillionTokens: gateway.max_input_usd_per_million_tokens }),
    ...(gateway?.max_output_usd_per_million_tokens === undefined
      ? {}
      : { maxOutputUsdPerMillionTokens: gateway.max_output_usd_per_million_tokens }),
    ...(isObject(openrouterOptions)
      ? {
          openrouter: {
            ...(Array.isArray(openrouterOptions.allowed_models)
              ? { allowedModels: openrouterOptions.allowed_models.filter((item): item is string => typeof item === "string") }
              : {}),
            ...(typeof openrouterOptions.cost_quality_tradeoff === "number"
              ? { costQualityTradeoff: openrouterOptions.cost_quality_tradeoff }
              : {}),
          },
        }
      : {}),
  };
}

export function analyzePrompt(request: RoutePromptRequest, rawHints?: RouterHints): PromptAnalysis {
  const hints = rawHints ?? extractRouterHints(request);
  const scores = inferredScores(request, hints);
  const taskTypes = taskPriority.filter((task) => (scores[task] ?? 0) >= 0.45);
  const normalizedTaskTypes = taskTypes.length ? taskTypes : (["chat"] as RouterTaskType[]);
  const estimatedInputTokens = estimateInputTokens(request, hints);
  const estimatedOutputTokens = estimateOutputTokens(request, hints);

  return {
    primaryTask: normalizedTaskTypes[0] ?? "chat",
    taskTypes: normalizedTaskTypes,
    taskScores: scores,
    requiredCapabilities: requiredCapabilities(request, normalizedTaskTypes, hints),
    estimatedInputTokens,
    estimatedOutputTokens,
    promptLengthChars: requestText(request).length,
    complexity: complexityFromScores(scores, estimatedInputTokens),
    sourceHints: sourceHintsFor(request, hints, normalizedTaskTypes),
  };
}
