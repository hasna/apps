import type { RouterDecision, RouterScore } from "./types";

export type OpenGatewayRouteAttemptCompat = {
  provider: string;
  model: string;
  providerModel: string;
  status: "selected" | "failed" | "skipped";
  reason?: string;
};

export type OpenGatewayRouteScoreCompat = {
  provider: string;
  model: string;
  providerModel: string;
  score: number;
  reason: string;
  components: Record<string, number>;
};

export type OpenGatewayRouteDecisionCompat = {
  requested_model: string;
  resolved_candidates: string[];
  selected?: string;
  mode: RouterDecision["mode"];
  policy: {
    allowed_providers?: string[];
    blocked_providers?: string[];
    allowed_regions?: string[];
    blocked_regions?: string[];
    allow_training?: boolean;
    allow_logging?: boolean;
    allow_chinese_providers?: boolean;
    zero_data_retention_required?: boolean;
    byok_only?: boolean;
  };
  reason: string;
  attempts: OpenGatewayRouteAttemptCompat[];
  scores?: OpenGatewayRouteScoreCompat[];
};

function toOpenGatewayScore(score: RouterScore): OpenGatewayRouteScoreCompat {
  return {
    provider: score.provider,
    model: score.model,
    providerModel: score.providerModel,
    score: score.score,
    reason: score.reason,
    components: score.components,
  };
}

export function toOpenGatewayRouteDecision(decision: RouterDecision): OpenGatewayRouteDecisionCompat {
  return {
    requested_model: decision.requestedModel ?? "auto",
    resolved_candidates: decision.resolvedCandidates,
    ...(decision.selectedId === undefined ? {} : { selected: decision.selectedId }),
    mode: decision.mode,
    policy: {
      ...(decision.policy.allowedProviders ? { allowed_providers: decision.policy.allowedProviders } : {}),
      ...(decision.policy.blockedProviders ? { blocked_providers: decision.policy.blockedProviders } : {}),
      ...(decision.policy.allowedRegions ? { allowed_regions: decision.policy.allowedRegions } : {}),
      ...(decision.policy.blockedRegions ? { blocked_regions: decision.policy.blockedRegions } : {}),
      allow_training: decision.policy.allowTraining,
      allow_logging: decision.policy.allowLogging,
      allow_chinese_providers: decision.policy.allowChineseProviders,
      zero_data_retention_required: decision.policy.zeroDataRetentionRequired,
      byok_only: decision.policy.byokOnly,
    },
    reason: decision.reason,
    attempts: decision.skipped.map((skip) => ({
      provider: skip.provider,
      model: skip.model,
      providerModel: skip.providerModel,
      status: "skipped",
      reason: skip.reason,
    })),
    ...(decision.scores.length ? { scores: decision.scores.map(toOpenGatewayScore) } : {}),
  };
}
