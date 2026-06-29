export type ProviderId = "mercury" | "bunq" | "revolut-business" | "erste-bcr";
export type ProviderRole = "institution" | "open_banking_access";
export type ProviderEnvironment = "sandbox" | "production";
export type ProviderOperationSupport = "unsupported" | "documented_unverified" | "verified";
export type ProviderCardOperation = "createVirtual" | "updateSettings" | "freeze" | "unfreeze" | "terminate" | "revealSensitiveData";

export interface BankingProviderCapabilities {
  readonly accounts: boolean;
  readonly balances: boolean;
  readonly transactions: boolean;
  readonly counterparties: boolean;
  readonly payments: boolean;
  readonly paymentDrafts: boolean;
  readonly internalTransfers: boolean;
  readonly cards: boolean;
  readonly webhooks: boolean;
  readonly sandbox: boolean;
  readonly cardSandbox: boolean;
  readonly requiresTpp: boolean;
  readonly requiresBusinessAccount: boolean;
  readonly sensitiveCardData: boolean;
}

export interface ProviderScopeRequirements {
  readonly read: readonly string[];
  readonly payments: readonly string[];
  readonly cards: readonly string[];
  readonly sensitiveCardData: readonly string[];
}

export interface ProviderCardOperations {
  readonly createVirtual: ProviderOperationSupport;
  readonly updateSettings: ProviderOperationSupport;
  readonly freeze: ProviderOperationSupport;
  readonly unfreeze: ProviderOperationSupport;
  readonly terminate: ProviderOperationSupport;
  readonly revealSensitiveData: ProviderOperationSupport;
  readonly productionOnly: boolean;
}

export interface ProviderCapabilityCard {
  readonly id: ProviderId;
  readonly displayName: string;
  readonly role: ProviderRole;
  readonly capabilities: BankingProviderCapabilities;
  readonly scopes: ProviderScopeRequirements;
  readonly cardOperations: ProviderCardOperations;
  readonly environments: readonly ProviderEnvironment[];
  readonly docs: readonly string[];
  readonly releaseGate: string;
  readonly limitations: readonly string[];
}

export function assertProviderCapabilityCard(provider: ProviderCapabilityCard): void {
  if (provider.role === "open_banking_access" && provider.capabilities.cards) {
    throw new Error(`${provider.id} cannot expose direct card control as an open-banking access provider.`);
  }
  if (provider.cardOperations.productionOnly && provider.capabilities.cardSandbox) {
    throw new Error(`${provider.id} cannot mark production-only card operations as sandbox-supported.`);
  }
  if (provider.capabilities.sensitiveCardData && provider.scopes.sensitiveCardData.length === 0) {
    throw new Error(`${provider.id} must declare sensitive-card-data scope requirements.`);
  }
  if (!provider.capabilities.cards) {
    const supportedCardOperations = Object.entries(provider.cardOperations)
      .filter(([key]) => key !== "productionOnly")
      .filter(([, support]) => support !== "unsupported");
    if (supportedCardOperations.length > 0) {
      throw new Error(`${provider.id} cannot declare card operations without card capability.`);
    }
  }
}

export function isProviderCardOperationVerified(provider: ProviderCapabilityCard, operation: ProviderCardOperation): boolean {
  return provider.cardOperations[operation] === "verified";
}
