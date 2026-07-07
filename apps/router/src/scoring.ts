import { extractRouterHints } from "./analysis";
import { clamp01, hashString, inverseNormalize, normalize } from "./utils";
import type {
  PromptAnalysis,
  RoutePromptRequest,
  RouterCandidate,
  RouterMode,
  RouterRuntimeOptions,
  RouterScore,
} from "./types";

function candidateKey(candidate: RouterCandidate): string {
  return `${candidate.provider.id}:${candidate.model.id}`;
}

export function candidateHasConfiguredPrice(candidate: RouterCandidate): boolean {
  return candidate.model.inputUsdPerMillionTokens !== undefined && candidate.model.outputUsdPerMillionTokens !== undefined;
}

function estimatedRequestCost(candidate: RouterCandidate, analysis: PromptAnalysis): number | undefined {
  if (!candidateHasConfiguredPrice(candidate)) return undefined;
  return (
    (analysis.estimatedInputTokens / 1_000_000) * candidate.model.inputUsdPerMillionTokens! +
    (analysis.estimatedOutputTokens / 1_000_000) * candidate.model.outputUsdPerMillionTokens!
  );
}

function inferredQuality(candidate: RouterCandidate, analysis: PromptAnalysis): number {
  const taskQuality = candidate.model.taskQuality?.[analysis.primaryTask];
  if (taskQuality !== undefined) return taskQuality;
  if (candidate.model.qualityScore !== undefined) return candidate.model.qualityScore;
  let score = 0.42;
  if (candidate.model.capabilities.includes("reasoning")) score += 0.14;
  if (candidate.model.capabilities.includes("tools")) score += 0.08;
  if (candidate.model.capabilities.includes("json")) score += 0.05;
  if (candidate.model.capabilities.includes("vision")) score += 0.05;
  score += Math.min(candidate.model.contextWindow ?? 0, 1_000_000) / 1_000_000 * 0.08;
  return clamp01(score);
}

function taskFit(candidate: RouterCandidate, analysis: PromptAnalysis): number {
  let score = 0.45;
  for (const task of analysis.taskTypes) {
    score = Math.max(score, candidate.model.taskQuality?.[task] ?? 0);
  }
  if (analysis.taskTypes.includes("coding") && (candidate.model.tags ?? []).includes("coding")) score += 0.2;
  if (analysis.taskTypes.includes("reasoning") && candidate.model.capabilities.includes("reasoning")) score += 0.2;
  if (analysis.taskTypes.includes("tool-use") && candidate.model.capabilities.includes("tools")) score += 0.18;
  if (analysis.taskTypes.includes("json") && candidate.model.capabilities.includes("json")) score += 0.16;
  if (analysis.taskTypes.includes("vision") && candidate.model.capabilities.includes("vision")) score += 0.2;
  if (analysis.taskTypes.includes("long-context") && (candidate.model.contextWindow ?? 0) >= analysis.estimatedInputTokens) {
    score += 0.15;
  }
  if (candidate.model.aliases?.includes(analysis.primaryTask)) score += 0.08;
  return clamp01(score);
}

function stickyValue(candidate: RouterCandidate, request: RoutePromptRequest): number {
  const hints = extractRouterHints(request);
  const sessionId = hints.stickySessionId ?? hints.sessionId ?? request.session_id;
  if (!sessionId) return 0;
  return hashString(`${sessionId}:${candidate.model.id}`) / 0xffffffff;
}

function providerOrderScore(candidate: RouterCandidate, request: RoutePromptRequest): number | undefined {
  const order = extractRouterHints(request).providerOrder;
  if (!order?.length) return undefined;
  const index = order.indexOf(candidate.provider.id);
  if (index < 0) return 0;
  return 1 - index / Math.max(order.length, 1);
}

function fallbackOrderScore(index: number, total: number): number {
  if (total <= 1) return 1;
  return 1 - index / (total - 1);
}

function weightsForMode(
  mode: RouterMode,
  request: RoutePromptRequest,
): Record<"cost" | "quality" | "taskFit" | "latency" | "success" | "throughput" | "providerOrder" | "fallbackOrder", number> {
  const hints = extractRouterHints(request);
  if (mode === "lowest-latency") {
    return {
      cost: 0.08,
      quality: 0.1,
      taskFit: 0.08,
      latency: 0.52,
      success: 0.17,
      throughput: 0,
      providerOrder: 0.03,
      fallbackOrder: 0.02,
    };
  }
  if (mode === "highest-throughput") {
    return {
      cost: 0.08,
      quality: 0.1,
      taskFit: 0.08,
      latency: 0.08,
      success: 0.2,
      throughput: 0.42,
      providerOrder: 0.02,
      fallbackOrder: 0.02,
    };
  }
  const priority = hints.priority ?? "balanced";
  if (priority === "cost") {
    return {
      cost: 0.48,
      quality: 0.12,
      taskFit: 0.13,
      latency: 0.1,
      success: 0.12,
      throughput: 0,
      providerOrder: 0.02,
      fallbackOrder: 0.03,
    };
  }
  if (priority === "quality") {
    return {
      cost: 0.08,
      quality: 0.36,
      taskFit: 0.28,
      latency: 0.08,
      success: 0.15,
      throughput: 0,
      providerOrder: 0.02,
      fallbackOrder: 0.03,
    };
  }
  if (priority === "latency") {
    return {
      cost: 0.08,
      quality: 0.15,
      taskFit: 0.12,
      latency: 0.42,
      success: 0.18,
      throughput: 0,
      providerOrder: 0.02,
      fallbackOrder: 0.03,
    };
  }

  const tradeoff = clamp01((hints.costQualityTradeoff ?? 5) / 10);
  return {
    cost: 0.18 + tradeoff * 0.22,
    quality: 0.3 - tradeoff * 0.12,
    taskFit: 0.22 - tradeoff * 0.06,
    latency: 0.11,
    success: 0.13,
    throughput: 0,
    providerOrder: 0.03,
    fallbackOrder: 0.03,
  };
}

