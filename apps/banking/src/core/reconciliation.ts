import type { Money } from "./money.ts";
import type { ProviderId } from "./providers.ts";
import { hashPayload } from "./idempotency.ts";

export type ProviderEventKind = "payment" | "card_authorization" | "card_lifecycle" | "balance" | "transaction";
export type ReconciliationStatus = "pending" | "matched" | "mismatch" | "indeterminate";

export interface ProviderEvent {
  readonly id: string;
  readonly providerId: ProviderId;
  readonly kind: ProviderEventKind;
  readonly providerObjectId: string;
  readonly occurredAt: string;
  readonly amount?: Money;
  readonly rawHash: string;
}

export interface ProviderWebhookInput {
  readonly id: string;
  readonly providerId: ProviderId;
  readonly kind: ProviderEventKind;
  readonly providerObjectId: string;
  readonly occurredAt: string;
  readonly amount?: Money;
  readonly rawPayload: unknown;
}

export interface ReconciliationRecord {
  readonly id: string;
  readonly intentId?: string;
  readonly providerEventId: string;
  readonly status: ReconciliationStatus;
  readonly reasons: readonly string[];
  readonly checkedAt: string;
}

export function reconcileProviderEvent(intentId: string | undefined, providerEvent: ProviderEvent, expectedAmount?: Money): ReconciliationRecord {
  const reasons: string[] = [];
  let status: ReconciliationStatus = "matched";

  if (!intentId) {
    status = "indeterminate";
    reasons.push("Provider event has no known local intent.");
  }
  if (expectedAmount && providerEvent.amount) {
    if (expectedAmount.currency !== providerEvent.amount.currency || expectedAmount.amountMinor !== providerEvent.amount.amountMinor) {
      status = "mismatch";
      reasons.push("Provider event amount does not match the expected intent amount.");
    }
  }
  if (expectedAmount && !providerEvent.amount) {
    status = "indeterminate";
    reasons.push("Provider event omitted an amount needed for reconciliation.");
  }

  const record = {
    id: `recon_${providerEvent.id}`,
    providerEventId: providerEvent.id,
    status,
    reasons: reasons.length === 0 ? ["Provider event matched local expectation."] : reasons,
    checkedAt: new Date().toISOString(),
  };
  return intentId ? { ...record, intentId } : record;
}

export function normalizeProviderWebhookEvent(input: ProviderWebhookInput): ProviderEvent {
  return {
    id: input.id,
    providerId: input.providerId,
    kind: input.kind,
    providerObjectId: input.providerObjectId,
    occurredAt: input.occurredAt,
    ...(input.amount ? { amount: input.amount } : {}),
    rawHash: hashWebhookPayload(input.rawPayload),
  };
}

export function createReconciliationHook(input: {
  readonly intentId?: string;
  readonly providerEvent: ProviderEvent;
  readonly expectedAmount?: Money;
}): ReconciliationRecord {
  return reconcileProviderEvent(input.intentId, input.providerEvent, input.expectedAmount);
}

function hashWebhookPayload(payload: unknown): string {
  return hashPayload(payload);
}
