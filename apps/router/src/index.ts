export { analyzePrompt, estimateInputTokens, estimateOutputTokens, extractRouterHints, requestText } from "./analysis";
export { loadRouterConfig, normalizeRouterConfig, validateRouterConfig } from "./config";
export {
  buildOpenRouterGatewayHints,
  buildVercelGatewayHints,
  gatewayDescriptors,
  gatewayHintsForProvider,
} from "./gateways";
export { candidateSkipReason, isChinaProvider, mergePolicy } from "./policy";
export { toOpenGatewayRouteDecision } from "./open-gateway";
export { candidateHasConfiguredPrice, scoreCandidates, sortCandidatesByMode } from "./scoring";
export { createRouterHandler, startRouterServer, startRouterServerFromConfig } from "./server";
export { resolveCandidates, routePrompt } from "./router";
export { routerVersion } from "./version";
export type {
  ChatMessage,
  ChatRole,
  EffectiveRouterPolicy,
  OpenGatewayRequestHints,
  PromptAnalysis,
  RoutePromptInput,
  RoutePromptRequest,
  RouterCandidate,
  RouterCandidateReference,
  RouterConfig,
  RouterConfigInput,
  RouterConfigValidationResult,
  RouterDataPolicy,
  RouterDecision,
  RouterGatewayCompatibility,
  RouterGatewayKind,
  RouterHints,
  RouterMode,
  RouterModelReference,
  RouterModelCapability,
  RouterModelDescriptor,
  RouterPriority,
  RouterProviderAuthConfig,
  RouterProviderDescriptor,
  RouterProviderHeaderValue,
  RouterProviderKind,
  RouterProviderReference,
  RouterRouteConfig,
  RouterRuntimeMetrics,
  RouterRuntimeOptions,
  RouterScore,
  RouterSkipReason,
  RouterTaskType,
} from "./types";
export type {
  OpenGatewayRouteAttemptCompat,
  OpenGatewayRouteDecisionCompat,
  OpenGatewayRouteScoreCompat,
} from "./open-gateway";
