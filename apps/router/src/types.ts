export type RouterProviderKind =
  | "openai-compatible"
  | "openai"
  | "anthropic"
  | "google"
  | "bedrock"
  | "vertex"
  | "openrouter"
  | (string & {});

export type RouterModelCapability =
  | "chat"
  | "streaming"
  | "tools"
  | "json"
  | "vision"
  | "reasoning"
  | "embeddings";

export type RouterTaskType =
  | "coding"
  | "reasoning"
  | "long-context"
  | "vision"
  | "json"
  | "tool-use"
  | "summarization"
  | "bulk-cheap"
  | "low-latency-chat"
  | "chat";

export type RouterMode =
  | "explicit"
  | "fallback"
  | "cheapest"
  | "lowest-latency"
  | "highest-throughput"
  | "balanced"
  | "smart";

export type RouterPriority = "cost" | "quality" | "latency" | "balanced";

export type RouterDataPolicy = {
  allowTraining?: boolean;
  allowLogging?: boolean;
  allowedRegions?: string[];
  blockedRegions?: string[];
  allowedProviders?: string[];
  blockedProviders?: string[];
  zeroDataRetentionRequired?: boolean;
  zeroDataRetentionAvailable?: boolean;
  allowChineseProviders?: boolean;
  allowRequestPolicyExpansion?: boolean;
  byokOnly?: boolean;
};

export type RouterProviderAuthConfig = {
  type?: "bearer" | "header" | "none";
  apiKeyEnv?: string;
  headerName?: string;
  prefix?: string;
};

export type RouterProviderHeaderValue =
  | string
  | {
      value?: string;
      env?: string;
      prefix?: string;
      required?: boolean;
    };

export type RouterGatewayKind =
  | "direct"
  | "openrouter"
  | "vercel-ai-gateway"
  | "litellm-proxy"
  | "portkey"
  | "cloudflare-ai-gateway"
  | "kong-ai-gateway"
  | "helicone-ai-gateway"
  | (string & {});

export type RouterGatewayCompatibility = {
  kind: RouterGatewayKind;
  openAiCompatible: boolean;
  requestOptionsShape?:
    | "openai-compatible"
    | "openrouter-provider"
    | "openrouter-auto-router-plugin"
    | "vercel-provider-options"
    | "headers-and-config";
  docsUrl?: string;
  notes?: string[];
};

export type RouterProviderDescriptor = {
  id: string;
  displayName: string;
  kind: RouterProviderKind;
  baseUrl?: string;
  baseUrlEnv?: string;
  apiKeyEnv?: string;
  auth?: RouterProviderAuthConfig;
  headers?: Record<string, RouterProviderHeaderValue>;
  enabled?: boolean;
  regions?: string[];
  jurisdiction?: string;
  dataPolicy?: RouterDataPolicy;
  gateway?: RouterGatewayCompatibility;
};

export type RouterModelDescriptor = {
  id: string;
  providerId: string;
  providerModel: string;
  aliases?: string[];
  capabilities: RouterModelCapability[];
  contextWindow?: number;
  inputUsdPerMillionTokens?: number;
  outputUsdPerMillionTokens?: number;
  qualityScore?: number;
  averageLatencyMs?: number;
  successRate?: number;
  throughputTokensPerSecond?: number;
  taskQuality?: Partial<Record<RouterTaskType, number>>;
  tags?: string[];
};

export type RouterRouteConfig = {
  id: string;
  mode: RouterMode;
  modelAliases?: string[];
  providerAllowlist?: string[];
  providerBlocklist?: string[];
  maxInputUsdPerMillionTokens?: number;
  maxOutputUsdPerMillionTokens?: number;
  maxLatencyMs?: number;
  fallbackModelIds?: string[];
  dataPolicy?: RouterDataPolicy;
};

export type RouterConfig = {
  policy: RouterDataPolicy;
  providers: RouterProviderDescriptor[];
  models: RouterModelDescriptor[];
  routes: RouterRouteConfig[];
};

export type RouterConfigInput = Partial<RouterConfig>;