function metricFor(candidate: RouterCandidate, runtime: RouterRuntimeOptions | undefined) {
  return runtime?.metrics?.[candidateKey(candidate)] ?? runtime?.metrics?.[candidate.model.id] ?? runtime?.metrics?.[candidate.provider.id];
}

export function scoreCandidates(
  candidates: RouterCandidate[],
  mode: RouterMode,
  request: RoutePromptRequest,
  analysis: PromptAnalysis,
  runtime?: RouterRuntimeOptions,
): RouterScore[] {
  const costs = candidates.map((candidate) => estimatedRequestCost(candidate, analysis));
  const latencies = candidates.map((candidate) => metricFor(candidate, runtime)?.latencyMs ?? candidate.model.averageLatencyMs);
  const throughputs = candidates.map(
    (candidate) => metricFor(candidate, runtime)?.throughputTokensPerSecond ?? candidate.model.throughputTokensPerSecond,
  );
  const weights = weightsForMode(mode, request);

  return candidates.map((candidate, index) => {
    const metrics = metricFor(candidate, runtime);
    const latencyMs = metrics?.latencyMs ?? candidate.model.averageLatencyMs;
    const successRate = metrics?.successRate ?? candidate.model.successRate;
    const throughput = metrics?.throughputTokensPerSecond ?? candidate.model.throughputTokensPerSecond;
    const components = {
      cost: inverseNormalize(estimatedRequestCost(candidate, analysis), costs, 0.35),
      quality: inferredQuality(candidate, analysis),
      taskFit: taskFit(candidate, analysis),
      latency: inverseNormalize(latencyMs, latencies, 0.5),
      success: clamp01((successRate ?? 0.5) * (1 - (metrics?.recentFailureRate ?? 0))),
      throughput: normalize(throughput, throughputs, 0.5),
      providerOrder: providerOrderScore(candidate, request) ?? 0.5,
      fallbackOrder: fallbackOrderScore(index, candidates.length),
      sticky: stickyValue(candidate, request),
    };
    const score =
      components.cost * weights.cost +
      components.quality * weights.quality +
      components.taskFit * weights.taskFit +
      components.latency * weights.latency +
      components.success * weights.success +
      components.throughput * weights.throughput +
      components.providerOrder * weights.providerOrder +
      components.fallbackOrder * weights.fallbackOrder;
    const reason =
      mode === "lowest-latency"
        ? "highest latency-weighted score among eligible candidates"
        : mode === "highest-throughput"
          ? "highest throughput and success weighted score among eligible candidates"
          : "highest cost, quality, task-fit, latency, and success weighted score among eligible candidates";

    return {
      provider: candidate.provider.id,
      model: candidate.model.id,
      providerModel: candidate.model.providerModel,
      score,
      reason,
      components,
    };
  });
}

function scoreFor(candidate: RouterCandidate, scores: RouterScore[]): RouterScore | undefined {
  return scores.find((score) => score.model === candidate.model.id && score.provider === candidate.provider.id);
}

export function sortCandidatesByMode(
  candidates: RouterCandidate[],
  mode: RouterMode,
  request: RoutePromptRequest,
  scores: RouterScore[],
): RouterCandidate[] {
  const indexes = new Map(candidates.map((candidate, index) => [candidateKey(candidate), index]));
  const byOriginalOrder = (a: RouterCandidate, b: RouterCandidate): number =>
    (indexes.get(candidateKey(a)) ?? 0) - (indexes.get(candidateKey(b)) ?? 0);

  if (mode === "fallback" || mode === "explicit") {
    const order = extractRouterHints(request).providerOrder;
    if (!order?.length) return candidates;
    return [...candidates].sort((a, b) => {
      const aIndex = order.indexOf(a.provider.id);
      const bIndex = order.indexOf(b.provider.id);
      const aRank = aIndex < 0 ? Number.POSITIVE_INFINITY : aIndex;
      const bRank = bIndex < 0 ? Number.POSITIVE_INFINITY : bIndex;
      return aRank - bRank || byOriginalOrder(a, b);
    });
  }

  if (mode === "cheapest") {
    return [...candidates].sort((a, b) => {
      const aCost = candidateHasConfiguredPrice(a) ? a.model.inputUsdPerMillionTokens! + a.model.outputUsdPerMillionTokens! : Infinity;
      const bCost = candidateHasConfiguredPrice(b) ? b.model.inputUsdPerMillionTokens! + b.model.outputUsdPerMillionTokens! : Infinity;
      return aCost - bCost || byOriginalOrder(a, b);
    });
  }

  return [...candidates].sort((a, b) => {
    const aScore = scoreFor(a, scores);
    const bScore = scoreFor(b, scores);
    return (
      (bScore?.score ?? 0) - (aScore?.score ?? 0) ||
      (bScore?.components.sticky ?? 0) - (aScore?.components.sticky ?? 0) ||
      byOriginalOrder(a, b)
    );
  });
}
