import type { ProviderEnvironment, ProviderId, ProviderOperationSupport } from "../core/providers.ts";
import { getProvider } from "./capabilities.ts";
import { preflightProviderEnv, preflightProviderScopes, type ProviderScopeArea } from "./security.ts";

export type ProviderOperationKind =
  | "accounts.list"
  | "balances.get"
  | "transactions.list"
  | "counterparties.list"
  | "payments.create"
  | "payments.status"
  | "cards.list"
  | "cards.createVirtual"
  | "cards.updateSettings"
  | "cards.freeze"
  | "cards.unfreeze"
  | "cards.terminate"
  | "cards.revealSensitiveData"
  | "webhooks.subscribe";

export type ProviderOperationEffect = "read" | "money_movement" | "card_side_effect" | "sensitive_read" | "webhook";
export type ProviderOperationPlanStatus = "ready_for_conformance" | "blocked";

export interface ProviderEndpointContract {
  readonly method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly path: string;
}

export interface ProviderDocSource {
  readonly title: string;
  readonly url: string;
  readonly checkedAt: string;
}

export interface ProviderOperationContract {
  readonly operation: ProviderOperationKind;
  readonly effect: ProviderOperationEffect;
  readonly support: ProviderOperationSupport;
  readonly environments: readonly ProviderEnvironment[];
  readonly scopeArea?: ProviderScopeArea;
  readonly requiredScopes: readonly string[];
  readonly requiredEnv: readonly string[];
  readonly requiresApproval: boolean;
  readonly requiresIdempotencyKey: boolean;
  readonly requiresRequestSigning: boolean;
  readonly requiresSCA: boolean;
  readonly endpoint?: ProviderEndpointContract;
  readonly releaseGates: readonly string[];
}

export interface ProviderConformanceContract {
  readonly providerId: ProviderId;
  readonly checkedAt: string;
  readonly docs: readonly ProviderDocSource[];
  readonly operations: readonly ProviderOperationContract[];
  readonly constraints: readonly string[];
}

export interface ProviderOperationPlan {
  readonly providerId: ProviderId;
  readonly operation: ProviderOperationKind;
  readonly environment: ProviderEnvironment;
  readonly status: ProviderOperationPlanStatus;
  readonly executable: false;
  readonly support: ProviderOperationSupport;
  readonly requiredScopes: readonly string[];
  readonly grantedScopes: readonly string[];
  readonly requiredEnv: readonly string[];
  readonly acceptedEnvKeys: readonly string[];
  readonly missingScopes: readonly string[];
  readonly missingEnvKeys: readonly string[];
  readonly reasons: readonly string[];
  readonly releaseGates: readonly string[];
}

export interface ProviderOperationPlanInput {
  readonly providerId: ProviderId;
  readonly operation: ProviderOperationKind;
  readonly environment: ProviderEnvironment;
  readonly grantedScopes?: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
}

const checkedAt = "2026-06-29";
const MERCURY_ENV = ["MERCURY_API_KEY", "MERCURY_SANDBOX_API_KEY", "MERCURY_PRODUCTION_API_KEY"] as const;

