import { analyzePrompt, extractRouterHints } from "./analysis";
import { gatewayHintsForProvider } from "./gateways";
import { candidateSkipReason, mergePolicy, skipped } from "./policy";
import { candidateHasConfiguredPrice, scoreCandidates, sortCandidatesByMode } from "./scoring";
import { unique } from "./utils";
import type {
  RoutePromptInput,
  RoutePromptRequest,
  RouterCandidate,
  RouterCandidateReference,
  RouterConfig,
  RouterDecision,
  RouterMode,
  RouterModelDescriptor,
  RouterProviderDescriptor,
  RouterRouteConfig,
} from "./types";

function providerMap(config: RouterConfig): Map<string, RouterProviderDescriptor> {
  return new Map(config.providers.map((provider) => [provider.id, provider]));
}

function modelMap(config: RouterConfig): Map<string, RouterModelDescriptor> {
  return new Map(config.models.map((model) => [model.id, model]));
}

function routeForRequest(config: RouterConfig, model: string | undefined): RouterRouteConfig | undefined {
  if (!model) return config.routes.find((route) => route.id === "auto" || (route.modelAliases ?? []).includes("auto"));
  return config.routes.find((route) => route.id === model || (route.modelAliases ?? []).includes(model));
}

function dynamicCandidate(config: RouterConfig, id: string): RouterCandidate | undefined {
  const slash = id.indexOf("/");
  if (slash <= 0) return undefined;
  const providerId = id.slice(0, slash);
  const providerModel = id.slice(slash + 1);
  const provider = providerMap(config).get(providerId);
  if (!provider) return undefined;
  return {
    provider,
    model: {
      id,
      providerId,
      providerModel,
      aliases: [],
      capabilities: ["chat", "streaming"],
    },
  };
}

function candidatesFromModelIds(
  config: RouterConfig,
  modelIds: string[] | undefined,
): RouterCandidate[] {
  if (!modelIds?.length) return [];
  const providers = providerMap(config);
  const models = modelMap(config);
  return modelIds
    .map((id) => models.get(id) ?? dynamicCandidate(config, id)?.model)
    .filter((model): model is RouterModelDescriptor => Boolean(model))
    .map((model) => ({ model, provider: providers.get(model.providerId) }))
    .filter((candidate): candidate is RouterCandidate => Boolean(candidate.provider));
}

export function resolveCandidates(config: RouterConfig, request: RoutePromptRequest): RouterCandidate[] {
  const requestedModel = request.model;
  const providers = providerMap(config);
  const models = modelMap(config);
  const route = routeForRequest(config, requestedModel);

  if (requestedModel) {
    const explicit = models.get(requestedModel);
    if (explicit) {
      const provider = providers.get(explicit.providerId);
      return provider ? [{ model: explicit, provider }] : [];
    }

    const dynamic = dynamicCandidate(config, requestedModel);
    if (dynamic) return [dynamic];
  }

  if (route?.fallbackModelIds?.length) return candidatesFromModelIds(config, route.fallbackModelIds);

  if (!requestedModel) {
    return config.models
      .map((model) => ({ model, provider: providers.get(model.providerId) }))
      .filter((candidate): candidate is RouterCandidate => Boolean(candidate.provider));
  }

  return config.models
    .filter((model) => (model.aliases ?? []).includes(requestedModel))
    .map((model) => ({ model, provider: providers.get(model.providerId) }))
    .filter((candidate): candidate is RouterCandidate => Boolean(candidate.provider));
}

function routeMode(route: RouterRouteConfig | undefined, request: RoutePromptRequest): RouterMode {
  const routing = request.gateway?.task === "explicit" ? "explicit" : undefined;
  return request.gateway?.routing ?? routing ?? route?.mode ?? "smart";
}

function safetyNotes(input: RoutePromptInput): string[] {
  const notes = ["Policy filters were applied before scoring; skipped candidates were not scored for selection."];
  if (input.runtime?.credentialMode !== "skip-missing") {
    notes.push("Provider credential env checks were not applied; callers that execute requests must still enforce credentials.");
  }
  if (input.config.policy.allowRequestPolicyExpansion !== true) {
    notes.push("Request policy can only restrict configured policy; it cannot expand provider, region, or data permissions.");
  }
  return notes;
}

function selectionReason(mode: RouterMode, hasScores: boolean, providerOrder: boolean): string {
  if (mode === "cheapest") return "lowest configured token price among eligible candidates";
  if (mode === "fallback" || mode === "explicit") {
    return providerOrder ? "first eligible candidate after provider_order hint" : "first eligible candidate in configured order";
  }
  return hasScores ? "highest score among eligible candidates" : "first eligible candidate";
}

