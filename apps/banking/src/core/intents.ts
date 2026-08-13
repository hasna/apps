import type { Money } from "./money.ts";
import type { ProviderId } from "./providers.ts";

export type ActorType = "agent" | "human" | "service";
export type IntentStatus = "draft" | "policy_required" | "approval_required" | "approved" | "submitted" | "succeeded" | "failed" | "indeterminate" | "cancelled";
export type PaymentRail = "ach" | "wire" | "check" | "sepa" | "instant" | "internal" | "card";
export type CardIntentKind = "request_virtual" | "update" | "freeze" | "unfreeze" | "terminate";

export interface ActorRef {
  readonly id: string;
  readonly type: ActorType;
  readonly displayName?: string;
}

export interface IntentMetadata {
  readonly reason: string;
  readonly correlationId?: string;
  readonly tags?: readonly string[];
}

export interface CounterpartyRef {
  readonly id?: string;
  readonly name: string;
  readonly iban?: string;
  readonly routingNumber?: string;
  readonly accountNumberLast4?: string;
  readonly providerRecipientId?: string;
}

export interface BaseIntent {
  readonly id: string;
  readonly providerId: ProviderId;
  readonly requester: ActorRef;
  readonly idempotencyKey: string;
  readonly status: IntentStatus;
  readonly createdAt: string;
  readonly metadata: IntentMetadata;
}

export interface PaymentQuoteIntent extends BaseIntent {
  readonly type: "payment.quote";
  readonly sourceAccountId: string;
  readonly counterparty: CounterpartyRef;
  readonly amount: Money;
  readonly rail: PaymentRail;
}

export interface PaymentRequestIntent extends BaseIntent {
  readonly type: "payment.request";
  readonly quoteId?: string;
  readonly sourceAccountId: string;
  readonly counterparty: CounterpartyRef;
  readonly amount: Money;
  readonly rail: PaymentRail;
  readonly approvalId?: string;
}

export interface PaymentStatusIntent extends BaseIntent {
  readonly type: "payment.status";
  readonly paymentRequestId: string;
  readonly providerPaymentId?: string;
}

export interface CardSpendingControls {
  readonly single?: Money;
  readonly day?: Money;
  readonly week?: Money;
  readonly month?: Money;
  readonly lifetime?: Money;
  readonly allowedMerchantCategories?: readonly string[];
  readonly blockedMerchantCategories?: readonly string[];
}

export interface CardRequestIntent extends BaseIntent {
  readonly type: "card.request";
  readonly kind: "request_virtual";
  readonly accountId: string;
  readonly label: string;
  readonly contactIds?: readonly string[];
  readonly holderId?: string;
  readonly spendingControls?: CardSpendingControls;
  readonly approvalId?: string;
}

export interface CardUpdateIntent extends BaseIntent {
  readonly type: "card.update";
  readonly kind: "update";
  readonly cardId: string;
  readonly label?: string;
  readonly accountIds?: readonly string[];
  readonly contactIds?: readonly string[];
  readonly spendingControls?: CardSpendingControls | null;
  readonly approvalId?: string;
}

export interface CardLifecycleIntent extends BaseIntent {
  readonly type: "card.lifecycle";
  readonly kind: Exclude<CardIntentKind, "request_virtual" | "update">;
  readonly cardId: string;
  readonly approvalId?: string;
}

export type BankingIntent =
  | PaymentQuoteIntent
  | PaymentRequestIntent
  | PaymentStatusIntent
  | CardRequestIntent
  | CardUpdateIntent
  | CardLifecycleIntent;

export function isProviderSideEffect(intent: BankingIntent): boolean {
  return intent.type === "payment.request" || intent.type === "card.request" || intent.type === "card.update" || intent.type === "card.lifecycle";
}

export function isCardIntent(intent: BankingIntent): boolean {
  return intent.type === "card.request" || intent.type === "card.update" || intent.type === "card.lifecycle";
}

export function canonicalIntentPayload(intent: BankingIntent): Readonly<Record<string, unknown>> {
  const { approvalId: _approvalId, status: _status, ...payload } = intent as unknown as Record<string, unknown>;
  return payload;
}