export const PROVIDER_CONFORMANCE_CONTRACTS: readonly ProviderConformanceContract[] = [
  {
    providerId: "mercury",
    checkedAt,
    docs: [
      source("Mercury API changelog", "https://docs.mercury.com/changelog"),
      source("Mercury list cards", "https://docs.mercury.com/reference/listcards"),
      source("Mercury list all transactions", "https://docs.mercury.com/reference/listtransactions"),
      source("Mercury get cards for account", "https://docs.mercury.com/reference/getaccountcards"),
      source("Mercury create transaction", "https://docs.mercury.com/reference/createtransaction"),
    ],
    constraints: [
      "Mercury send-money requires recipientId, idempotencyKey, amount >= 0.01, paymentMethod ach/check/domesticWire, and purpose when paymentMethod is domesticWire.",
      "Card lifecycle operations are documented but remain non-executable until sandbox/live conformance confirms scopes, amount units, limits, and idempotency behavior.",
      "Sensitive card data is unsupported until an exact official sensitive-card endpoint source is documented.",
      "All money movement and card lifecycle operations require maker-checker approval and idempotency reservation before provider submission.",
    ],
    operations: [
      read("accounts.list", ["accounts:read"], MERCURY_ENV, { method: "GET", path: "/api/v1/accounts" }),
      read("balances.get", ["accounts:read"], MERCURY_ENV, { method: "GET", path: "/api/v1/account/{accountId}" }),
      read("transactions.list", ["transactions:read"], MERCURY_ENV, { method: "GET", path: "/api/v1/transactions" }),
      write("payments.create", "money_movement", ["transactions:write"], MERCURY_ENV, ["sandbox", "production"], {
        method: "POST",
        path: "/api/v1/account/{accountId}/transactions",
      }, [
        "Require provider recipientId before provider submission.",
        "Map provider-agnostic rail to Mercury paymentMethod ach, check, or domesticWire only.",
        "Reject Mercury payment amounts below 0.01 before provider submission.",
        "Require purpose when mapped Mercury paymentMethod is domesticWire.",
        "Verify amount units and recipient requirements against Mercury sandbox before enabling.",
      ]),
      read("payments.status", ["transactions:read"], MERCURY_ENV, { method: "GET", path: "/api/v1/transaction/{transactionId}" }),
      read("cards.list", ["cards:write"], MERCURY_ENV, { method: "GET", path: "/api/v1/cards" }),
      card("cards.createVirtual", ["cards:write"], MERCURY_ENV, ["sandbox", "production"], undefined, [
        "Confirm the newly documented card issue endpoint and sandbox lifecycle semantics before any live execution.",
      ]),
      card("cards.updateSettings", ["cards:write"], MERCURY_ENV, ["sandbox", "production"]),
      card("cards.freeze", ["cards:write"], MERCURY_ENV, ["sandbox", "production"]),
      card("cards.unfreeze", ["cards:write"], MERCURY_ENV, ["sandbox", "production"]),
      card("cards.terminate", ["cards:write"], MERCURY_ENV, ["sandbox", "production"]),
      unsupported("cards.revealSensitiveData", "sensitive_read"),
      webhook("webhooks.subscribe", MERCURY_ENV, ["sandbox", "production"], [
        "Verify Mercury webhook payload signatures and event replay behavior before trusting provider state.",
      ]),
    ],
  },
  {
    providerId: "bunq",
    checkedAt,
    docs: [
      source("bunq API docs", "https://doc.bunq.com/"),
      source("bunq payment object", "https://doc.bunq.com/basics/bunq-api-objects/payment"),
      source("bunq ordering a card", "https://doc.bunq.com/tutorials/how-to-manage-your-cards/ordering-a-card"),
    ],
    constraints: [
      "Write operations require bunq API context, device/session-server setup, X-Bunq-Client-Authentication, X-Bunq-Client-Request-Id, geolocation headers, and request signing with a private key.",
      "Card management is contract-only until direct API fixtures verify card create/update/freeze semantics in sandbox.",
      "Sensitive card/CVC data is unsupported until an exact official endpoint source is documented.",
    ],
    operations: [
      read("accounts.list", ["monetary-account:read"], ["BUNQ_API_KEY", "BUNQ_PRIVATE_KEY"], { method: "GET", path: "/user/{userID}/monetary-account" }, true),
      read("balances.get", ["monetary-account:read"], ["BUNQ_API_KEY", "BUNQ_PRIVATE_KEY"], { method: "GET", path: "/user/{userID}/monetary-account/{monetary-accountID}" }, true),
      read("transactions.list", ["payment:read"], ["BUNQ_API_KEY", "BUNQ_PRIVATE_KEY"], { method: "GET", path: "/user/{userID}/monetary-account/{monetary-accountID}/payment" }, true),
      write("payments.create", "money_movement", ["payment:write"], ["BUNQ_API_KEY", "BUNQ_PRIVATE_KEY"], ["sandbox", "production"], {
        method: "POST",
        path: "/user/{userID}/monetary-account/{monetary-accountID}/payment",
      }, ["Verify session-server persistence, request signing, and draft-vs-direct payment semantics."], true),
      read("payments.status", ["payment:read"], ["BUNQ_API_KEY", "BUNQ_PRIVATE_KEY"], { method: "GET", path: "/user/{userID}/monetary-account/{monetary-accountID}/payment/{paymentID}" }, true),
      card("cards.createVirtual", ["card:write"], ["BUNQ_API_KEY", "BUNQ_PRIVATE_KEY"], ["sandbox", "production"], {
        method: "POST",
        path: "/user/{userID}/card-credit",
      }, ["Verify accepted card type/status values and spending controls in bunq sandbox."], true),
      card("cards.updateSettings", ["card:write"], ["BUNQ_API_KEY", "BUNQ_PRIVATE_KEY"], ["sandbox", "production"], {
        method: "PUT",
        path: "/user/{userID}/card-credit/{cardID}",
      }, undefined, true),
      card("cards.freeze", ["card:write"], ["BUNQ_API_KEY", "BUNQ_PRIVATE_KEY"], ["sandbox", "production"], undefined, undefined, true),
      card("cards.unfreeze", ["card:write"], ["BUNQ_API_KEY", "BUNQ_PRIVATE_KEY"], ["sandbox", "production"], undefined, undefined, true),
      unsupported("cards.terminate", "card_side_effect"),
      unsupported("cards.revealSensitiveData", "sensitive_read"),
      webhook("webhooks.subscribe", ["BUNQ_API_KEY", "BUNQ_PRIVATE_KEY"], ["sandbox", "production"], [
        "Verify callback category filters and signature behavior before trusting webhook state.",
      ], true),
    ],
  },
  {
    providerId: "revolut-business",
    checkedAt,
    docs: [
      source("Revolut Business API", "https://developer.revolut.com/docs/business/business-api"),
      source("Revolut manage cards guide", "https://developer.revolut.com/docs/guides/manage-accounts/cards/manage-cards"),
      source("Revolut create card", "https://developer.revolut.com/docs/business/create-card"),
    ],
    constraints: [
      "Business card management is documented as unavailable in Sandbox; card plans must block sandbox execution.",
      "Business API integrations require scope checks and JWT/certificate-backed authentication before provider calls.",
      "Card creation requires request_id idempotency, virtual-only creation, and spending-limit conformance before provider submission.",
    ],
    operations: [
      read("accounts.list", ["READ"], ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"], { method: "GET", path: "/1.0/accounts" }),
      read("balances.get", ["READ"], ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"], { method: "GET", path: "/1.0/accounts/{account_id}" }),
      read("transactions.list", ["READ"], ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"], { method: "GET", path: "/1.0/transactions" }),
      read("counterparties.list", ["READ"], ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"], { method: "GET", path: "/1.0/counterparties" }),
      write("payments.create", "money_movement", ["PAY"], ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"], ["sandbox", "production"], {
        method: "POST",
        path: "/1.0/pay",
      }, ["Verify payment draft/payment flow, transfer limits, and idempotency header mapping."]),
      read("payments.status", ["READ"], ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"], { method: "GET", path: "/1.0/transactions/{transaction_id}" }),
      {
        operation: "cards.list",
        effect: "read",
        support: "documented_unverified",
        environments: ["production"],
        scopeArea: "read",
        requiredScopes: ["READ"],
        requiredEnv: ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"],
        requiresApproval: false,
        requiresIdempotencyKey: false,
        requiresRequestSigning: false,
        requiresSCA: false,
        endpoint: { method: "GET", path: "/1.0/cards" },
        releaseGates: ["Blocked in Sandbox by Revolut docs; verify response schema and redaction in production-like review before enabling."],
      },
      card("cards.createVirtual", ["WRITE"], ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"], ["production"], {
        method: "POST",
        path: "/1.0/cards",
      }, [
        "Blocked in Sandbox by Revolut docs; production requires manual API Support and card-limit confirmation.",
        "Map the intent idempotency key to Revolut request_id before provider submission.",
        "Create-card plans are virtual-only until physical-card contract evidence exists.",
        "Verify spending-limit constraints and period semantics before provider submission.",
      ]),
      card("cards.updateSettings", ["WRITE"], ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"], ["production"], { method: "PATCH", path: "/1.0/cards/{card_id}" }),
      card("cards.freeze", ["WRITE"], ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"], ["production"], { method: "POST", path: "/1.0/cards/{card_id}/freeze" }),
      card("cards.unfreeze", ["WRITE"], ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"], ["production"], { method: "POST", path: "/1.0/cards/{card_id}/unfreeze" }),
      card("cards.terminate", ["WRITE"], ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"], ["production"], { method: "POST", path: "/1.0/cards/{card_id}/terminate" }),
      sensitive("cards.revealSensitiveData", ["READ_SENSITIVE_CARD_DATA"], ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"], ["production"]),
      webhook("webhooks.subscribe", ["REVOLUT_CLIENT_ID", "REVOLUT_PRIVATE_KEY"], ["sandbox", "production"], [
        "Verify Business API webhook event types and signature verification before automated reconciliation.",
      ]),
    ],
  },
  {
    providerId: "erste-bcr",
    checkedAt,
    docs: [
      source("BCR Open Banking", "https://www.bcr.ro/en/open-banking"),
      source("Erste Developer Portal", "https://developers.erstegroup.com/"),
      source("Erste Open Banking", "https://www.erstegroup.com/en/erste-open-banking"),
    ],
    constraints: [
      "Treat BCR as PSD2 Account Information and Payment Initiation only until a separate commercial API grants broader control.",
      "All production use requires registered TPP status, consent, SCA, and redirect/session handling.",
      "No direct card lifecycle or sensitive card data contract is exposed.",
    ],
    operations: [
      read("accounts.list", ["AIS"], ["ERSTE_CLIENT_ID"], undefined, false, true),
      read("balances.get", ["AIS"], ["ERSTE_CLIENT_ID"], undefined, false, true),
      read("transactions.list", ["AIS"], ["ERSTE_CLIENT_ID"], undefined, false, true),
      write("payments.create", "money_movement", ["PIS"], ["ERSTE_CLIENT_ID"], ["sandbox", "production"], undefined, [
        "Verify PSD2 payment product matrix, consent redirect, SCA status polling, and bank-specific PSU headers.",
      ], false, true),
      unsupported("counterparties.list", "read"),
      unsupported("cards.list", "read"),
      unsupported("cards.createVirtual", "card_side_effect"),
      unsupported("cards.updateSettings", "card_side_effect"),
      unsupported("cards.freeze", "card_side_effect"),
      unsupported("cards.unfreeze", "card_side_effect"),
      unsupported("cards.terminate", "card_side_effect"),
      unsupported("cards.revealSensitiveData", "sensitive_read"),
      unsupported("webhooks.subscribe", "webhook"),
    ],
  },
] as const;

for (const contract of PROVIDER_CONFORMANCE_CONTRACTS) {
  assertProviderConformanceContract(contract);
}

export function listProviderConformanceContracts(): readonly ProviderConformanceContract[] {
  return PROVIDER_CONFORMANCE_CONTRACTS;
}

export function getProviderConformanceContract(providerId: ProviderId): ProviderConformanceContract | undefined {
  return PROVIDER_CONFORMANCE_CONTRACTS.find((contract) => contract.providerId === providerId);
}

export function getProviderOperationContract(providerId: ProviderId, operation: ProviderOperationKind): ProviderOperationContract | undefined {
  return getProviderConformanceContract(providerId)?.operations.find((candidate) => candidate.operation === operation);
}

export function planProviderOperation(input: ProviderOperationPlanInput): ProviderOperationPlan {
  const provider = getProvider(input.providerId);
  if (!provider) throw new Error(`Unknown provider: ${input.providerId}`);
  const operation = getProviderOperationContract(input.providerId, input.operation);
  if (!operation) throw new Error(`Unknown provider operation: ${input.providerId}:${input.operation}`);

  const env = preflightProviderEnv(input.providerId, input.env ?? {});
  const grantedScopes = input.grantedScopes ?? [];
  const missingScopes = operation.requiredScopes.filter((scope) => !grantedScopes.includes(scope));
  const scopeSupport = operation.scopeArea
    ? preflightProviderScopes(provider, operation.scopeArea, provider.scopes[operation.scopeArea])
    : undefined;
  const reasons: string[] = [];

  if (operation.support === "unsupported") reasons.push("Provider contract marks operation unsupported.");
  if (!operation.environments.includes(input.environment)) reasons.push(`Provider contract does not support ${input.environment} for ${operation.operation}.`);
  if (scopeSupport?.unsupportedReason) {
    reasons.push(scopeSupport.unsupportedReason);
  }
  if (missingScopes.length > 0) {
    reasons.push("Missing required provider scopes.");
  }
  if (env.missingRequiredKeys.some((key) => operation.requiredEnv.includes(key))) {
    reasons.push("Missing required provider environment keys.");
  }
  if (operation.support !== "verified") {
    reasons.push("Provider operation is not verified for live execution; only conformance planning is allowed.");
  }

  return {
    providerId: input.providerId,
    operation: input.operation,
    environment: input.environment,
    status: reasons.length === 1 && reasons[0] === "Provider operation is not verified for live execution; only conformance planning is allowed."
      ? "ready_for_conformance"
      : reasons.length === 0 ? "ready_for_conformance" : "blocked",
    executable: false,
    support: operation.support,
    requiredScopes: operation.requiredScopes,
    grantedScopes,
    requiredEnv: operation.requiredEnv,
    acceptedEnvKeys: env.allowedKeys.filter((key) => operation.requiredEnv.includes(key)),
    missingScopes,
    missingEnvKeys: env.missingRequiredKeys.filter((key) => operation.requiredEnv.includes(key)),
    reasons,
    releaseGates: operation.releaseGates,
  };
}

export function assertProviderConformanceContract(contract: ProviderConformanceContract): void {
  const provider = getProvider(contract.providerId);
  if (!provider) throw new Error(`Missing provider capability card for ${contract.providerId}`);
  const operations = new Set<ProviderOperationKind>();
  for (const operation of contract.operations) {
    if (operations.has(operation.operation)) throw new Error(`Duplicate operation ${contract.providerId}:${operation.operation}`);
    operations.add(operation.operation);
    if (operation.operation.startsWith("cards.") && !provider.capabilities.cards && operation.support !== "unsupported") {
      throw new Error(`${contract.providerId} cannot support card operation ${operation.operation}`);
    }
    if (operation.operation === "cards.revealSensitiveData" && !provider.capabilities.sensitiveCardData && operation.support !== "unsupported") {
      throw new Error(`${contract.providerId} cannot support sensitive card data without capability evidence`);
    }
    if (operation.operation.startsWith("cards.") && provider.cardOperations.productionOnly && operation.environments.includes("sandbox")) {
      throw new Error(`${contract.providerId} cannot expose sandbox card operation ${operation.operation}`);
    }
    if (operation.effect === "money_movement" && !operation.requiresApproval) {
      throw new Error(`${contract.providerId}:${operation.operation} must require approval`);
    }
  }
}

function source(title: string, url: string): ProviderDocSource {
  return { title, url, checkedAt };
}

function read(
  operation: ProviderOperationKind,
  requiredScopes: readonly string[],
  requiredEnv: readonly string[],
  endpoint?: ProviderEndpointContract,
  requiresRequestSigning = false,
  requiresSCA = false,
): ProviderOperationContract {
  return {
    operation,
    effect: "read",
    support: "documented_unverified",
    environments: ["sandbox", "production"],
    scopeArea: "read",
    requiredScopes,
    requiredEnv,
    requiresApproval: false,
    requiresIdempotencyKey: false,
    requiresRequestSigning,
    requiresSCA,
    ...(endpoint ? { endpoint } : {}),
    releaseGates: ["Verify response schema, pagination, account scoping, and redaction before trusting provider-backed reads."],
  };
}

function write(
  operation: ProviderOperationKind,
  effect: ProviderOperationEffect,
  requiredScopes: readonly string[],
  requiredEnv: readonly string[],
  environments: readonly ProviderEnvironment[],
  endpoint?: ProviderEndpointContract,
  releaseGates: readonly string[] = [],
  requiresRequestSigning = false,
  requiresSCA = false,
): ProviderOperationContract {
  return {
    operation,
    effect,
    support: "documented_unverified",
    environments,
    scopeArea: "payments",
    requiredScopes,
    requiredEnv,
    requiresApproval: true,
    requiresIdempotencyKey: true,
    requiresRequestSigning,
    requiresSCA,
    ...(endpoint ? { endpoint } : {}),
    releaseGates: releaseGates.length > 0 ? releaseGates : ["Verify request schema, idempotency behavior, limits, and provider status mapping before execution."],
  };
}

function card(
  operation: ProviderOperationKind,
  requiredScopes: readonly string[],
  requiredEnv: readonly string[],
  environments: readonly ProviderEnvironment[],
  endpoint?: ProviderEndpointContract,
  releaseGates: readonly string[] = [],
  requiresRequestSigning = false,
): ProviderOperationContract {
  return {
    operation,
    effect: "card_side_effect",
    support: "documented_unverified",
    environments,
    scopeArea: "cards",
    requiredScopes,
    requiredEnv,
    requiresApproval: true,
    requiresIdempotencyKey: true,
    requiresRequestSigning,
    requiresSCA: false,
    ...(endpoint ? { endpoint } : {}),
    releaseGates: releaseGates.length > 0 ? releaseGates : ["Verify card lifecycle endpoint, state transition, and spending-control semantics before execution."],
  };
}

function sensitive(
  operation: ProviderOperationKind,
  requiredScopes: readonly string[],
  requiredEnv: readonly string[],
  environments: readonly ProviderEnvironment[],
  requiresRequestSigning = false,
): ProviderOperationContract {
  return {
    operation,
    effect: "sensitive_read",
    support: "documented_unverified",
    environments,
    scopeArea: "sensitiveCardData",
    requiredScopes,
    requiredEnv,
    requiresApproval: true,
    requiresIdempotencyKey: false,
    requiresRequestSigning,
    requiresSCA: false,
    releaseGates: ["Verify no PAN/CVC is logged or returned through agent-visible surfaces before enabling."],
  };
}

function webhook(
  operation: ProviderOperationKind,
  requiredEnv: readonly string[],
  environments: readonly ProviderEnvironment[],
  releaseGates: readonly string[],
  requiresRequestSigning = false,
): ProviderOperationContract {
  return {
    operation,
    effect: "webhook",
    support: "documented_unverified",
    environments,
    requiredScopes: [],
    requiredEnv,
    requiresApproval: true,
    requiresIdempotencyKey: true,
    requiresRequestSigning,
    requiresSCA: false,
    releaseGates,
  };
}

function unsupported(operation: ProviderOperationKind, effect: ProviderOperationEffect): ProviderOperationContract {
  return {
    operation,
    effect,
    support: "unsupported",
    environments: [],
    requiredScopes: [],
    requiredEnv: [],
    requiresApproval: true,
    requiresIdempotencyKey: true,
    requiresRequestSigning: false,
    requiresSCA: false,
    releaseGates: ["Unsupported by the current public provider contract."],
  };
}