function redactCandidate(candidate: RouterCandidate): RouterCandidateReference {
  const { model, provider } = candidate;
  return {
    model: {
      id: model.id,
      providerId: model.providerId,
      providerModel: model.providerModel,
      ...(model.aliases === undefined ? {} : { aliases: model.aliases }),
      capabilities: model.capabilities,
      ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
      ...(model.inputUsdPerMillionTokens === undefined
        ? {}
        : { inputUsdPerMillionTokens: model.inputUsdPerMillionTokens }),
      ...(model.outputUsdPerMillionTokens === undefined
        ? {}
        : { outputUsdPerMillionTokens: model.outputUsdPerMillionTokens }),
      ...(model.qualityScore === undefined ? {} : { qualityScore: model.qualityScore }),
      ...(model.averageLatencyMs === undefined ? {} : { averageLatencyMs: model.averageLatencyMs }),
      ...(model.successRate === undefined ? {} : { successRate: model.successRate }),
      ...(model.throughputTokensPerSecond === undefined
        ? {}
        : { throughputTokensPerSecond: model.throughputTokensPerSecond }),
      ...(model.tags === undefined ? {} : { tags: model.tags }),
    },
    provider: {
      id: provider.id,
      displayName: provider.displayName,
      kind: provider.kind,
      ...(provider.regions === undefined ? {} : { regions: provider.regions }),
      ...(provider.jurisdiction === undefined ? {} : { jurisdiction: provider.jurisdiction }),
      ...(provider.dataPolicy === undefined ? {} : { dataPolicy: provider.dataPolicy }),
      ...(provider.gateway === undefined ? {} : { gateway: provider.gateway }),
    },
  };
}

export function routePrompt(input: RoutePromptInput): RouterDecision {
  const route = routeForRequest(input.config, input.request.model);
  const mode = routeMode(route, input.request);
  const analysis = analyzePrompt(input.request);
  const policy = mergePolicy(input.config, route, input.request);
  const resolved = input.candidates ?? resolveCandidates(input.config, input.request);
  const skippedCandidates = [];
  const eligible = [];

  for (const candidate of resolved) {
    const reason = candidateSkipReason(candidate, input.request, policy, analysis, input.runtime);
    if (reason) skippedCandidates.push(skipped(candidate, reason));
    else eligible.push(candidate);
  }

  const scores = scoreCandidates(eligible, mode, input.request, analysis, input.runtime);
  const ordered = sortCandidatesByMode(eligible, mode, input.request, scores);
  const sourceHints = unique([...analysis.sourceHints]);

  if (mode === "cheapest" && ordered.length > 0 && !ordered.some(candidateHasConfiguredPrice)) {
    return {
      status: "no_route",
      ...(input.request.model === undefined ? {} : { requestedModel: input.request.model }),
      mode,
      orderedCandidates: [],
      resolvedCandidates: unique(resolved.map((candidate) => candidate.model.id)),
      skipped: skippedCandidates,
      scores: scores.sort((a, b) => b.score - a.score),
      policy,
      analysis,
      reason: "no eligible candidate has configured token price for cheapest routing",
      sourceHints,
      safetyNotes: safetyNotes(input),
    };
  }

  const selected = ordered[0];
  if (!selected) {
    return {
      status: "no_route",
      ...(input.request.model === undefined ? {} : { requestedModel: input.request.model }),
      mode,
      orderedCandidates: [],
      resolvedCandidates: unique(resolved.map((candidate) => candidate.model.id)),
      skipped: skippedCandidates,
      scores,
      policy,
      analysis,
      reason: "no eligible candidate after policy filtering",
      sourceHints,
      safetyNotes: safetyNotes(input),
    };
  }

  const hints = extractRouterHints(input.request);
  const gatewayHints = gatewayHintsForProvider(selected.provider, input.request, policy);
  return {
    status: "selected",
    ...(input.request.model === undefined ? {} : { requestedModel: input.request.model }),
    mode,
    selected: redactCandidate(selected),
    selectedId: selected.model.id,
    orderedCandidates: ordered.map(redactCandidate),
    resolvedCandidates: unique(resolved.map((candidate) => candidate.model.id)),
    skipped: skippedCandidates,
    scores: scores.sort((a, b) => b.score - a.score),
    policy,
    analysis,
    reason: selectionReason(mode, scores.length > 0, Boolean(hints.providerOrder?.length)),
    sourceHints,
    safetyNotes: safetyNotes(input),
    ...(gatewayHints === undefined ? {} : { gatewayHints }),
  };
}
