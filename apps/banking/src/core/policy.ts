import type { BankingIntent } from "./intents.ts";
import { isCardIntent, isProviderSideEffect } from "./intents.ts";
import { compareMoney, isPositiveMoney, moneyFromMinor, type Money } from "./money.ts";
import type { ProviderCapabilityCard, ProviderCardOperation, ProviderEnvironment } from "./providers.ts";
import { isProviderCardOperationVerified } from "./providers.ts";

export type PolicyDecisionKind = "allow" | "requires_approval" | "deny";

export interface BankingPolicy {
  readonly liveMode: boolean;
  readonly environment: ProviderEnvironment;
  readonly requireApprovalForProviderSideEffects: boolean;
  readonly maxPaymentWithoutApproval?: Money;
  readonly allowedProviderIds?: readonly string[];
  readonly blockedProviderIds?: readonly string[];
  readonly allowSensitiveCardData: boolean;
}

export interface PolicyDecision {
  readonly kind: PolicyDecisionKind;
  readonly reasons: readonly string[];
  readonly snapshot: PolicySnapshot;
}

export interface PolicySnapshot {
  readonly evaluatedAt: string;
  readonly providerId: string;
  readonly intentType: string;
  readonly liveMode: boolean;
  readonly environment: ProviderEnvironment;
  readonly requireApprovalForProviderSideEffects: boolean;
  readonly ruleHash: string;
}

export const DEFAULT_BANKING_POLICY: BankingPolicy = {
  liveMode: false,
  environment: "sandbox",
  requireApprovalForProviderSideEffects: true,
  allowSensitiveCardData: false,
};

export function evaluateIntentPolicy(
  intent: BankingIntent,
  provider: ProviderCapabilityCard,
  policy: BankingPolicy = DEFAULT_BANKING_POLICY,
  now = new Date(),
): PolicyDecision {
  const denials: string[] = [];
  const approvalReasons: string[] = [];

  if (provider.id !== intent.providerId) {
    denials.push("Intent provider does not match capability card.");
  }
  if (policy.allowedProviderIds && !policy.allowedProviderIds.includes(provider.id)) {
    denials.push("Provider is not on the allowlist.");
  }
  if (policy.blockedProviderIds?.includes(provider.id)) {
    denials.push("Provider is blocked by policy.");
  }
  if (intent.type.startsWith("payment") && !provider.capabilities.payments) {
    denials.push("Provider does not support payments.");
  }
  if (isCardIntent(intent) && !provider.capabilities.cards) {
    denials.push("Provider does not support direct card control.");
  }
  const cardOperation = cardOperationForIntent(intent);
  if (cardOperation) {
    const operationSupport = provider.cardOperations[cardOperation];
    if (operationSupport === "unsupported") {
      denials.push(`Provider does not support card operation ${cardOperation}.`);
    }
    if (operationSupport === "documented_unverified" || !isProviderCardOperationVerified(provider, cardOperation)) {
      denials.push("Provider card operation is documented but not verified for execution.");
    }
    if (provider.cardOperations.productionOnly && policy.environment !== "production") {
      denials.push("Provider card operation is production-only and cannot execute in sandbox policy context.");
    }
  }

  denials.push(...validatePositiveSideEffectMoney(intent));

  if (policy.requireApprovalForProviderSideEffects && isProviderSideEffect(intent)) {
    approvalReasons.push("Provider side effects require approval.");
  }

  if (intent.type === "payment.request" && policy.maxPaymentWithoutApproval) {
    if (compareMoney(intent.amount, policy.maxPaymentWithoutApproval) === 1) {
      approvalReasons.push("Payment exceeds no-approval limit.");
    }
  }

  const snapshot: PolicySnapshot = {
    evaluatedAt: now.toISOString(),
    providerId: provider.id,
    intentType: intent.type,
    liveMode: policy.liveMode,
    environment: policy.environment,
    requireApprovalForProviderSideEffects: policy.requireApprovalForProviderSideEffects,
    ruleHash: createPolicyRuleHash(policy),
  };

  if (denials.length > 0) {
    return { kind: "deny", reasons: denials, snapshot };
  }
  if (approvalReasons.length > 0) {
    return { kind: "requires_approval", reasons: approvalReasons, snapshot };
  }
  return { kind: "allow", reasons: ["Policy allowed the intent."], snapshot };
}

export function createPolicyRuleHash(policy: BankingPolicy): string {
  const maxPayment = policy.maxPaymentWithoutApproval ?? moneyFromMinor(0, "USD");
  return [
    policy.liveMode ? "live" : "dry",
    policy.environment,
    policy.requireApprovalForProviderSideEffects ? "approval" : "direct",
    policy.allowSensitiveCardData ? "sensitive" : "redacted",
    maxPayment.currency,
    maxPayment.amountMinor,
    policy.allowedProviderIds?.join(",") ?? "*",
    policy.blockedProviderIds?.join(",") ?? "",
  ].join(":");
}

function cardOperationForIntent(intent: BankingIntent): ProviderCardOperation | undefined {
  if (intent.type === "card.request") return "createVirtual";
  if (intent.type === "card.update") return "updateSettings";
  if (intent.type === "card.lifecycle") return intent.kind;
  return undefined;
}

function validatePositiveSideEffectMoney(intent: BankingIntent): string[] {
  const denials: string[] = [];
  if ((intent.type === "payment.quote" || intent.type === "payment.request") && !isPositiveMoney(intent.amount)) {
    denials.push("Payment amount must be positive.");
  }
  if (intent.type === "card.request" || intent.type === "card.update") {
    const controls = intent.spendingControls;
    if (!controls) return denials;
    for (const [name, value] of Object.entries(controls)) {
      if (isMoneyLike(value) && !isPositiveMoney(value)) {
        denials.push(`Card spending control ${name} must be positive.`);
      }
    }
  }
  return denials;
}

function isMoneyLike(value: unknown): value is Money {
  return Boolean(
    value &&
      typeof value === "object" &&
      "currency" in value &&
      "amountMinor" in value &&
      "scale" in value,
  );
}
