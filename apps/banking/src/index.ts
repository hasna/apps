export type ProviderRole = "institution" | "open_banking_access";

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

export interface ProviderCapabilityCard {
  readonly id: "mercury" | "bunq" | "revolut-business" | "erste-bcr";
  readonly displayName: string;
  readonly role: ProviderRole;
  readonly capabilities: BankingProviderCapabilities;
  readonly releaseGate: string;
}

const yes = true;
const no = false;

export const PROVIDERS: readonly ProviderCapabilityCard[] = [
  {
    id: "mercury",
    displayName: "Mercury",
    role: "institution",
    capabilities: {
      accounts: yes,
      balances: yes,
      transactions: yes,
      counterparties: yes,
      payments: yes,
      paymentDrafts: yes,
      internalTransfers: yes,
      cards: yes,
      webhooks: yes,
      sandbox: yes,
      cardSandbox: yes,
      requiresTpp: no,
      requiresBusinessAccount: yes,
      sensitiveCardData: yes,
    },
    releaseGate: "Verify Mercury payment amount units, token scopes, IP policy, sandbox, and virtual-card lifecycle.",
  },
  {
    id: "bunq",
    displayName: "bunq",
    role: "institution",
    capabilities: {
      accounts: yes,
      balances: yes,
      transactions: yes,
      counterparties: yes,
      payments: yes,
      paymentDrafts: yes,
      internalTransfers: yes,
      cards: yes,
      webhooks: yes,
      sandbox: yes,
      cardSandbox: yes,
      requiresTpp: no,
      requiresBusinessAccount: yes,
      sensitiveCardData: yes,
    },
    releaseGate: "Implement and verify API context, device/session persistence, signing/OAuth, sandbox, drafts, and cards.",
  },
  {
    id: "revolut-business",
    displayName: "Revolut Business",
    role: "institution",
    capabilities: {
      accounts: yes,
      balances: yes,
      transactions: yes,
      counterparties: yes,
      payments: yes,
      paymentDrafts: yes,
      internalTransfers: yes,
      cards: yes,
      webhooks: yes,
      sandbox: yes,
      cardSandbox: no,
      requiresTpp: no,
      requiresBusinessAccount: yes,
      sensitiveCardData: yes,
    },
    releaseGate: "Verify Business API scopes, JWT/certificate auth, IP controls, and production-only card management.",
  },
  {
    id: "erste-bcr",
    displayName: "Erste BCR",
    role: "open_banking_access",
    capabilities: {
      accounts: yes,
      balances: yes,
      transactions: yes,
      counterparties: no,
      payments: yes,
      paymentDrafts: no,
      internalTransfers: no,
      cards: no,
      webhooks: no,
      sandbox: yes,
      cardSandbox: no,
      requiresTpp: yes,
      requiresBusinessAccount: no,
      sensitiveCardData: no,
    },
    releaseGate: "Treat as PSD2 AIS/PIS only until a commercial API grants broader account or card control.",
  },
] as const;

export function listProviders(): readonly ProviderCapabilityCard[] {
  return PROVIDERS;
}

export function getProvider(id: ProviderCapabilityCard["id"]): ProviderCapabilityCard | undefined {
  return PROVIDERS.find((provider) => provider.id === id);
}

export interface BankingClient {
  listProviders(): readonly ProviderCapabilityCard[];
}

export function createBankingClient(): BankingClient {
  return {
    listProviders,
  };
}
