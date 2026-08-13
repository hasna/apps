import { createIdempotencyFingerprint, createIntentFingerprint, hashPayload, type IdempotencyFingerprint } from "./idempotency.ts";
import type {
  ActorRef,
  BankingIntent,
  CardLifecycleIntent,
  CardRequestIntent,
  CardSpendingControls,
  CardUpdateIntent,
  CounterpartyRef,
  IntentMetadata,
  PaymentQuoteIntent,
  PaymentRail,
  PaymentRequestIntent,
  PaymentStatusIntent,
} from "./intents.ts";
import { moneyFromDecimal, type CurrencyCode, type Money } from "./money.ts";
import { DEFAULT_BANKING_POLICY, evaluateIntentPolicy, type BankingPolicy, type PolicyDecision } from "./policy.ts";
import type { ProviderCapabilityCard, ProviderId } from "./providers.ts";

export interface IntentBuilderBaseInput {
  readonly providerId: ProviderId;
  readonly requester: ActorRef;
  readonly reason: string;
  readonly correlationId?: string;
  readonly tags?: readonly string[];
  readonly id?: string;
  readonly idempotencyKey?: string;
  readonly now?: Date;
}

export interface PaymentIntentBuilderInput extends IntentBuilderBaseInput {
  readonly sourceAccountId: string;
  readonly counterparty: CounterpartyRef;
  readonly amount: Money;
  readonly rail: PaymentRail;
  readonly quoteId?: string;
}

export interface PaymentStatusBuilderInput extends IntentBuilderBaseInput {
  readonly paymentRequestId: string;
  readonly providerPaymentId?: string;
}

export interface CardRequestBuilderInput extends IntentBuilderBaseInput {
  readonly accountId: string;
  readonly label: string;
  readonly contactIds?: readonly string[];
  readonly holderId?: string;
  readonly spendingControls?: CardSpendingControls;
}

export interface CardUpdateBuilderInput extends IntentBuilderBaseInput {
  readonly cardId: string;
  readonly label?: string;
  readonly accountIds?: readonly string[];
  readonly contactIds?: readonly string[];
  readonly spendingControls?: CardSpendingControls | null;
}

export interface CardLifecycleBuilderInput extends IntentBuilderBaseInput {
  readonly cardId: string;
  readonly kind: CardLifecycleIntent["kind"];
}

export interface IntentEnvelope<TIntent extends BankingIntent = BankingIntent> {
  readonly intent: TIntent;
  readonly fingerprint: IdempotencyFingerprint;
  readonly policyDecision: PolicyDecision;
}

export function moneyInput(amount: string, currency: CurrencyCode): Money {
  return moneyFromDecimal(amount, currency);
}

export function createPaymentQuoteIntent(input: PaymentIntentBuilderInput): PaymentQuoteIntent {
  return {
    ...baseIntent("payment.quote", input, paymentPayload(input)),
    type: "payment.quote",
    sourceAccountId: input.sourceAccountId,
    counterparty: input.counterparty,
    amount: input.amount,
    rail: input.rail,
  };
}

export function createPaymentRequestIntent(input: PaymentIntentBuilderInput): PaymentRequestIntent {
  const quote = optional("quoteId", input.quoteId);
  return {
    ...baseIntent("payment.request", input, { ...paymentPayload(input), ...quote }),
    type: "payment.request",
    ...quote,
    sourceAccountId: input.sourceAccountId,
    counterparty: input.counterparty,
    amount: input.amount,
    rail: input.rail,
  };
}

export function createPaymentStatusIntent(input: PaymentStatusBuilderInput): PaymentStatusIntent {
  const providerPayment = optional("providerPaymentId", input.providerPaymentId);
  return {
    ...baseIntent("payment.status", input, {
      paymentRequestId: input.paymentRequestId,
      ...providerPayment,
    }),
    type: "payment.status",
    paymentRequestId: input.paymentRequestId,
    ...providerPayment,
  };
}

export function createCardRequestIntent(input: CardRequestBuilderInput): CardRequestIntent {
  const optionals = {
    ...optional("contactIds", input.contactIds),
    ...optional("holderId", input.holderId),
    ...optional("spendingControls", input.spendingControls),
  };
  return {
    ...baseIntent("card.request", input, {
      accountId: input.accountId,
      label: input.label,
      ...optionals,
    }),
    type: "card.request",
    kind: "request_virtual",
    accountId: input.accountId,
    label: input.label,
    ...optionals,
  };
}

export function createCardUpdateIntent(input: CardUpdateBuilderInput): CardUpdateIntent {
  const optionals = {
    ...optional("label", input.label),
    ...optional("accountIds", input.accountIds),
    ...optional("contactIds", input.contactIds),
    ...optional("spendingControls", input.spendingControls),
  };
  return {
    ...baseIntent("card.update", input, {
      cardId: input.cardId,
      ...optionals,
    }),
    type: "card.update",
    kind: "update",
    cardId: input.cardId,
    ...optionals,
  };
}

export function createCardLifecycleIntent(input: CardLifecycleBuilderInput): CardLifecycleIntent {
  return {
    ...baseIntent("card.lifecycle", input, {
      cardId: input.cardId,
      kind: input.kind,
    }),
    type: "card.lifecycle",
    kind: input.kind,
    cardId: input.cardId,
  };
}

export function createIntentEnvelope<TIntent extends BankingIntent>(
  intent: TIntent,
  provider: ProviderCapabilityCard,
  policy: BankingPolicy = DEFAULT_BANKING_POLICY,
): IntentEnvelope<TIntent> {
  return {
    intent,
    fingerprint: createIntentFingerprint(intent),
    policyDecision: evaluateIntentPolicy(intent, provider, policy),
  };
}

function baseIntent(type: BankingIntent["type"], input: IntentBuilderBaseInput, payload: Readonly<Record<string, unknown>>) {
  const metadata: IntentMetadata = {
    reason: input.reason,
    ...optional("correlationId", input.correlationId),
    ...optional("tags", input.tags),
  };
  const seed = { type, providerId: input.providerId, requester: input.requester, metadata, payload };
  const id = input.id ?? `intent_${hashPayload(seed).slice(0, 20)}`;
  return {
    id,
    providerId: input.providerId,
    requester: input.requester,
    idempotencyKey: input.idempotencyKey ?? createIdempotencyFingerprint(type, seed).key,
    status: "draft" as const,
    createdAt: (input.now ?? new Date()).toISOString(),
    metadata,
  };
}

function paymentPayload(input: PaymentIntentBuilderInput): Readonly<Record<string, unknown>> {
  return {
    sourceAccountId: input.sourceAccountId,
    counterparty: input.counterparty,
    amount: input.amount,
    rail: input.rail,
  };
}

function optional<TKey extends string, TValue>(key: TKey, value: TValue | undefined): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : { [key]: value } as Partial<Record<TKey, TValue>>;
}
