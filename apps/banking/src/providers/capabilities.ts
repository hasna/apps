import type { ProviderCapabilityCard, ProviderId } from "../core/providers.ts";
import { assertProviderCapabilityCard } from "../core/providers.ts";

const yes = true;
const no = false;
const documented = "documented_unverified";
const unsupported = "unsupported";

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
      sensitiveCardData: no,
    },
    scopes: {
      read: ["accounts:read", "transactions:read"],
      payments: ["transactions:write"],
      cards: ["cards:write"],
      sensitiveCardData: [],
    },
    cardOperations: {
      createVirtual: documented,
      updateSettings: documented,
      freeze: documented,
      unfreeze: documented,
      terminate: documented,
      revealSensitiveData: unsupported,
      productionOnly: no,
    },
    environments: ["sandbox", "production"],
    docs: [
      "https://docs.mercury.com/changelog",
      "https://docs.mercury.com/reference/getaccountcards",
      "https://docs.mercury.com/reference/createtransaction",
    ],
    releaseGate: "Verify Mercury recipientId, paymentMethod mapping, amount units, token scopes, IP policy, sandbox, and virtual-card lifecycle.",
    limitations: [
      "Card API support is recent; documented lifecycle actions stay non-executable until conformance verifies sandbox/live behavior.",
      "Sensitive card data is unsupported until an exact official sensitive-card endpoint source is documented.",
    ],
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
      sensitiveCardData: no,
    },
    scopes: {
      read: ["monetary-account:read", "payment:read"],
      payments: ["payment:write"],
      cards: ["card:write"],
      sensitiveCardData: [],
    },
    cardOperations: {
      createVirtual: documented,
      updateSettings: documented,
      freeze: documented,
      unfreeze: documented,
      terminate: unsupported,
      revealSensitiveData: unsupported,
      productionOnly: no,
    },
    environments: ["sandbox", "production"],
    docs: [
      "https://doc.bunq.com/",
      "https://doc.bunq.com/basics/bunq-api-objects/payment",
      "https://doc.bunq.com/tutorials/how-to-manage-your-cards/ordering-a-card",
    ],
    releaseGate: "Implement and verify API context, device/session persistence, X-Bunq headers, signing/OAuth, sandbox, drafts, and cards.",
    limitations: [
      "Official SDKs are not the preferred current integration path; build direct API contracts and signing tests.",
      "Sensitive card/CVC data is unsupported until an exact official endpoint source is documented.",
    ],
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
    scopes: {
      read: ["READ"],
      payments: ["PAY"],
      cards: ["WRITE"],
      sensitiveCardData: ["READ_SENSITIVE_CARD_DATA"],
    },
    cardOperations: {
      createVirtual: documented,
      updateSettings: documented,
      freeze: documented,
      unfreeze: documented,
      terminate: documented,
      revealSensitiveData: documented,
      productionOnly: yes,
    },
    environments: ["sandbox", "production"],
    docs: [
      "https://developer.revolut.com/docs/business/business-api",
      "https://developer.revolut.com/docs/guides/manage-accounts/cards/manage-cards",
      "https://developer.revolut.com/docs/business/create-card",
    ],
    releaseGate: "Verify Business API scopes, JWT/certificate auth, IP controls, and production-only card management.",
    limitations: ["Business API card management is documented as unavailable in Sandbox; tests must not claim sandbox card execution."],
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
    scopes: {
      read: ["AIS"],
      payments: ["PIS"],
      cards: [],
      sensitiveCardData: [],
    },
    cardOperations: {
      createVirtual: unsupported,
      updateSettings: unsupported,
      freeze: unsupported,
      unfreeze: unsupported,
      terminate: unsupported,
      revealSensitiveData: unsupported,
      productionOnly: no,
    },
    environments: ["sandbox", "production"],
    docs: [
      "https://www.bcr.ro/en/open-banking",
      "https://developers.erstegroup.com/",
      "https://www.erstegroup.com/en/erste-open-banking",
    ],
    releaseGate: "Treat as PSD2 AIS/PIS only until a commercial API grants broader account or card control.",
    limitations: ["Requires PSD2/TPP consent and SCA flows; no direct card-control capability is exposed in the public scope."],
  },
] as const;

for (const provider of PROVIDERS) {
  assertProviderCapabilityCard(provider);
}

export function listProviders(): readonly ProviderCapabilityCard[] {
  return PROVIDERS;
}

export function getProvider(id: ProviderId): ProviderCapabilityCard | undefined {
  return PROVIDERS.find((provider) => provider.id === id);
}
