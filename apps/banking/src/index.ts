export * from "./core/index.ts";
export * from "./providers/index.ts";

import { listProviders } from "./providers/index.ts";
import type { ProviderCapabilityCard, ProviderId } from "./core/providers.ts";

export interface BankingClient {
  listProviders(): readonly ProviderCapabilityCard[];
  getProvider(id: ProviderId): ProviderCapabilityCard | undefined;
}

export function createBankingClient(): BankingClient {
  return {
    listProviders,
    getProvider(id) {
      return listProviders().find((provider) => provider.id === id);
    },
  };
}