export type RouterConfigValidationResult =
  | { ok: true; config: RouterConfig; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

export type ChatRole = "system" | "user" | "assistant" | "tool" | "developer";

export type ChatMessage = {
  role: ChatRole;
  content?: string | Array<Record<string, unknown>> | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: unknown[];
};

export type RouterHints = {
  task?: RouterTaskType | RouterTaskType[] | string | string[];
  priority?: RouterPriority;
  costQualityTradeoff?: number;
  stickySessionId?: string;
  sessionId?: string;
  minQuality?: number;
  minContextTokens?: number;
  expectedInputTokens?: number;
  expectedOutputTokens?: number;
  requiredCapabilities?: RouterModelCapability[];
  providerOrder?: string[];
  providerOnly?: string[];
  providerIgnore?: string[];
  providerSort?: string | Record<string, unknown>;
  allowFallbacks?: boolean;
  zdr?: boolean;
  dataCollection?: "allow" | "deny";
  maxPrice?: Record<string, number>;
  caching?: "auto";
  providerTimeouts?: Record<string, unknown>;
  allowedProviders?: string[];
  blockedProviders?: string[];
  allowedRegions?: string[];
  blockedRegions?: string[];
  allowChineseProviders?: boolean;
  allowTraining?: boolean;
  allowLogging?: boolean;
  zeroDataRetentionRequired?: boolean;
  byokOnly?: boolean;
  maxInputUsdPerMillionTokens?: number;
  maxOutputUsdPerMillionTokens?: number;
  includeGatewayMetadata?: boolean;
  openrouter?: {
    allowedModels?: string[];
    costQualityTradeoff?: number;
  };
};

export type OpenGatewayRequestHints = {
  routing?: RouterMode;
  task?: string;
  priority?: RouterPriority;
  cost_quality_tradeoff?: number;
  sticky_session_id?: string;
  session_id?: string;
  min_quality?: number;
  min_context_tokens?: number;
  expected_input_tokens?: number;
  required_capabilities?: RouterModelCapability[];
  provider_order?: string[];
  provider_only?: string[];
  provider_ignore?: string[];
  provider_sort?: string | Record<string, unknown>;
  allow_fallbacks?: boolean;
  zdr?: boolean;
  data_collection?: "allow" | "deny";
  max_price?: Record<string, number>;
  caching?: "auto";
  provider_timeouts?: Record<string, unknown>;
  allowed_providers?: string[];
  blocked_providers?: string[];
  allowed_regions?: string[];
  blocked_regions?: string[];
  allow_chinese_providers?: boolean;
  allow_training?: boolean;
  allow_logging?: boolean;
  zero_data_retention_required?: boolean;
  byok_only?: boolean;
  max_input_usd_per_million_tokens?: number;
  max_output_usd_per_million_tokens?: number;
  include_gateway_metadata?: boolean;
  strict_openai_compatibility?: boolean;
  tenant?: string;
};

export type RoutePromptRequest = {
  model?: string;
  prompt?: string;
  messages?: ChatMessage[];
  stream?: boolean;
  tools?: unknown[];
  tool_choice?: unknown;
  response_format?: unknown;
  max_tokens?: number;
  max_completion_tokens?: number;
  metadata?: unknown;
  hints?: RouterHints;
  gateway?: OpenGatewayRequestHints;
  provider_options?: Record<string, unknown>;
  providerOptions?: Record<string, unknown>;
  provider?: unknown;
  plugins?: unknown;
  session_id?: string;
  [key: string]: unknown;
};

export type RouterRuntimeMetrics = {
  latencyMs?: number;
  successRate?: number;
  throughputTokensPerSecond?: number;
  recentFailureRate?: number;
};

export type RouterRuntimeOptions = {
  env?: Record<string, string | undefined>;
  credentialMode?: "ignore" | "skip-missing";
  metrics?: Record<string, RouterRuntimeMetrics>;
};

export type RouterCandidate = {
  model: RouterModelDescriptor;
  provider: RouterProviderDescriptor;
};

export type RouterProviderReference = Pick<
  RouterProviderDescriptor,
  "id" | "displayName" | "kind" | "regions" | "jurisdiction" | "dataPolicy" | "gateway"
>;

export type RouterModelReference = Pick<
  RouterModelDescriptor,
  | "id"
  | "providerId"
  | "providerModel"
  | "aliases"
  | "capabilities"
  | "contextWindow"
  | "inputUsdPerMillionTokens"
  | "outputUsdPerMillionTokens"
  | "qualityScore"
  | "averageLatencyMs"
  | "successRate"
  | "throughputTokensPerSecond"
  | "tags"
>;

export type RouterCandidateReference = {
  model: RouterModelReference;
  provider: RouterProviderReference;
};

export type PromptAnalysis = {
  primaryTask: RouterTaskType;
  taskTypes: RouterTaskType[];
  taskScores: Partial<Record<RouterTaskType, number>>;
  requiredCapabilities: RouterModelCapability[];
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  promptLengthChars: number;
  complexity: number;
  sourceHints: string[];
};

export type EffectiveRouterPolicy = {
  allowedProviders?: string[];
  blockedProviders?: string[];
  allowedRegions?: string[];
  blockedRegions?: string[];
  allowTraining: boolean;
  allowLogging: boolean;
  allowChineseProviders: boolean;
  zeroDataRetentionRequired: boolean;
  byokOnly: boolean;
  maxInputUsdPerMillionTokens?: number;
  maxOutputUsdPerMillionTokens?: number;
};

export type RouterSkipReason = {
  provider: string;
  model: string;
  providerModel: string;
  reason: string;
};

export type RouterScore = {
  provider: string;
  model: string;
  providerModel: string;
  score: number;
  reason: string;
  components: Record<string, number>;
};

export type RouterDecision = {
  status: "selected" | "no_route";
  requestedModel?: string;
  mode: RouterMode;
  selected?: RouterCandidateReference;
  selectedId?: string;
  orderedCandidates: RouterCandidateReference[];
  resolvedCandidates: string[];
  skipped: RouterSkipReason[];
  scores: RouterScore[];
  policy: EffectiveRouterPolicy;
  analysis: PromptAnalysis;
  reason: string;
  sourceHints: string[];
  safetyNotes: string[];
  gatewayHints?: Record<string, unknown>;
};

export type RoutePromptInput = {
  config: RouterConfig;
  request: RoutePromptRequest;
  candidates?: RouterCandidate[];
  runtime?: RouterRuntimeOptions;
};
