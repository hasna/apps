export * from "./core/index.ts";
export * from "./providers/index.ts";

import { listProviders } from "./providers/index.ts";
import {
  createCardLifecycleIntent,
  createCardRequestIntent,
  createCardUpdateIntent,
  createIntentEnvelope,
  createPaymentQuoteIntent,
  createPaymentRequestIntent,
  createPaymentStatusIntent,
  type CardLifecycleBuilderInput,
  type CardRequestBuilderInput,
  type CardUpdateBuilderInput,
  type IntentEnvelope,
  type PaymentIntentBuilderInput,
  type PaymentStatusBuilderInput,
} from "./core/builders.ts";
import type { ProviderCapabilityCard, ProviderId } from "./core/providers.ts";
import type { BankingIntent } from "./core/intents.ts";
import type { BankingPolicy } from "./core/policy.ts";

export interface ProviderBackedPendingResult {
  readonly status: "provider_backed_pending";
  readonly operation: string;
  readonly providerId: ProviderId;
  readonly accountId?: string;
  readonly message: string;
}

export interface ProviderReadInput {
  readonly providerId: ProviderId;
  readonly accountId?: string;
}

export interface BankingClient {
  listProviders(): readonly ProviderCapabilityCard[];
  getProvider(id: ProviderId): ProviderCapabilityCard | undefined;
  listAccounts(input: ProviderReadInput): ProviderBackedPendingResult;
  getBalance(input: ProviderReadInput & { readonly accountId: string }): ProviderBackedPendingResult;
  listTransactions(input: ProviderReadInput & { readonly accountId: string }): ProviderBackedPendingResult;
  listCards(input: ProviderReadInput): ProviderBackedPendingResult;
  createPaymentQuote(input: PaymentIntentBuilderInput, policy?: BankingPolicy): IntentEnvelope;
  createPaymentRequest(input: PaymentIntentBuilderInput, policy?: BankingPolicy): IntentEnvelope;
  createPaymentStatus(input: PaymentStatusBuilderInput, policy?: BankingPolicy): IntentEnvelope;
  createCardRequest(input: CardRequestBuilderInput, policy?: BankingPolicy): IntentEnvelope;
  createCardUpdate(input: CardUpdateBuilderInput, policy?: BankingPolicy): IntentEnvelope;
  createCardLifecycle(input: CardLifecycleBuilderInput, policy?: BankingPolicy): IntentEnvelope;
}

export function createBankingClient(): BankingClient {
  return {
    listProviders,
    getProvider(id) {
      return listProviders().find((provider) => provider.id === id);
    },
    listAccounts(input) {
      return providerBackedPending("accounts.list", input.providerId);
    },
    getBalance(input) {
      return providerBackedPending("balances.get", input.providerId, input.accountId);
    },
    listTransactions(input) {
      return providerBackedPending("transactions.list", input.providerId, input.accountId);
    },
    listCards(input) {
      return providerBackedPending("cards.list", input.providerId);
    },
    createPaymentQuote(input, policy) {
      return envelope(createPaymentQuoteIntent(input), policy);
    },
    createPaymentRequest(input, policy) {
      return envelope(createPaymentRequestIntent(input), policy);
    },
    createPaymentStatus(input, policy) {
      return envelope(createPaymentStatusIntent(input), policy);
    },
    createCardRequest(input, policy) {
      return envelope(createCardRequestIntent(input), policy);
    },
    createCardUpdate(input, policy) {
      return envelope(createCardUpdateIntent(input), policy);
    },
    createCardLifecycle(input, policy) {
      return envelope(createCardLifecycleIntent(input), policy);
    },
  };
}

function providerBackedPending(operation: string, providerId: ProviderId, accountId?: string): ProviderBackedPendingResult {
  ensureProvider(providerId);
  return {
    status: "provider_backed_pending",
    operation,
    providerId,
    ...(accountId ? { accountId } : {}),
    message: `Provider-backed operation ${operation}${accountId ? ` for account ${accountId}` : ""} is not implemented yet.`,
  };
}

function envelope(intent: BankingIntent, policy?: BankingPolicy): IntentEnvelope {
  const provider = ensureProvider(intent.providerId);
  return createIntentEnvelope(intent, provider, policy);
}

function ensureProvider(providerId: ProviderId): ProviderCapabilityCard {
  const provider = listProviders().find((candidate) => candidate.id === providerId);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  return provider;
}
